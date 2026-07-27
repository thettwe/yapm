import { type Kysely, type SqlBool, sql } from 'kysely'
import { issueKeyOf } from '../search/score.js'
import { SNIPPET_START_DELIMITER, SNIPPET_STOP_DELIMITER } from '../search/snippet.js'
import type { IssueStatus } from '../zero/context.js'
import type { DB } from './types.js'

// EVERY Kysely statement over `search_document` lives here. Three rules this file carries, all of
// them load-bearing rather than stylistic:
//
//   1. ONE FILE. No `apps/server` module writes SQL against this table. Search is a read path with
//      its own permission predicate, and a predicate that can be written in two places is a
//      predicate that will eventually be written wrong in one of them.
//   2. THE SCOPING PREDICATE LIVES BESIDE THE SQL IT GUARDS. `team_id = any($teams)` is inside the
//      same scan as the full-text match, and the snippet is produced AFTER it in the same
//      statement — never over a pre-filter CTE. Search must not be able to reveal that a row
//      exists: not by returning it, not by a count, not by a ranking artefact, not by a status.
//   3. THIS TABLE IS NEVER AN AI DATA SOURCE. `body` is the plaintext projection of every indexed
//      description and comment, and mentions resolve to colleagues' CURRENT names — so it contains
//      per-person data by construction. The AI substrate's guarantee is that a model is fed only
//      team-level aggregates that structurally cannot name a person; a searchable projection of
//      every document is exactly the shape that would break it. No module under `apps/server/ai/`,
//      and neither `zero/{digest,ai-tools,cycle-facts}.ts` nor `db/cycle-facts.ts`, may import this
//      file or name `search_document`. Asserted by a test, because an absence is not self-enforcing.
//
// And one absence worth naming: no query here mentions any `retro_*` table. The allowlist that makes
// that true is a Postgres CHECK on `search_document.entity_type` (migration `0015_search`), so
// "no search path can reach the retrospective anonymity boundary" is a grep rather than a judgement.

export const SEARCH_FTS_INDEX_NAME = 'search_document_fts_idx'

export const SEARCH_ENTITY_TYPES = ['issue', 'comment'] as const

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number]

// The text-search configuration is interpolated as a SQL LITERAL, because a parameter cannot appear
// in an index expression and the query expression must match the index expression exactly or the
// index is silently not used. Zod validates the shape at boot against this same pattern; it is
// re-checked here so the invariant belongs to the statement rather than to a caller's discipline.
const TEXT_CONFIG_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/

export const DEFAULT_TEXT_SEARCH_CONFIG = 'simple'

export class SearchTextConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchTextConfigError'
  }
}

function assertTextConfig(textConfig: string): void {
  if (!TEXT_CONFIG_PATTERN.test(textConfig)) {
    throw new SearchTextConfigError(
      `SEARCH_TEXT_CONFIG: "${textConfig}" is not a valid text-search configuration name (expected ${String(TEXT_CONFIG_PATTERN)})`,
    )
  }
}

// The weighted vector, spelled ONCE. The index expression and the query expression are generated
// from this function, so they cannot drift into the silent sequential scan that a mismatched
// configuration produces. `A` is the issue title, `B` the body — a comment document carries an
// empty title, so a comment never competes with its own issue's title.
function vectorExpression(textConfig: string, alias: string): string {
  const table = alias.length > 0 ? `${alias}.` : ''
  return (
    `setweight(to_tsvector('${textConfig}', ${table}title), 'A') || ` +
    `setweight(to_tsvector('${textConfig}', ${table}body), 'B')`
  )
}

export function searchIndexDefinitionSql(textConfig: string): string {
  assertTextConfig(textConfig)
  return (
    `create index ${SEARCH_FTS_INDEX_NAME} on search_document using gin ` +
    `((${vectorExpression(textConfig, '')}))`
  )
}

// `ts_headline` returns markup by default; these two control characters replace it. See
// `search/snippet.ts` for why, and for the renderer that reads them.
const HEADLINE_OPTIONS = [
  `StartSel=${SNIPPET_START_DELIMITER}`,
  `StopSel=${SNIPPET_STOP_DELIMITER}`,
  'MaxFragments=1',
  'MaxWords=18',
  'MinWords=5',
  'HighlightAll=false',
].join(',')

export interface SearchScope {
  // The teams whose documents this actor may read. EMPTY for a non-member, which is the
  // deny-by-empty-set analogue of `denyAll`'s empty `or()` — the statement still runs and still
  // returns nothing, so a non-member's request is not a distinguishable code path.
  readonly teams: readonly string[]
  readonly isAdmin: boolean
}

// The actor's readable team set, mirroring `teamScoped` (`zero/queries.ts`) EXACTLY, including its
// workspace-admin bypass: an admin can create issues in any team of their workspace, so they can
// read them, so they can search them. A user with no `workspace_member` row is not a member and
// gets an empty set — resolved server-side from the verified session id, never from the client.
//
// Deliberately NOT filtered by `team.archived_at`: `teamScoped` does not filter it either, and
// inventing a third behaviour here would mean an issue readable in the list but invisible to search.
export async function resolveSearchScope(db: Kysely<DB>, userId: string): Promise<SearchScope> {
  const member = await db
    .selectFrom('workspace_member')
    .select(['workspace_id', 'role'])
    .where('user_id', '=', userId)
    .executeTakeFirst()

  if (member === undefined) return { teams: [], isAdmin: false }

  if (member.role === 'admin') {
    const teams = await db
      .selectFrom('team')
      .select('id')
      .where('workspace_id', '=', member.workspace_id)
      .orderBy('id', 'asc')
      .execute()
    return { teams: teams.map((team) => team.id), isAdmin: true }
  }

  const teams = await db
    .selectFrom('team_membership')
    .select('team_id')
    .where('user_id', '=', userId)
    .orderBy('team_id', 'asc')
    .execute()
  return { teams: teams.map((row) => row.team_id), isAdmin: false }
}

// A caller-supplied team can only NARROW. An intersection, never a union: a team id the actor is
// not in produces the empty set and therefore the same response as a miss, which is the whole point
// — a widening `teamId` would turn the route into a read of any team by guessing its id.
export function intersectScope(scope: SearchScope, teamId?: string | null): SearchScope {
  if (teamId === undefined || teamId === null || teamId.length === 0) return scope
  return { teams: scope.teams.filter((team) => team === teamId), isAdmin: scope.isAdmin }
}

export interface SearchDocumentsOptions {
  readonly scope: SearchScope
  readonly query: string
  readonly limit: number
  readonly textConfig: string
}

export interface SearchHit {
  readonly type: SearchEntityType
  readonly id: string
  readonly issueId: string
  readonly teamId: string
  readonly issueKey: string | null
  readonly issueTitle: string
  readonly status: IssueStatus
  readonly needsTriage: boolean
  // Already delimited (see `search/snippet.ts`). Empty when the matched document has no body text
  // to excerpt — a title-only hit on an issue with no description, most often.
  readonly snippet: string
  readonly updatedAt: Date
}

interface SearchHitRow {
  entity_type: SearchEntityType
  entity_id: string
  issue_id: string
  team_id: string
  issue_title: string
  issue_number: number | null
  issue_status: IssueStatus
  needs_triage: boolean
  team_key: string
  snippet: string | null
  source_updated_at: Date
}

// The one read. Shape notes, each one a defence rather than a preference:
//
//   * The inner select carries BOTH predicates — the scoping filter and the full-text match — in one
//     WHERE over one scan, so a token that exists only out of scope costs the same index probe as a
//     token that exists nowhere. It is not a "pre-filter CTE": it is the filter.
//   * `ts_headline` runs in the OUTER select, over at most `limit` rows that have already passed
//     the scoping filter. A snippet can therefore never be computed for a row the caller may not
//     read, which is the failure a plausible-looking rewrite (headline first, filter later) causes.
//   * `ts_rank_cd(…, 32)` is the `rank/(rank+1)` normalisation: bounded into (0,1) using nothing but
//     the document and the query. No corpus-wide statistic, no document count, no global IDF — a
//     rank must not encode how much exists outside the caller's scope. The rank is used for ordering
//     and is NEVER returned.
//   * Ordering is total: rank, then recency, then the primary key. Recency is a TIEBREAK, not a
//     blended weight (design D10) — a weight needs a coefficient only real usage can calibrate.
//     Totality is also what makes the cursor stable and the integration tests assertable.
//   * `websearch_to_tsquery` does not raise on a malformed query; it yields a tsquery that matches
//     nothing. So "unparseable" and "absent" are the same outcome here, with no error path to leak.
export async function searchDocuments(
  db: Kysely<DB>,
  options: SearchDocumentsOptions,
): Promise<SearchHit[]> {
  const { scope, query, limit, textConfig } = options
  assertTextConfig(textConfig)

  const vector = sql.raw(vectorExpression(textConfig, 'd'))
  const config = sql.raw(`'${textConfig}'`)
  const teams = [...scope.teams]

  const { rows } = await sql<SearchHitRow>`
    select
      hit.entity_type,
      hit.entity_id,
      hit.issue_id,
      hit.team_id,
      i.title as issue_title,
      i.number as issue_number,
      i.status as issue_status,
      i.needs_triage as needs_triage,
      t.key as team_key,
      hit.source_updated_at,
      ts_headline(${config}::regconfig, hit.body, websearch_to_tsquery(${config}, ${query}), ${HEADLINE_OPTIONS}) as snippet
    from (
      select
        d.entity_type,
        d.entity_id,
        d.issue_id,
        d.team_id,
        d.body,
        d.source_updated_at,
        ts_rank_cd(${vector}, websearch_to_tsquery(${config}, ${query}), 32) as rank
      from search_document d
      where d.team_id = any(${teams}::uuid[])
        and (${vector}) @@ websearch_to_tsquery(${config}, ${query})
      order by rank desc, d.source_updated_at desc, d.entity_type asc, d.entity_id asc
      limit ${limit}
    ) as hit
    join issue i on i.id = hit.issue_id
    join team t on t.id = hit.team_id
    order by hit.rank desc, hit.source_updated_at desc, hit.entity_type asc, hit.entity_id asc
  `.execute(db)

  return rows.map((row) => ({
    type: row.entity_type,
    id: row.entity_id,
    issueId: row.issue_id,
    teamId: row.team_id,
    issueKey: issueKeyOf(row.issue_number, row.team_key) ?? null,
    issueTitle: row.issue_title,
    status: row.issue_status,
    needsTriage: row.needs_triage,
    snippet: row.snippet ?? '',
    updatedAt: row.source_updated_at,
  }))
}

// ---------------------------------------------------------------------------
// Index maintenance. Every statement below is bounded by an explicit limit: these run on a shared
// job scheduler against a database that is also serving requests, so an unbounded sweep is an
// outage waiting for a big enough workspace.
// ---------------------------------------------------------------------------

// The largest number of rows one `insert … on conflict` or one `delete` may carry. The passes chunk
// to it rather than failing, so a caller cannot accidentally emit a statement with fifty thousand
// bound parameters.
export const SEARCH_WRITE_CHUNK = 200

// A source row projected for the index. One shape for both entity types, so the passes can treat
// issues and comments uniformly and the projection has one implementation.
export interface SearchSourceRow {
  readonly entityType: SearchEntityType
  readonly entityId: string
  readonly teamId: string
  readonly issueId: string
  readonly commentId: string | null
  readonly title: string
  // The rich-text document JSON, unprojected. Turning it into plaintext needs the mention id→name
  // map, which is a batch read the job owns — this file does no rich-text work.
  readonly doc: unknown
  readonly updatedAt: Date
  // Set by the reconcile diff only: true when no document exists at all, false when one exists with
  // a mismatched `source_updated_at`. The distinction is a log line, not a behaviour.
  readonly missing: boolean
}

export interface SearchDocumentRow {
  readonly entityType: SearchEntityType
  readonly entityId: string
  readonly teamId: string
  readonly issueId: string
  readonly commentId: string | null
  readonly title: string
  readonly body: string
  readonly updatedAt: Date
}

export interface SearchDocumentKey {
  readonly entityType: SearchEntityType
  readonly entityId: string
}

// One index-only lookup on the `(entity_type, source_updated_at)` btree. Null means nothing of this
// type has ever been indexed, which is the fresh-instance case: the tail then starts at the
// beginning and walks forward in bounded batches.
export async function searchWatermark(
  db: Kysely<DB>,
  entityType: SearchEntityType,
): Promise<Date | null> {
  const { rows } = await sql<{ watermark: Date | null }>`
    select max(source_updated_at) as watermark
    from search_document
    where entity_type = ${entityType}
  `.execute(db)
  return rows[0]?.watermark ?? null
}

export interface StaleBatchOptions {
  // `>=`, not `>`: rows sharing a timestamp with the watermark must never be skipped, and
  // re-indexing one costs an idempotent upsert.
  readonly since: Date | null
  readonly limit: number
}

// Both source tables declare `updated_at` as `Generated<Timestamp>`, and Kysely's `Generated<S>` is
// `ColumnType<S, S | undefined, S>` — it WRAPS rather than unwraps, so the selected type is the
// column type, not `Date`. Reading the column through a typed raw reference is the honest fix; the
// alternative is a cast at every call site.
const issueUpdatedAt = sql<Date>`issue.updated_at`
const commentUpdatedAt = sql<Date>`comment.updated_at`

// THE DIFF COMPARES AT MILLISECOND RESOLUTION, AND MUST. `timestamptz` keeps microseconds; the
// value round-trips through a JavaScript `Date`, which does not. A row whose `updated_at` came from
// the column default (`now()`) is therefore written back a few microseconds short of itself, and a
// naive `is distinct from` reports it stale on every single pass — a reconcile that re-indexes the
// entire corpus forever and never converges. Truncating the SOURCE side of the comparison to what a
// `Date` can carry is what makes the diff a fixed point.
//
// Only the comparison is truncated. `source_updated_at` still stores the value verbatim as read,
// and the watermark's `>=` re-selects the boundary row, which is idempotent by design.
const truncateToMilliseconds = (column: ReturnType<typeof sql<Date>>) =>
  sql<Date>`date_trunc('milliseconds', ${column})`

export async function staleIssueBatch(
  db: Kysely<DB>,
  options: StaleBatchOptions,
): Promise<SearchSourceRow[]> {
  let query = db
    .selectFrom('issue')
    .select(['id', 'team_id', 'title', 'description'])
    .select(issueUpdatedAt.as('updated_at'))
    .orderBy('updated_at', 'asc')
    .orderBy('id', 'asc')
    .limit(options.limit)
  if (options.since !== null) {
    query = query.where(sql<SqlBool>`${issueUpdatedAt} >= ${options.since}`)
  }
  const rows = await query.execute()
  return rows.map((row) => ({
    entityType: 'issue' as const,
    entityId: row.id,
    teamId: row.team_id,
    issueId: row.id,
    commentId: null,
    title: row.title,
    doc: row.description,
    updatedAt: row.updated_at,
    missing: false,
  }))
}

export async function staleCommentBatch(
  db: Kysely<DB>,
  options: StaleBatchOptions,
): Promise<SearchSourceRow[]> {
  let query = db
    .selectFrom('comment')
    .select(['id', 'team_id', 'issue_id', 'body'])
    .select(commentUpdatedAt.as('updated_at'))
    .orderBy('updated_at', 'asc')
    .orderBy('id', 'asc')
    .limit(options.limit)
  if (options.since !== null) {
    query = query.where(sql<SqlBool>`${commentUpdatedAt} >= ${options.since}`)
  }
  const rows = await query.execute()
  return rows.map((row) => ({
    entityType: 'comment' as const,
    entityId: row.id,
    teamId: row.team_id,
    issueId: row.issue_id,
    commentId: row.id,
    // A comment indexes ONLY its own text. Folding the parent issue's title in would make every
    // comment on an issue a hit for that issue's title.
    title: '',
    doc: row.body,
    updatedAt: row.updated_at,
    missing: false,
  }))
}

export interface ReconcileDiffOptions {
  readonly entityType: SearchEntityType
  readonly limit: number
}

// The full diff, and the reason the passes need no cursor table: it asks "which source rows have no
// document, or a document whose `source_updated_at` disagrees" and answers from current state. Run
// it repeatedly and it converges, because each pass removes its own batch from the next answer.
// It is also the first-boot backfill — on a fresh upgrade every row is missing.
//
// It exists because the watermark tail is not sufficient on its own: `updated_at` is minted at the
// client call site, so a skewed clock can write a row BEHIND the watermark, which the tail would
// miss forever. This is the only thing that heals that.
export async function reconcileDiffBatch(
  db: Kysely<DB>,
  options: ReconcileDiffOptions,
): Promise<SearchSourceRow[]> {
  if (options.entityType === 'issue') {
    const rows = await db
      .selectFrom('issue')
      .leftJoin('search_document as d', (join) =>
        join.on('d.entity_type', '=', 'issue').onRef('d.entity_id', '=', 'issue.id'),
      )
      .select([
        'issue.id as id',
        'issue.team_id as team_id',
        'issue.title as title',
        'issue.description as description',
        'd.entity_id as document_id',
      ])
      .select(issueUpdatedAt.as('updated_at'))
      // `is distinct from` covers BOTH arms in one predicate: a missing document has a null
      // `source_updated_at`, which is distinct from any real timestamp. `<>` would silently drop
      // every missing row — which is every row on a fresh instance, so the backfill would do nothing.
      .where(
        sql<SqlBool>`d.source_updated_at is distinct from ${truncateToMilliseconds(issueUpdatedAt)}`,
      )
      .orderBy('issue.id', 'asc')
      .limit(options.limit)
      .execute()
    return rows.map((row) => ({
      entityType: 'issue' as const,
      entityId: row.id,
      teamId: row.team_id,
      issueId: row.id,
      commentId: null,
      title: row.title,
      doc: row.description,
      updatedAt: row.updated_at,
      missing: row.document_id === null,
    }))
  }

  const rows = await db
    .selectFrom('comment')
    .leftJoin('search_document as d', (join) =>
      join.on('d.entity_type', '=', 'comment').onRef('d.entity_id', '=', 'comment.id'),
    )
    .select([
      'comment.id as id',
      'comment.team_id as team_id',
      'comment.issue_id as issue_id',
      'comment.body as body',
      'd.entity_id as document_id',
    ])
    .select(commentUpdatedAt.as('updated_at'))
    .where(
      sql<SqlBool>`d.source_updated_at is distinct from ${truncateToMilliseconds(commentUpdatedAt)}`,
    )
    .orderBy('comment.id', 'asc')
    .limit(options.limit)
    .execute()
  return rows.map((row) => ({
    entityType: 'comment' as const,
    entityId: row.id,
    teamId: row.team_id,
    issueId: row.issue_id,
    commentId: row.id,
    title: '',
    doc: row.body,
    updatedAt: row.updated_at,
    missing: row.document_id === null,
  }))
}

// A canary, not a sweep. `search_document.comment_id` carries `on delete cascade`, so Postgres
// removes a deleted comment's document inside the deleting transaction and this should always
// return nothing. It exists so that a future migration which drops or defers that constraint shows
// up as a number in the reconcile log rather than as deleted text that stays findable forever.
export async function orphanedCommentDocuments(
  db: Kysely<DB>,
  limit: number,
): Promise<SearchDocumentKey[]> {
  const rows = await db
    .selectFrom('search_document as d')
    .leftJoin('comment as c', 'c.id', 'd.comment_id')
    .select(['d.entity_type as entity_type', 'd.entity_id as entity_id'])
    .where('d.entity_type', '=', 'comment')
    .where('c.id', 'is', null)
    .orderBy('d.entity_id', 'asc')
    .limit(limit)
    .execute()
  return rows.map((row) => ({ entityType: row.entity_type, entityId: row.entity_id }))
}

// ONE multi-row `insert … on conflict (entity_type, entity_id) do update`, chunked to
// `SEARCH_WRITE_CHUNK`. The conflict target is the primary key itself, so there is no separate
// unique index to drift out of agreement with it and re-running any pass writes the same rows.
export async function upsertSearchDocuments(
  db: Kysely<DB>,
  documents: readonly SearchDocumentRow[],
): Promise<void> {
  for (let start = 0; start < documents.length; start += SEARCH_WRITE_CHUNK) {
    const chunk = documents.slice(start, start + SEARCH_WRITE_CHUNK)
    if (chunk.length === 0) continue
    await db
      .insertInto('search_document')
      .values(
        chunk.map((document) => ({
          entity_type: document.entityType,
          entity_id: document.entityId,
          team_id: document.teamId,
          issue_id: document.issueId,
          comment_id: document.commentId,
          title: document.title,
          body: document.body,
          source_updated_at: document.updatedAt,
          // `indexed_at` is left to its `now()` default rather than stamped from the process
          // clock — on conflict it is taken from `excluded`, which carries that same default, so a
          // re-index refreshes it without this file ever holding an opinion about the time.
        })),
      )
      .onConflict((oc) =>
        oc.columns(['entity_type', 'entity_id']).doUpdateSet((eb) => ({
          team_id: eb.ref('excluded.team_id'),
          issue_id: eb.ref('excluded.issue_id'),
          comment_id: eb.ref('excluded.comment_id'),
          title: eb.ref('excluded.title'),
          body: eb.ref('excluded.body'),
          source_updated_at: eb.ref('excluded.source_updated_at'),
          indexed_at: eb.ref('excluded.indexed_at'),
        })),
      )
      .execute()
  }
}

export async function deleteSearchDocuments(
  db: Kysely<DB>,
  keys: readonly SearchDocumentKey[],
): Promise<number> {
  let deleted = 0
  for (let start = 0; start < keys.length; start += SEARCH_WRITE_CHUNK) {
    const chunk = keys.slice(start, start + SEARCH_WRITE_CHUNK)
    if (chunk.length === 0) continue
    const result = await db
      .deleteFrom('search_document')
      .where((eb) =>
        eb.or(
          chunk.map((key) =>
            eb.and([eb('entity_type', '=', key.entityType), eb('entity_id', '=', key.entityId)]),
          ),
        ),
      )
      .executeTakeFirst()
    deleted += Number(result?.numDeletedRows ?? 0)
  }
  return deleted
}

export interface SearchIndexFreshness {
  readonly documents: number
  readonly sources: number
  // Seconds since the oldest source row that has no matching, current document was last written.
  // Null when the index is caught up.
  readonly oldestUnindexedAgeSeconds: number | null
}

interface FreshnessRow {
  documents: string
  sources: string
  oldest_unindexed_age_seconds: string | null
}

// The operator-facing freshness signal behind the NON-GATING `/readyz` entry. A stale index must
// never take an instance out of rotation, so the caller treats a failure here as a detail string,
// not as an unhealthy process.
export async function searchIndexFreshness(db: Kysely<DB>): Promise<SearchIndexFreshness> {
  const { rows } = await sql<FreshnessRow>`
    with unindexed as (
      select min(i.updated_at) as oldest
      from issue i
      left join search_document d on d.entity_type = 'issue' and d.entity_id = i.id
      where d.entity_id is null
         or d.source_updated_at is distinct from date_trunc('milliseconds', i.updated_at)
      union all
      select min(c.updated_at) as oldest
      from comment c
      left join search_document d on d.entity_type = 'comment' and d.entity_id = c.id
      where d.entity_id is null
         or d.source_updated_at is distinct from date_trunc('milliseconds', c.updated_at)
    )
    select
      (select count(*) from search_document) as documents,
      (select count(*) from issue) + (select count(*) from comment) as sources,
      (
        select floor(extract(epoch from now() - min(oldest)))::text
        from unindexed
      ) as oldest_unindexed_age_seconds
  `.execute(db)

  const row = rows[0]
  return {
    documents: Number(row?.documents ?? 0),
    sources: Number(row?.sources ?? 0),
    oldestUnindexedAgeSeconds:
      row?.oldest_unindexed_age_seconds == null ? null : Number(row.oldest_unindexed_age_seconds),
  }
}

export type EnsureSearchIndexStatus = 'unchanged' | 'created' | 'rebuilt'

export interface EnsureSearchIndexResult {
  readonly status: EnsureSearchIndexStatus
  readonly textConfig: string
}

interface IndexDefRow {
  indexdef: string
}

interface TsConfigRow {
  cfgname: string
}

// Postgres normalises `to_tsvector('simple', title)` to `to_tsvector('simple'::regconfig, title)` in
// `pg_indexes.indexdef`, so the live configuration is read back out of the stored definition rather
// than compared as text — a formatting difference must not trigger a rebuild on every run.
const REGCONFIG_IN_INDEXDEF = /'([^']+)'::regconfig/g

function configurationsIn(indexdef: string): string[] {
  return [...indexdef.matchAll(REGCONFIG_IN_INDEXDEF)].map((match) => match[1] ?? '')
}

// The expression index is built with a LITERAL configuration, so changing `SEARCH_TEXT_CONFIG`
// without rebuilding silently stops the index being used and search degrades to a sequential scan
// that nobody notices until it times out. This is what makes "cheap to reverse — rebuild one index"
// a real property rather than a runbook step somebody has to find.
//
// Two rails, because the value reaches SQL as a literal:
//   * the shape is validated (here and, earlier, by Zod at boot, failing fast BY NAME);
//   * the value must exist in `pg_ts_config` before any DDL or query uses it. An unknown
//     configuration throws and LEAVES THE EXISTING INDEX IN PLACE, so search keeps answering with
//     the old configuration rather than going dark.
//
// The drop and the create run in ONE transaction, so no concurrent session ever sees the table
// without its index.
export async function ensureSearchIndex(
  db: Kysely<DB>,
  textConfig: string,
): Promise<EnsureSearchIndexResult> {
  assertTextConfig(textConfig)

  const { rows: configs } = await sql<TsConfigRow>`
    select cfgname from pg_ts_config where cfgname = ${textConfig}
  `.execute(db)
  if (configs.length === 0) {
    throw new SearchTextConfigError(
      `SEARCH_TEXT_CONFIG: "${textConfig}" does not exist in pg_ts_config; leaving the existing search index in place`,
    )
  }

  const { rows: definitions } = await sql<IndexDefRow>`
    select indexdef from pg_indexes
    where schemaname = current_schema() and indexname = ${SEARCH_FTS_INDEX_NAME}
  `.execute(db)

  const existing = definitions[0]?.indexdef
  if (existing !== undefined) {
    const live = configurationsIn(existing)
    if (live.length > 0 && live.every((name) => name === textConfig)) {
      return { status: 'unchanged', textConfig }
    }
  }

  const create = sql.raw(searchIndexDefinitionSql(textConfig))
  await db.transaction().execute(async (trx) => {
    await sql`drop index if exists ${sql.raw(SEARCH_FTS_INDEX_NAME)}`.execute(trx)
    await create.execute(trx)
  })

  return { status: existing === undefined ? 'created' : 'rebuilt', textConfig }
}
