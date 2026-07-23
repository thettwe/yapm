import type { Migration, MigrationProvider } from 'kysely'
import * as m0001 from './0001_workspace.js'

export const migrations: Record<string, Migration> = {
  '0001_workspace': m0001,
}

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
}
