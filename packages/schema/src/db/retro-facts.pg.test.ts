import { type Kysely, sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import { buildRetroSeed } from '../zero/retro/seed.js'
import { createDatabase, type Database } from './client.js'
import { migrateToLatest } from './migrate.js'
import { retroFactsForCycle } from './retro-facts.js'
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
const ALLOWED_TABLES = [
  'ci_check',
  'cycle',
  'issue',
  'issue_link',
  'pull_request',
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

    // No retro content table and no comment, stated explicitly rather than left to the equality.
    for (const forbidden of [
      'retro',
      'retro_draft',
      'retro_card',
      'retro_card_author',
      'retro_vote',
      'retro_vote_tally',
      'retro_presence',
      'retro_action',
      'comment',
      'workspace_member',
      'user',
    ]) {
      expect(recording.tables, forbidden).not.toContain(forbidden)
    }

    // Every select is an explicit column list, and none of them is an identity column.
    expect(recording.columns).not.toContain('*')
    for (const column of recording.columns) {
      for (const forbidden of ['author', 'assignee_id', 'creator_id', 'uploader_id']) {
        expect(column.includes(forbidden), `${column} names ${forbidden}`).toBe(false)
      }
    }
  })

  it('returns an object graph with no identity-shaped key at any depth', async () => {
    const facts = await retroFactsForCycle(database.db, teamId, closedCycleId)

    expect(identityKeys(facts)).toEqual([])
  })
})
