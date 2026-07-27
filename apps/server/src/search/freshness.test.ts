import type { DB, SearchIndexFreshness } from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import { describe, expect, it, vi } from 'vitest'
import { createSearchFreshnessProbe } from './freshness.js'

// The probe's contract is "one database round trip per incremental-pass interval, whatever the
// healthcheck does", so the fake counts transactions rather than statements.
function fakeDb(answer: () => Promise<SearchIndexFreshness>) {
  const transactions = { count: 0 }
  const db = {
    transaction: () => ({
      execute: async () => {
        transactions.count += 1
        return answer()
      },
    }),
  } as unknown as Kysely<DB>
  return { db, transactions }
}

const CAUGHT_UP: SearchIndexFreshness = {
  documents: 8421,
  sources: 8437,
  oldestUnindexedAgeSeconds: 6,
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createSearchFreshnessProbe', () => {
  it('serves one answer for a whole interval instead of scanning the corpus per probe', async () => {
    const { db, transactions } = fakeDb(() => Promise.resolve(CAUGHT_UP))
    let now = 1_000
    const probe = createSearchFreshnessProbe({
      db,
      ttlMs: 10_000,
      statementTimeoutMs: 2_000,
      now: () => now,
    })

    const first = await probe()
    expect(first).toBe('documents=8421 sources=8437 oldestUnindexedAgeSeconds=6')
    expect(transactions.count).toBe(1)

    // The container healthcheck probes every ten seconds; the pass that moves these counters runs
    // on the same interval, so every probe inside one is answered from memory.
    now += 9_000
    expect(await probe()).toBe(first)
    expect(transactions.count).toBe(1)

    now += 2_000
    await probe()
    expect(transactions.count).toBe(2)
  })

  it('reports a caught-up index as none rather than as zero', async () => {
    const { db } = fakeDb(() =>
      Promise.resolve({ documents: 3, sources: 3, oldestUnindexedAgeSeconds: null }),
    )
    const probe = createSearchFreshnessProbe({ db, ttlMs: 10_000, statementTimeoutMs: 2_000 })
    expect(await probe()).toBe('documents=3 sources=3 oldestUnindexedAgeSeconds=none')
  })

  it('does not cache a failure and coalesces concurrent probes onto one read', async () => {
    const answer = vi
      .fn<() => Promise<SearchIndexFreshness>>()
      .mockRejectedValueOnce(new Error('canceling statement due to statement timeout'))
      .mockResolvedValue(CAUGHT_UP)
    const { db, transactions } = fakeDb(() => answer())
    const probe = createSearchFreshnessProbe({ db, ttlMs: 10_000, statementTimeoutMs: 2_000 })

    await expect(probe()).rejects.toThrow('statement timeout')
    await tick()

    const [a, b] = await Promise.all([probe(), probe()])
    expect(a).toBe(b)
    // A failure left nothing cached, and the two overlapping probes shared ONE statement rather
    // than piling a second full-corpus scan on top of the first.
    expect(transactions.count).toBe(2)
  })
})
