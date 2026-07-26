import type { Migration, MigrationProvider } from 'kysely'
import * as m0001 from './0001_workspace.js'
import * as m0002 from './0002_workspace_auth.js'
import * as m0003 from './0003_user_preference.js'
import * as m0004 from './0004_issue_core.js'
import * as m0005 from './0005_board_rank.js'
import * as m0006 from './0006_cycles.js'
import * as m0007 from './0007_triage.js'
import * as m0008 from './0008_projects.js'
import * as m0009 from './0009_connectors.js'
import * as m0010 from './0010_ai.js'
import * as m0011 from './0011_cycle_rollover_origin.js'
import * as m0012 from './0012_retro.js'
import * as m0013 from './0013_notifications.js'

export const migrations: Record<string, Migration> = {
  '0001_workspace': m0001,
  '0002_workspace_auth': m0002,
  '0003_user_preference': m0003,
  '0004_issue_core': m0004,
  '0005_board_rank': m0005,
  '0006_cycles': m0006,
  '0007_triage': m0007,
  '0008_projects': m0008,
  '0009_connectors': m0009,
  '0010_ai': m0010,
  '0011_cycle_rollover_origin': m0011,
  '0012_retro': m0012,
  '0013_notifications': m0013,
}

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
}
