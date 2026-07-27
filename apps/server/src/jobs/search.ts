import { extractMentionIds, richTextToPlainText, SEARCH_BODY_MAX_LENGTH } from '@yapm/schema'
import type { DB, SearchDocumentRow, SearchEntityType, SearchSourceRow } from '@yapm/schema/db'
import {
  deleteSearchDocuments,
  ensureSearchIndex,
  orphanedCommentDocuments,
  reconcileDiffBatch,
  searchWatermark,
  staleCommentBatch,
  staleIssueBatch,
  upsertSearchDocuments,
} from '@yapm/schema/db'
import { type Kysely, type SqlBool, sql } from 'kysely'

export const SEARCH_INDEX_QUEUE = 'search-index'
export const SEARCH_RECONCILE_QUEUE = 'search-reconcile'

const ENTITY_TYPES: readonly SearchEntityType[] = ['issue', 'comment']

// One read's worth of source rows. Small enough that a pass never holds a large result set or a
// long transaction, large enough that a first-boot backfill converges in minutes rather than hours.
export const SEARCH_BATCH_SIZE = 200

// The wall-clock ceiling on ONE pass. The tail re-arms itself, so a pass that runs out of budget is
// not a failure — it is the next pass's starting point. This is what keeps a backfill from
// monopolising a connection for as long as the corpus takes.
export const SEARCH_PASS_BUDGET_MS = 20_000

// Postgres' `foreign_key_violation`. A source row deleted between the read and the upsert makes the
// whole multi-row statement fail; the batch is dropped and the next pass converges. Failing the
// pass instead would let one racing delete stop indexing until someone noticed.
const FOREIGN_KEY_VIOLATION = '23503'

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION
  )
}

export interface SearchJobLogger {
  info: (obj: object, msg: string) => void
  warn: (obj: object, msg: string) => void
  error: (obj: object, msg: string) => void
}

export interface SearchIndexOptions {
  db: Kysely<DB>
  logger: SearchJobLogger
  batchSize?: number
  budgetMs?: number
  now?: () => number
}

export interface SearchIndexResult {
  readonly indexed: number
  readonly batches: number
  readonly dropped: number
  readonly drained: boolean
}

// Mention ids resolve to the person's CURRENT name, which is why a rename propagates on the next
// reindex and the stored `label` is only ever a fallback. One read per batch, not per row.
//
// `search_document.body` therefore contains colleagues' names — which is exactly why the table is
// never an AI data source (`db/search.ts`'s header rule 3). `'strip'` stays mandatory on
// model-facing paths; this is not one of them.
async function resolveNames(
  db: Kysely<DB>,
  rows: readonly SearchSourceRow[],
): Promise<ReadonlyMap<string, string>> {
  const ids = new Set<string>()
  for (const row of rows) {
    // The SAME walker the mention fan-out uses, not a second traversal of the document.
    for (const id of extractMentionIds(row.doc)) ids.add(id)
  }
  if (ids.size === 0) return new Map()
  const users = await db
    .selectFrom('user')
    .select(['id', 'name'])
    .where(sql<SqlBool>`id = any(${[...ids]})`)
    .execute()
  return new Map(users.map((user) => [user.id, user.name]))
}

function project(
  rows: readonly SearchSourceRow[],
  names: ReadonlyMap<string, string>,
): SearchDocumentRow[] {
  return rows.map((row) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    teamId: row.teamId,
    issueId: row.issueId,
    commentId: row.commentId,
    title: row.title,
    body: richTextToPlainText(row.doc, {
      mentions: 'label',
      names,
      maxLength: SEARCH_BODY_MAX_LENGTH,
    }),
    updatedAt: row.updatedAt,
  }))
}

interface WriteBatchResult {
  readonly indexed: number
  readonly dropped: number
}

async function writeBatch(
  options: SearchIndexOptions,
  rows: readonly SearchSourceRow[],
): Promise<WriteBatchResult> {
  const { db, logger } = options
  try {
    const names = await resolveNames(db, rows)
    await upsertSearchDocuments(db, project(rows, names))
    return { indexed: rows.length, dropped: 0 }
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error
    logger.warn(
      { batch: rows.length },
      'search index batch dropped: a source row was deleted mid-pass',
    )
    return { indexed: 0, dropped: rows.length }
  }
}

// The incremental tail. Per entity type: read the watermark (`max(source_updated_at)`, one
// index-only lookup), then walk forward from it in bounded batches until the batch comes back
// short — which is what "drained" means — or the wall-clock budget is spent.
//
// The watermark is read ONCE per entity type per pass and the loop advances by re-reading the
// stale batch, so a batch whose rows all share a timestamp cannot spin: `>=` re-selects them, the
// upsert is idempotent, and the pass exits on the short batch. A tail alone is not sufficient —
// `updated_at` is minted at the client call site, so a skewed clock writes rows BEHIND the
// watermark. `runSearchReconcile` is the only thing that heals those.
export async function runSearchIndexTail(options: SearchIndexOptions): Promise<SearchIndexResult> {
  const { db, logger } = options
  const batchSize = options.batchSize ?? SEARCH_BATCH_SIZE
  const budgetMs = options.budgetMs ?? SEARCH_PASS_BUDGET_MS
  const clock = options.now ?? Date.now
  const deadline = clock() + budgetMs

  let indexed = 0
  let batches = 0
  let dropped = 0
  let drained = true

  for (const entityType of ENTITY_TYPES) {
    // Read ONCE per entity type, then walked forward in memory. Re-reading it per batch would be a
    // spin whenever a full batch shares one timestamp, because `>=` would re-select the same rows.
    let since = await searchWatermark(db, entityType)
    // Per type, because a stall is a property of ONE type's cursor. A shared flag let a timestamp
    // collision in the issue tail skip the comment tail entirely — and permanently, because the
    // collision is self-perpetuating until the reconcile heals it, so comments would never index.
    let outOfBudget = false
    for (;;) {
      if (clock() >= deadline) {
        drained = false
        outOfBudget = true
        break
      }
      const rows =
        entityType === 'issue'
          ? await staleIssueBatch(db, { since, limit: batchSize })
          : await staleCommentBatch(db, { since, limit: batchSize })
      if (rows.length === 0) break
      const result = await writeBatch(options, rows)
      indexed += result.indexed
      dropped += result.dropped
      batches += 1
      // A short batch means the cursor now covers everything of this type.
      if (rows.length < batchSize) break
      const last = rows[rows.length - 1]?.updatedAt
      if (last === undefined || (since !== null && last.getTime() <= since.getTime())) {
        // A whole batch sharing one timestamp: the cursor cannot advance without skipping rows, so
        // the tail stops rather than spinning. The reconcile diff is what heals it.
        logger.warn(
          { entityType, batch: rows.length },
          'search index tail stalled on a timestamp collision; the reconcile pass will heal it',
        )
        drained = false
        break
      }
      since = last
    }
    // Only a spent wall-clock budget means there is no time left for the NEXT type. A stall does
    // not: the next type's cursor is independent and still has budget to spend.
    if (outOfBudget) break
  }

  if (indexed > 0 || dropped > 0) {
    logger.info({ indexed, batches, dropped, drained }, 'search index tail ran')
  }
  return { indexed, batches, dropped, drained }
}

export interface SearchReconcileOptions extends SearchIndexOptions {
  textConfig: string
}

export interface SearchReconcileResult {
  readonly indexed: number
  readonly stale: number
  readonly orphaned: number
  readonly missing: number
  readonly index: string
  readonly drained: boolean
}

// The full diff, the orphan canary and the index-definition guard, in one pass. Also the
// first-boot backfill: on a fresh upgrade every source row is missing, the diff finds them, and
// running it repeatedly converges because each pass removes its own batch from the next answer.
//
// `ensureSearchIndex` runs FIRST and its failure fails the pass: an unknown `SEARCH_TEXT_CONFIG`
// means the index and the query would disagree, and indexing into that state would write rows the
// route cannot find. The existing index is left in place, so search keeps answering meanwhile.
export async function runSearchReconcile(
  options: SearchReconcileOptions,
): Promise<SearchReconcileResult> {
  const { db, logger, textConfig } = options
  const batchSize = options.batchSize ?? SEARCH_BATCH_SIZE
  const budgetMs = options.budgetMs ?? SEARCH_PASS_BUDGET_MS
  const clock = options.now ?? Date.now
  const deadline = clock() + budgetMs

  const ensured = await ensureSearchIndex(db, textConfig)

  let indexed = 0
  let stale = 0
  let missing = 0
  let drained = true

  for (const entityType of ENTITY_TYPES) {
    for (;;) {
      if (clock() >= deadline) {
        drained = false
        break
      }
      const rows = await reconcileDiffBatch(db, { entityType, limit: batchSize })
      if (rows.length === 0) break
      const result = await writeBatch(options, rows)
      indexed += result.indexed
      if (result.indexed > 0) {
        for (const row of rows) {
          if (row.missing) missing += 1
          else stale += 1
        }
      }
      if (rows.length < batchSize) break
    }
    if (!drained) break
  }

  // A canary rather than a sweep: `comment_id` carries `on delete cascade`, so this should always
  // be zero. A non-zero number is how a future migration that drops the constraint shows up as a
  // log line instead of as deleted text that stays findable forever.
  const orphans = await orphanedCommentDocuments(db, batchSize)
  const orphaned = orphans.length > 0 ? await deleteSearchDocuments(db, orphans) : 0

  logger.info(
    { indexed, stale, orphaned, missing, index: ensured.status, drained },
    'search reconcile ran',
  )
  return { indexed, stale, orphaned, missing, index: ensured.status, drained }
}
