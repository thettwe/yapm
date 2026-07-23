import { type Kysely, sql } from 'kysely'
import type { DB, Workspace } from './types.js'

export const DEFAULT_WORKSPACE_NAME = 'yapm'

export const SEED_LOCK_ID = 4207331001

export interface SeedWorkspaceOptions {
  id: string
  name?: string
}

export async function seedWorkspace(
  db: Kysely<DB>,
  options: SeedWorkspaceOptions,
): Promise<Workspace | undefined> {
  const name = options.name ?? DEFAULT_WORKSPACE_NAME

  return db.transaction().execute(async (trx) => {
    // `where not exists` alone is not enough: under READ COMMITTED two booting
    // replicas both see an empty table and both insert.
    await sql`select pg_advisory_xact_lock(${sql.lit(SEED_LOCK_ID)})`.execute(trx)

    const { rows } = await sql<Workspace>`
      insert into workspace (id, name)
      select ${options.id}, ${name}
      where not exists (select 1 from workspace)
      returning id, name, created_at, updated_at
    `.execute(trx)

    return rows[0]
  })
}
