import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import { newId } from '../id.js'
import { claimNextIssueNumber } from './server-mutators.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the numbering test must not be skipped')
}

describe.skipIf(DATABASE_URL === undefined)('per-team issue numbering', () => {
  const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const workspaceId = newId()
  const teamA = newId()
  const teamB = newId()

  beforeAll(async () => {
    await migrateToLatest(database.db)
    await sql`insert into workspace (id, name) values (${workspaceId}, 'numbering-test')`.execute(
      database.db,
    )
    for (const [id, key] of [
      [teamA, `NA${Date.now() % 1000}`],
      [teamB, `NB${Date.now() % 1000}`],
    ] as const) {
      await sql`insert into team (id, workspace_id, name, key) values (${id}, ${workspaceId}, ${key}, ${key})`.execute(
        database.db,
      )
    }
  }, 30_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  it('assigns a gapless monotonic sequence per team starting at 1', async () => {
    const first = await claimNextIssueNumber(database.db, teamA)
    const second = await claimNextIssueNumber(database.db, teamA)
    const third = await claimNextIssueNumber(database.db, teamA)
    expect([first, second, third]).toEqual([1, 2, 3])
  })

  it('advances each team independently', async () => {
    const b1 = await claimNextIssueNumber(database.db, teamB)
    const b2 = await claimNextIssueNumber(database.db, teamB)
    expect([b1, b2]).toEqual([1, 2])
    // team A is unaffected by team B's claims
    const a4 = await claimNextIssueNumber(database.db, teamA)
    expect(a4).toBe(4)
  })

  it('gives distinct sequential numbers under concurrent claims in one team', async () => {
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => claimNextIssueNumber(database.db, teamB)),
    )
    const sorted = [...claims].sort((a, b) => a - b)
    // team B already advanced to 2, so the next ten are 3..12, all distinct
    expect(new Set(claims).size).toBe(10)
    expect(sorted).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})
