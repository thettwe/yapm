import { type Kysely, sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import { buildRetroSeed } from '../zero/retro/seed.js'
import { createDatabase, type Database } from './client.js'
import { migrateToLatest } from './migrate.js'
import { retroFactsForCycle } from './retro-facts.js'
import { retroVerdictLogForWorkspace } from './retro-verdict-log.js'
import type { DB } from './types.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the retro fact-assembly integration test must not be skipped',
  )
}

// The D2 allowlist. The set of tables `retroFactsForCycle` reads must EQUAL this — not be a subset
// of it — so a later change that reaches for a retro content table or a comment fails here rather
// than in review.
// It grew by EXACTLY TWO, `retro` and `retro_action`, and the equality is what makes that "exactly".
// The argument for those two and against every other retro table is design §D1: an action is the
// team's agreed public output, made in the open, carrying no author column, already readable by every
// member through an ordinary team-scoped query — a card is one person's testimony.
const ALLOWED_TABLES = [
  'ci_check',
  'cycle',
  'issue',
  'issue_link',
  'pull_request',
  'retro',
  'retro_action',
  'review',
  'team',
]

// The identity-shaped keys the D-27 walker rejects, verbatim from `retro-board`.
const IDENTITY_KEY = /assignee|author|reviewer|creator|user|member|owner|actor|login|email/i

function identityKeys(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((item, i) => identityKeys(item, `${path}[${i}]`))
  const found: string[] = []
  for (const [key, child] of Object.entries(value)) {
    if (IDENTITY_KEY.test(key)) found.push(`${path}.${key}`)
    found.push(...identityKeys(child, `${path}.${key}`))
  }
  return found
}

interface Recording {
  readonly tables: Set<string>
  readonly columns: Set<string>
}

// A recording proxy over the Kysely instance. `selectFrom` is the only entry point this module uses,
// so wrapping it records every table; the compiled SQL of each executed query records every column
// token. Cheaper and stricter than a query log: it observes what the code actually did.
function recordingDb(db: Kysely<DB>, recording: Recording): Kysely<DB> {
  const wrapBuilder = (builder: unknown): unknown =>
    new Proxy(builder as object, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (prop === 'select' || prop === 'selectAll') {
            for (const arg of args.flat()) {
              if (typeof arg === 'string') recording.columns.add(arg)
            }
            if (prop === 'selectAll') recording.columns.add('*')
          }
          if (prop === 'innerJoin' || prop === 'leftJoin') {
            const table = args[0]
            if (typeof table === 'string') recording.tables.add(table.split(' ')[0] as string)
          }
          const result = (value as (...a: unknown[]) => unknown).apply(target, args)
          if (prop === 'execute' || prop === 'executeTakeFirst') return result
          return typeof result === 'object' && result !== null ? wrapBuilder(result) : result
        }
      },
    })

  return new Proxy(db as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop !== 'selectFrom') {
        // BOUND to the target. An unbound kysely method invoked with the Proxy as `this` cannot read
        // its own `#props` private field and throws — the proxy has to be transparent, not just
        // permissive.
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (...args: unknown[]) => {
        const table = args[0]
        if (typeof table === 'string') recording.tables.add(table.split(' ')[0] as string)
        return wrapBuilder((value as (...a: unknown[]) => unknown).apply(target, args))
      }
    },
  }) as Kysely<DB>
}

describe.skipIf(DATABASE_URL === undefined)('retroFactsForCycle against Postgres', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })

  const workspaceId = newId()
  const teamId = newId()
  const otherTeamId = newId()
  const closedCycleId = newId()
  const priorCycleIds = [newId(), newId(), newId(), newId()]
  const shippedIssueId = newId()
  const carriedIssueId = newId()
  const prId = newId()
  const checkId = newId()

  // The prior retro and the two actions it agreed. Every one of these four rows carries a REAL,
  // NON-NULL assignee, and the action's assignee differs from its issue's — so "no assignee reaches
  // the bundle" cannot pass because there was nothing to strip.
  const priorRetroId = newId()
  const shippedActionId = newId()
  const canceledActionId = newId()
  const shippedActionIssueId = newId()
  const canceledActionIssueId = newId()
  const ACTION_ASSIGNEE = `action-assignee-${newId()}`
  const ISSUE_ASSIGNEE = `issue-assignee-${newId()}`

  beforeAll(async () => {
    await migrateToLatest(database.db)
    const db = database.db

    await sql`insert into workspace (id, name) values (${workspaceId}, 'retro-facts-pg')`.execute(
      db,
    )
    const key = `RF${Date.now() % 10_000}`
    await sql`
      insert into team (id, workspace_id, name, key) values
        (${teamId}, ${workspaceId}, 'Facts', ${key}),
        (${otherTeamId}, ${workspaceId}, 'Other', ${`${key}X`})
    `.execute(db)

    // Four prior completed cycles so the three-cycle window is a real cap rather than a coincidence.
    for (const [index, id] of priorCycleIds.entries()) {
      const daysAgo = 70 - index * 14
      await sql`
        insert into cycle (id, team_id, number, name, status, start_date, end_date)
        values (${id}, ${teamId}, ${index + 1}, ${`Prior ${index + 1}`}, 'completed',
                now() - (${daysAgo} || ' days')::interval,
                now() - (${daysAgo - 14} || ' days')::interval)
      `.execute(db)
    }
    await sql`
      insert into cycle (id, team_id, number, name, status, start_date, end_date)
      values (${closedCycleId}, ${teamId}, 5, 'Closed', 'completed',
              now() - interval '14 days', now())
    `.execute(db)

    const creatorId = `creator-${newId()}`
    await sql`
      insert into issue (id, team_id, number, title, status, priority, creator_id, cycle_id,
                         carryover_count, cycle_assigned_at)
      values (${shippedIssueId}, ${teamId}, 1, 'Guest checkout', 'done', 'medium', ${creatorId},
              ${closedCycleId}, 0, now() - interval '13 days')
    `.execute(db)
    // Carried OUT of the closed cycle: it no longer points at it but keeps the rollover marker.
    await sql`
      insert into issue (id, team_id, number, title, status, priority, creator_id, cycle_id,
                         rolled_over_from_cycle_id, carryover_count)
      values (${carriedIssueId}, ${teamId}, 2, 'Search relevance', 'in_progress', 'medium',
              ${creatorId}, null, ${closedCycleId}, 2)
    `.execute(db)

    const configId = newId()
    const installationId = newId()
    await sql`insert into connector_config (id, workspace_id, provider) values (${configId}, ${workspaceId}, 'github')`.execute(
      db,
    )
    await sql`insert into connector_installation (id, connector_config_id, external_installation_id) values (${installationId}, ${configId}, 'inst-1')`.execute(
      db,
    )
    await sql`
      insert into pull_request (id, team_id, installation_id, provider, repo, number, external_id,
                                title, state, opened_at, merged_at)
      values (${prId}, ${teamId}, ${installationId}, 'github', 'acme/app', 7, 'pr-7',
              'Implement guest checkout', 'merged',
              now() - interval '10 days', now() - interval '8 days')
    `.execute(db)
    await sql`insert into issue_link (issue_id, pull_request_id, team_id, source) values (${shippedIssueId}, ${prId}, ${teamId}, 'branch')`.execute(
      db,
    )
    await sql`
      insert into ci_check (id, team_id, pull_request_id, provider, external_id, conclusion)
      values (${checkId}, ${teamId}, ${prId}, 'github', 'check-1', 'success')
    `.execute(db)
    // The PREVIOUS retro, on the newest prior cycle in the window, and the two improvements the team
    // agreed there: one that shipped, one that was canceled. The two converted issues sit in NO cycle,
    // so they contribute nothing to any seed metric and the loop-close read is the only thing that can
    // see them.
    await sql`
      insert into issue (id, team_id, number, title, status, priority, creator_id, assignee_id)
      values
        (${shippedActionIssueId}, ${teamId}, 3, 'Split the release check', 'done', 'medium',
         ${creatorId}, ${ISSUE_ASSIGNEE}),
        (${canceledActionIssueId}, ${teamId}, 4, 'Rotate the on-call doc', 'canceled', 'medium',
         ${creatorId}, ${ISSUE_ASSIGNEE})
    `.execute(db)
    await sql`
      insert into retro (id, team_id, cycle_id, title, format, created_by)
      values (${priorRetroId}, ${teamId}, ${priorCycleIds[3]}, 'Prior 4 retro', 'start_stop_continue',
              ${creatorId})
    `.execute(db)
    await sql`
      insert into retro_action (id, retro_id, team_id, body, assignee_id, issue_id)
      values
        (${shippedActionId}, ${priorRetroId}, ${teamId}, 'Split the release check in two',
         ${ACTION_ASSIGNEE}, ${shippedActionIssueId}),
        (${canceledActionId}, ${priorRetroId}, ${teamId}, 'Rotate the on-call doc weekly',
         ${ACTION_ASSIGNEE}, ${canceledActionIssueId})
    `.execute(db)

    // `review.author` is a provider handle. It is populated here precisely so the assertion that the
    // fact assembly never selects it is meaningful.
    await sql`
      insert into review (id, team_id, pull_request_id, provider, external_id, author, state,
                          submitted_at)
      values (${newId()}, ${teamId}, ${prId}, 'github', 'rev-1', 'octocat', 'approved',
              now() - interval '9 days')
    `.execute(db)
  }, 60_000)

  afterAll(async () => {
    await database.close()
  })

  it('computes the same metrics the shared builder computes from the same rows', async () => {
    const facts = await retroFactsForCycle(database.db, teamId, closedCycleId)
    expect(facts).not.toBeNull()

    const delivered = facts?.seed.sections.find((section) => section.key === 'delivered')
    const metric = (key: string): number | undefined =>
      delivered?.metrics.find((candidate) => candidate.key === key)?.value

    expect(metric('shipped')).toBe(1)
    expect(metric('carried_out')).toBe(1)
    expect(metric('total')).toBe(2)
    expect(metric('carried_twice_plus')).toBe(1)

    // One definition, two callers: feed `buildRetroSeed` the same rows by hand and the numbers must
    // be identical. A metric computed anywhere else would diverge here.
    const byHand = buildRetroSeed({
      cycle: {
        id: closedCycleId,
        name: 'Closed',
        startDate: 0,
        issues: [
          { id: shippedIssueId, status: 'done', cycleId: closedCycleId, carryoverCount: 0 },
          {
            id: carriedIssueId,
            status: 'in_progress',
            cycleId: null,
            rolledOverFromCycleId: closedCycleId,
            carryoverCount: 2,
          },
        ],
      },
    })
    const byHandDelivered = byHand.sections.find((section) => section.key === 'delivered')
    for (const key of ['shipped', 'carried_out', 'total', 'carried_twice_plus']) {
      expect(metric(key), key).toBe(
        byHandDelivered?.metrics.find((candidate) => candidate.key === key)?.value,
      )
    }
  })

  it('caps the seed history at three prior cycles', async () => {
    const facts = await retroFactsForCycle(database.db, teamId, closedCycleId)
    const shipped = facts?.seed.sections
      .find((section) => section.key === 'delivered')
      ?.metrics.find((metric) => metric.key === 'shipped')

    // The trend is the prior cycles plus this one, so four entries at most for a window of three.
    expect(shipped?.trend.length).toBeLessThanOrEqual(4)
  })

  it('exposes citableIds as the evidence ids union every computed metric key', async () => {
    const facts = await retroFactsForCycle(database.db, teamId, closedCycleId)
    expect(facts).not.toBeNull()

    const metricKeys = (facts?.seed.sections ?? []).flatMap((section) =>
      section.metrics.map((metric) => metric.key),
    )
    for (const id of [...(facts?.evidenceIds ?? []), ...metricKeys]) {
      expect(facts?.citableIds).toContain(id)
    }
    expect(facts?.citableIds).toContain(shippedIssueId)
    expect(facts?.citableIds).toContain(prId)
    expect(facts?.citableIds).toContain(checkId)
    expect(facts?.citableIds).toContain('shipped')
  })

  it('returns null for a cycle belonging to another team', async () => {
    expect(await retroFactsForCycle(database.db, otherTeamId, closedCycleId)).toBeNull()
  })

  it('touches exactly the allowlisted tables and never selects an identity column', async () => {
    const recording: Recording = { tables: new Set(), columns: new Set() }
    const facts = await retroFactsForCycle(
      recordingDb(database.db, recording),
      teamId,
      closedCycleId,
    )
    expect(facts).not.toBeNull()

    expect([...recording.tables].sort()).toEqual(ALLOWED_TABLES)

    // Every table holding an individual's testimony or an individual's signal stays out, stated
    // explicitly rather than left to the equality — including `retro_ai_proposal`, so no draft can be
    // shaped by what an earlier one was judged to be.
    for (const forbidden of [
      'retro_ai_proposal',
      'retro_ai_reaction',
      'retro_draft',
      'retro_card',
      'retro_card_author',
      'retro_vote',
      'retro_vote_tally',
      'retro_presence',
      'comment',
      'workspace_member',
      'user',
    ]) {
      expect(recording.tables, forbidden).not.toContain(forbidden)
    }

    // Every select is an explicit column list, and none of them is an identity column or the join
    // back to the anonymous card an action came from.
    expect(recording.columns).not.toContain('*')
    for (const column of recording.columns) {
      for (const forbidden of [
        'author',
        'assignee_id',
        'creator_id',
        'uploader_id',
        'card_id',
        'group_id',
        'facilitator_id',
        'created_by',
      ]) {
        expect(column.includes(forbidden), `${column} names ${forbidden}`).toBe(false)
      }
    }
  })

  it('returns an object graph with no identity-shaped key at any depth', async () => {
    const facts = await retroFactsForCycle(database.db, teamId, closedCycleId)

    expect(identityKeys(facts)).toEqual([])
  })

  // THE FALSIFIABLE CHECK for change 22, asserted against the BUILT OBJECT rather than against the
  // text of any request made from it. A downstream validator that happened to strip an assignee out
  // of the prompt would not make a single line of this pass.
  it('reports the prior retro’s actions with yapm-computed outcomes and neither assignee', async () => {
    const recording: Recording = { tables: new Set(), columns: new Set() }
    const facts = await retroFactsForCycle(
      recordingDb(database.db, recording),
      teamId,
      closedCycleId,
    )

    const prior = facts?.priorRetro
    expect(prior?.cycleName).toBe('Prior 4')
    expect(prior?.actions.map((action) => action.outcome).sort()).toEqual(['canceled', 'shipped'])

    // `shipped` is `done` AND NOTHING ELSE. Folding `canceled` into it is the easy, plausible, wrong
    // implementation, which is why the canceled one is asserted by name as well as by total.
    expect(prior?.totals.shipped).toBe(1)
    expect(prior?.totals.canceled).toBe(1)
    const canceled = prior?.actions.find((action) => action.id === canceledActionId)
    expect(canceled?.outcome).toBe('canceled')
    expect(canceled?.issue?.status).toBe('canceled')
    expect(prior?.actions.find((action) => action.id === shippedActionId)?.outcome).toBe('shipped')

    // Both action ids are citable, so a follow-up proposal can point at one; the outcome totals are
    // citable too, so it can point at a count instead of typing one.
    expect(facts?.citableIds).toContain(shippedActionId)
    expect(facts?.citableIds).toContain(canceledActionId)
    expect(facts?.citableIds).toContain('prior_retro_shipped')

    // The strip, at both altitudes: the shape, and the values.
    expect(identityKeys(facts)).toEqual([])
    const serialized = JSON.stringify(facts)
    expect(serialized).not.toContain(ACTION_ASSIGNEE)
    expect(serialized).not.toContain(ISSUE_ASSIGNEE)

    // And the read itself: neither assignee column, nor the card link, was ever selected.
    expect(recording.columns).not.toContain('*')
    for (const column of recording.columns) {
      for (const forbidden of [
        'assignee_id',
        'card_id',
        'group_id',
        'facilitator_id',
        'created_by',
      ]) {
        expect(column.includes(forbidden), `${column} names ${forbidden}`).toBe(false)
      }
    }
  })

  it('leaves the prior retro absent for a team that has never held one', async () => {
    const soloTeamId = newId()
    const soloCycleId = newId()
    const db = database.db
    await sql`
      insert into team (id, workspace_id, name, key)
      values (${soloTeamId}, ${workspaceId}, 'Solo', ${`S${Date.now() % 100_000}`})
    `.execute(db)
    await sql`
      insert into cycle (id, team_id, number, name, status, start_date, end_date)
      values (${soloCycleId}, ${soloTeamId}, 1, 'First', 'completed',
              now() - interval '14 days', now())
    `.execute(db)

    const facts = await retroFactsForCycle(db, soloTeamId, soloCycleId)

    // A well-formed bundle with the section ABSENT — not a throw, not an empty string, not a partial
    // object. Nothing is citable from a retro that never happened, so the shipped cite-or-omit
    // validator is what makes a first retro produce no follow-up proposal.
    expect(facts).not.toBeNull()
    expect(facts?.priorRetro).toBeNull()
    expect(facts?.cycleName).toBe('First')
    expect(facts?.citableIds).not.toContain('prior_retro_shipped')
    expect(identityKeys(facts)).toEqual([])
  })

  // A team of its own per case, so each fixture states exactly the history it is about and no
  // assertion depends on another test's rows.
  async function freshTeam(name: string): Promise<string> {
    const id = newId()
    await sql`
      insert into team (id, workspace_id, name, key)
      values (${id}, ${workspaceId}, ${name}, ${`K${id.replaceAll('-', '').slice(-8).toUpperCase()}`})
    `.execute(database.db)
    return id
  }

  async function completedCycle(
    teamIdOfCycle: string,
    number: number,
    name: string,
    daysAgo: number,
  ): Promise<string> {
    const id = newId()
    await sql`
      insert into cycle (id, team_id, number, name, status, start_date, end_date)
      values (${id}, ${teamIdOfCycle}, ${number}, ${name}, 'completed',
              now() - (${daysAgo} || ' days')::interval,
              now() - (${daysAgo - 14} || ' days')::interval)
    `.execute(database.db)
    return id
  }

  async function retroOn(teamIdOfRetro: string, cycleIdOfRetro: string): Promise<string> {
    const id = newId()
    await sql`
      insert into retro (id, team_id, cycle_id, title, format, created_by)
      values (${id}, ${teamIdOfRetro}, ${cycleIdOfRetro}, 'Retro', 'start_stop_continue',
              ${`creator-${newId()}`})
    `.execute(database.db)
    return id
  }

  // Every outcome the vocabulary has, on one prior retro, so the four are told apart by the read and
  // not merely by the pure classifier that has its own unit test.
  it('reports all four outcomes distinctly, and counts only the done one as shipped', async () => {
    const outcomeTeamId = await freshTeam('Outcomes')
    const priorCycle = await completedCycle(outcomeTeamId, 1, 'Outcomes 1', 28)
    const targetCycle = await completedCycle(outcomeTeamId, 2, 'Outcomes 2', 14)
    const retroId = await retroOn(outcomeTeamId, priorCycle)

    const doneIssue = newId()
    const canceledIssue = newId()
    const openIssue = newId()
    const creator = `creator-${newId()}`
    await sql`
      insert into issue (id, team_id, number, title, status, priority, creator_id, assignee_id)
      values
        (${doneIssue}, ${outcomeTeamId}, 1, 'Shipped one', 'done', 'medium', ${creator},
         ${ISSUE_ASSIGNEE}),
        (${canceledIssue}, ${outcomeTeamId}, 2, 'Dropped one', 'canceled', 'medium', ${creator},
         ${ISSUE_ASSIGNEE}),
        (${openIssue}, ${outcomeTeamId}, 3, 'Still going', 'in_review', 'medium', ${creator},
         ${ISSUE_ASSIGNEE})
    `.execute(database.db)

    const [shippedId, canceledId, openId, untrackedId] = [newId(), newId(), newId(), newId()]
    await sql`
      insert into retro_action (id, retro_id, team_id, body, assignee_id, issue_id)
      values
        (${shippedId}, ${retroId}, ${outcomeTeamId}, 'Split the release check', ${ACTION_ASSIGNEE},
         ${doneIssue}),
        (${canceledId}, ${retroId}, ${outcomeTeamId}, 'Rotate the on-call doc', ${ACTION_ASSIGNEE},
         ${canceledIssue}),
        (${openId}, ${retroId}, ${outcomeTeamId}, 'Trim the CI matrix', ${ACTION_ASSIGNEE},
         ${openIssue}),
        (${untrackedId}, ${retroId}, ${outcomeTeamId}, 'Talk to design earlier', ${ACTION_ASSIGNEE},
         null)
    `.execute(database.db)

    const facts = await retroFactsForCycle(database.db, outcomeTeamId, targetCycle)
    const prior = facts?.priorRetro
    const outcomeOf = (id: string) => prior?.actions.find((action) => action.id === id)?.outcome

    expect(outcomeOf(shippedId)).toBe('shipped')
    expect(outcomeOf(canceledId)).toBe('canceled')
    expect(outcomeOf(openId)).toBe('in_flight')
    expect(outcomeOf(untrackedId)).toBe('not_converted')

    // ONE shipped out of four. A canceled action is reported accurately rather than counted as
    // shipped, and an `in_review` one is still open rather than nearly done.
    expect(prior?.totals).toEqual({ shipped: 1, canceled: 1, in_flight: 1, not_converted: 1 })

    // The never-converted action carries no issue at all rather than a hollow one.
    expect(prior?.actions.find((action) => action.id === untrackedId)?.issue).toBeNull()
    expect(prior?.actions.find((action) => action.id === canceledId)?.issue?.status).toBe(
      'canceled',
    )

    expect(identityKeys(facts)).toEqual([])
    expect(JSON.stringify(facts)).not.toContain(ISSUE_ASSIGNEE)
  })

  // Design §D7: a team that skipped a retro — or held one and agreed nothing — should still be
  // reminded of the actions it last actually agreed, and the bundle must NAME that cycle so a
  // proposal cannot imply the actions were from last cycle.
  it('takes the prior retro from two cycles back when the nearer one agreed nothing', async () => {
    const skippedTeamId = await freshTeam('Skipped')
    const older = await completedCycle(skippedTeamId, 1, 'Skipped 1', 42)
    const nearer = await completedCycle(skippedTeamId, 2, 'Skipped 2', 28)
    const targetCycle = await completedCycle(skippedTeamId, 3, 'Skipped 3', 14)

    const olderRetro = await retroOn(skippedTeamId, older)
    // A retro on the immediately-preceding cycle that produced NO action, which is why it is not the
    // one reported on.
    await retroOn(skippedTeamId, nearer)

    const actionId = newId()
    await sql`
      insert into retro_action (id, retro_id, team_id, body, issue_id)
      values (${actionId}, ${olderRetro}, ${skippedTeamId}, 'Pair on the migration', null)
    `.execute(database.db)

    const facts = await retroFactsForCycle(database.db, skippedTeamId, targetCycle)

    expect(facts?.priorRetro?.cycleId).toBe(older)
    expect(facts?.priorRetro?.cycleName).toBe('Skipped 1')
    expect(facts?.priorRetro?.actions.map((action) => action.id)).toEqual([actionId])
    expect(facts?.citableIds).toContain(actionId)
  })

  it('leaves the prior retro absent when the only prior retro agreed nothing', async () => {
    const emptyTeamId = await freshTeam('Empty retro')
    const priorCycle = await completedCycle(emptyTeamId, 1, 'Empty 1', 28)
    const targetCycle = await completedCycle(emptyTeamId, 2, 'Empty 2', 14)
    await retroOn(emptyTeamId, priorCycle)

    const facts = await retroFactsForCycle(database.db, emptyTeamId, targetCycle)

    // A retro with no actions is the same absence as no retro at all: well-formed bundle, null
    // section, nothing citable — not an empty action list a prompt would have to describe.
    expect(facts).not.toBeNull()
    expect(facts?.priorRetro).toBeNull()
    expect(facts?.citableIds).not.toContain('prior_retro_shipped')
    expect(identityKeys(facts)).toEqual([])
  })
})

// The other half of the loop: what teams DID with what the model drafted. It lives beside the fact
// assembly because the two share the recording proxy above and because the property that matters
// most about them is the same one stated twice — the fact assembly must never read a verdict, and
// the verdict log must never read a reaction.
describe.skipIf(DATABASE_URL === undefined)('retroVerdictLogForWorkspace against Postgres', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })

  const workspaceId = newId()
  const otherWorkspaceId = newId()
  const teamId = newId()
  const quietTeamId = newId()
  const otherTeamId = newId()
  const rejectedId = newId()
  const contestedId = newId()
  const REACTOR = `reactor-${newId()}`

  beforeAll(async () => {
    await migrateToLatest(database.db)
    const db = database.db
    const suffix = newId().replaceAll('-', '').slice(-6).toUpperCase()

    await sql`
      insert into workspace (id, name) values
        (${workspaceId}, 'verdict-log'), (${otherWorkspaceId}, 'verdict-log-other')
    `.execute(db)
    await sql`
      insert into team (id, workspace_id, name, key) values
        (${teamId}, ${workspaceId}, 'Platform', ${`VA${suffix}`}),
        (${quietTeamId}, ${workspaceId}, 'Apps', ${`VB${suffix}`}),
        (${otherTeamId}, ${otherWorkspaceId}, 'Elsewhere', ${`VC${suffix}`})
    `.execute(db)

    const creator = `creator-${newId()}`
    async function retroWithProposals(
      ownerTeamId: string,
      cycleName: string,
      rows: readonly {
        id: string
        category: string
        summary: string
        verdict: string | null
        agree: number | null
        disagree: number | null
      }[],
    ) {
      const cycleId = newId()
      const retroId = newId()
      const draftId = newId()
      await sql`
        insert into cycle (id, team_id, number, name, status, start_date, end_date)
        values (${cycleId}, ${ownerTeamId}, 1, ${cycleName}, 'completed',
                now() - interval '28 days', now() - interval '14 days')
      `.execute(db)
      await sql`
        insert into retro (id, team_id, cycle_id, title, format, created_by)
        values (${retroId}, ${ownerTeamId}, ${cycleId}, ${cycleName}, 'start_stop_continue',
                ${creator})
      `.execute(db)
      await sql`
        insert into retro_ai_draft (id, retro_id, team_id, status)
        values (${draftId}, ${retroId}, ${ownerTeamId}, 'ready')
      `.execute(db)
      for (const [rank, row] of rows.entries()) {
        await sql`
          insert into retro_ai_proposal (id, draft_id, retro_id, team_id, category, summary,
                                         confidence, rank, verdict, agree_count, disagree_count,
                                         ratified_at)
          values (${row.id}, ${draftId}, ${retroId}, ${ownerTeamId}, ${row.category}, ${row.summary},
                  'medium', ${rank}, ${row.verdict}, ${row.agree}, ${row.disagree},
                  ${row.verdict === null ? null : new Date()})
        `.execute(db)
      }
      return { retroId }
    }

    const { retroId } = await retroWithProposals(teamId, 'Cycle 6', [
      {
        id: newId(),
        category: 'win',
        summary: 'Everything in scope shipped.',
        verdict: 'agreed',
        agree: 3,
        disagree: 0,
      },
      {
        id: rejectedId,
        category: 'improvement',
        summary: 'Add a second reviewer to every pull request.',
        verdict: 'rejected',
        agree: 0,
        disagree: 2,
      },
      {
        id: contestedId,
        category: 'loss',
        summary: 'Two issues carried a second time.',
        verdict: 'contested',
        agree: 2,
        disagree: 1,
      },
      {
        id: newId(),
        category: 'win',
        summary: 'CI stayed green.',
        verdict: 'unrated',
        agree: 0,
        disagree: 0,
      },
      // Never ratified: the team never advanced past `vote`, so no verdict was ever stamped. That is
      // `undecided`, not `unrated` — a team that has not finished is not a team that shrugged.
      {
        id: newId(),
        category: 'improvement',
        summary: 'Nobody has voted on this yet.',
        verdict: null,
        agree: null,
        disagree: null,
      },
    ])

    // A reaction really exists, so "the log never reads one" cannot pass because there was none.
    await sql`
      insert into retro_ai_reaction (proposal_id, user_id, retro_id, team_id, value)
      values (${rejectedId}, ${REACTOR}, ${retroId}, ${teamId}, 'disagree')
    `.execute(db)

    await retroWithProposals(otherTeamId, 'Elsewhere 1', [
      {
        id: newId(),
        category: 'loss',
        summary: 'A proposal in another workspace entirely.',
        verdict: 'rejected',
        agree: 0,
        disagree: 4,
      },
    ])
  }, 60_000)

  afterAll(async () => {
    await database.close()
  })

  it('counts every verdict per team, keeping never-ratified apart from nobody-responded', async () => {
    const log = await retroVerdictLogForWorkspace(database.db, workspaceId)

    const platform = log.totals.find((team) => team.teamId === teamId)
    expect(platform?.teamName).toBe('Platform')
    expect(platform).toMatchObject({
      agreed: 1,
      rejected: 1,
      contested: 1,
      unrated: 1,
      undecided: 1,
    })
    // A team that has drafted nothing has no row rather than a row of zeros.
    expect(log.totals.map((team) => team.teamId)).not.toContain(quietTeamId)
  })

  it('reports only what a team threw away or split over, and only for this workspace', async () => {
    const log = await retroVerdictLogForWorkspace(database.db, workspaceId)

    expect(log.recent.map((row) => row.id).sort()).toEqual([rejectedId, contestedId].sort())
    expect(log.recent.map((row) => row.verdict).sort()).toEqual(['contested', 'rejected'])
    expect(log.recent.map((row) => row.summary)).not.toContain(
      'A proposal in another workspace entirely.',
    )
    expect(log.recent.every((row) => row.cycleName === 'Cycle 6')).toBe(true)
    expect(log.recent.find((row) => row.id === rejectedId)?.disagreeCount).toBe(2)
  })

  // THE TEAM-LEVEL GUARANTEE, asserted on the statements rather than on the response: a read that
  // never names the reaction table cannot grow a per-person column later without failing here.
  it('never issues a statement naming retro_ai_reaction, and returns no user identifier', async () => {
    const recording: Recording = { tables: new Set(), columns: new Set() }
    const log = await retroVerdictLogForWorkspace(recordingDb(database.db, recording), workspaceId)

    expect([...recording.tables].sort()).toEqual(['cycle', 'retro', 'retro_ai_proposal', 'team'])
    for (const forbidden of ['retro_ai_reaction', 'workspace_member', 'user', 'retro_card']) {
      expect(recording.tables, forbidden).not.toContain(forbidden)
    }
    expect(recording.columns).not.toContain('*')
    for (const column of recording.columns) {
      for (const forbidden of ['user_id', 'created_by', 'facilitator_id']) {
        expect(column.includes(forbidden), `${column} names ${forbidden}`).toBe(false)
      }
    }

    // And the object: no identity-shaped key at any depth, and the one real reactor's id nowhere.
    expect(identityKeys(log)).toEqual([])
    expect(JSON.stringify(log)).not.toContain(REACTOR)
  })

  it('returns an empty log for a workspace that has never drafted a retro', async () => {
    const emptyWorkspaceId = newId()
    await sql`insert into workspace (id, name) values (${emptyWorkspaceId}, 'no-drafts')`.execute(
      database.db,
    )

    expect(await retroVerdictLogForWorkspace(database.db, emptyWorkspaceId)).toEqual({
      totals: [],
      recent: [],
    })
  })
})
