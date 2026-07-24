import { type IssueStatus, newId } from '@yapm/schema'
import { createDatabase, type Database, migrateToLatest } from '@yapm/schema/db'
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
})
