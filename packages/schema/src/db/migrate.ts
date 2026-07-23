import { type Kysely, Migrator } from 'kysely'
import { migrationProvider } from '../migrations/index.js'
import type { DB } from './types.js'

export interface MigrationOutcome {
  name: string
  direction: 'Up' | 'Down'
  status: 'Success' | 'Error' | 'NotExecuted'
}

export const MIGRATION_TABLE = 'kysely_migration'
export const MIGRATION_LOCK_TABLE = 'kysely_migration_lock'

export function createMigrator(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: migrationProvider,
    migrationTableName: MIGRATION_TABLE,
    migrationLockTableName: MIGRATION_LOCK_TABLE,
    allowUnorderedMigrations: false,
  })
}

export async function migrateToLatest(db: Kysely<DB>): Promise<MigrationOutcome[]> {
  const { error, results } = await createMigrator(db).migrateToLatest()

  const outcomes: MigrationOutcome[] = (results ?? []).map((result) => ({
    name: result.migrationName,
    direction: result.direction,
    status: result.status,
  }))

  if (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }

  return outcomes
}
