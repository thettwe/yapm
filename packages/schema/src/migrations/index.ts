import type { Migration, MigrationProvider } from 'kysely'
import * as m0001 from './0001_workspace.js'
import * as m0002 from './0002_workspace_auth.js'

export const migrations: Record<string, Migration> = {
  '0001_workspace': m0001,
  '0002_workspace_auth': m0002,
}

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
}
