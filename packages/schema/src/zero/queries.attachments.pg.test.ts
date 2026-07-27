import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import { queries } from './queries.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from './testing/pg-transaction.js'
import type { BuiltQuery } from './testing/query-ast.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the attachment sync-scoping proof must not be skipped',
  )
}

// `attachments.byIssue` is the ONLY way an attachment row reaches a client, and rows sync — so
// whatever this query admits lands in that person's IndexedDB and stays there. Reading the query
// and seeing `teamScoped` around it is not a proof; running it against real Postgres is.
//
// Each persona below fails for a different specific defect:
//
//   * the owning team's member seeing nothing fails if the correlated membership subquery is
//     mis-joined — the assertion that keeps every other leg from passing vacuously;
//   * the OTHER TEAM's member seeing rows fails the moment the wrapper is dropped, which is the
//     one-line change this test exists for. That persona also reads their OWN issue's attachment
//     successfully, so "empty" here is a fact about scoping rather than about a query that returns
//     nothing for anybody;
//   * an unauthenticated context seeing rows fails if the `isMember` gate is reordered after the
//     scope, which is how a deny-by-empty becomes a deny-by-nothing;
//   * a workspace member in NO team seeing rows fails if `teamScoped` degrades to "authenticated";
//   * a workspace admin seeing NOTHING fails if the documented bypass is dropped — an admin who
//     can create an issue in any team but cannot see its files is a broken Files list, not a
//     tighter permission;
//   * a member passing another team's `issueId` seeing rows fails if the scope is ever taken from
//     the argument instead of from the verified context.
describe.skipIf(DATABASE_URL === undefined)('attachments.byIssue sync scoping', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })

  const workspaceId = newId()
  const teamAId = newId()
  const teamBId = newId()
  const issueAId = newId()
  const issueBId = newId()
  const firstAId = newId()
  const secondAId = newId()
  const attachmentBId = newId()

  const MEMBER_A: AuthContext = { userID: `a-${newId()}`, role: 'member' }
  const VIEWER_A: AuthContext = { userID: `v-${newId()}`, role: 'viewer' }
  const MEMBER_B: AuthContext = { userID: `b-${newId()}`, role: 'member' }
  // A workspace admin who belongs to NO team — the widest read anyone has, and the persona the
  // bypass is actually about.
  const ADMIN: AuthContext = { userID: `admin-${newId()}`, role: 'admin' }
  // A workspace member in no team at all: denied by the correlated `whereExists`, not by an empty
  // query, so this is the persona that exercises the subquery compilation rather than the gate.
  const OUTSIDER: AuthContext = { userID: `out-${newId()}`, role: 'member' }

  let meta: PgSchemaMeta

  interface AttachmentRow {
    id: string
    teamId: string
    issueId: string | null
    filename: string
    byteSize: number
  }

  async function byIssue(issueId: string, ctx: AuthContext | undefined): Promise<AttachmentRow[]> {
    const query = queries.attachments.byIssue.fn({
      args: { issueId },
      ctx,
    }) as unknown as BuiltQuery
    const rows = await database.db
      .transaction()
      .execute(async (trx) => await createPgServerTransaction(trx, meta).run(query as never))
    return rows as unknown as AttachmentRow[]
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    meta = await readPgSchemaMeta(database.db)
    const db = database.db
    const stamp = newId().slice(-6)

    await db.insertInto('workspace').values({ id: workspaceId, name: 'attachment-scope' }).execute()
    await db
      .insertInto('team')
      .values([
        { id: teamAId, workspace_id: workspaceId, name: 'A', key: `AT${stamp}` },
        { id: teamBId, workspace_id: workspaceId, name: 'B', key: `BT${stamp}` },
      ])
      .execute()
    await db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: MEMBER_A.userID, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: VIEWER_A.userID, role: 'viewer' },
        { id: newId(), workspace_id: workspaceId, user_id: MEMBER_B.userID, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: ADMIN.userID, role: 'admin' },
        { id: newId(), workspace_id: workspaceId, user_id: OUTSIDER.userID, role: 'member' },
      ])
      .execute()
    await db
      .insertInto('team_membership')
      .values([
        { id: newId(), team_id: teamAId, user_id: MEMBER_A.userID },
        { id: newId(), team_id: teamAId, user_id: VIEWER_A.userID },
        { id: newId(), team_id: teamBId, user_id: MEMBER_B.userID },
      ])
      .execute()
    await db
      .insertInto('issue')
      .values([
        {
          id: issueAId,
          team_id: teamAId,
          number: 1,
          title: 'A',
          status: 'todo',
          priority: 'no_priority',
          creator_id: MEMBER_A.userID,
        },
        {
          id: issueBId,
          team_id: teamBId,
          number: 1,
          title: 'B',
          status: 'todo',
          priority: 'no_priority',
          creator_id: MEMBER_B.userID,
        },
      ])
      .execute()

    // `created_at` is set explicitly and out of insertion order, so "ordered by createdAt asc" is a
    // claim the rows can actually falsify rather than an accident of insert order.
    await db
      .insertInto('attachment')
      .values([
        {
          id: secondAId,
          team_id: teamAId,
          issue_id: issueAId,
          uploader_id: MEMBER_A.userID,
          filename: 'second.png',
          content_type: 'image/png',
          byte_size: 4096,
          has_thumbnail: false,
          created_at: new Date('2026-07-01T10:00:00.000Z'),
        },
        {
          id: firstAId,
          team_id: teamAId,
          issue_id: issueAId,
          uploader_id: MEMBER_A.userID,
          filename: 'first.png',
          content_type: 'image/png',
          byte_size: 1024,
          has_thumbnail: false,
          created_at: new Date('2026-07-01T09:00:00.000Z'),
        },
        {
          id: attachmentBId,
          team_id: teamBId,
          issue_id: issueBId,
          uploader_id: MEMBER_B.userID,
          filename: 'other-team.png',
          content_type: 'image/png',
          byte_size: 2048,
          has_thumbnail: false,
          created_at: new Date('2026-07-01T11:00:00.000Z'),
        },
      ])
      .execute()
  }, 60_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  it('gives the owning team both rows, in upload order', async () => {
    const rows = await byIssue(issueAId, MEMBER_A)
    expect(rows.map((row) => row.id)).toEqual([firstAId, secondAId])
    expect(rows.map((row) => row.filename)).toEqual(['first.png', 'second.png'])
  })

  it('reads byte_size back as a number, not the string node-postgres hands back for int8', async () => {
    const [first] = await byIssue(issueAId, MEMBER_A)
    expect(first?.byteSize).toBe(1024)
  })

  it('gives a viewer of the owning team the same rows — reading files is free', async () => {
    const rows = await byIssue(issueAId, VIEWER_A)
    expect(rows.map((row) => row.id)).toEqual([firstAId, secondAId])
  })

  it('gives a member of ANOTHER team nothing, while their own issue still resolves', async () => {
    expect(await byIssue(issueAId, MEMBER_B)).toEqual([])
    // Not a query that returns nothing for everyone: B reads B's issue.
    expect((await byIssue(issueBId, MEMBER_B)).map((row) => row.id)).toEqual([attachmentBId])
  })

  it('gives an unauthenticated context nothing', async () => {
    expect(await byIssue(issueAId, undefined)).toEqual([])
    expect(await byIssue(issueAId, { userID: MEMBER_A.userID, role: null })).toEqual([])
  })

  it('gives a workspace member who is in no team nothing', async () => {
    expect(await byIssue(issueAId, OUTSIDER)).toEqual([])
  })

  it('gives a workspace admin the rows under the documented teamScoped bypass', async () => {
    const rows = await byIssue(issueAId, ADMIN)
    expect(rows.map((row) => row.id)).toEqual([firstAId, secondAId])
  })

  it('never widens past the caller memberships when handed another team issueId', async () => {
    expect(await byIssue(issueBId, MEMBER_A)).toEqual([])
    expect(await byIssue(issueBId, VIEWER_A)).toEqual([])
  })
})
