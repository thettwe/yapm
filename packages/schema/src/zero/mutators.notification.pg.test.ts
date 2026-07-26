import { type Kysely, sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import { recordNotifications } from '../db/notification.js'
import type { DB } from '../db/types.js'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import { NOTIFICATION_RECIPIENT_CAP } from './notifications/recipients.js'
import { queries } from './queries.js'
import { createServerMutators } from './server-mutators.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from './testing/pg-transaction.js'
import type { BuiltQuery } from './testing/query-ast.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the notification fan-out proof must not be skipped',
  )
}

// THE FALSIFIABLE CHECK for the notification change.
//
// Everything the design claims about the per-recipient invariant is asserted here against real
// Postgres, run the way zero-cache runs mutators: one open transaction per mutation, every read
// seeing the writes before it.
//
// Each assertion fails for a DIFFERENT specific defect:
//
//   * "exactly one row after running the same mutation twice" fails if the natural key is not a
//     real uniqueness constraint in Postgres — the whole crux, proved rather than argued.
//   * "a teammate sees zero" fails if the query is not filtered by recipient at all.
//   * "a WORKSPACE ADMIN sees zero" fails for the one-line `teamScoped` copy-paste that looks
//     completely normal in review. No ordinary test catches it; this one exists for it.
//   * "a client-location transaction writes zero" fails if the fan-out escapes the rebase guard.
//   * "markAllRead stamps only the caller's rows" fails if the recipient is ever taken from args.
//
// The supporting half runs every trigger site, so `issue.routeIssue` — a duplicated assignee path
// that is easy to miss — and `retro.convertActionToIssue` — which calls the SHARED `issue.create`
// function and therefore bypasses the override that owns the fan-out — cannot be silently absent.
describe.skipIf(DATABASE_URL === undefined)('notification fan-out against Postgres', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const mutators = createServerMutators()

  const workspaceId = newId()
  const teamId = newId()
  const otherTeamId = newId()
  const issueId = newId()
  const otherIssueId = newId()

  // A is a WORKSPACE ADMIN — the widest read anyone in this workspace has — and the actor in every
  // assignment below. If an admin could read an inbox, A would read B's.
  const A: AuthContext = { userID: `admin-${newId()}`, role: 'admin' }
  const B: AuthContext = { userID: `member-b-${newId()}`, role: 'member' }
  const C: AuthContext = { userID: `member-c-${newId()}`, role: 'member' }

  const bTeamMembershipId = newId()
  const bOtherTeamMembershipId = newId()
  const bWorkspaceMemberId = newId()

  let meta: PgSchemaMeta

  async function apply<T>(
    run: (tx: ReturnType<typeof createPgServerTransaction>) => Promise<T>,
  ): Promise<T> {
    return await database.db
      .transaction()
      .execute(async (trx) => await run(createPgServerTransaction(trx, meta)))
  }

  // The same Postgres-backed transaction, relabelled as the OPTIMISTIC client pass. `dbTransaction`
  // is still present and still usable, so if the fan-out were missing its `tx.location !== 'server'`
  // guard it would write real rows here — which is what makes "zero rows" a fact about the guard
  // rather than about a transaction that could not have written anyway.
  async function applyAsClient<T>(
    run: (tx: ReturnType<typeof createPgServerTransaction>) => Promise<T>,
  ): Promise<T> {
    return await database.db.transaction().execute(async (trx) => {
      const server = createPgServerTransaction(trx, meta)
      return await run({ ...server, location: 'client', reason: 'optimistic' } as typeof server)
    })
  }

  async function rows<T>(query: ReturnType<typeof sql<T>>): Promise<T[]> {
    const { rows: result } = await query.execute(database.db)
    return result
  }

  interface InboxRow {
    kind: string
    subjectId: string
    subjectKey: string | null
    subjectTitle: string
    actorId: string
    readAt: number | null
    teamId: string
  }

  // The inbox exactly as a client receives it: the registered synced query, evaluated against live
  // Postgres with that caller's verified context.
  async function inbox(ctx: AuthContext): Promise<InboxRow[]> {
    const query = queries.notifications.mine.fn({ args: undefined, ctx }) as unknown as BuiltQuery
    return (await apply(async (tx) => await tx.run(query as never))) as unknown as InboxRow[]
  }

  async function notificationCount(): Promise<number> {
    const result = await rows(
      sql<{ n: string }>`select count(*) as n from notification where team_id in (${sql.join([
        sql`${teamId}::uuid`,
        sql`${otherTeamId}::uuid`,
      ])})`,
    )
    return Number(result[0]?.n ?? 0)
  }

  // `issue.create` and `comment.create` insert a row keyed on a CALL-SITE-MINTED id, so a second
  // identical application cannot get past its own insert — in any mutator in this repo, not just
  // these. Running them twice therefore means "attempt twice"; the second attempt's transaction
  // rolls back whole, and what is asserted is that exactly one notification row exists afterwards.
  // The natural key's own idempotency under a genuinely repeated authoritative write is asserted
  // separately, at the seam, in "the write seam is idempotent on its own".
  async function attempt(run: () => Promise<unknown>): Promise<void> {
    try {
      await run()
    } catch {
      // expected for the insert-shaped mutators on the second pass
    }
  }

  async function createAuthUserTable(db: Kysely<DB>): Promise<void> {
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
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    await createAuthUserTable(database.db)
    meta = await readPgSchemaMeta(database.db)

    await sql`insert into workspace (id, name) values (${workspaceId}, 'notification-pg-test')`.execute(
      database.db,
    )
    const stamp = Date.now() % 10_000
    await sql`
      insert into team (id, workspace_id, name, key) values
        (${teamId}, ${workspaceId}, 'Engineering', ${`NA${stamp}`}),
        (${otherTeamId}, ${workspaceId}, 'Platform', ${`NB${stamp}`})
    `.execute(database.db)

    for (const ctx of [A, B, C]) {
      await sql`
        insert into "user" (id, name, email, "emailVerified")
        values (${ctx.userID}, ${ctx.userID}, ${`${ctx.userID}@example.test`}, true)
      `.execute(database.db)
    }
  }, 60_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    for (const ctx of [A, B, C]) {
      await sql`delete from "user" where id = ${ctx.userID}`.execute(database.db)
    }
    await database.close()
  })

  // Memberships and issues are rebuilt every test, so the leaver cases (which delete memberships by
  // design) leave nothing behind for the next one.
  beforeEach(async () => {
    await sql`delete from notification where team_id in (${sql.join([
      sql`${teamId}::uuid`,
      sql`${otherTeamId}::uuid`,
    ])})`.execute(database.db)
    await sql`delete from comment where team_id = ${teamId}`.execute(database.db)
    await sql`delete from issue where team_id in (${sql.join([
      sql`${teamId}::uuid`,
      sql`${otherTeamId}::uuid`,
    ])})`.execute(database.db)
    await sql`delete from team_membership where team_id in (${sql.join([
      sql`${teamId}::uuid`,
      sql`${otherTeamId}::uuid`,
    ])})`.execute(database.db)
    await sql`delete from workspace_member where workspace_id = ${workspaceId}`.execute(database.db)

    await sql`
      insert into workspace_member (id, workspace_id, user_id, role) values
        (${newId()}, ${workspaceId}, ${A.userID}, 'admin'),
        (${bWorkspaceMemberId}, ${workspaceId}, ${B.userID}, 'member'),
        (${newId()}, ${workspaceId}, ${C.userID}, 'member')
    `.execute(database.db)
    await sql`
      insert into team_membership (id, team_id, user_id) values
        (${newId()}, ${teamId}, ${A.userID}),
        (${bTeamMembershipId}, ${teamId}, ${B.userID}),
        (${newId()}, ${teamId}, ${C.userID}),
        (${bOtherTeamMembershipId}, ${otherTeamId}, ${B.userID}),
        (${newId()}, ${otherTeamId}, ${A.userID})
    `.execute(database.db)
    await sql`
      insert into issue (id, team_id, number, title, status, priority, creator_id) values
        (${issueId}, ${teamId}, 7, 'Flaky login redirect', 'todo', 'no_priority', ${C.userID}),
        (${otherIssueId}, ${otherTeamId}, 3, 'Slow deploy step', 'todo', 'no_priority', ${A.userID})
    `.execute(database.db)
  })

  async function assignTwice(): Promise<void> {
    const args = { id: issueId, assigneeId: B.userID, updatedAt: 1000 }
    await apply((tx) => mutators.issue.assign.fn({ tx, args, ctx: A }))
    await apply((tx) => mutators.issue.assign.fn({ tx, args, ctx: A }))
  }

  describe('the same assignment applied twice', () => {
    beforeEach(assignTwice)

    it('gives the assignee exactly one row, shaped as the inbox renders it', async () => {
      const received = await inbox(B)
      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({
        kind: 'issue_assigned',
        subjectId: issueId,
        actorId: A.userID,
        readAt: null,
        teamId,
      })
      // The team's key and the issue's number, snapshotted at the moment it happened.
      expect(received[0]?.subjectKey).toMatch(/^NA\d+-7$/u)
      expect(received[0]?.subjectTitle).toBe('Flaky login redirect')
    })

    it('gives a teammate who is not the assignee zero rows', async () => {
      expect(await inbox(C)).toEqual([])
    })

    // THE ASSERTION THAT EXISTS FOR ONE MISTAKE. A is a workspace admin and the actor; `teamScoped`
    // would hand them every row in the workspace. An inbox has no admin bypass, ever.
    it('gives the WORKSPACE ADMIN zero rows', async () => {
      expect(await inbox(A)).toEqual([])
    })

    it('marks all read for the caller and for nobody else', async () => {
      // C created the issue, so B commenting on it gives C a row of their own — which is what makes
      // "only B's rows were stamped" a real distinction rather than a vacuous one.
      await apply((tx) =>
        mutators.comment.create.fn({
          tx,
          args: {
            id: newId(),
            issueId,
            body: { type: 'doc', content: [] },
            createdAt: 3000,
            updatedAt: 3000,
          },
          ctx: B,
        }),
      )
      expect((await inbox(C)).length).toBeGreaterThan(0)

      await apply((tx) =>
        mutators.notification.markAllRead.fn({ tx, args: { readAt: 4000 }, ctx: B }),
      )

      expect((await inbox(B)).every((row) => row.readAt === 4000)).toBe(true)
      expect((await inbox(C)).every((row) => row.readAt === null)).toBe(true)
    })
  })

  it('writes nothing at all on the optimistic client pass', async () => {
    await applyAsClient((tx) =>
      mutators.issue.assign.fn({
        tx,
        args: { id: issueId, assigneeId: B.userID, updatedAt: 1000 },
        ctx: A,
      }),
    )
    expect(await notificationCount()).toBe(0)
    // The mutation itself still landed — this is a guard on the fan-out, not a disabled mutator.
    const issue = await rows(
      sql<{ assignee_id: string | null }>`select assignee_id from issue where id = ${issueId}`,
    )
    expect(issue[0]?.assignee_id).toBe(B.userID)
  })

  describe('every trigger site', () => {
    it('issue.create with an assignee yields exactly one row, with the claimed number', async () => {
      const createdId = newId()
      const args = {
        id: createdId,
        teamId,
        title: 'Wire the inbox badge',
        status: 'todo' as const,
        priority: 'no_priority' as const,
        assigneeId: B.userID,
        createdAt: 5000,
        updatedAt: 5000,
      }
      await attempt(() => apply((tx) => mutators.issue.create.fn({ tx, args, ctx: A })))
      await attempt(() => apply((tx) => mutators.issue.create.fn({ tx, args, ctx: A })))

      const received = (await inbox(B)).filter((row) => row.subjectId === createdId)
      expect(received).toHaveLength(1)
      // The fan-out runs AFTER the per-team number is claimed, so the key is never null here.
      expect(received[0]?.subjectKey).not.toBeNull()
    })

    // THE SITE THAT GETS SILENTLY MISSED. `routeIssue` carries its own `assigneeId` and sets it
    // directly, independent of `issue.assign`. Being routed to somebody out of triage is an
    // assignment, and it notifies like one.
    it('issue.routeIssue with an assignee yields exactly one row', async () => {
      const args = { id: issueId, assigneeId: B.userID, status: 'todo' as const, updatedAt: 6000 }
      await apply((tx) => mutators.issue.routeIssue.fn({ tx, args, ctx: A }))
      await apply((tx) => mutators.issue.routeIssue.fn({ tx, args, ctx: A }))

      const received = await inbox(B)
      expect(received).toHaveLength(1)
      expect(received[0]?.kind).toBe('issue_assigned')
    })

    it('issue.routeIssue that routes no assignee tells nobody', async () => {
      await apply((tx) =>
        mutators.issue.assign.fn({
          tx,
          args: { id: issueId, assigneeId: B.userID, updatedAt: 1000 },
          ctx: A,
        }),
      )
      await sql`delete from notification where recipient_id = ${B.userID}`.execute(database.db)
      await apply((tx) =>
        mutators.issue.routeIssue.fn({
          tx,
          args: { id: issueId, status: 'in_progress' as const, updatedAt: 7000 },
          ctx: A,
        }),
      )
      expect(await inbox(B)).toEqual([])
    })

    it('comment.create reaches the assignee and the creator, never the commenter', async () => {
      await apply((tx) =>
        mutators.issue.assign.fn({
          tx,
          args: { id: issueId, assigneeId: B.userID, updatedAt: 1000 },
          ctx: A,
        }),
      )
      const commentId = newId()
      const args = {
        id: commentId,
        issueId,
        body: { type: 'doc', content: [] },
        createdAt: 8000,
        updatedAt: 8000,
      }
      // Commented by A, who is the actor; the issue is assigned to B and was created by C.
      await attempt(() => apply((tx) => mutators.comment.create.fn({ tx, args, ctx: A })))
      await attempt(() => apply((tx) => mutators.comment.create.fn({ tx, args, ctx: A })))

      const forB = (await inbox(B)).filter((row) => row.kind === 'issue_commented')
      const forC = await inbox(C)
      expect(forB).toHaveLength(1)
      expect(forC).toHaveLength(1)
      expect(await inbox(A)).toEqual([])
      // `event_key` is the comment's own id, so a second, different comment is a second row.
      await apply((tx) =>
        mutators.comment.create.fn({
          tx,
          args: { ...args, id: newId(), createdAt: 9000, updatedAt: 9000 },
          ctx: A,
        }),
      )
      expect((await inbox(C)).length).toBe(2)
    })

    // THE FIFTH SITE, and the one the four above cannot cover: `retro.convertActionToIssue` calls
    // the SHARED `issue.create` function directly rather than the override that owns the fan-out,
    // so an action carrying an owner produced an assigned issue nobody was told about.
    it('retro.convertActionToIssue with an owner yields exactly one row, with the claimed number', async () => {
      const retroId = newId()
      const actionId = newId()
      const convertedId = newId()
      await sql`
        insert into retro (id, team_id, title, format, phase, created_by)
        values (${retroId}, ${teamId}, 'Cycle retro', 'mad_sad_glad', 'actions', ${A.userID})
      `.execute(database.db)
      await sql`
        insert into retro_action (id, retro_id, team_id, body, assignee_id)
        values (${actionId}, ${retroId}, ${teamId}, 'Cut the reconnect backoff', ${B.userID})
      `.execute(database.db)

      const args = { actionId, issueId: convertedId, createdAt: 11_000, updatedAt: 11_000 }
      await attempt(() =>
        apply((tx) => mutators.retro.convertActionToIssue.fn({ tx, args, ctx: A })),
      )
      // Idempotent by the action's own `issue_id`, so a second pass converts nothing and tells
      // nobody a second time.
      await attempt(() =>
        apply((tx) => mutators.retro.convertActionToIssue.fn({ tx, args, ctx: A })),
      )

      const received = (await inbox(B)).filter((row) => row.subjectId === convertedId)
      expect(received).toHaveLength(1)
      expect(received[0]?.kind).toBe('issue_assigned')
      // The fan-out runs AFTER the per-team number is claimed here too.
      expect(received[0]?.subjectKey).not.toBeNull()

      await sql`delete from retro where id = ${retroId}`.execute(database.db)
    })
  })

  // INVOLVEMENT IS NOT MEMBERSHIP. A comment's recipients are computed from involvement — creator,
  // standing assignee, prior commenters — every one of which can outlive the membership that
  // authorised it. The row carries the team's issue key and title, and `notifications.mine` has no
  // team predicate, so without a membership re-check at WRITE time an ex-team-member syncs and
  // reads work they no longer have access to. Delivery already re-checks at send time; this is the
  // same guarantee, one step earlier.
  describe('a recipient who has left the issue’s team', () => {
    const leftBehindId = newId()

    beforeEach(async () => {
      await sql`
        insert into issue (id, team_id, number, title, status, priority, creator_id, assignee_id)
        values (${leftBehindId}, ${teamId}, 9, 'Filed before B left', 'todo', 'no_priority', ${B.userID}, ${A.userID})
      `.execute(database.db)
      await sql`delete from team_membership where id = ${bTeamMembershipId}`.execute(database.db)
    })

    it('is not told about a comment on an issue they created', async () => {
      await apply((tx) =>
        mutators.comment.create.fn({
          tx,
          args: {
            id: newId(),
            issueId: leftBehindId,
            body: { type: 'doc', content: [] },
            createdAt: 10_000,
            updatedAt: 10_000,
          },
          ctx: C,
        }),
      )

      expect(await inbox(B)).toEqual([])
      // An intersection, not a blanket refusal: A is the assignee and still in the team.
      const forA = await inbox(A)
      expect(forA).toHaveLength(1)
      expect(forA[0]?.kind).toBe('issue_commented')
    })
  })

  // WHICH END THE CAP FALLS ON. The prior-commenter read is bounded, so on a thread longer than the
  // cap it has to keep the people currently discussing the issue and drop the ones who stopped.
  // Read oldest-first it does exactly the opposite: whoever commented once at the very start is
  // notified forever and everyone in the live conversation is silently dropped.
  describe('a thread longer than the recipient cap', () => {
    const busyIssueId = newId()
    const commenters = Array.from(
      { length: NOTIFICATION_RECIPIENT_CAP + 10 },
      (_, index) => `chatty-${index}-${newId()}`,
    )

    beforeAll(async () => {
      for (const id of commenters) {
        await sql`
          insert into "user" (id, name, email, "emailVerified")
          values (${id}, ${id}, ${`${id}@example.test`}, true)
        `.execute(database.db)
      }
    }, 60_000)

    afterAll(async () => {
      for (const id of commenters) {
        await sql`delete from "user" where id = ${id}`.execute(database.db)
      }
    })

    beforeEach(async () => {
      // Team membership only: the fan-out's own membership intersection is what these have to
      // satisfy, and none of them reads an inbox here.
      for (const id of commenters) {
        await sql`
          insert into team_membership (id, team_id, user_id) values (${newId()}, ${teamId}, ${id})
        `.execute(database.db)
      }
      // Created by A, who is also the actor below, so the creator slot is filtered out as a
      // self-notification and the cap falls purely on the commenter list.
      await sql`
        insert into issue (id, team_id, number, title, status, priority, creator_id)
        values (${busyIssueId}, ${teamId}, 11, 'Long thread', 'todo', 'no_priority', ${A.userID})
      `.execute(database.db)
      for (const [index, id] of commenters.entries()) {
        await sql`
          insert into comment (id, issue_id, team_id, author_id, body, created_at)
          values (${newId()}, ${busyIssueId}, ${teamId}, ${id}, '{}'::jsonb, ${new Date(1_000 + index)})
        `.execute(database.db)
      }
    }, 60_000)

    it('tells the newest participants and drops the ones who stopped commenting', async () => {
      await apply((tx) =>
        mutators.comment.create.fn({
          tx,
          args: {
            id: newId(),
            issueId: busyIssueId,
            body: { type: 'doc', content: [] },
            createdAt: 20_000,
            updatedAt: 20_000,
          },
          ctx: A,
        }),
      )

      const told = await rows(
        sql<{
          recipient_id: string
        }>`select recipient_id from notification where subject_id = ${busyIssueId}`,
      )
      const recipients = new Set(told.map((row) => row.recipient_id))
      const dropped = commenters.slice(0, 10)
      const kept = commenters.slice(10)

      expect(recipients.size).toBe(NOTIFICATION_RECIPIENT_CAP)
      for (const id of kept) expect(recipients.has(id)).toBe(true)
      for (const id of dropped) expect(recipients.has(id)).toBe(false)
    })
  })

  // The seam `mentions` binds to, asserted on its own so the guarantee does not depend on which
  // mutator happens to call it.
  it('the write seam is idempotent on its own', async () => {
    const event = {
      recipientId: B.userID,
      actorId: A.userID,
      kind: 'issue_assigned' as const,
      teamId,
      subjectType: 'issue' as const,
      subjectId: issueId,
      subjectKey: 'NA-7',
      subjectTitle: 'Flaky login redirect',
      eventKey: '1000',
      createdAt: 1000,
    }
    await recordNotifications(database.db, [event])
    await recordNotifications(database.db, [event])
    // Also within one statement: two identical events collapse rather than erroring.
    await recordNotifications(database.db, [event, event])
    expect(await notificationCount()).toBe(1)

    await recordNotifications(database.db, [])
    expect(await notificationCount()).toBe(1)
  })

  describe('leaving', () => {
    beforeEach(async () => {
      // B gets a notification in each of the two teams they belong to.
      await apply((tx) =>
        mutators.issue.assign.fn({
          tx,
          args: { id: issueId, assigneeId: B.userID, updatedAt: 1000 },
          ctx: A,
        }),
      )
      await apply((tx) =>
        mutators.issue.assign.fn({
          tx,
          args: { id: otherIssueId, assigneeId: B.userID, updatedAt: 1100 },
          ctx: A,
        }),
      )
      expect(await inbox(B)).toHaveLength(2)
    })

    it('leaving ONE team deletes only that team’s rows', async () => {
      await apply((tx) =>
        mutators.team.removeMember.fn({ tx, args: { id: bTeamMembershipId }, ctx: A }),
      )
      const remaining = await inbox(B)
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.teamId).toBe(otherTeamId)
    })

    it('leaving the WORKSPACE deletes every row, across every team', async () => {
      await apply((tx) =>
        mutators.member.remove.fn({ tx, args: { id: bWorkspaceMemberId }, ctx: A }),
      )
      expect(
        await rows(
          sql<{
            n: string
          }>`select count(*) as n from notification where recipient_id = ${B.userID}`,
        ),
      ).toEqual([{ n: '0' }])
    })
  })

  // The invariant `notification.team_id` (and the later `search` change) rests on: an issue can
  // never change team, so a denormalised copy of its team can never go stale. `routeIssue` refuses
  // team reassignment outright, and no other mutator offers it.
  it('no mutator moves an issue between teams', async () => {
    const before = await rows(
      sql<{ team_id: string }>`select team_id from issue where id = ${issueId}`,
    )
    const at = 12_000
    await apply((tx) =>
      mutators.issue.assign.fn({
        tx,
        args: { id: issueId, assigneeId: B.userID, updatedAt: at },
        ctx: A,
      }),
    )
    await apply((tx) =>
      mutators.issue.routeIssue.fn({
        tx,
        args: { id: issueId, status: 'in_progress' as const, assigneeId: C.userID, updatedAt: at },
        ctx: A,
      }),
    )
    await apply((tx) =>
      mutators.issue.setStatus.fn({
        tx,
        args: { id: issueId, status: 'done', updatedAt: at },
        ctx: A,
      }),
    )
    await apply((tx) =>
      mutators.issue.update.fn({
        tx,
        args: { id: issueId, title: 'Renamed', updatedAt: at },
        ctx: A,
      }),
    )
    await apply((tx) =>
      mutators.issue.move.fn({
        tx,
        args: { id: issueId, status: 'todo', rank: 'a1', updatedAt: at },
        ctx: A,
      }),
    )

    const after = await rows(
      sql<{ team_id: string }>`select team_id from issue where id = ${issueId}`,
    )
    expect(after[0]?.team_id).toBe(before[0]?.team_id)
    // And the notification rows written along the way carry that same team.
    const teams = await rows(
      sql<{
        team_id: string
      }>`select distinct team_id from notification where subject_id = ${issueId}`,
    )
    expect(teams.map((row) => row.team_id)).toEqual([teamId])
  })
})
