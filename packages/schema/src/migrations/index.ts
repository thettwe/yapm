import type { Migration, MigrationProvider } from 'kysely'
import * as m0001 from './0001_workspace.js'
import * as m0002 from './0002_workspace_auth.js'
import * as m0003 from './0003_user_preference.js'

export const migrations: Record<string, Migration> = {
  '0001_workspace': m0001,
  '0002_workspace_auth': m0002,
  '0003_user_preference': m0003,
}

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
}
