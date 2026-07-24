import { sql } from 'kysely'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { createMigrator } from '../db/migrate.js'
import { newId } from '../id.js'

// The board-view migration backfills every existing issue with a fractional-index `rank` within
// its (team, status) column, matching the list's default order (priority desc, updated_at desc,
// id asc), with distinct byte-ordered keys (issue-tracking/spec.md). This drives the real
// migration against live Postgres: stage the schema to just-before 0005, seed issues, run the
// backfill, then assert the ranks.
//
// It runs against a throwaway database (created and dropped here) so it stays fully isolated
// from the drift/collation tests that hit the shared database concurrently — a separate schema
// is not enough, because Kysely's migrator introspection is schema-unaware and would collide on
// the migration bookkeeping tables that already exist in `public`.
const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the board-rank backfill test must not be skipped',
  )
}

interface SeedIssue {
  id: string
  team: string
  status: string
  priority: string
  updated: number
}

describe.skipIf(DATABASE_URL === undefined)('0005_board_rank backfill', () => {
  const dbName = `yapm_board_rank_test_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
  const admin = createDatabase({ connectionString: DATABASE_URL ?? '' })
  let scoped: Database | undefined

  afterAll(async () => {
    if (scoped) await scoped.close()
    await sql.raw(`drop database if exists "${dbName}"`).execute(admin.db)
    await admin.close()
  })

  it('ranks every issue per column, matching the list default order with distinct keys', async () => {
    await sql.raw(`create database "${dbName}"`).execute(admin.db)
    const scopedUrl = new URL(DATABASE_URL ?? '')
    scopedUrl.pathname = `/${dbName}`
    scoped = createDatabase({ connectionString: scopedUrl.toString() })
    const db = scoped.db

    // Stage every migration up to (but not including) the backfill, so the issue table exists.
    await createMigrator(db).migrateTo('0004_issue_core')

    const workspaceId = newId()
    const teamA = newId()
    const teamB = newId()
    await sql`insert into workspace (id, name) values (${workspaceId}, 'Backfill WS')`.execute(db)
    await sql`
      insert into team (id, workspace_id, name, key) values
        (${teamA}, ${workspaceId}, 'Team A', 'TA'),
        (${teamB}, ${workspaceId}, 'Team B', 'TB')
    `.execute(db)

    // Each list is the EXPECTED order after backfill (priority desc, updated_at desc, id asc).
    // Team A / todo deliberately places a lower-priority-but-newer issue after a higher-priority
    // older one, so the PRIORITY_RANK case is genuinely exercised (priority beats recency).
    const teamAtodo: SeedIssue[] = [
      { id: newId(), team: teamA, status: 'todo', priority: 'urgent', updated: 100 },
      { id: newId(), team: teamA, status: 'todo', priority: 'low', updated: 500 },
    ]
    const teamAinProgress: SeedIssue[] = [
      { id: newId(), team: teamA, status: 'in_progress', priority: 'high', updated: 300 },
      { id: newId(), team: teamA, status: 'in_progress', priority: 'high', updated: 200 },
      { id: newId(), team: teamA, status: 'in_progress', priority: 'medium', updated: 400 },
    ]
    const teamBtodo: SeedIssue[] = [
      { id: newId(), team: teamB, status: 'todo', priority: 'medium', updated: 200 },
      { id: newId(), team: teamB, status: 'todo', priority: 'medium', updated: 100 },
    ]

    // Insert shuffled so the migration's ORDER BY, not insertion order, decides the ranks.
    const seed = [...teamAinProgress, ...teamBtodo, ...teamAtodo].sort(() => Math.random() - 0.5)
    for (const row of seed) {
      await sql`
        insert into issue (id, team_id, title, status, priority, creator_id, updated_at)
        values (${row.id}, ${row.team}, ${'seed'}, ${row.status}, ${row.priority},
          ${'creator'}, to_timestamp(${row.updated}))
      `.execute(db)
    }

    await createMigrator(db).migrateTo('0005_board_rank')

    const { rows: unranked } = await sql<{ count: number | string }>`
      select count(*) as count from issue where rank is null
    `.execute(db)
    expect(Number(unranked[0]?.count)).toBe(0)

    async function ranksInOrder(
      team: string,
      status: string,
    ): Promise<{ id: string; rank: string }[]> {
      const { rows } = await sql<{ id: string; rank: string }>`
        select id, rank from issue
        where team_id = ${team} and status = ${status}
        order by rank collate "C"
      `.execute(db)
      return rows
    }

    async function assertGroup(expected: SeedIssue[]): Promise<string> {
      const first = expected[0]
      if (first === undefined) throw new Error('empty expected group')
      const rows = await ranksInOrder(first.team, first.status)
      // Byte-ordered read matches the list default order.
      expect(rows.map((row) => row.id)).toEqual(expected.map((issue) => issue.id))
      // Distinct, strictly byte-ascending keys.
      const keys = rows.map((row) => row.rank)
      expect(new Set(keys).size).toBe(keys.length)
      expect([...keys].sort()).toEqual(keys)
      return keys[0] as string
    }

    const firstTeamAtodo = await assertGroup(teamAtodo)
    const firstTeamAinProgress = await assertGroup(teamAinProgress)
    await assertGroup(teamBtodo)

    // Ranks are minted per (team, status) column, not globally: two different-status columns in
    // the same team each start their own fresh fractional fill, so their first keys coincide.
    // A global numbering would have handed them distinct keys.
    expect(firstTeamAtodo).toBe(firstTeamAinProgress)
  })
})
