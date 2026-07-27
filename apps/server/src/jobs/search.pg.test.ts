import { newId } from '@yapm/schema'
import { createDatabase, type Database, migrateToLatest } from '@yapm/schema/db'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSearchIndexTail, runSearchReconcile } from './search.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the search index job test must not be skipped')
}

const doc = (text: string): string =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe.skipIf(DATABASE_URL === undefined)('search index jobs over live Postgres', () => {
  let database: Database
  let logger: ReturnType<typeof silentLogger>
  const workspaceId = newId()
  const teamId = newId()
  const authorId = newId()
  const issueIds = [newId(), newId(), newId(), newId(), newId()]
  const commentId = newId()

  const documentOf = async (entityType: 'issue' | 'comment', entityId: string) =>
    database.db
      .selectFrom('search_document')
      .select(['title', 'body', 'source_updated_at'])
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .executeTakeFirst()

  const teamDocumentCount = async (): Promise<number> => {
    const row = await database.db
      .selectFrom('search_document')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('team_id', '=', teamId)
      .executeTakeFirst()
    return Number(row?.count ?? 0)
  }

  const reconcile = (overrides: { batchSize?: number; budgetMs?: number } = {}) =>
    runSearchReconcile({ db: database.db, logger, textConfig: 'simple', ...overrides })

  const tail = (overrides: { batchSize?: number; budgetMs?: number } = {}) =>
    runSearchIndexTail({ db: database.db, logger, ...overrides })

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    const db = database.db

    await db.insertInto('workspace').values({ id: workspaceId, name: 'search-jobs-test' }).execute()
    await db
      .insertInto('team')
      .values({
        id: teamId,
        workspace_id: workspaceId,
        name: 'Indexing',
        key: `J${newId().slice(0, 4)}`,
      })
      .execute()
    await db
      .insertInto('issue')
      .values(
        issueIds.map((id, index) => ({
          id,
          team_id: teamId,
          number: index + 1,
          title: `Indexed issue ${index + 1}`,
          description: doc(`Body text for issue ${index + 1}`),
          status: 'todo' as const,
          priority: 'medium' as const,
          creator_id: authorId,
        })),
      )
      .execute()
    await db
      .insertInto('comment')
      .values({
        id: commentId,
        issue_id: issueIds[0] ?? '',
        team_id: teamId,
        author_id: authorId,
        body: doc('A comment that must stop being findable the moment it is deleted'),
      })
      .execute()
  }, 120_000)

  beforeEach(() => {
    logger = silentLogger()
  })

  afterAll(async () => {
    if (database === undefined) return
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.close()
  })

  it('backfills from empty in bounded batches, and is resumable when the budget runs out', async () => {
    // A pass with no budget left indexes NOTHING and says so, rather than running to completion
    // anyway. That is what makes a first-boot backfill safe to interleave with serving traffic.
    const exhausted = await reconcile({ budgetMs: -1 })
    expect(exhausted.indexed).toBe(0)
    expect(exhausted.drained).toBe(false)

    // Two rows at a time over six sources: the pass loops until the diff is empty.
    const filled = await reconcile({ batchSize: 2 })
    expect(filled.drained).toBe(true)
    expect(await teamDocumentCount()).toBe(issueIds.length + 1)
    expect((await documentOf('issue', issueIds[0] ?? ''))?.title).toBe('Indexed issue 1')
    expect((await documentOf('comment', commentId))?.body).toContain('stop being findable')
    // A comment indexes only its own text — a comment document's title is empty, so searching an
    // issue's title cannot return every comment on it.
    expect((await documentOf('comment', commentId))?.title).toBe('')
  }, 120_000)

  it('re-indexes an edited title on the next tail pass', async () => {
    await reconcile()
    // Written as raw SQL: `updated_at` is `Generated<Timestamp>`, and Kysely's `Generated<S>`
    // WRAPS rather than unwraps, so the update type is the ColumnType and not a `Date`.
    await sql`
      update issue set title = ${'Edited after indexing'}, updated_at = ${new Date(Date.now() + 1000)}
      where id = ${issueIds[1] ?? ''}
    `.execute(database.db)

    const result = await tail()
    expect(result.indexed).toBeGreaterThan(0)
    expect((await documentOf('issue', issueIds[1] ?? ''))?.title).toBe('Edited after indexing')
  }, 120_000)

  it('misses a backdated row in the tail and heals it in the reconcile', async () => {
    await reconcile()
    // `updated_at` is minted at the client call site, so a skewed clock writes BEHIND the
    // watermark. The tail cannot see it by construction; only the diff can.
    const backdated = new Date(Date.now() - 60 * 60 * 1000)
    await sql`
      update issue set title = ${'Written by a skewed clock'}, updated_at = ${backdated}
      where id = ${issueIds[2] ?? ''}
    `.execute(database.db)

    await tail()
    expect((await documentOf('issue', issueIds[2] ?? ''))?.title).toBe('Indexed issue 3')

    const healed = await reconcile()
    expect(healed.stale).toBeGreaterThan(0)
    expect((await documentOf('issue', issueIds[2] ?? ''))?.title).toBe('Written by a skewed clock')
  }, 120_000)

  it('removes a deleted comment document inside the deleting transaction, with no sweep', async () => {
    await reconcile()
    expect(await documentOf('comment', commentId)).toBeDefined()

    await database.db.deleteFrom('comment').where('id', '=', commentId).execute()

    // No pass has run: the FK cascade did it.
    expect(await documentOf('comment', commentId)).toBeUndefined()

    const swept = await reconcile()
    expect(swept.orphaned).toBe(0)
  }, 120_000)

  it('changes nothing when either pass runs twice', async () => {
    await reconcile()
    const snapshot = async () =>
      database.db
        .selectFrom('search_document')
        .select(['entity_type', 'entity_id', 'title', 'body', 'source_updated_at'])
        .where('team_id', '=', teamId)
        .orderBy('entity_type', 'asc')
        .orderBy('entity_id', 'asc')
        .execute()

    const before = await snapshot()
    // `stale` is the non-convergence signal: a document that exists but disagrees with its source.
    // It must be zero on a second pass, and it was NOT — `timestamptz` keeps microseconds and a
    // JavaScript `Date` does not, so every row written back from its column default looked
    // perpetually stale and the reconcile re-indexed the whole corpus on every run, forever.
    // (A concurrently created row would count as `missing`, not `stale`, so this is not a race.)
    expect((await reconcile()).stale).toBe(0)
    // The tail deliberately re-selects the watermark row (`>=`, so a shared timestamp is never
    // skipped), so "changes nothing" is a property of the WRITE, not of the read: the upsert is
    // idempotent and the rows come back identical.
    await tail()
    expect(await snapshot()).toEqual(before)
  }, 120_000)
})
