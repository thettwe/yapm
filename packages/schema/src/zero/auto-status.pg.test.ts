import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { upsertConnectorConfig, upsertConnectorInstallation } from '../db/connector.js'
import { migrateToLatest } from '../db/migrate.js'
import { newId } from '../id.js'
import type { AuthContext, IssueStatus } from './context.js'
import {
  assembleLinkedEntities,
  computeDeliverySignal,
  computeDivergence,
  type DivergenceKind,
  type PrState,
} from './delivery.js'
import { queries } from './queries.js'
import { createServerMutators } from './server-mutators.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from './testing/pg-transaction.js'
import type { BuiltQuery } from './testing/query-ast.js'
import { applyWorkGraphMutations, parseIssueRefs, type WorkGraphMutation } from './work-graph.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the status-automation check must not be skipped — it is the only test that proves a delivery moves an issue at all',
  )
}

// THE FALSIFIABLE CHECK (design.md §"How we will know this worked").
//
// Everything else about this change is a pure function or a fake transaction. What no unit test can
// establish is that a real work-graph delivery, applied through the real ingest write path, against
// real Postgres, moves a real issue — and moves it for exactly one of two otherwise identical teams.
// On `main` this file does not compile (no `auto-status.ts`, no `auto_status_since` column) and,
// compiled, fails at the first assertion because no ingest path writes any status.
//
// Two teams differing in ONE column, driven by the SAME two mutations, is the shape of the whole
// change: T1 has opted in, T2 has not, and T2 must behave exactly as every instance behaves today —
// unchanged status, divergence flag and all.
describe.skipIf(DATABASE_URL === undefined)('status automation, end to end', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const mutators = createServerMutators()

  const workspaceId = newId()
  const optedInTeamId = newId()
  const offTeamId = newId()
  const MEMBER: AuthContext = { userID: `member-${newId()}`, role: 'member' }
  const ADMIN: AuthContext = { userID: `admin-${newId()}`, role: 'admin' }

  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  // A fixed wall clock, so "an hour before the opt-in" and "ten minutes after the merge" are
  // unambiguous and every assertion below is reproducible rather than racing the test's own runtime.
  const NOW = Date.UTC(2026, 5, 1, 12, 0, 0)
  const OPT_IN_AT = NOW - HOUR
  const OPENED_AT = NOW - 30 * MINUTE
  const MERGED_AT = NOW - 10 * MINUTE

  let meta: PgSchemaMeta
  let installationId: string
  let optedInKey: string
  let offKey: string

  function randomKey(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let key = ''
    for (let i = 0; i < 4; i += 1) {
      key += letters[Math.floor(Math.random() * letters.length)] as string
    }
    return key
  }

  async function apply<T>(
    run: (tx: ReturnType<typeof createPgServerTransaction>) => Promise<T>,
  ): Promise<T> {
    return await database.db
      .transaction()
      .execute(async (trx) => await run(createPgServerTransaction(trx, meta)))
  }

  async function rows<T>(query: ReturnType<typeof sql<T>>): Promise<T[]> {
    const { rows: result } = await query.execute(database.db)
    return result
  }

  interface IssueRow {
    id: string
    number: number
    status: IssueStatus
    needs_triage: boolean
    last_human_status_at: Date | null
    updated_at: Date
  }

  async function issue(id: string): Promise<IssueRow> {
    const found = await rows(
      sql<IssueRow>`
        select id, number, status, needs_triage, last_human_status_at, updated_at
        from issue where id = ${id}
      `,
    )
    const row = found[0]
    if (row === undefined) throw new Error(`issue ${id} vanished`)
    return row
  }

  async function createIssue(
    teamId: string,
    title: string,
    over: { status?: IssueStatus; needsTriage?: boolean; at?: number } = {},
  ): Promise<string> {
    const id = newId()
    const at = over.at ?? OPT_IN_AT - HOUR
    await apply((tx) =>
      mutators.issue.create.fn({
        tx,
        args: {
          id,
          teamId,
          title,
          status: over.status ?? 'todo',
          priority: 'no_priority',
          rank: 'a0',
          needsTriage: over.needsTriage ?? false,
          createdAt: at,
          updatedAt: at,
        },
        ctx: MEMBER,
      }),
    )
    return id
  }

  async function setStatus(id: string, status: IssueStatus, at: number): Promise<void> {
    await apply((tx) =>
      mutators.issue.setStatus.fn({ tx, args: { id, status, updatedAt: at }, ctx: MEMBER }),
    )
  }

  // The real ingest write path — the same function the GitHub worker calls with the same union.
  // Nothing in this file reaches into `applyAutoStatusForPullRequest` directly, because a test that
  // called it directly would prove the ladder works and say nothing about whether it is wired in.
  async function deliver(teamId: string, mutation: WorkGraphMutation): Promise<void> {
    await apply((tx) => applyWorkGraphMutations(tx, { teamId, now: NOW }, [mutation]))
  }

  function pullRequest(over: {
    externalId: string
    branch: string
    state?: PrState & ('draft' | 'open' | 'merged' | 'closed')
    openedAt?: number
    mergedAt?: number | null
    updatedAt?: number
    number?: number
  }): WorkGraphMutation {
    return {
      kind: 'upsertPullRequest',
      id: newId(),
      installationId,
      provider: 'github',
      repo: 'acme/app',
      number: over.number ?? 12,
      externalId: over.externalId,
      title: 'Fix the thing',
      state: over.state ?? 'open',
      url: 'https://github.com/acme/app/pull/12',
      headSha: 'abc123',
      mergeCommitSha: null,
      openedAt: over.openedAt ?? OPENED_AT,
      mergedAt: over.mergedAt ?? null,
      updatedAt: over.updatedAt ?? OPENED_AT,
      issueRefs: parseIssueRefs({ branch: over.branch }),
    }
  }

  // Divergence read through its real producer: the linked pull requests assembled into
  // `LinkedEntities`, through `computeDeliverySignal`, into `computeDivergence` — the same three
  // functions the reality strip calls, unmodified by this change.
  async function divergence(issueId: string): Promise<DivergenceKind | null> {
    const row = await issue(issueId)
    const links = await rows(
      sql<{ state: PrState; opened_at: Date }>`
        select pr.state, pr.opened_at
        from issue_link il join pull_request pr on pr.id = il.pull_request_id
        where il.issue_id = ${issueId}
      `,
    )
    const linked = assembleLinkedEntities(
      links.map((link) => ({
        pullRequest: { state: link.state, openedAt: link.opened_at.getTime() },
      })),
    )
    return computeDivergence(row.status, computeDeliverySignal({ status: row.status }, linked))
  }

  async function triageInbox(teamId: string): Promise<string[]> {
    const query = queries.triage.inbox.fn({
      args: { teamId },
      ctx: MEMBER,
    }) as unknown as BuiltQuery
    const result = (await apply(async (tx) => await tx.run(query as never))) as { id: string }[]
    return result.map((row) => row.id)
  }

  // `updatedAt` is the instant of the admin's write, so enabling "an hour ago" is a write an hour
  // ago. The mutator refuses to store an epoch older than its own write — otherwise an agent could
  // back-date the cut-off and replay a backfill — so a fixture that wrote at NOW would be asking
  // for the very thing that is forbidden.
  async function setAutoStatus(teamId: string, since: number | null): Promise<void> {
    await apply((tx) =>
      mutators.team.setAutoStatus.fn({
        tx,
        args: { id: teamId, since, updatedAt: since ?? NOW },
        ctx: ADMIN,
      }),
    )
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    meta = await readPgSchemaMeta(database.db)

    optedInKey = randomKey()
    offKey = randomKey()
    while (offKey === optedInKey) offKey = randomKey()

    await sql`insert into workspace (id, name) values (${workspaceId}, 'auto-status-pg-test')`.execute(
      database.db,
    )
    for (const [id, key, name] of [
      [optedInTeamId, optedInKey, 'Opted in'],
      [offTeamId, offKey, 'Left off'],
    ] as const) {
      await sql`insert into team (id, workspace_id, name, key) values (${id}, ${workspaceId}, ${name}, ${key})`.execute(
        database.db,
      )
      for (const userId of [MEMBER.userID, ADMIN.userID]) {
        await sql`insert into team_membership (id, team_id, user_id) values (${newId()}, ${id}, ${userId})`.execute(
          database.db,
        )
      }
    }

    const config = await upsertConnectorConfig(database.db, ADMIN, {
      id: newId(),
      workspaceId,
      provider: 'github',
      enabled: true,
    })
    const installation = await upsertConnectorInstallation(database.db, {
      id: newId(),
      configId: config.id,
      externalInstallationId: `auto-status-${newId()}`,
      accountLogin: 'acme',
    })
    installationId = installation.id
  }, 60_000)

  afterAll(async () => {
    await sql`delete from connector_config where workspace_id = ${workspaceId}`.execute(database.db)
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  beforeEach(async () => {
    for (const teamId of [optedInTeamId, offTeamId]) {
      await sql`delete from issue_link where team_id = ${teamId}`.execute(database.db)
      await sql`delete from issue where team_id = ${teamId}`.execute(database.db)
      await sql`delete from pull_request where team_id = ${teamId}`.execute(database.db)
    }
    // The switch, written through the real mutator rather than a raw UPDATE, so the admin gate is
    // on the path every time and the test cannot pass with a permission check nobody runs.
    await setAutoStatus(optedInTeamId, OPT_IN_AT)
    await setAutoStatus(offTeamId, null)
  })

  it('a merged PR drives the linked issue to Done only for a team that opted in', async () => {
    const optedIn = await createIssue(optedInTeamId, 'Opted-in work')
    const off = await createIssue(offTeamId, 'Opted-out work')
    const optedInNumber = (await issue(optedIn)).number
    const offNumber = (await issue(off)).number

    const cases = [
      {
        teamId: optedInTeamId,
        issueId: optedIn,
        key: optedInKey,
        number: optedInNumber,
        tag: 'IN',
      },
      { teamId: offTeamId, issueId: off, key: offKey, number: offNumber, tag: 'OFF' },
    ]

    for (const each of cases) {
      await deliver(
        each.teamId,
        pullRequest({
          externalId: `PR_${each.tag}`,
          branch: `feature/${each.key}-${each.number}-thing`,
          state: 'open',
          updatedAt: OPENED_AT,
        }),
      )
    }

    expect((await issue(optedIn)).status, 'an opened PR moves the opted-in issue').toBe('in_review')
    expect((await issue(off)).status, 'the opted-out issue is untouched').toBe('todo')

    for (const each of cases) {
      await deliver(
        each.teamId,
        pullRequest({
          externalId: `PR_${each.tag}`,
          branch: `feature/${each.key}-${each.number}-thing`,
          state: 'merged',
          mergedAt: MERGED_AT,
          updatedAt: MERGED_AT,
        }),
      )
    }

    expect((await issue(optedIn)).status, 'the merge moves it to done').toBe('done')
    expect((await issue(off)).status, 'off means unchanged').toBe('todo')

    // The other half of "off means unchanged": today's behaviour, byte for byte. A team that has
    // not opted in still gets the flag, which is the whole reason the change is opt-in.
    expect(await divergence(off)).toBe('status_behind_merge')
    // And where the transition fired there is nothing left to diverge about — quiet by
    // construction, because the disagreement `status_behind_merge` reports no longer exists.
    expect(await divergence(optedIn)).toBeNull()

    // The automated write is distinguishable from a person's: the stamp is the one this issue
    // carried from its creation, not the merge.
    expect((await issue(optedIn)).last_human_status_at?.getTime()).toBe(OPT_IN_AT - HOUR)
  })

  it('is inert on a verbatim redelivery of the merged event', async () => {
    const id = await createIssue(optedInTeamId, 'Redelivered')
    const number = (await issue(id)).number
    const branch = `feature/${optedInKey}-${number}-thing`

    await deliver(optedInTeamId, pullRequest({ externalId: 'PR_R', branch, updatedAt: OPENED_AT }))
    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_R',
        branch,
        state: 'merged',
        mergedAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
    )

    const settled = await issue(id)
    expect(settled.status).toBe('done')

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_R',
        branch,
        state: 'merged',
        mergedAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
    )

    const replayed = await issue(id)
    expect(replayed.status).toBe('done')
    // Not merely "still done" — the row was not written AT ALL. A transition that re-fired would
    // land the same status and be invisible without this.
    expect(replayed.updated_at.getTime()).toBe(settled.updated_at.getTime())
  })

  // The spec's "healed missed event" scenario, which is where a naive last-writer-wins loses
  // someone's deliberate decision: reconciliation surfaces a merge that happened before the person
  // acted, so the person's write is newer than the event and must win.
  it('does not undo a status a person set after the event actually happened', async () => {
    const id = await createIssue(optedInTeamId, 'Reopened by a person')
    const number = (await issue(id)).number
    const branch = `feature/${optedInKey}-${number}-thing`

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_H1',
        branch,
        state: 'merged',
        mergedAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
    )
    expect((await issue(id)).status).toBe('done')

    const humanAt = MERGED_AT + 5 * MINUTE
    await setStatus(id, 'in_progress', humanAt)
    expect((await issue(id)).last_human_status_at?.getTime()).toBe(humanAt)

    // A SECOND pull request for the same issue, discovered by reconciliation, that merged before
    // the person acted. It is a real state edge (the row is new), so only the human-intent guard
    // stands between it and overwriting them.
    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_H2',
        number: 13,
        branch,
        state: 'merged',
        mergedAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
    )

    expect((await issue(id)).status).toBe('in_progress')
    // Blocked is not silent: the disagreement is real and the flag is what reports it.
    expect(await divergence(id)).toBe('status_behind_merge')
  })

  // The mirror image, and the reason the guard compares against the EVENT rather than running a
  // grace window off the clock: a status set two minutes before the pull request opened is not
  // evidence against the transition that pull request warrants.
  it('still transitions when the human write precedes the event', async () => {
    const id = await createIssue(optedInTeamId, 'In progress, then a PR')
    const number = (await issue(id)).number
    await setStatus(id, 'in_progress', OPENED_AT - 2 * MINUTE)

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_F',
        branch: `feature/${optedInKey}-${number}-thing`,
        state: 'open',
        updatedAt: OPENED_AT,
      }),
    )

    expect((await issue(id)).status).toBe('in_review')
  })

  // Task 5.2 — the first-install safety property on its own. An instance that turns automation on
  // and then backfills two hundred historical merged pull requests must not have its board rewritten.
  it('drives nothing from an event that predates the opt-in', async () => {
    const id = await createIssue(optedInTeamId, 'Merged before the switch')
    const number = (await issue(id)).number
    const before = await issue(id)

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_E',
        branch: `feature/${optedInKey}-${number}-thing`,
        state: 'merged',
        mergedAt: OPT_IN_AT - MINUTE,
        updatedAt: OPT_IN_AT - MINUTE,
      }),
    )

    const after = await issue(id)
    expect(after.status).toBe('todo')
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime())
    // The link was still made — a stale-for-automation event is not a stale event.
    const links = await rows(
      sql<{ count: string }>`select count(*)::text as count from issue_link where issue_id = ${id}`,
    )
    expect(links[0]?.count).toBe('1')
    // And divergence reports what automation declined to act on.
    expect(await divergence(id)).toBe('status_behind_merge')
  })

  // The same property, against the thing that actually defeats it: `updated_at` is the pull
  // request's LAST-ACTIVITY time and bumps on a comment or a label, so a pull request that merged
  // three weeks before the switch is first seen by the backfill sweep carrying a fresh `updated_at`.
  // Comparing that against the epoch would drive Done off a merge nobody opted into — which is the
  // two-hundred-issues-flip scenario the epoch exists to prevent, arriving through the front door.
  it('drives nothing from a long-merged pull request whose activity time is fresh', async () => {
    const id = await createIssue(optedInTeamId, 'Merged three weeks before the switch')
    const number = (await issue(id)).number
    const before = await issue(id)
    const threeWeeks = 21 * 24 * HOUR

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_STALE',
        branch: `feature/${optedInKey}-${number}-thing`,
        state: 'merged',
        openedAt: OPT_IN_AT - threeWeeks - HOUR,
        mergedAt: OPT_IN_AT - threeWeeks,
        updatedAt: NOW,
      }),
    )

    const after = await issue(id)
    expect(after.status).toBe('todo')
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime())
    expect(await divergence(id)).toBe('status_behind_merge')
  })

  // And the same trap on the other transition: a pull request opened long before the switch and
  // still open is first ingested afterwards. The open edge is real — the row is new — but the
  // instant it describes is not.
  it('drives nothing from a pull request opened before the switch and first seen after', async () => {
    const id = await createIssue(optedInTeamId, 'Opened before the switch')
    const number = (await issue(id)).number
    const before = await issue(id)

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_OLD_OPEN',
        branch: `feature/${optedInKey}-${number}-thing`,
        state: 'open',
        openedAt: OPT_IN_AT - 2 * HOUR,
        updatedAt: NOW,
      }),
    )

    const after = await issue(id)
    expect(after.status).toBe('todo')
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime())
  })

  it('fires on an event exactly at the opt-in instant', async () => {
    const id = await createIssue(optedInTeamId, 'Merged at the switch')
    const number = (await issue(id)).number

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_EQ',
        branch: `feature/${optedInKey}-${number}-thing`,
        state: 'merged',
        mergedAt: OPT_IN_AT,
        updatedAt: OPT_IN_AT,
      }),
    )

    expect((await issue(id)).status).toBe('done')
  })

  // Task 5.3 — the two issue states automation must never touch, proven against real rows rather
  // than against the ladder in isolation.
  it('leaves an untriaged issue alone and in the triage inbox', async () => {
    const id = await createIssue(optedInTeamId, 'Untriaged', { needsTriage: true })
    const number = (await issue(id)).number

    expect(await triageInbox(optedInTeamId)).toContain(id)

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_T',
        branch: `feature/${optedInKey}-${number}-thing`,
        state: 'merged',
        mergedAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
    )

    const after = await issue(id)
    expect(after.status).toBe('todo')
    expect(after.needs_triage).toBe(true)
    // The inbox is the point: a transition would have advanced an issue nobody has accepted yet,
    // and — because the board holds triage issues out — moved it somewhere invisible.
    expect(await triageInbox(optedInTeamId)).toContain(id)
  })

  it('never writes over a canceled issue', async () => {
    const id = await createIssue(optedInTeamId, 'Canceled')
    const number = (await issue(id)).number
    await setStatus(id, 'canceled', OPENED_AT - MINUTE)
    const before = await issue(id)

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_C',
        branch: `feature/${optedInKey}-${number}-thing`,
        state: 'merged',
        mergedAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
    )

    const after = await issue(id)
    expect(after.status).toBe('canceled')
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime())
    // The existing divergence contract for a canceled issue is unchanged by this capability.
    expect(await divergence(id)).toBeNull()
  })

  it('never moves an issue backward when a merged pull request reopens', async () => {
    const id = await createIssue(optedInTeamId, 'Reopened PR')
    const number = (await issue(id)).number
    const branch = `feature/${optedInKey}-${number}-thing`

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_B',
        branch,
        state: 'merged',
        mergedAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
    )
    expect((await issue(id)).status).toBe('done')

    await deliver(
      optedInTeamId,
      pullRequest({ externalId: 'PR_B', branch, state: 'open', updatedAt: MERGED_AT + MINUTE }),
    )

    expect((await issue(id)).status).toBe('done')
  })

  it.each(['draft', 'closed'] as const)('drives nothing from a %s pull request', async (state) => {
    const id = await createIssue(optedInTeamId, `PR is ${state}`)
    const number = (await issue(id)).number
    const before = await issue(id)

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: `PR_S_${state}`,
        branch: `feature/${optedInKey}-${number}-thing`,
        state,
        updatedAt: OPENED_AT,
      }),
    )

    const after = await issue(id)
    expect(after.status).toBe('todo')
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime())
  })

  // Disabling has to be a real off switch, not a one-way door: the column goes back to NULL and the
  // next delivery is as inert as it is on an instance that never enabled anything.
  it('goes quiet again when an admin disables it', async () => {
    const id = await createIssue(optedInTeamId, 'Disabled midstream')
    const number = (await issue(id)).number
    await setAutoStatus(optedInTeamId, null)

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_D',
        branch: `feature/${optedInKey}-${number}-thing`,
        state: 'merged',
        mergedAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
    )

    expect((await issue(id)).status).toBe('todo')
    const stored = await rows(
      sql<{
        auto_status_since: Date | null
      }>`select auto_status_since from team where id = ${optedInTeamId}`,
    )
    expect(stored[0]?.auto_status_since).toBeNull()
  })

  it('advances every linked issue one merge names', async () => {
    const first = await createIssue(optedInTeamId, 'Half of it')
    const second = await createIssue(optedInTeamId, 'The other half')
    const firstNumber = (await issue(first)).number
    const secondNumber = (await issue(second)).number

    await deliver(
      optedInTeamId,
      pullRequest({
        externalId: 'PR_M',
        branch: `feature/${optedInKey}-${firstNumber}-and-${optedInKey}-${secondNumber}`,
        state: 'merged',
        mergedAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
    )

    expect((await issue(first)).status).toBe('done')
    expect((await issue(second)).status).toBe('done')
  })

  it('refuses the setting to a member, leaving the team as it was', async () => {
    await expect(
      apply((tx) =>
        mutators.team.setAutoStatus.fn({
          tx,
          args: { id: optedInTeamId, since: null, updatedAt: NOW },
          ctx: MEMBER,
        }),
      ),
    ).rejects.toThrow()

    const stored = await rows(
      sql<{
        auto_status_since: Date | null
      }>`select auto_status_since from team where id = ${optedInTeamId}`,
    )
    expect(stored[0]?.auto_status_since?.getTime()).toBe(OPT_IN_AT)
  })
})
