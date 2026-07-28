import { type Kysely, sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import type { DB } from '../db/types.js'
import { newId } from '../id.js'
import type { AuthContext, RetroPhase } from './context.js'
import { queries } from './queries.js'
import { retroColumnTemplate } from './retro/phase.js'
import { createServerMutators } from './server-mutators.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from './testing/pg-transaction.js'
import type { BuiltQuery } from './testing/query-ast.js'
import { registryQueries, type VisitedValue, walkQueryResult } from './testing/query-walk.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the retro anonymity proof must not be skipped')
}

// THE ANONYMITY PROOF (design.md D2, tasks 5.2).
//
// Zero has no column-level read permission: a synced query returns whole rows. The guarantee that an
// anonymous card's author is unobtainable therefore rests entirely on the SHAPE of the schema and
// the registry — `retro_card_author` is absent from the Zero schema, an anonymous card carries no
// author value, and `retro_draft`/`retro_vote` sync by a bare `ctx.userID` filter with no admin
// bypass. Reading the queries is not a proof of that; running them is.
//
// So: seed a real anonymous retro in which author A writes drafts, publishes cards through the real
// server `retro.setPhase`, casts votes and is present in the room. Then enumerate the registry BY
// WALKING IT — never a hand-listed array, so a query added by a later change cannot escape the
// proof — evaluate every entry against live Postgres as teammate B and as workspace admin C, and
// account for every single scalar the caller would receive by the table and field it came from.
//
// The assertion is provenance-aware rather than a bare substring hunt, because A's id legitimately
// appears in the workspace roster. What must never happen is A's id reaching a caller bound to retro
// CONTENT. Every place it may appear is named in `IDENTITY_BY_DESIGN` below; anything else fails.
describe.skipIf(DATABASE_URL === undefined)('the retro anonymity boundary', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const mutators = createServerMutators()

  const workspaceId = newId()
  const teamId = newId()
  const cycle1 = newId()
  const cycle2 = newId()
  const cycle3 = newId()

  // A authors everything anonymous and NOTHING else — no issue, no comment, no action, no
  // facilitation. That is what makes "A's id appears anywhere outside the roster" a leak rather
  // than a coincidence to be explained away.
  const A: AuthContext = { userID: `author-${newId()}`, role: 'member' }
  const B: AuthContext = { userID: `teammate-${newId()}`, role: 'member' }
  // A workspace admin who is NOT the author and NOT even in the team: `teamScoped` hands admins the
  // whole workspace, so this is the widest read anyone can have. If the guarantee holds here it
  // holds for everyone.
  const C: AuthContext = { userID: `admin-${newId()}`, role: 'admin' }
  // A workspace member who belongs to no team at all. `teamScoped` denies them by a CORRELATED
  // `whereExists` over `team_membership` rather than by an empty query, so this persona is the one
  // that exercises the correlated-subquery compilation the registry walk depends on (D-31).
  const D: AuthContext = { userID: `outsider-${newId()}`, role: 'member' }

  let meta: PgSchemaMeta
  let anonymousRetroId: string
  let namedRetroId: string
  let anonymousColumnIds: string[]
  let anonymousCardBodies: string[]
  let authorDraftIds: string[]
  let projectId: string
  let deliveryIssueId: string

  async function apply<T>(
    run: (tx: ReturnType<typeof createPgServerTransaction>) => Promise<T>,
  ): Promise<T> {
    return await database.db
      .transaction()
      .execute(async (trx) => await run(createPgServerTransaction(trx, meta)))
  }

  // A `Query` carries its AST and format at runtime; the public types do not expose them, so the
  // harness reads them structurally (see `testing/query-ast.ts`).
  function built(query: unknown): BuiltQuery {
    return query as BuiltQuery
  }

  async function evaluate(query: BuiltQuery): Promise<unknown> {
    return await apply(async (tx) => await tx.run(query as never))
  }

  // better-auth's `getMigrations()` owns the `user` table, not our Kysely migrations, so the DDL is
  // reproduced here exactly as `schema-drift.test.ts` does (packages never import apps).
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

  async function openRetro(over: {
    id: string
    cycleId: string
    nextCycleId: string
    isAnonymous: boolean
  }): Promise<string[]> {
    const template = retroColumnTemplate('wentwell_didnt_action')
    const columnIds = template.map(() => newId())
    await apply((tx) =>
      mutators.retro.openForCycle.fn({
        tx,
        args: {
          id: over.id,
          cycleId: over.cycleId,
          nextCycleId: over.nextCycleId,
          format: 'wentwell_didnt_action',
          isAnonymous: over.isAnonymous,
          votesPerParticipant: 3,
          columns: template.map((column, index) => ({
            id: columnIds[index] as string,
            key: column.key,
            title: column.title,
            accentToken: column.accentToken,
            rank: `a${index}`,
          })),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx: C,
      }),
    )
    await apply((tx) =>
      mutators.retro.claimFacilitator.fn({
        tx,
        args: { id: over.id, updatedAt: Date.now() },
        ctx: B,
      }),
    )
    return columnIds
  }

  async function draft(
    retroId: string,
    columnId: string,
    ctx: AuthContext,
    body: string,
    rank: string,
    seedRef?: { kind: 'issue'; id: string; label: string },
  ): Promise<string> {
    const id = newId()
    await apply((tx) =>
      mutators.retroDraft.create.fn({
        tx,
        args: {
          id,
          retroId,
          columnId,
          body,
          rank,
          seedRef: seedRef ?? null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx,
      }),
    )
    return id
  }

  async function moveTo(retroId: string, phase: RetroPhase): Promise<void> {
    const order: RetroPhase[] = ['brainstorm', 'group', 'vote', 'discuss', 'actions', 'closed']
    const { rows } = await sql<{
      phase: RetroPhase
    }>`select phase from retro where id = ${retroId}`.execute(database.db)
    let at = order.indexOf(rows[0]?.phase ?? 'brainstorm')
    const target = order.indexOf(phase)
    while (at !== target) {
      at += at < target ? 1 : -1
      await apply((tx) =>
        mutators.retro.setPhase.fn({
          tx,
          args: { id: retroId, to: order[at] as RetroPhase, updatedAt: Date.now() },
          ctx: B,
        }),
      )
    }
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    await createAuthUserTable(database.db)
    meta = await readPgSchemaMeta(database.db)

    await sql`insert into workspace (id, name) values (${workspaceId}, 'retro-anonymity')`.execute(
      database.db,
    )
    for (const [ctx, name] of [
      [A, 'Author'],
      [B, 'Teammate'],
      [C, 'Admin'],
      [D, 'Outsider'],
    ] as const) {
      await sql`
        insert into "user" ("id", "name", "email", "emailVerified")
        values (${ctx.userID}, ${name}, ${`${ctx.userID}@example.test`}, true)
      `.execute(database.db)
      await sql`
        insert into workspace_member (id, workspace_id, user_id, role)
        values (${newId()}, ${workspaceId}, ${ctx.userID}, ${ctx.role})
      `.execute(database.db)
      await sql`
        insert into user_preference (id, user_id) values (${newId()}, ${ctx.userID})
      `.execute(database.db)
    }

    const key = `RA${Date.now() % 10_000}`
    await sql`
      insert into team (id, workspace_id, name, key)
      values (${teamId}, ${workspaceId}, 'Retro anonymity', ${key})
    `.execute(database.db)
    // C is deliberately NOT a team member: its reach comes from the admin bypass alone.
    for (const ctx of [A, B]) {
      await sql`
        insert into team_membership (id, team_id, user_id) values (${newId()}, ${teamId}, ${ctx.userID})
      `.execute(database.db)
    }
    await sql`
      insert into cycle (id, team_id, number, name, status, start_date, end_date)
      values
        (${cycle1}, ${teamId}, 1, 'Cycle 1', 'completed', now() - interval '28 days', now() - interval '14 days'),
        (${cycle2}, ${teamId}, 2, 'Cycle 2', 'active', now() - interval '14 days', now()),
        (${cycle3}, ${teamId}, 3, 'Cycle 3', 'upcoming', now(), now() + interval '14 days')
    `.execute(database.db)

    // Non-retro fixtures so the registry's other queries are evaluated over real rows rather than
    // empty tables. Every one of them is authored by B — A must have no reason to appear.
    projectId = newId()
    await sql`
      insert into project (id, workspace_id, name, status, lead_id)
      values (${projectId}, ${workspaceId}, 'Reliability', 'active', ${B.userID})
    `.execute(database.db)
    const labelId = newId()
    await sql`
      insert into label (id, team_id, name, color) values (${labelId}, ${teamId}, 'infra', 'blue')
    `.execute(database.db)
    const issueId = newId()
    deliveryIssueId = issueId
    await apply((tx) =>
      mutators.issue.create.fn({
        tx,
        args: {
          id: issueId,
          teamId,
          title: 'Deploys are slow',
          status: 'in_progress',
          priority: 'medium',
          assigneeId: B.userID,
          rank: 'a0',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx: B,
      }),
    )
    await apply((tx) =>
      mutators.issue.setCycle.fn({
        tx,
        args: { id: issueId, cycleId: cycle1, updatedAt: Date.now() },
        ctx: B,
      }),
    )
    await apply((tx) =>
      mutators.issue.setProject.fn({
        tx,
        args: { id: issueId, projectId, updatedAt: Date.now() },
        ctx: B,
      }),
    )
    await apply((tx) =>
      mutators.issue.addLabel.fn({
        tx,
        args: { issueId, labelId, createdAt: Date.now() },
        ctx: B,
      }),
    )
    await apply((tx) =>
      mutators.comment.create.fn({
        tx,
        args: {
          id: newId(),
          issueId,
          body: { type: 'doc', content: [] },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx: B,
      }),
    )
    const triagedId = newId()
    await apply((tx) =>
      mutators.issue.create.fn({
        tx,
        args: {
          id: triagedId,
          teamId,
          title: 'Inbound bug report',
          status: 'backlog',
          priority: 'no_priority',
          needsTriage: true,
          rank: 'a1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx: B,
      }),
    )
    // The linked delivery subtree `issues.byTeam` pulls in, so `withLinkedDelivery` is actually
    // traversed rather than found empty.
    const connectorConfigId = newId()
    const installationId = newId()
    await sql`
      insert into connector_config (id, workspace_id, provider, enabled, status)
      values (${connectorConfigId}, ${workspaceId}, 'github', true, 'connected')
    `.execute(database.db)
    await sql`
      insert into connector_installation (id, connector_config_id, external_installation_id, account_login)
      values (${installationId}, ${connectorConfigId}, '1', 'acme')
    `.execute(database.db)
    const pullRequestId = newId()
    await sql`
      insert into pull_request (id, team_id, installation_id, provider, repo, number, external_id, title, state, url, opened_at)
      values (${pullRequestId}, ${teamId}, ${installationId}, 'github', 'acme/app', 12, ${newId()}, 'Speed up deploys', 'merged', 'https://example.test/pr/12', now())
    `.execute(database.db)
    await sql`
      insert into issue_link (issue_id, pull_request_id, team_id, source)
      values (${issueId}, ${pullRequestId}, ${teamId}, 'branch')
    `.execute(database.db)
    await sql`
      insert into ci_check (id, team_id, pull_request_id, provider, external_id, name, conclusion)
      values (${newId()}, ${teamId}, ${pullRequestId}, 'github', ${newId()}, 'build', 'success')
    `.execute(database.db)
    await sql`
      insert into review (id, team_id, pull_request_id, provider, external_id, author, state, submitted_at)
      values (${newId()}, ${teamId}, ${pullRequestId}, 'github', ${newId()}, 'octocat', 'approved', now())
    `.execute(database.db)
    await sql`
      insert into deployment (id, team_id, installation_id, provider, repo, external_id, environment, ref, state)
      values (${newId()}, ${teamId}, ${installationId}, 'github', 'acme/app', ${newId()}, 'production', 'main', 'success')
    `.execute(database.db)
    await sql`
      insert into saved_view (id, team_id, name, filter, grouping, sort, created_by)
      values (${newId()}, ${teamId}, 'Mine', ${JSON.stringify({})}::jsonb, 'status', ${JSON.stringify({})}::jsonb, ${B.userID})
    `.execute(database.db)
    await sql`
      insert into cycle_digest (id, team_id, cycle_id, status, model, generated_at)
      values (${newId()}, ${teamId}, ${cycle1}, 'ready', 'test-model', now())
    `.execute(database.db)
    await sql`
      insert into invite (id, workspace_id, team_id, email, role, token, created_by, expires_at)
      values (${newId()}, ${workspaceId}, ${teamId}, 'new@example.test', 'member', ${newId()}, ${B.userID}, now() + interval '7 days')
    `.execute(database.db)

    // The anonymous retro, driven through the real mutators so `retro_card_author` is written by
    // production code and publish happens exactly as it does under zero-cache.
    anonymousRetroId = newId()
    anonymousColumnIds = await openRetro({
      id: anonymousRetroId,
      cycleId: cycle1,
      nextCycleId: cycle2,
      isAnonymous: true,
    })
    const firstColumn = anonymousColumnIds[0] as string
    anonymousCardBodies = [
      'I was scared to say this out loud in standup',
      'The deploy freeze cost us two days',
    ]
    authorDraftIds = [
      await draft(anonymousRetroId, firstColumn, A, anonymousCardBodies[0] as string, 'a1', {
        kind: 'issue',
        id: issueId,
        label: 'Deploys are slow',
      }),
      await draft(anonymousRetroId, firstColumn, A, anonymousCardBodies[1] as string, 'a2'),
    ]
    const teammateDraftId = await draft(
      anonymousRetroId,
      firstColumn,
      B,
      'Pairing helped a lot',
      'a3',
    )

    await moveTo(anonymousRetroId, 'group')
    const groupId = newId()
    await apply((tx) =>
      mutators.retroGroup.create.fn({
        tx,
        args: {
          id: groupId,
          retroId: anonymousRetroId,
          columnId: firstColumn,
          rank: 'a0',
          cardIds: authorDraftIds,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx: B,
      }),
    )
    await moveTo(anonymousRetroId, 'vote')
    for (let dot = 0; dot < 2; dot += 1) {
      await apply((tx) =>
        mutators.retroVote.cast.fn({
          tx,
          args: {
            id: newId(),
            retroId: anonymousRetroId,
            targetType: 'group',
            targetId: groupId,
            createdAt: Date.now(),
          },
          ctx: A,
        }),
      )
    }
    await apply((tx) =>
      mutators.retroVote.cast.fn({
        tx,
        args: {
          id: newId(),
          retroId: anonymousRetroId,
          targetType: 'card',
          targetId: teammateDraftId,
          createdAt: Date.now(),
        },
        ctx: B,
      }),
    )
    await moveTo(anonymousRetroId, 'discuss')
    const actionId = newId()
    await apply((tx) =>
      mutators.retroAction.create.fn({
        tx,
        args: {
          id: actionId,
          retroId: anonymousRetroId,
          body: 'Shorten the deploy freeze to one day',
          assigneeId: B.userID,
          groupId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx: B,
      }),
    )
    await apply((tx) =>
      mutators.retro.convertActionToIssue.fn({
        tx,
        args: { actionId, issueId: newId(), createdAt: Date.now(), updatedAt: Date.now() },
        ctx: B,
      }),
    )
    // A is in the room. Presence is team-visible by design (D-8), and its focus target is a COLUMN
    // id — never a card or draft id — which is what keeps that visibility from binding A to content.
    await apply((tx) =>
      mutators.retroPresence.heartbeat.fn({
        tx,
        args: {
          retroId: anonymousRetroId,
          focusTarget: firstColumn,
          lastSeenAt: Date.now(),
        },
        ctx: A,
      }),
    )

    // The non-anonymous retro, where attribution is the point: A's published card SHOULD name A.
    // Its presence in the walk is what stops the proof from passing merely because nothing anywhere
    // ever carries an author.
    namedRetroId = newId()
    const namedColumnIds = await openRetro({
      id: namedRetroId,
      cycleId: cycle2,
      nextCycleId: cycle3,
      isAnonymous: false,
    })
    await draft(namedRetroId, namedColumnIds[0] as string, A, 'Attributed and fine with it', 'a1')
    await moveTo(namedRetroId, 'group')
    await moveTo(namedRetroId, 'brainstorm')
    // An unpublished draft of A's, left in flight — the row a brainstorming client holds.
    await draft(namedRetroId, namedColumnIds[0] as string, A, 'Still typing this one', 'a2')
  }, 120_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await sql`
      delete from "user" where id in (${A.userID}, ${B.userID}, ${C.userID}, ${D.userID})
    `.execute(database.db)
    await database.close()
  })

  // Args for every query in the registry, keyed by its registered name. The test asserts this table
  // covers the registry exactly, so a query added by a later change fails here instead of quietly
  // escaping the proof.
  function argsByQueryName(): Record<string, unknown> {
    return {
      'workspace.current': undefined,
      'members.all': undefined,
      'users.all': undefined,
      'teams.all': undefined,
      'invites.all': undefined,
      'preferences.mine': undefined,
      'issues.byTeam': { teamId },
      'issues.mine': undefined,
      'issues.detail': { id: deliveryIssueId },
      'cycles.byTeam': { teamId },
      'projects.all': undefined,
      'projects.get': { id: projectId },
      'triage.inbox': { teamId },
      'labels.byTeam': { teamId },
      'deployments.byTeam': { teamId },
      'savedViews.byTeam': { teamId },
      'digests.byCycle': { cycleId: cycle1 },
      'digests.byTeam': { teamId },
      // The two AI-draft queries, inside the proof by construction: the walk asserts covered ==
      // registry, so a query this change added cannot escape it. Their rows carry NO identity
      // dimension at all, which is why no `IDENTITY_BY_DESIGN` entry is needed for either.
      'retroAiDrafts.byRetro': { retroId: anonymousRetroId },
      'retroAiProposals.byRetro': { retroId: anonymousRetroId },
      'retros.byTeam': { teamId },
      'retros.detail': { id: anonymousRetroId },
      'retroDrafts.mine': { retroId: anonymousRetroId },
      'retroVotes.mine': { retroId: anonymousRetroId },
      // Self-scoped like the two above and swept by the same walk: a notification carries both a
      // recipient and an actor, so if it ever synced past its recipient it would put one person's
      // id in front of another with no `IDENTITY_BY_DESIGN` entry to excuse it.
      'notifications.mine': undefined,
      // Self-scoped and per-issue. Swept by the same walk because a subscription row carries a
      // user id: if it ever synced past its owner, this issue's follower list would become
      // readable, which is exactly the surveillance surface the mentions change refuses to build.
      'subscriptions.mine': { issueId: deliveryIssueId },
      // Team-scoped, read-only, and swept by the same walk because an attachment row carries an
      // uploader id: if it ever synced past its team, who pasted what would become readable
      // outside the team that owns the file.
      'attachments.byIssue': { issueId: deliveryIssueId },
    }
  }

  // Where a person's id may legitimately reach another member. Anything outside this list is a leak.
  const IDENTITY_BY_DESIGN: ReadonlySet<string> = new Set([
    // The workspace roster: who exists, and which team they are on. Public by design — it is what
    // renders an assignee picker — and it says nothing about what anyone wrote.
    'user.id',
    'workspace_member.userId',
    'team_membership.userId',
    // "Who's in the room" (D-8). Coarse, throttled, column-level; asserted below to carry a column
    // id and never a card or draft id, so it cannot bind a person to content.
    'retro_presence.userId',
  ])

  function offendingValues(visited: readonly VisitedValue[], userID: string): string[] {
    const offences: string[] = []
    for (const entry of visited) {
      if (entry.value !== userID) continue
      const path = `${entry.table}.${entry.field}`
      if (IDENTITY_BY_DESIGN.has(path)) continue
      // A named retro attributes its cards on purpose; an anonymous one must carry nothing. This is
      // the guarantee, stated as the only conditional exemption in the whole check.
      if (
        entry.table === 'retro_card' &&
        entry.field === 'authorDisplayId' &&
        entry.row.isAnonymous === false
      ) {
        continue
      }
      offences.push(path)
    }
    return [...new Set(offences)].sort()
  }

  // Every table that carries retro content or its membership. A caller outside the team must reach
  // no row of any of them — including `retro_presence`, whose team-wide visibility (D-8) stops at
  // the team boundary like everything else.
  const RETRO_TABLES: readonly string[] = [
    'retro',
    'retro_column',
    'retro_card',
    'retro_draft',
    'retro_group',
    'retro_vote',
    'retro_vote_tally',
    'retro_action',
    'retro_presence',
  ]

  async function visitEverything(ctx: AuthContext | undefined): Promise<VisitedValue[]> {
    const args = argsByQueryName()
    const visited: VisitedValue[] = []
    for (const query of registryQueries(queries)) {
      const request = built(query.fn({ args: args[query.queryName], ctx }))
      const result = await evaluate(request)
      visited.push(...walkQueryResult(request.ast, request.format, result))
    }
    return visited
  }

  it('covers every query in the registry, discovered by walking it', () => {
    const registered = registryQueries(queries).map((query) => query.queryName)
    expect(registered.length).toBeGreaterThan(0)
    expect(registered).toEqual(Object.keys(argsByQueryName()).sort())
  })

  it('never yields the author of an anonymous card to a teammate', async () => {
    const visited = await visitEverything(B)
    expect(offendingValues(visited, A.userID)).toEqual([])
  })

  it('never yields the author of an anonymous card to a workspace admin', async () => {
    const visited = await visitEverything(C)
    expect(offendingValues(visited, A.userID)).toEqual([])
  })

  // The check must be able to fail. Evaluated as A, the very same walk finds A's id on exactly the
  // rows a caller is supposed to hold about itself — its own drafts, its own votes, its own
  // preference — so an empty offence list for B and C is a fact about the queries rather than about
  // a walk that never looks anywhere. None of the three is in `IDENTITY_BY_DESIGN`, deliberately:
  // each is self-scoped, so any of them reaching another member must fail the two tests above.
  it('finds the author’s id when the author is the one asking', async () => {
    const visited = await visitEverything(A)
    expect(offendingValues(visited, A.userID)).toEqual([
      'retro_draft.authorId',
      'retro_vote.voterId',
      'user_preference.userId',
    ])
  })

  // The two denied paths, evaluated over real rows rather than read off the AST. `queries.test.ts`
  // already pins their SHAPE; that is not the same claim, and D-32 is why. The harness compiled
  // `denyAll` — `or()` with no branches — to `true`, so every deny-by-empty-query in the registry
  // would have returned the whole table, and no test noticed because none of them ran a denied
  // query against rows. These two do.
  it('reaches no retro content from a workspace member who is on no team', async () => {
    const visited = await visitEverything(D)
    expect(visited.length).toBeGreaterThan(0)
    expect(
      [...new Set(visited.map((entry) => entry.table))].filter((table) =>
        RETRO_TABLES.includes(table),
      ),
    ).toEqual([])
    expect(offendingValues(visited, A.userID)).toEqual([])
  })

  it('reaches nothing at all when nobody is signed in', async () => {
    expect(await visitEverything(undefined)).toEqual([])
  })

  it('reaches no row of another member’s drafts or votes, for anyone', async () => {
    for (const ctx of [A, B, C, D]) {
      const visited = await visitEverything(ctx)
      const drafts = visited.filter((entry) => entry.table === 'retro_draft')
      const votes = visited.filter((entry) => entry.table === 'retro_vote')
      for (const entry of drafts) {
        expect(entry.row.authorId).toBe(ctx.userID)
      }
      for (const entry of votes) {
        expect(entry.row.voterId).toBe(ctx.userID)
      }
      expect(visited.some((entry) => entry.table === 'retro_card_author')).toBe(false)
    }
  })

  it('shows a teammate the anonymous card body with a null author', async () => {
    const detail = (await evaluate(
      built(queries.retros.detail.fn({ args: { id: anonymousRetroId }, ctx: B })),
    )) as Record<string, unknown> | undefined
    expect(detail).toBeDefined()
    const board = detail as Record<string, unknown>
    const cards = board.cards as Record<string, unknown>[]
    expect(cards.map((card) => card.body)).toEqual(expect.arrayContaining(anonymousCardBodies))
    for (const card of cards) {
      expect(card.isAnonymous).toBe(true)
      expect(card.authorDisplayId).toBeNull()
    }
    // Non-empty tallies, actions and presence prove the walk above ran over a populated board.
    expect((board.voteTallies as unknown[]).length).toBeGreaterThan(0)
    expect((board.actions as unknown[]).length).toBeGreaterThan(0)
    expect((board.presence as unknown[]).length).toBeGreaterThan(0)
  })

  it('keeps a present member’s focus on a column, never on a card or a draft', async () => {
    const detail = (await evaluate(
      built(queries.retros.detail.fn({ args: { id: anonymousRetroId }, ctx: B })),
    )) as Record<string, unknown>
    const presence = detail.presence as Record<string, unknown>[]
    const mine = presence.find((row) => row.userId === A.userID)
    expect(mine).toBeDefined()
    expect(anonymousColumnIds).toContain(mine?.focusTarget)
  })

  it('gives the author their own drafts and votes, and gives nobody else theirs', async () => {
    const mineArgs = { retroId: anonymousRetroId }
    const authorDrafts = (await evaluate(
      built(queries.retroDrafts.mine.fn({ args: mineArgs, ctx: A })),
    )) as Record<string, unknown>[]
    expect(authorDrafts.map((row) => row.id).sort()).toEqual([...authorDraftIds].sort())

    const authorVotes = (await evaluate(
      built(queries.retroVotes.mine.fn({ args: mineArgs, ctx: A })),
    )) as Record<string, unknown>[]
    expect(authorVotes.length).toBe(2)

    const teammateDrafts = (await evaluate(
      built(queries.retroDrafts.mine.fn({ args: mineArgs, ctx: B })),
    )) as Record<string, unknown>[]
    expect(teammateDrafts.length).toBe(1)
    expect(teammateDrafts[0]?.authorId).toBe(B.userID)

    // The admin bypass `teamScoped` grants for work data is deliberately absent here (D2).
    const adminDrafts = (await evaluate(
      built(queries.retroDrafts.mine.fn({ args: mineArgs, ctx: C })),
    )) as Record<string, unknown>[]
    expect(adminDrafts).toEqual([])
    const adminVotes = (await evaluate(
      built(queries.retroVotes.mine.fn({ args: mineArgs, ctx: C })),
    )) as Record<string, unknown>[]
    expect(adminVotes).toEqual([])
  })

  it('reads a populated board for both a teammate and an admin', async () => {
    for (const ctx of [B, C]) {
      const retros = (await evaluate(
        built(queries.retros.byTeam.fn({ args: { teamId }, ctx })),
      )) as unknown[]
      expect(retros.length).toBe(2)
      const issues = (await evaluate(
        built(queries.issues.byTeam.fn({ args: { teamId }, ctx })),
      )) as unknown[]
      expect(issues.length).toBeGreaterThan(0)
      const members = (await evaluate(
        built(queries.members.all.fn({ args: undefined, ctx })),
      )) as Record<string, unknown>[]
      const seeded = [A.userID, B.userID, C.userID]
      expect(members.filter((row) => seeded.includes(row.userId as string)).length).toBe(3)
      // The deepest related tree in the registry, so the walk really does descend through the
      // linked-delivery subtree rather than stopping at an empty result.
      const detail = (await evaluate(
        built(queries.issues.detail.fn({ args: { id: deliveryIssueId }, ctx })),
      )) as Record<string, unknown> | undefined
      expect(detail).toBeDefined()
      const issue = detail as Record<string, unknown>
      expect((issue.labels as unknown[]).length).toBe(1)
      expect((issue.comments as unknown[]).length).toBe(1)
    }
  })
})
