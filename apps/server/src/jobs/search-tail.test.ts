import type { DB, SearchSourceRow } from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import { describe, expect, it, vi } from 'vitest'

// The tail's control flow, isolated from Postgres. The live-database suite proves the SQL; what
// needs a deterministic harness is the branch a timestamp collision takes, because reproducing one
// in a shared database means writing rows this file does not own (design I42).
const reads = vi.hoisted(() => ({
  watermark: vi.fn(),
  issues: vi.fn(),
  comments: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@yapm/schema/db', () => ({
  searchWatermark: reads.watermark,
  staleIssueBatch: reads.issues,
  staleCommentBatch: reads.comments,
  upsertSearchDocuments: reads.upsert,
  deleteSearchDocuments: vi.fn(),
  ensureSearchIndex: vi.fn(),
  orphanedCommentDocuments: vi.fn(),
  reconcileDiffBatch: vi.fn(),
}))

import { runSearchIndexTail } from './search.js'

const COLLIDED = new Date('2026-07-01T00:00:00.000Z')

function source(entityType: 'issue' | 'comment', entityId: string): SearchSourceRow {
  return {
    entityType,
    entityId,
    teamId: 'team-1',
    issueId: 'issue-1',
    commentId: entityType === 'comment' ? entityId : null,
    title: entityType === 'issue' ? `Issue ${entityId}` : '',
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    updatedAt: COLLIDED,
    missing: true,
  }
}

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('runSearchIndexTail', () => {
  it('keeps walking the comment tail after the issue tail stalls on a timestamp collision', async () => {
    const log = logger()
    // Two full batches of issues, every row sharing one timestamp: the cursor cannot advance past
    // the second without skipping rows, so the issue tail stops and defers to the reconcile.
    reads.watermark.mockResolvedValue(COLLIDED)
    reads.issues.mockResolvedValue([source('issue', 'a'), source('issue', 'b')])
    reads.comments.mockResolvedValueOnce([source('comment', 'c')]).mockResolvedValue([])
    reads.upsert.mockResolvedValue(undefined)

    const result = await runSearchIndexTail({
      db: {} as unknown as Kysely<DB>,
      logger: log,
      batchSize: 2,
    })

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(result.drained).toBe(false)
    // The load-bearing one: a stall is a property of ONE type's cursor. Sharing the flag with the
    // outer loop skipped comments entirely, and the collision is self-perpetuating until the
    // reconcile heals it — so comments would never have been indexed again.
    expect(reads.comments).toHaveBeenCalled()
    expect(result.indexed).toBe(3)
  })

  it('stops at the wall-clock budget without starting the next entity type', async () => {
    const log = logger()
    reads.watermark.mockResolvedValue(null)
    reads.issues.mockReset()
    reads.comments.mockReset()

    const result = await runSearchIndexTail({
      db: {} as unknown as Kysely<DB>,
      logger: log,
      budgetMs: -1,
    })

    expect(result.drained).toBe(false)
    expect(result.indexed).toBe(0)
    expect(reads.issues).not.toHaveBeenCalled()
    expect(reads.comments).not.toHaveBeenCalled()
  })
})
