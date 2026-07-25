import { type IssueStatus, newId } from '@yapm/schema'
import {
  createDatabase,
  cycleFactsForTeam,
  cyclesNeedingDigest,
  type Database,
  migrateToLatest,
} from '@yapm/schema/db'
import { createServerMutators } from '@yapm/schema/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createZeroDatabase } from '../zero/db-provider.js'
import { runCycleMaintenance } from './cycles.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the cycle maintenance test must not be skipped')
}

describe.skipIf(DATABASE_URL === undefined)('cycle maintenance rollover (live db)', () => {
  let database: Database
  const workspaceId = newId()
  const teamId = newId()

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'Rollover WS' })
      .execute()
    await database.db
      .insertInto('team')
      .values({ id: teamId, workspace_id: workspaceId, name: 'Rollover Team', key: 'ROLL' })
      .execute()
  }, 30_000)

  afterAll(async () => {
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.close()
  })

  it('completes ended cycles, activates started ones, and rolls unfinished issues forward', async () => {
    const now = Date.now()
    const active = newId()
    const upcoming = newId()
    await database.db
      .insertInto('cycle')
      .values([
        {
          id: active,
          team_id: teamId,
          name: 'Cycle A',
          status: 'active',
          start_date: new Date(now - 100_000),
          end_date: new Date(now - 10_000),
        },
        {
          id: upcoming,
          team_id: teamId,
          name: 'Cycle B',
          status: 'upcoming',
          start_date: new Date(now - 5_000),
          end_date: new Date(now + 100_000),
        },
      ])
      .execute()

    const [todo, done, wip] = [newId(), newId(), newId()]
    const seeds: { id: string; status: IssueStatus }[] = [
      { id: todo, status: 'todo' },
      { id: done, status: 'done' },
      { id: wip, status: 'in_progress' },
    ]
    await database.db
      .insertInto('issue')
      .values(
        seeds.map((issue) => ({
          ...issue,
          team_id: teamId,
          title: `issue ${issue.id}`,
          priority: 'medium' as const,
          creator_id: 'system',
          cycle_id: active,
        })),
      )
      .execute()

    const dbProvider = createZeroDatabase(database.db)
    const mutators = createServerMutators()

    const result = await runCycleMaintenance(database.db, dbProvider, mutators, now)
    expect(result.completed).toContain(active)
    expect(result.activated).toContain(upcoming)

    const cycles = await database.db
      .selectFrom('cycle')
      .select(['id', 'status'])
      .where('team_id', '=', teamId)
      .execute()
    const statusById = new Map(cycles.map((c) => [c.id, c.status]))
    expect(statusById.get(active)).toBe('completed')
    expect(statusById.get(upcoming)).toBe('active')

    const issues = await database.db
      .selectFrom('issue')
      .select(['id', 'cycle_id'])
      .where('team_id', '=', teamId)
      .execute()
    const cycleByIssue = new Map(issues.map((i) => [i.id, i.cycle_id]))
    expect(cycleByIssue.get(todo)).toBe(upcoming)
    expect(cycleByIssue.get(wip)).toBe(upcoming)
    expect(cycleByIssue.get(done)).toBe(active)

    // Idempotent: a second pass at the same instant moves nothing new.
    const again = await runCycleMaintenance(database.db, dbProvider, mutators, now)
    expect(again.completed).not.toContain(active)
  }, 30_000)

  it('reconstructs a manually-completed cycle from the rollover-origin marker for the digest sweep', async () => {
    const now = Date.now()
    const src = newId()
    const dst = newId()
    await database.db
      .insertInto('cycle')
      .values([
        {
          id: src,
          team_id: teamId,
          name: 'Manual A',
          status: 'active',
          start_date: new Date(now - 100_000),
          end_date: new Date(now + 100_000),
        },
        {
          id: dst,
          team_id: teamId,
          name: 'Manual B',
          status: 'upcoming',
          start_date: new Date(now + 50_000),
          end_date: new Date(now + 200_000),
        },
      ])
      .execute()

    const [carried, shipped] = [newId(), newId()]
    await database.db
      .insertInto('issue')
      .values(
        (
          [
            { id: carried, status: 'in_progress' },
            { id: shipped, status: 'done' },
          ] as const
        ).map((issue) => ({
          id: issue.id,
          status: issue.status,
          team_id: teamId,
          title: `manual ${issue.id}`,
          priority: 'medium' as const,
          creator_id: 'system',
          cycle_id: src,
        })),
      )
      .execute()

    // Drive the SHARED cycle.complete mutator directly, exactly as the client optimistic path does
    // (the scheduler never re-selects a hand-completed cycle), re-pointing the unfinished issue.
    const dbProvider = createZeroDatabase(database.db)
    const mutators = createServerMutators()
    await dbProvider.transaction((tx) =>
      mutators.cycle.complete.fn({
        tx,
        args: { id: src, updatedAt: now },
        ctx: { userID: 'system', role: 'admin' },
      }),
    )

    // The carried issue was re-pointed off src but stamped its origin cycle; the shipped one stayed.
    // (The exact destination is whichever open cycle sorts first after src, so assert only that it
    // moved — the origin marker is what the completed-cycle view reconstructs from.)
    const carriedRow = await database.db
      .selectFrom('issue')
      .select(['cycle_id', 'rolled_over_from_cycle_id'])
      .where('id', '=', carried)
      .executeTakeFirstOrThrow()
    expect(carriedRow.cycle_id).not.toBe(src)
    expect(carriedRow.rolled_over_from_cycle_id).toBe(src)
    const shippedRow = await database.db
      .selectFrom('issue')
      .select(['cycle_id'])
      .where('id', '=', shipped)
      .executeTakeFirstOrThrow()
    expect(shippedRow.cycle_id).toBe(src)

    // Post-rollover facts reconstruction sees the carried issue via the marker, so the scope is
    // correct rather than reporting carried=0 / an undercounted total.
    const facts = await cycleFactsForTeam(database.db, teamId, src)
    expect(facts).not.toBeNull()
    expect(facts?.counts.total).toBe(2)
    expect(facts?.counts.shipped).toBe(1)
    expect(facts?.counts.carried).toBe(1)
    expect(facts?.issues.map((issue) => issue.issueId).sort()).toEqual([carried, shipped].sort())

    // The sweep query surfaces the hand-completed cycle (no digest row yet, recently completed).
    const needing = await cyclesNeedingDigest(database.db, {
      completedSince: new Date(now - 60_000),
      limit: 25,
    })
    expect(needing.map((cycle) => cycle.id)).toContain(src)

    // …and excludes it once handled this pass (the scheduler-close path already enqueued it).
    const excluded = await cyclesNeedingDigest(database.db, {
      completedSince: new Date(now - 60_000),
      exclude: [src],
      limit: 25,
    })
    expect(excluded.map((cycle) => cycle.id)).not.toContain(src)
  }, 30_000)
})
