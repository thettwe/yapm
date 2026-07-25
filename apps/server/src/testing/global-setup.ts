import { createDatabase, migrateToLatest } from '@yapm/schema/db'
import { sql } from 'kysely'
import { createAuth } from '../auth.js'
import { type Env, envSchema } from '../config/env.js'
import { SERVER_TEST_DATABASE, withDatabase } from './database-url.js'

// Provisions this tier's own database (see database-url.ts) exactly once, before any suite runs.
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
    const { rows } =
      await sql`select 1 from pg_database where datname = ${SERVER_TEST_DATABASE}`.execute(admin.db)
    if (rows.length === 0) {
      await sql.raw(`create database "${SERVER_TEST_DATABASE}"`).execute(admin.db)
    }
  } finally {
    await admin.close()
  }

  const connectionString = withDatabase(base, SERVER_TEST_DATABASE)
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
