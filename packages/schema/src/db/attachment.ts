import { type Kysely, sql } from 'kysely'
import type { DB } from './types.js'

// EVERY Kysely statement over `attachment` lives here, on the `db/search.ts` one-file rule. Three
// properties this file carries, all load-bearing rather than stylistic:
//
//   1. ONE FILE. No `apps/server` module writes SQL against this table. Attachments are a read path
//      with their own permission predicate, and a predicate that can be written in two places is a
//      predicate that will eventually be written wrong in one of them.
//   2. THE SCOPING PREDICATE LIVES BESIDE THE SQL IT GUARDS. `findAttachmentForReader` carries the
//      id AND the reader's team scope in ONE statement. A row fetched and then rejected by a
//      caller's `if` is a timing difference, and — the reason that actually matters — it is a shape
//      one plausible-looking refactor turns into a `403` beside a `404`, which is the oracle the
//      whole design exists to avoid.
//   3. THERE IS NO KEY IN THIS FILE. The storage key is `<team_id>/<id>`, derived where the bytes
//      are handled. Nothing here returns, stores or names a path, a URL or a capability of any
//      kind: the id is a name, and naming a file you may not read gets you the same refusal as
//      naming one that does not exist.
//
// And one absence worth naming: there is no `attachment` mutator anywhere in `zero/mutators.ts`.
// Every write below is reachable only from the REST upload path, where the row and the object move
// together in one request.

export interface AttachmentRow {
  readonly id: string
  readonly teamId: string
  readonly issueId: string | null
  readonly commentId: string | null
  readonly uploaderId: string
  readonly filename: string
  // The SNIFFED media type, never the client's claim.
  readonly contentType: string
  readonly byteSize: number
  readonly hasThumbnail: boolean
  readonly createdAt: Date
}

interface AttachmentSelectRow {
  id: string
  team_id: string
  issue_id: string | null
  comment_id: string | null
  uploader_id: string
  filename: string
  content_type: string
  // `bigint` — node-postgres hands `int8` back as a STRING, and no global type parser is registered
  // (one would change how every other int8 in the process reads). Converted at this boundary so
  // nothing outside this file ever sees it.
  byte_size: string | number
  has_thumbnail: boolean
  created_at: Date
}

const SELECTED = [
  'id',
  'team_id',
  'issue_id',
  'comment_id',
  'uploader_id',
  'filename',
  'content_type',
  'byte_size',
  'has_thumbnail',
  'created_at',
] as const

function toRow(row: AttachmentSelectRow): AttachmentRow {
  return {
    id: row.id,
    teamId: row.team_id,
    issueId: row.issue_id,
    commentId: row.comment_id,
    uploaderId: row.uploader_id,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    hasThumbnail: row.has_thumbnail,
    createdAt: row.created_at,
  }
}

// The reader's scope, mirroring `teamScoped` (`zero/queries.ts`) EXACTLY, including its
// workspace-admin bypass: an admin can create issues in any team of their workspace, so they can
// read them, so they can read what is attached to them. Spelled as a SQL fragment rather than as a
// resolved team list so it can be inlined into the same statement as the id lookup.
function readableByFragment(userId: string) {
  return sql<boolean>`(
    exists (
      select 1 from team_membership m
      where m.team_id = attachment.team_id and m.user_id = ${userId}
    )
    or exists (
      select 1 from workspace_member wm
      join team t on t.workspace_id = wm.workspace_id
      where wm.user_id = ${userId} and wm.role = 'admin' and t.id = attachment.team_id
    )
  )`
}

export interface CreateAttachmentInput {
  // Minted by the caller before the object is written, so the key and the row agree even if the
  // insert never happens (the sweep and the upload's own rollback both clean that up).
  readonly id: string
  readonly teamId: string
  readonly uploaderId: string
  readonly filename: string
  readonly contentType: string
  readonly byteSize: number
  readonly hasThumbnail: boolean
  readonly issueId?: string | null
  readonly commentId?: string | null
}

export async function createAttachment(
  db: Kysely<DB>,
  input: CreateAttachmentInput,
): Promise<AttachmentRow> {
  const row = await db
    .insertInto('attachment')
    .values({
      id: input.id,
      team_id: input.teamId,
      uploader_id: input.uploaderId,
      filename: input.filename,
      content_type: input.contentType,
      byte_size: input.byteSize,
      has_thumbnail: input.hasThumbnail,
      issue_id: input.issueId ?? null,
      comment_id: input.commentId ?? null,
    })
    .returning(SELECTED)
    .executeTakeFirstOrThrow()
  return toRow(row as unknown as AttachmentSelectRow)
}

export interface AttachmentReaderQuery {
  readonly id: string
  readonly userId: string
}

// THE read. One statement whose `WHERE` carries both the id and the reader's scope, so "no such
// row" and "a row in a team you are not in" are the same `null` — not two branches the caller has
// to remember to collapse.
//
// A malformed id would make Postgres raise `invalid input syntax for type uuid`, which is a
// distinguishable outcome; the caller rejects a non-UUID before reaching here, and this returns
// `null` for one anyway rather than trusting that.
export async function findAttachmentForReader(
  db: Kysely<DB>,
  query: AttachmentReaderQuery,
): Promise<AttachmentRow | null> {
  if (!UUID_PATTERN.test(query.id)) return null
  const row = await db
    .selectFrom('attachment')
    .select(SELECTED)
    .where('id', '=', query.id)
    .where(readableByFragment(query.userId))
    .executeTakeFirst()
  return row === undefined ? null : toRow(row as unknown as AttachmentSelectRow)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AttachTarget {
  readonly id: string
  readonly userId: string
  readonly issueId?: string | null
  readonly commentId?: string | null
}

// Attach ONCE, from null, and only to a target already proven to be in the row's own team. The
// `is null` guards are in the statement rather than in a read-then-write, so two concurrent
// attaches cannot both win and an already-attached row is never re-parented — the update simply
// matches nothing and the caller gets `null`, which folds into the standard refusal.
export async function attachAttachment(
  db: Kysely<DB>,
  target: AttachTarget,
): Promise<AttachmentRow | null> {
  if (!UUID_PATTERN.test(target.id)) return null
  let update = db
    .updateTable('attachment')
    .where('id', '=', target.id)
    .where(readableByFragment(target.userId))
  if (target.issueId != null) {
    update = update.where('issue_id', 'is', null).set({ issue_id: target.issueId })
  }
  if (target.commentId != null) {
    update = update.where('comment_id', 'is', null).set({ comment_id: target.commentId })
  }
  const row = await update.returning(SELECTED).executeTakeFirst()
  return row === undefined ? null : toRow(row as unknown as AttachmentSelectRow)
}

// Idempotent by construction: the second call deletes nothing and reports `false`, which the route
// turns into the same refusal as an id that never existed.
export async function deleteAttachment(db: Kysely<DB>, id: string): Promise<boolean> {
  if (!UUID_PATTERN.test(id)) return false
  const result = await db.deleteFrom('attachment').where('id', '=', id).executeTakeFirst()
  return Number(result?.numDeletedRows ?? 0) > 0
}

export interface OrphanedAttachmentsOptions {
  // Rows created before this instant with neither edge set. The grace window is the caller's
  // policy; this statement only knows the cutoff.
  readonly createdBefore: Date
  // ALWAYS bounded. This runs on a shared scheduler against a database that is also serving
  // requests, so an unbounded sweep is an outage waiting for a big enough instance.
  readonly limit: number
}

export async function listOrphanedAttachments(
  db: Kysely<DB>,
  options: OrphanedAttachmentsOptions,
): Promise<AttachmentRow[]> {
  const rows = await db
    .selectFrom('attachment')
    .select(SELECTED)
    .where('issue_id', 'is', null)
    .where('comment_id', 'is', null)
    .where('created_at', '<', options.createdBefore)
    .orderBy('created_at', 'asc')
    .limit(options.limit)
    .execute()
  return rows.map((row) => toRow(row as unknown as AttachmentSelectRow))
}

export interface UploadScopeQuery {
  readonly userId: string
  readonly teamId: string
}

// May this caller PUT bytes into this team? Membership in the team (or the workspace-admin bypass
// that `teamScoped` and `assertTeamAccess` both carry), and not the `viewer` role — viewers are
// read-only everywhere else and are read-only here.
//
// It lives beside the read predicate rather than in the route because the two must agree about what
// a team is; a write gate written in the route is a second definition of membership.
export async function canUploadToTeam(db: Kysely<DB>, query: UploadScopeQuery): Promise<boolean> {
  if (!UUID_PATTERN.test(query.teamId)) return false
  const member = await db
    .selectFrom('workspace_member')
    .select(['workspace_id', 'role'])
    .where('user_id', '=', query.userId)
    .executeTakeFirst()
  if (member === undefined || member.role === 'viewer') return false

  if (member.role === 'admin') {
    const team = await db
      .selectFrom('team')
      .select('id')
      .where('id', '=', query.teamId)
      .where('workspace_id', '=', member.workspace_id)
      .executeTakeFirst()
    return team !== undefined
  }

  const membership = await db
    .selectFrom('team_membership')
    .select('id')
    .where('team_id', '=', query.teamId)
    .where('user_id', '=', query.userId)
    .executeTakeFirst()
  return membership !== undefined
}

export interface TargetScopeQuery {
  readonly teamId: string
  readonly issueId?: string | null
  readonly commentId?: string | null
}

// The one place a cross-team edge could be forged into existence: an upload naming a team the
// caller belongs to, but an issue or comment in a different one. Both are checked against the
// SAME `teamId` the row will carry, so an edge can never point out of its own team.
export async function targetsAreInTeam(db: Kysely<DB>, query: TargetScopeQuery): Promise<boolean> {
  if (query.issueId != null) {
    if (!UUID_PATTERN.test(query.issueId)) return false
    const issue = await db
      .selectFrom('issue')
      .select('id')
      .where('id', '=', query.issueId)
      .where('team_id', '=', query.teamId)
      .executeTakeFirst()
    if (issue === undefined) return false
  }
  if (query.commentId != null) {
    if (!UUID_PATTERN.test(query.commentId)) return false
    const comment = await db
      .selectFrom('comment')
      .select('id')
      .where('id', '=', query.commentId)
      .where('team_id', '=', query.teamId)
      .executeTakeFirst()
    if (comment === undefined) return false
  }
  return true
}
