import type { Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { upsertPmDigest } from './pm-digest-writes.js'

// THE AUTHORITATIVE GENERATION WRITE, and the one property that is not about what it writes but
// about what it is not allowed to leave behind: a re-generation replaces `content` wholesale, so
// landing on a row a human had already released must take the release with it. Otherwise a
// background job swaps reviewed prose for never-reviewed model output while the row keeps syncing to
// the disclosure audience — the review-and-publish gate bypassed by a scheduler.

const CYCLE_ID = '019f8f00-0000-7000-8000-0000000000c1'
const EXISTING_ID = '019f8f00-0000-7000-8000-0000000000d1'
const FRESH_ID = '019f8f00-0000-7000-8000-0000000000d2'
const AUDIT_ID = '019f8f00-0000-7000-8000-0000000000d3'
const WORKSPACE_ID = '019f8f00-0000-7000-8000-0000000000w1'
const TEAM_ID = '019f8f00-0000-7000-8000-0000000000aa'
const NOW = 1_800_000_000_000

interface SyncWrite {
  verb: string
  value: Record<string, unknown>
}

interface RawUpdate {
  table: string
  set: Record<string, unknown>
}

interface RawInsert {
  table: string
  values: Record<string, unknown>
}

// A Kysely stand-in narrow enough to be honest: this module only ever builds
// `updateTable(...).set(...).where(...).execute()` and, through `recordDisclosureAudit`,
// `insertInto(...).values(...).execute()`.
function fakeDb() {
  const updates: RawUpdate[] = []
  const inserts: RawInsert[] = []
  const db = {
    updateTable(table: string) {
      const record: RawUpdate = { table, set: {} }
      const builder = {
        set(values: Record<string, unknown>) {
          record.set = values
          return builder
        },
        where() {
          return builder
        },
        execute() {
          updates.push(record)
          return Promise.resolve()
        },
      }
      return builder
    },
    insertInto(table: string) {
      const record: RawInsert = { table, values: {} }
      const builder = {
        values(values: Record<string, unknown>) {
          record.values = values
          return builder
        },
        execute() {
          inserts.push(record)
          return Promise.resolve()
        },
      }
      return builder
    },
  }
  return { db, updates, inserts }
}

function fakeTx(existing: unknown) {
  const syncWrites: SyncWrite[] = []
  const raw = fakeDb()
  const tx = {
    location: 'server',
    reason: 'authoritative',
    run: () => Promise.resolve(existing),
    mutate: {
      pm_digest: new Proxy(
        {},
        {
          get:
            (_target, verb: string) =>
            (value: Record<string, unknown>): Promise<void> => {
              syncWrites.push({ verb, value })
              return Promise.resolve()
            },
        },
      ),
    },
    dbTransaction: { wrappedTransaction: raw.db },
  } as unknown as Transaction
  return { tx, syncWrites, raw }
}

const CONTENT = { headline: 'Regenerated.', sections: [] }

const write = {
  id: FRESH_ID,
  auditId: AUDIT_ID,
  workspaceId: WORKSPACE_ID,
  teamId: TEAM_ID,
  cycleId: CYCLE_ID,
  status: 'ready' as const,
  content: CONTENT,
  provider: 'anthropic',
  model: 'test-model',
  generatedAt: NOW,
  inputToken: 10,
  outputToken: 20,
  estimatedCostUsd: 0.5,
  now: NOW,
}

describe('upsertPmDigest', () => {
  it('inserts an unpublished row when the cycle has none', async () => {
    const { tx, syncWrites, raw } = fakeTx(undefined)
    const result = await upsertPmDigest(tx, write)

    expect(result).toEqual({ id: FRESH_ID, inserted: true, retracted: false })
    expect(syncWrites[0]?.verb).toBe('insert')
    expect(syncWrites[0]?.value.publishedAt).toBeNull()
    expect(syncWrites[0]?.value.audienceSizeAtPublish).toBeNull()
    expect(raw.inserts).toEqual([])
  })

  // THE FALSIFIABLE ONE. New content over a released row cannot stay released, in any of the four
  // places the release is recorded.
  it('cannot leave regenerated content published, and records the forced retraction', async () => {
    const { tx, syncWrites, raw } = fakeTx({ id: EXISTING_ID, publishedAt: NOW - 1000 })
    const result = await upsertPmDigest(tx, write)

    expect(result).toEqual({ id: EXISTING_ID, inserted: false, retracted: true })

    const update = syncWrites.find((call) => call.verb === 'update')
    expect(update?.value.content).toEqual(CONTENT)
    expect(update?.value.publishedAt).toBeNull()
    expect(update?.value.audienceSizeAtPublish).toBeNull()
    expect(raw.updates[0]?.set.published_by).toBeNull()

    // The one disclosure event nobody chose, attributed to the system principal (`actor_id` null)
    // and carrying no content.
    expect(raw.inserts).toHaveLength(1)
    expect(raw.inserts[0]?.table).toBe('ai_disclosure_audit')
    expect(raw.inserts[0]?.values.event).toBe('unpublished')
    expect(raw.inserts[0]?.values.actor_id).toBeNull()
    expect(raw.inserts[0]?.values.pm_digest_id).toBe(EXISTING_ID)
    expect(JSON.stringify(raw.inserts[0]?.values.detail)).not.toContain('Regenerated')
  })

  // An unpublished row was never disclosed, so re-writing it is not a retraction and must not
  // manufacture an audit record that says one happened.
  it('records nothing when the row it replaces was never published', async () => {
    const { tx, raw } = fakeTx({ id: EXISTING_ID, publishedAt: null })
    const result = await upsertPmDigest(tx, write)

    expect(result.retracted).toBe(false)
    expect(raw.inserts).toEqual([])
  })
})
