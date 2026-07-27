import type { DB } from '@yapm/schema/db'
import { searchIndexFreshness } from '@yapm/schema/db'
import { type Kysely, sql } from 'kysely'

export interface SearchFreshnessProbeOptions {
  db: Kysely<DB>
  /**
   * How long one answer is served for. One incremental-pass interval: the counters cannot change
   * meaningfully faster than the pass that moves them, so a fresher number would be precision the
   * index does not actually have.
   */
  ttlMs: number
  statementTimeoutMs: number
  now?: () => number
}

/**
 * The `/readyz` search entry's detail string, memoised.
 *
 * The freshness query is an O(corpus) anti-join over `issue` and `comment`. The container
 * healthcheck probes every ten seconds, so recomputing it per probe would make an idle instance
 * pay a full-corpus scan forever — a readiness probe that costs more than the traffic it guards.
 *
 * The timeout is set IN POSTGRES rather than only in JavaScript. `Promise.race` abandons a promise;
 * it does not cancel a statement, so a slow scan would keep running — and keep holding a pooled
 * connection — after the probe gave up on it, and the next probe would start another one on top.
 */
export function createSearchFreshnessProbe(
  options: SearchFreshnessProbeOptions,
): () => Promise<string> {
  const { db, ttlMs, statementTimeoutMs } = options
  const clock = options.now ?? Date.now

  let cached: { at: number; detail: string } | undefined
  let inFlight: Promise<string> | undefined

  const read = async (): Promise<string> => {
    const freshness = await db.transaction().execute(async (trx) => {
      // `set local` so the ceiling dies with the transaction rather than leaking onto the next
      // caller to borrow this pooled connection — the same discipline the search route uses.
      await sql`set local statement_timeout = ${sql.lit(statementTimeoutMs)}`.execute(trx)
      return searchIndexFreshness(trx)
    })
    const age = freshness.oldestUnindexedAgeSeconds
    return `documents=${freshness.documents} sources=${freshness.sources} oldestUnindexedAgeSeconds=${age === null ? 'none' : age}`
  }

  return () => {
    const at = clock()
    if (cached !== undefined && at - cached.at < ttlMs) return Promise.resolve(cached.detail)
    if (inFlight === undefined) {
      const pending = read()
      inFlight = pending
      // Tracked on its own chain so an abandoned probe still fills the cache when its statement
      // eventually lands, and a rejection is never unhandled just because nobody was waiting.
      void pending
        .then(
          (detail) => {
            cached = { at: clock(), detail }
          },
          () => undefined,
        )
        .finally(() => {
          if (inFlight === pending) inFlight = undefined
        })
    }
    return inFlight
  }
}
