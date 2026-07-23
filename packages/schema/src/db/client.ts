import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import type { DB } from './types.js'

export interface DatabaseOptions {
  connectionString: string
  maxConnections?: number
  log?: (event: { level: 'query' | 'error'; message: string }) => void
  onPoolError?: (error: Error) => void
}

export interface Database {
  db: Kysely<DB>
  pool: Pool
  close: () => Promise<void>
}

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
  })

  // Without an 'error' listener, node-postgres crashes the process when the server
  // drops an idle connection — readiness could then never report not-ready.
  pool.on('error', (error) => {
    options.onPoolError?.(error)
  })

  const log = options.log
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    log: log
      ? (event) => {
          log({
            level: event.level,
            message: event.level === 'error' ? String(event.error) : event.query.sql,
          })
        }
      : undefined,
  })

  return {
    db,
    pool,
    close: async () => {
      await db.destroy()
    },
  }
}

export async function pingDatabase(db: Kysely<DB>): Promise<void> {
  await sql`select 1`.execute(db)
}
