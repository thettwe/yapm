import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import { resolvePmAudienceTeamIds, setPmDisclosurePolicy } from '../db/pm-disclosure.js'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import type { StoredPmDigestContent } from './pm-digest.js'
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
    'DATABASE_URL is required in CI: the disclosure boundary proof must not be skipped',
  )
}

// THE DISCLOSURE BOUNDARY, PROVEN BY RUNNING IT.
//
// Reading `pmAudienceScoped` and seeing a `teamId IN (…)` is not a proof of anything. What has to be
// true, against real Postgres and for the same principal in the same pass:
//
//   (a) with the default all-off config, the answer for a REAL cycle is indistinguishable from the
//       answer for a cycle id that never existed — no permission oracle to probe;
//   (b) with every switch on and the reader named, an UNPUBLISHED digest is still nothing;
//   (c) after a human publishes, exactly one row, carrying no path token, no source extension, no
//       backtick and no roster name;
//   (d) IN THE SAME TEST AND FOR THE SAME PRINCIPAL, every `teamScoped` query still returns zero
//       rows for that team's data — the proof that the first axis was not widened while the second
//       was added, which is the failure mode a one-line diff in `teamScoped` would have produced;
//   (e) exactly one `generated` and one `published` audit row, neither quoting a word of the digest.
//
// This fails on today's main at compile time (no `pm_digest`, no `pmDigests` group, no
// `pmAudienceScoped`, no `ai_disclosure_audit`) and passes only when the change is correct.
describe.skipIf(DATABASE_URL === undefined)('the PM disclosure boundary', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const mutators = createServerMutators()

  const workspaceId = newId()
  const teamId = newId()
  const cycleId = newId()
  const issueId = newId()
  const digestId = newId()
  const projectId = newId()
  // A cycle id that never existed, for the byte-identical comparison in (a).
  const GHOST_CYCLE_ID = '019f8f00-0000-7000-8000-00000000dead'

  // M is on the team and does the work. P is the principal the whole proof is about: a real
  // workspace member with `role: 'viewer'` and NO `team_membership` row for T. Everything P can ever
  // read about T's work has to come through the audience axis and nothing else.
  const MEMBER: AuthContext = { userID: `m-${newId()}`, role: 'member' }
  const PM: AuthContext = { userID: `p-${newId()}`, role: 'viewer' }
  const ADMIN: AuthContext = { userID: `a-${newId()}`, role: 'admin' }

  // A distinctive name nobody would coin by accident, so "the roster never reaches the reader" is a
  // claim the content can falsify.
  const ROSTER_NEEDLE = 'Zephyrine Quillfeather'

  let meta: PgSchemaMeta

  // The stored blob, written the way the job writes it: content the validators already passed, plus
  // yapm's own subject line and baked evidence labels.
  const CONTENT: StoredPmDigestContent = {
    headline: 'Checkout shipped; billing carried',
    sections: [
      {
        title: 'Shipped',
        items: [
          {
            kind: 'shipped',
            summary: 'Checkout now completes without a second confirmation step.',
            evidenceRefs: [{ kind: 'issue', id: issueId, label: 'ENG-1' }],
            confidence: 'high',
          },
        ],
      },
    ],
    subject: { teamName: 'Delivery', cycleName: 'Cycle 1', startDate: 1, endDate: 2 },
    evidenceLabels: { [issueId]: 'ENG-1 · PR #331' },
  }

  function built(query: unknown): BuiltQuery {
    return query as BuiltQuery
  }

  async function evaluate(query: BuiltQuery): Promise<unknown> {
    return await database.db
      .transaction()
      .execute(async (trx) => await createPgServerTransaction(trx, meta).run(query as never))
  }

  // Re-resolved per call, exactly as the server does per `/query` request, so every leg of this test
  // exercises the real path rather than a hand-built context.
  async function principal(ctx: AuthContext): Promise<AuthContext> {
    return { ...ctx, pmAudienceTeamIds: await resolvePmAudienceTeamIds(database.db, ctx.userID) }
  }

  async function pmDigestFor(cycle: string, ctx: AuthContext): Promise<unknown> {
    return await evaluate(built(queries.pmDigests.byCycle.fn({ args: { cycleId: cycle }, ctx })))
  }

  async function auditRows() {
    return await database.db
      .selectFrom('ai_disclosure_audit')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .orderBy('created_at', 'asc')
      .execute()
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    meta = await readPgSchemaMeta(database.db)
    const db = database.db
    const stamp = newId().slice(-6)

    await db.insertInto('workspace').values({ id: workspaceId, name: 'disclosure' }).execute()
    await db
      .insertInto('team')
      .values({ id: teamId, workspace_id: workspaceId, name: 'Delivery', key: `DL${stamp}` })
      .execute()
    await db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: MEMBER.userID, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: PM.userID, role: 'viewer' },
        { id: newId(), workspace_id: workspaceId, user_id: ADMIN.userID, role: 'admin' },
      ])
      .execute()
    // ONLY M. P and the admin have no membership of T, and that is the whole point of the fixture.
    await db
      .insertInto('team_membership')
      .values({ id: newId(), team_id: teamId, user_id: MEMBER.userID })
      .execute()

    await db
      .insertInto('cycle')
      .values({
        id: cycleId,
        team_id: teamId,
        number: 1,
        name: 'Cycle 1',
        status: 'completed',
        start_date: new Date('2026-07-01T00:00:00.000Z'),
        end_date: new Date('2026-07-14T00:00:00.000Z'),
      })
      .execute()
    await db
      .insertInto('issue')
      .values({
        id: issueId,
        team_id: teamId,
        number: 1,
        title: 'Checkout confirmation',
        status: 'done',
        priority: 'no_priority',
        creator_id: MEMBER.userID,
        cycle_id: cycleId,
      })
      .execute()
    await db
      .insertInto('project')
      .values({ id: projectId, workspace_id: workspaceId, name: 'Q3', status: 'active' })
      .execute()
    await db
      .insertInto('label')
      .values({ id: newId(), team_id: teamId, name: 'bug', color: '#f00' })
      .execute()
    await db
      .insertInto('saved_view')
      .values({
        id: newId(),
        team_id: teamId,
        name: 'Mine',
        filter: {},
        grouping: 'status',
        sort: { key: 'created', direction: 'desc' },
        created_by: MEMBER.userID,
      })
      .execute()
    await db
      .insertInto('cycle_digest')
      .values({
        id: newId(),
        team_id: teamId,
        cycle_id: cycleId,
        status: 'ready',
        // Team-internal content, and the reason a widened read on this table was refused: ZQL
        // returns whole rows, so any query that served P here would hand them this.
        content: { headline: `${ROSTER_NEEDLE} rewrote src/checkout/session.ts`, sections: [] },
      })
      .execute()
    await db
      .insertInto('retro')
      .values({
        id: newId(),
        team_id: teamId,
        cycle_id: cycleId,
        title: 'Retro',
        format: 'wentwell_didnt_action',
        phase: 'brainstorm',
        is_anonymous: true,
        votes_per_participant: 3,
        created_by: MEMBER.userID,
      })
      .execute()

    // The artifact the job would have written: `ready`, and UNPUBLISHED.
    await db
      .insertInto('pm_digest')
      .values({
        id: digestId,
        team_id: teamId,
        cycle_id: cycleId,
        status: 'ready',
        content: CONTENT,
        provider: 'anthropic',
        model: 'test-model',
        estimated_cost_usd: 0.02,
        generated_at: new Date(),
      })
      .execute()
    // The `generated` record the job writes on every terminal status, written here directly because
    // this test does not run the job.
    await database.db
      .insertInto('ai_disclosure_audit')
      .values({
        id: newId(),
        workspace_id: workspaceId,
        team_id: teamId,
        actor_id: null,
        event: 'generated',
        pm_digest_id: digestId,
        detail: { status: 'ready' },
      })
      .execute()
  }, 60_000)

  afterAll(async () => {
    await sql`delete from ai_disclosure_audit where workspace_id = ${workspaceId}`.execute(
      database.db,
    )
    await sql`delete from connector_config where workspace_id = ${workspaceId}`.execute(database.db)
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  // (a) THE DEFAULT. Nothing is configured, so nothing resolves and nothing is distinguishable.
  it('gives a default-configured workspace an empty audience and no permission oracle', async () => {
    expect(await resolvePmAudienceTeamIds(database.db, PM.userID)).toEqual([])
    const pm = await principal(PM)
    const real = await pmDigestFor(cycleId, pm)
    const ghost = await pmDigestFor(GHOST_CYCLE_ID, pm)
    expect(real).toEqual(ghost)
    expect(real ?? null).toBeNull()
  })

  // (b) EVERY SWITCH ON, THE READER NAMED — AND STILL NOTHING, because a human has not published.
  // Generation discloses to nobody; this is the gate, asserted rather than described.
  it('discloses nothing before a human publishes, however the policy is set', async () => {
    await setPmDisclosurePolicy(database.db, ADMIN, {
      configId: newId(),
      auditId: newId(),
      workspaceId,
      enabled: true,
      teams: { [teamId]: { pmVisible: true, audience: [PM.userID] } },
    })

    expect(await resolvePmAudienceTeamIds(database.db, PM.userID)).toEqual([teamId])
    const pm = await principal(PM)
    expect(await pmDigestFor(cycleId, pm)).toEqual(await pmDigestFor(GHOST_CYCLE_ID, pm))
    expect((await pmDigestFor(cycleId, pm)) ?? null).toBeNull()

    // The producing team, on the other axis, reads the very same row while it is unpublished — the
    // review half of review-and-publish.
    const review = await evaluate(
      built(queries.pmDigestReview.byCycle.fn({ args: { cycleId }, ctx: MEMBER })),
    )
    expect((review as { id?: string } | undefined)?.id).toBe(digestId)
  })

  // The kill switch, asserted between the two halves: it empties every audience regardless of every
  // other setting, and the resolver is the single place that decides it.
  it('empties every audience while the kill switch is set', async () => {
    await setPmDisclosurePolicy(database.db, ADMIN, {
      configId: newId(),
      auditId: newId(),
      workspaceId,
      killed: true,
    })
    expect(await resolvePmAudienceTeamIds(database.db, PM.userID)).toEqual([])

    // AND PUBLISHING IS REFUSED WHILE THE HOLD IS ON. Allowing it would stamp
    // `audience_size_at_publish = 0` onto a released row, and the moment an admin lifted the hold the
    // digest would be readable by N people while the producing team's own marker said 0 forever.
    await expect(
      database.db.transaction().execute(async (trx) =>
        mutators.pmDigest.publish.fn({
          tx: createPgServerTransaction(trx, meta),
          args: { id: digestId, updatedAt: Date.now() },
          ctx: MEMBER,
        }),
      ),
    ).rejects.toThrow()
    const held = await database.db
      .selectFrom('pm_digest')
      .select(['published_at', 'published_by', 'audience_size_at_publish'])
      .where('id', '=', digestId)
      .executeTakeFirst()
    expect(held?.published_at).toBeNull()
    expect(held?.published_by).toBeNull()
    expect(held?.audience_size_at_publish).toBeNull()

    await setPmDisclosurePolicy(database.db, ADMIN, {
      configId: newId(),
      auditId: newId(),
      workspaceId,
      killed: false,
    })
    expect(await resolvePmAudienceTeamIds(database.db, PM.userID)).toEqual([teamId])
  })

  // (c) THE DISCLOSURE ITSELF, and what may not be in it.
  it('discloses exactly one row after a human publishes, carrying no engineering shape', async () => {
    const at = Date.now()
    await database.db.transaction().execute(async (trx) =>
      mutators.pmDigest.publish.fn({
        tx: createPgServerTransaction(trx, meta),
        args: { id: digestId, updatedAt: at },
        ctx: MEMBER,
      }),
    )

    const pm = await principal(PM)
    const row = (await pmDigestFor(cycleId, pm)) as Record<string, unknown> | undefined
    expect(row?.id).toBe(digestId)

    const serialized = JSON.stringify(row)
    // No path token, no source-file extension, no fence, no roster name. Change 21's validator runs
    // before the row is written; this asserts what actually crossed the boundary.
    expect(serialized).not.toMatch(/[\w-]+\/[\w-]+/u)
    expect(serialized).not.toMatch(/\.(?:ts|tsx|js|py|go|rs|sql|yml|json)\b/u)
    expect(serialized).not.toContain('`')
    expect(serialized).not.toContain(ROSTER_NEEDLE)
    // And the columns that must never reach a reader outside the team are not on the synced row at
    // all — not merely unselected, since ZQL has no column projection to unselect with.
    expect(row).not.toHaveProperty('publishedBy')
    expect(row).not.toHaveProperty('estimatedCostUsd')
    expect(row).not.toHaveProperty('inputToken')
    expect(row).not.toHaveProperty('outputToken')
    // The audience size was stamped from the policy at the moment of release.
    expect(row?.audienceSizeAtPublish).toBe(1)
  })

  // Membership of the list IS the entitlement: an administrator who is not on it reads nothing HERE,
  // which is the difference from `teamScoped` and the case a reviewer would not think to check.
  it('gives a workspace admin who is not on the list nothing through the audience axis', async () => {
    const admin = await principal(ADMIN)
    expect(admin.pmAudienceTeamIds).toEqual([])
    expect((await pmDigestFor(cycleId, admin)) ?? null).toBeNull()
    expect(await pmDigestFor(cycleId, admin)).toEqual(await pmDigestFor(GHOST_CYCLE_ID, admin))
  })

  // (d) THE PROOF THAT THE FIRST AXIS WAS NOT WIDENED. Same principal, same pass, now reading
  // everything `teamScoped` guards. Every one of these would return rows if the disclosure
  // entitlement had been added by teaching `teamScoped` about audiences.
  it('still gives that same reader zero rows from every team-scoped query', async () => {
    const pm = await principal(PM)
    expect(pm.pmAudienceTeamIds).toEqual([teamId])

    const cases: [string, unknown][] = [
      ['issues.byTeam', queries.issues.byTeam.fn({ args: { teamId }, ctx: pm })],
      ['issues.mine', queries.issues.mine.fn({ args: undefined, ctx: pm })],
      ['issues.detail', queries.issues.detail.fn({ args: { id: issueId }, ctx: pm })],
      ['cycles.byTeam', queries.cycles.byTeam.fn({ args: { teamId }, ctx: pm })],
      ['labels.byTeam', queries.labels.byTeam.fn({ args: { teamId }, ctx: pm })],
      ['deployments.byTeam', queries.deployments.byTeam.fn({ args: { teamId }, ctx: pm })],
      ['savedViews.byTeam', queries.savedViews.byTeam.fn({ args: { teamId }, ctx: pm })],
      ['digests.byCycle', queries.digests.byCycle.fn({ args: { cycleId }, ctx: pm })],
      ['digests.byTeam', queries.digests.byTeam.fn({ args: { teamId }, ctx: pm })],
      ['attachments.byIssue', queries.attachments.byIssue.fn({ args: { issueId }, ctx: pm })],
      ['retros.byTeam', queries.retros.byTeam.fn({ args: { teamId }, ctx: pm })],
      ['triage.inbox', queries.triage.inbox.fn({ args: { teamId }, ctx: pm })],
      // The producing team's own review query is `teamScoped` too, so the named reader gets nothing
      // from it either: the two axes over one table do not leak into each other.
      ['pmDigestReview.byCycle', queries.pmDigestReview.byCycle.fn({ args: { cycleId }, ctx: pm })],
    ]

    for (const [name, query] of cases) {
      const result = await evaluate(built(query))
      const rows = Array.isArray(result) ? result : result === undefined ? [] : [result]
      expect(rows, `${name} leaked rows to a reader outside the team`).toEqual([])
    }

    // `projects.get` is the one query in that family whose ROW is workspace-level by design — a
    // project spans teams — so the claim it must still satisfy is about its `teamScoped` subtree:
    // the reader gets the project and none of the team's issues under it.
    const project = (await evaluate(
      built(queries.projects.get.fn({ args: { id: projectId }, ctx: pm })),
    )) as { id?: string; issues?: unknown[] } | undefined
    expect(project?.id).toBe(projectId)
    expect(project?.issues ?? []).toEqual([])

    // And the disclosure they ARE entitled to still resolves, so "empty" above is a fact about
    // scoping rather than about a principal who can read nothing at all.
    expect(((await pmDigestFor(cycleId, pm)) as { id?: string } | undefined)?.id).toBe(digestId)
  })

  // (e) THE RECORD. One row per event, and not a word of the digest in any of them.
  it('records the generation and the publication, and quotes neither', async () => {
    const rows = await auditRows()
    expect(rows.filter((row) => row.event === 'generated')).toHaveLength(1)
    expect(rows.filter((row) => row.event === 'published')).toHaveLength(1)

    const published = rows.find((row) => row.event === 'published')
    expect(published?.actor_id).toBe(MEMBER.userID)
    expect(published?.pm_digest_id).toBe(digestId)
    expect(published?.detail).toEqual({ audienceSize: 1 })
    // The generation is attributed to the system principal, which is not a `user` row.
    expect(rows.find((row) => row.event === 'generated')?.actor_id).toBeNull()

    // Every policy write left a record too, and no record anywhere contains any substring of the
    // digest's prose — a `detail` that quoted the disclosure would be a second copy of it sitting
    // outside the kill switch.
    expect(rows.filter((row) => row.event === 'policy_changed').length).toBeGreaterThan(0)
    const serialized = JSON.stringify(rows.map((row) => row.detail))
    for (const fragment of [
      CONTENT.headline,
      CONTENT.sections[0]?.title ?? '',
      CONTENT.sections[0]?.items[0]?.summary ?? '',
    ]) {
      expect(serialized).not.toContain(fragment)
    }
    // Nor does any record name a reader: the audit says that a disclosure happened and to how many,
    // never to whom.
    expect(serialized).not.toContain(PM.userID)
  })

  // Retraction stops further reads. Asserted last because it takes the disclosure away again.
  it('stops further reads on retraction and records it', async () => {
    await database.db.transaction().execute(async (trx) =>
      mutators.pmDigest.unpublish.fn({
        tx: createPgServerTransaction(trx, meta),
        args: { id: digestId, updatedAt: Date.now() },
        ctx: MEMBER,
      }),
    )

    const pm = await principal(PM)
    expect((await pmDigestFor(cycleId, pm)) ?? null).toBeNull()
    expect(await pmDigestFor(cycleId, pm)).toEqual(await pmDigestFor(GHOST_CYCLE_ID, pm))
    expect((await auditRows()).filter((row) => row.event === 'unpublished')).toHaveLength(1)
  })
})
