import type { Migration, MigrationProvider } from 'kysely'
import * as m0001 from './0001_workspace.js'
import * as m0002 from './0002_workspace_auth.js'
import * as m0003 from './0003_user_preference.js'
import * as m0004 from './0004_issue_core.js'
import * as m0005 from './0005_board_rank.js'

export const migrations: Record<string, Migration> = {
  '0001_workspace': m0001,
  '0002_workspace_auth': m0002,
  '0003_user_preference': m0003,
  '0004_issue_core': m0004,
  '0005_board_rank': m0005,
}

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
}
