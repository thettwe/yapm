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
    'DATABASE_URL is required in CI: the by-key deep-link scoping proof must not be skipped',
  )
}

// `issues.byKey` is the one query in the registry addressed by a GUESSABLE pair. `issues.detail`
// takes an id nobody can type; `(teamId, number)` is exactly what a URL spells, so every person who
// can read this product can ask this query for `(any team, 1)`. Reading `teamScoped` in the source
// is not a proof of what that returns — running it against real Postgres is.
//
// Each persona fails for its own specific defect:
//
//   * the owning team's member resolving their key is the leg that keeps every other one from
//     passing vacuously;
//   * the OTHER team's member resolving team A's `(teamId, number)` fails the moment `teamScoped`
//     is dropped — the deep-link widening this query was introduced to make impossible;
//   * an unauthenticated context resolving anything fails if the gate is reordered after the scope,
//     which is how deny-by-empty becomes deny-by-nothing;
//   * a triage row resolving fails if the `needsTriage` filter `issues.byTeam` carries is left off
//     here, which would make the inbox reachable by guessing a number (design DI-5);
//   * a workspace admin resolving nothing fails if the documented bypass is dropped.
describe.skipIf(DATABASE_URL === undefined)('issues.byKey deep-link scoping', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })

  const workspaceId = newId()
  const teamAId = newId()
  const teamBId = newId()
  const issueAId = newId()
  const issueBId = newId()
  const triageAId = newId()

  const MEMBER_A: AuthContext = { userID: `a-${newId()}`, role: 'member' }
  const VIEWER_A: AuthContext = { userID: `v-${newId()}`, role: 'viewer' }
  const MEMBER_B: AuthContext = { userID: `b-${newId()}`, role: 'member' }
  const ADMIN: AuthContext = { userID: `admin-${newId()}`, role: 'admin' }
  const OUTSIDER: AuthContext = { userID: `out-${newId()}`, role: 'member' }

  let meta: PgSchemaMeta

  interface IssueRow {
    id: string
    number: number
    title: string
  }

  async function byKey(
    teamId: string,
    number: number,
    ctx: AuthContext | undefined,
  ): Promise<IssueRow[]> {
    const query = queries.issues.byKey.fn({
      args: { teamId, number },
      ctx,
    }) as unknown as BuiltQuery
    const rows = await database.db
      .transaction()
      .execute(async (trx) => await createPgServerTransaction(trx, meta).run(query as never))
    // `.one()` is a client-side reading of the same result set; normalise so the assertions state
    // how many rows the query ADMITTED rather than how the runner shaped them.
    if (rows === null || rows === undefined) return []
    return (Array.isArray(rows) ? rows : [rows]) as unknown as IssueRow[]
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    meta = await readPgSchemaMeta(database.db)
    const db = database.db
    const stamp = newId().slice(-6)

    // better-auth's `getMigrations()` owns the `user` table, not our Kysely migrations, so the DDL
    // is reproduced here exactly as `queries.anonymity.pg.test.ts` does (packages never import
    // apps). The query relates `assignee` and `creator`, so without it the related subtree — not the
    // scoping — is what fails.
    await sql`
      create table if not exists "user" (
        "id" text not null primary key,
        "name" text not null,
        "email" text not null unique,
        "emailVerified" boolean not null,
        "image" text,
        "createdAt" timestamptz default current_timestamp not null,
        "updatedAt" timestamptz default current_timestamp not null
      )
    `.execute(db)
    for (const ctx of [MEMBER_A, VIEWER_A, MEMBER_B, ADMIN, OUTSIDER]) {
      await sql`
        insert into "user" ("id", "name", "email", "emailVerified")
        values (${ctx.userID}, ${ctx.userID}, ${`${ctx.userID}@example.test`}, true)
        on conflict do nothing
      `.execute(db)
    }

    await db.insertInto('workspace').values({ id: workspaceId, name: 'by-key-scope' }).execute()
    await db
      .insertInto('team')
      .values([
        { id: teamAId, workspace_id: workspaceId, name: 'A', key: `AK${stamp}` },
        { id: teamBId, workspace_id: workspaceId, name: 'B', key: `BK${stamp}` },
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

    // The SAME number in two teams, which is the whole point: `116` is not an address until a team
    // is named, and naming one in the argument must not widen the read.
    await db
      .insertInto('issue')
      .values([
        {
          id: issueAId,
          team_id: teamAId,
          number: 116,
          title: 'A-116',
          status: 'in_progress',
          priority: 'no_priority',
          creator_id: MEMBER_A.userID,
        },
        {
          id: issueBId,
          team_id: teamBId,
          number: 116,
          title: 'B-116',
          status: 'in_progress',
          priority: 'no_priority',
          creator_id: MEMBER_B.userID,
        },
        {
          id: triageAId,
          team_id: teamAId,
          number: 117,
          title: 'A-117 awaiting triage',
          status: 'backlog',
          priority: 'no_priority',
          creator_id: MEMBER_A.userID,
          needs_triage: true,
        },
      ])
      .execute()
  }, 60_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await sql`delete from "user" where id in (${MEMBER_A.userID}, ${VIEWER_A.userID}, ${MEMBER_B.userID}, ${ADMIN.userID}, ${OUTSIDER.userID})`.execute(
      database.db,
    )
    await database.close()
  })

  it('resolves the owning team member’s own key', async () => {
    const rows = await byKey(teamAId, 116, MEMBER_A)
    expect(rows.map((row) => row.id)).toEqual([issueAId])
  })

  it('resolves for a viewer of the owning team — reading is free', async () => {
    expect((await byKey(teamAId, 116, VIEWER_A)).map((row) => row.id)).toEqual([issueAId])
  })

  it('gives a member of ANOTHER team nothing, while their own key still resolves', async () => {
    expect(await byKey(teamAId, 116, MEMBER_B)).toEqual([])
    expect((await byKey(teamBId, 116, MEMBER_B)).map((row) => row.id)).toEqual([issueBId])
  })

  it('gives an unauthenticated context nothing', async () => {
    expect(await byKey(teamAId, 116, undefined)).toEqual([])
    expect(await byKey(teamAId, 116, { userID: MEMBER_A.userID, role: null })).toEqual([])
  })

  it('gives a workspace member who is in no team nothing', async () => {
    expect(await byKey(teamAId, 116, OUTSIDER)).toEqual([])
  })

  it('holds back a triage row the list also holds back', async () => {
    expect(await byKey(teamAId, 117, MEMBER_A)).toEqual([])
  })

  it('resolves for a workspace admin under the documented teamScoped bypass', async () => {
    expect((await byKey(teamAId, 116, ADMIN)).map((row) => row.id)).toEqual([issueAId])
  })
})
