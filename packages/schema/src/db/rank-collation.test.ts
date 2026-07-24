import { sql } from 'kysely'
import { afterAll, describe, expect, it } from 'vitest'
import { initialRanks, rankBetween } from '../zero/rank.js'
import { createDatabase } from './client.js'

// The board stores `rank text COLLATE "C"` so Postgres byte-order sort matches JS string
// order exactly (the standard fractional-index footgun: a locale-sensitive default collation
// would reorder keys). This asserts that invariant against live Postgres for the BASE_62
// alphabet the helpers actually emit.
const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the rank-collation test must not be skipped')
}

describe.skipIf(DATABASE_URL === undefined)('rank collation', () => {
  const database = createDatabase({ connectionString: DATABASE_URL ?? '' })

  afterAll(async () => {
    await database.close()
  })

  it('orders COLLATE "C" ranks identically to JS string sort', async () => {
    const ranks = initialRanks(500)
    // Interleave some between-keys to exercise variable-length keys, then shuffle the insert
    // order so the DB genuinely sorts rather than returning insertion order.
    for (let i = 0; i + 1 < ranks.length; i += 50) {
      ranks.push(rankBetween(ranks[i] ?? null, ranks[i + 1] ?? null))
    }
    const shuffled = [...ranks].sort(() => Math.random() - 0.5)

    await database.db.transaction().execute(async (tx) => {
      await sql`create temp table rank_probe (rank text collate "C") on commit drop`.execute(tx)
      for (const rank of shuffled) {
        await sql`insert into rank_probe (rank) values (${rank})`.execute(tx)
      }
      const { rows } = await sql<{ rank: string }>`
        select rank from rank_probe order by rank
      `.execute(tx)
      const fromDb = rows.map((row) => row.rank)
      const fromJs = [...ranks].sort()
      expect(fromDb).toEqual(fromJs)
    })
  })
})
