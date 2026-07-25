import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import { newId } from '../id.js'
import type { AuthContext, IssueStatus } from './context.js'
import { buildRetroSeed, type RetroSeedCycleInput } from './retro/seed.js'
import { createServerMutators } from './server-mutators.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from './testing/pg-transaction.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the carryover integration test must not be skipped',
  )
}

// The two carryover facts across CONSECUTIVE rollovers, against real Postgres and through the server
// mutators.
//
// `carryover_count` and `cycle_assigned_at` are the only record of how long a piece of work has been
// slipping and of when it entered the cycle it is in — the cycle history cannot reconstruct either,
// because a carried issue no longer points at the cycle it left. One rollover proves almost nothing:
// the count has to accumulate and the stamp has to be REWRITTEN on the second pass, and the seed
// panel has to read the pair the way D-9/D-10 say it does rather than the way a naive expectation
// would.
describe.skipIf(DATABASE_URL === undefined)('carryover across consecutive rollovers', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const mutators = createServerMutators()

  const workspaceId = newId()
  const teamId = newId()
  const AUTHOR: AuthContext = { userID: `author-${newId()}`, role: 'member' }

  const DAY = 24 * 60 * 60 * 1000
  // A start well in the past, so "mid-cycle" and "at the start" are unambiguously apart and every
  // completion timestamp the test asserts on is distinguishable from every other.
  const cycleAStart = Date.UTC(2026, 0, 5)
  const cycleBStart = cycleAStart + 14 * DAY
  const cycleCStart = cycleBStart + 14 * DAY
  const MID_CYCLE_A = cycleAStart + 6 * DAY
  const COMPLETED_A_AT = cycleAStart + 14 * DAY
  const COMPLETED_B_AT = cycleBStart + 14 * DAY

  let meta: PgSchemaMeta
  let cycleA: string
  let cycleB: string
  let cycleC: string

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
    status: string
    cycle_id: string | null
    rolled_over_from_cycle_id: string | null
    carryover_count: number
    cycle_assigned_at: Date | null
  }

  async function issue(id: string): Promise<IssueRow | undefined> {
    const result = await rows(
      sql<IssueRow>`
        select id, status, cycle_id, rolled_over_from_cycle_id, carryover_count, cycle_assigned_at
        from issue where id = ${id}
      `,
    )
    return result[0]
  }

  async function createIssue(title: string, status: IssueStatus): Promise<string> {
    const id = newId()
    await apply((tx) =>
      mutators.issue.create.fn({
        tx,
        args: {
          id,
          teamId,
          title,
          status,
          priority: 'no_priority',
          rank: 'a0',
          createdAt: cycleAStart,
          updatedAt: cycleAStart,
        },
        ctx: AUTHOR,
      }),
    )
    return id
  }

  async function setCycle(id: string, cycleId: string, at: number): Promise<void> {
    await apply((tx) =>
      mutators.issue.setCycle.fn({ tx, args: { id, cycleId, updatedAt: at }, ctx: AUTHOR }),
    )
  }

  async function complete(cycleId: string, at: number): Promise<void> {
    await apply((tx) =>
      mutators.cycle.complete.fn({ tx, args: { id: cycleId, updatedAt: at }, ctx: AUTHOR }),
    )
  }

  // The seed panel's view of a cycle, assembled the way `RetroSeedPanel` assembles it: every issue
  // still pointing at the cycle plus every issue the rollover carried OUT of it.
  async function seedCycle(
    cycleId: string,
    name: string,
    startDate: number,
  ): Promise<RetroSeedCycleInput> {
    const all = await rows(
      sql<IssueRow>`
        select id, status, cycle_id, rolled_over_from_cycle_id, carryover_count, cycle_assigned_at
        from issue where team_id = ${teamId}
      `,
    )
    return {
      id: cycleId,
      name,
      startDate,
      issues: all
        .filter((row) => row.cycle_id === cycleId || row.rolled_over_from_cycle_id === cycleId)
        .map((row) => ({
          id: row.id,
          status: row.status as IssueStatus,
          cycleId: row.cycle_id,
          rolledOverFromCycleId: row.rolled_over_from_cycle_id,
          carryoverCount: row.carryover_count,
          cycleAssignedAt: row.cycle_assigned_at === null ? null : row.cycle_assigned_at.getTime(),
        })),
    }
  }

  function deliveredValue(cycle: RetroSeedCycleInput, key: string): number | undefined {
    const seed = buildRetroSeed({ cycle })
    const delivered = seed.sections.find((section) => section.key === 'delivered')
    return delivered?.metrics.find((metric) => metric.key === key)?.value
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    meta = await readPgSchemaMeta(database.db)
    await sql`insert into workspace (id, name) values (${workspaceId}, 'carryover-pg-test')`.execute(
      database.db,
    )
    const key = `CO${Date.now() % 10_000}`
    await sql`insert into team (id, workspace_id, name, key) values (${teamId}, ${workspaceId}, 'Carryover', ${key})`.execute(
      database.db,
    )
    await sql`insert into team_membership (id, team_id, user_id) values (${newId()}, ${teamId}, ${AUTHOR.userID})`.execute(
      database.db,
    )
  }, 60_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  beforeEach(async () => {
    await sql`delete from issue where team_id = ${teamId}`.execute(database.db)
    await sql`delete from cycle where team_id = ${teamId}`.execute(database.db)
    cycleA = newId()
    cycleB = newId()
    cycleC = newId()
    await sql`
      insert into cycle (id, team_id, number, name, status, start_date, end_date)
      values
        (${cycleA}, ${teamId}, 1, 'Cycle 1', 'active', to_timestamp(${cycleAStart / 1000}), to_timestamp(${cycleBStart / 1000})),
        (${cycleB}, ${teamId}, 2, 'Cycle 2', 'upcoming', to_timestamp(${cycleBStart / 1000}), to_timestamp(${cycleCStart / 1000})),
        (${cycleC}, ${teamId}, 3, 'Cycle 3', 'upcoming', to_timestamp(${cycleCStart / 1000}), to_timestamp(${(cycleCStart + 14 * DAY) / 1000}))
    `.execute(database.db)
  })

  it('accumulates the count and re-stamps the assignment on each consecutive rollover', async () => {
    const slipping = await createIssue('Still slipping', 'in_progress')
    await setCycle(slipping, cycleA, cycleAStart)

    const assigned = await issue(slipping)
    expect(assigned?.carryover_count).toBe(0)
    expect(assigned?.cycle_assigned_at?.getTime()).toBe(cycleAStart)

    await complete(cycleA, COMPLETED_A_AT)

    const afterFirst = await issue(slipping)
    expect(afterFirst?.cycle_id).toBe(cycleB)
    expect(afterFirst?.rolled_over_from_cycle_id).toBe(cycleA)
    expect(afterFirst?.carryover_count).toBe(1)
    expect(afterFirst?.cycle_assigned_at?.getTime()).toBe(COMPLETED_A_AT)

    await apply((tx) =>
      mutators.cycle.activate.fn({
        tx,
        args: { id: cycleB, updatedAt: cycleBStart },
        ctx: AUTHOR,
      }),
    )
    await complete(cycleB, COMPLETED_B_AT)

    const afterSecond = await issue(slipping)
    expect(afterSecond?.cycle_id).toBe(cycleC)
    expect(afterSecond?.rolled_over_from_cycle_id).toBe(cycleB)
    expect(afterSecond?.carryover_count).toBe(2)
    // Re-stamped, not left at the first rollover: the stamp names the CURRENT assignment.
    expect(afterSecond?.cycle_assigned_at?.getTime()).toBe(COMPLETED_B_AT)
  })

  it('does not double-increment when the same completion runs again', async () => {
    const slipping = await createIssue('Retried', 'in_progress')
    await setCycle(slipping, cycleA, cycleAStart)

    await complete(cycleA, COMPLETED_A_AT)
    // A retried mutation, or the maintenance pass racing the deliberate action: the status guard
    // makes the second run a no-op rather than a second increment and a second stamp.
    await complete(cycleA, COMPLETED_A_AT + DAY)

    const rolled = await issue(slipping)
    expect(rolled?.carryover_count).toBe(1)
    expect(rolled?.cycle_assigned_at?.getTime()).toBe(COMPLETED_A_AT)
    expect(rolled?.cycle_id).toBe(cycleB)
  })

  it('leaves finished work behind, unstamped and uncounted', async () => {
    const shipped = await createIssue('Shipped', 'done')
    const dropped = await createIssue('Canceled', 'canceled')
    await setCycle(shipped, cycleA, cycleAStart)
    await setCycle(dropped, cycleA, cycleAStart)

    await complete(cycleA, COMPLETED_A_AT)

    for (const id of [shipped, dropped]) {
      const row = await issue(id)
      expect(row?.cycle_id).toBe(cycleA)
      expect(row?.carryover_count).toBe(0)
      expect(row?.cycle_assigned_at?.getTime()).toBe(cycleAStart)
    }
  })

  // D-9: `issue.create` takes no cycle, so there is no assignment moment to stamp. A naive
  // expectation reads task 2.9's "stamp `cycle_assigned_at` in `issue.create`" literally and asserts
  // a value here; the stamp arrives only from `setCycle`, `routeIssue` and the rollover.
  it('stamps nothing at create, because a new issue has no cycle', async () => {
    const fresh = await createIssue('Just filed', 'todo')

    const row = await issue(fresh)
    expect(row?.cycle_id).toBeNull()
    expect(row?.cycle_assigned_at).toBeNull()
    expect(row?.carryover_count).toBe(0)

    await setCycle(fresh, cycleA, MID_CYCLE_A)
    expect((await issue(fresh))?.cycle_assigned_at?.getTime()).toBe(MID_CYCLE_A)
  })

  // D-10 is the one a raw-column assertion gets wrong. After the rollover the carried issue's
  // `cycle_assigned_at` is later than cycle A's start — so reading the column alone would call it
  // scope creep in A — but the stamp by then describes cycle B, not A. The panel counts only issues
  // STILL in the cycle, so the issue is reported as carried and not as added mid-cycle. The
  // assertion therefore runs through `buildRetroSeed`, which is where the rule lives.
  it('reports a late-added, then carried issue as carried rather than as scope creep', async () => {
    const onTime = await createIssue('In from the start', 'done')
    const late = await createIssue('Added late, then shipped', 'done')
    const lateAndSlipping = await createIssue('Added late, then carried', 'in_progress')
    await setCycle(onTime, cycleA, cycleAStart)
    await setCycle(late, cycleA, MID_CYCLE_A)
    await setCycle(lateAndSlipping, cycleA, MID_CYCLE_A)

    const before = await seedCycle(cycleA, 'Cycle 1', cycleAStart)
    expect(deliveredValue(before, 'added_mid_cycle')).toBe(2)

    await complete(cycleA, COMPLETED_A_AT)

    // The raw column now reads later than the cycle's start for the carried issue …
    const carried = await issue(lateAndSlipping)
    expect(carried?.cycle_assigned_at?.getTime()).toBe(COMPLETED_A_AT)
    expect(carried?.cycle_assigned_at?.getTime()).toBeGreaterThan(cycleAStart)

    // … and the panel still counts it as carried out of A, not as scope creep in A.
    const after = await seedCycle(cycleA, 'Cycle 1', cycleAStart)
    expect(deliveredValue(after, 'added_mid_cycle')).toBe(1)
    expect(deliveredValue(after, 'carried_out')).toBe(1)
    expect(deliveredValue(after, 'shipped')).toBe(2)
    expect(deliveredValue(after, 'carried_twice_plus')).toBe(0)

    // Cycle B, before it completes: it holds the carried issue, which is carried IN there — the same
    // issue counted once on each side of the rollover, and not as scope creep on either.
    const nextCycle = await seedCycle(cycleB, 'Cycle 2', cycleBStart)
    expect(deliveredValue(nextCycle, 'carried_in')).toBe(1)
    expect(deliveredValue(nextCycle, 'added_mid_cycle')).toBe(0)
  })

  it('reports the twice-carried issue only after the second rollover', async () => {
    const slipping = await createIssue('Slipping twice', 'in_progress')
    await setCycle(slipping, cycleA, cycleAStart)

    await complete(cycleA, COMPLETED_A_AT)
    expect(deliveredValue(await seedCycle(cycleA, 'Cycle 1', cycleAStart), 'carried_twice_plus')) //
      .toBe(0)

    await apply((tx) =>
      mutators.cycle.activate.fn({
        tx,
        args: { id: cycleB, updatedAt: cycleBStart },
        ctx: AUTHOR,
      }),
    )
    await complete(cycleB, COMPLETED_B_AT)

    const secondCycle = await seedCycle(cycleB, 'Cycle 2', cycleBStart)
    expect(deliveredValue(secondCycle, 'carried_out')).toBe(1)
    expect(deliveredValue(secondCycle, 'carried_twice_plus')).toBe(1)
  })
})
