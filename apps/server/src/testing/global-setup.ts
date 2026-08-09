import { createDatabase, migrateToLatest } from '@yapm/schema/db'
import { sql } from 'kysely'
import { createAuth } from '../auth.js'
import { type Env, envSchema } from '../config/env.js'
import { RETRO_DRAFT_TEST_DATABASE, SERVER_TEST_DATABASE, withDatabase } from './database-url.js'

const TEST_DATABASES = [SERVER_TEST_DATABASE, RETRO_DRAFT_TEST_DATABASE]

// Provisions this tier's own databases (see database-url.ts) exactly once, before any suite runs.
//
// The auth tables are part of that: the live-db suites drive Zero's server mutators, and
// `getServerSchema` asserts every table in the Zero schema exists — including `user`, which
// better-auth's `getMigrations()` owns rather than the Kysely migrations. It is neither
// advisory-locked nor transactional, so it runs here, once, through the same `migrateAuth()` the
// server boots with, rather than per suite or by inheriting whatever another package's tests left.
export default async function setup(): Promise<void> {
  const base = process.env.DATABASE_URL
  if (base === undefined) return

  const admin = createDatabase({ connectionString: withDatabase(base, 'postgres') })
  try {
    for (const name of TEST_DATABASES) {
      const { rows } = await sql`select 1 from pg_database where datname = ${name}`.execute(
        admin.db,
      )
      if (rows.length === 0) {
        await sql.raw(`create database "${name}"`).execute(admin.db)
      }
    }
  } finally {
    await admin.close()
  }

  for (const name of TEST_DATABASES) {
    const connectionString = withDatabase(base, name)
    const parsed = envSchema.parse({ DATABASE_URL: connectionString })
    const env: Env = { ...parsed, WEB_DIST_DIR: parsed.WEB_DIST_DIR ?? '' }
    const database = createDatabase({ connectionString })
    try {
      await migrateToLatest(database.db)
      await createAuth(database.db, env).migrateAuth()
    } finally {
      await database.close()
    }
  }
}
