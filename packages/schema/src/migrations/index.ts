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
import * as m0014 from './0014_mentions.js'
import * as m0015 from './0015_search.js'
import * as m0016 from './0016_auto_status.js'
import * as m0017 from './0017_attachments.js'
import * as m0018 from './0018_retro_ai.js'
import * as m0019 from './0019_ai_retired_spend.js'
import * as m0020 from './0020_retro_ratification.js'
import * as m0021 from './0021_pm_digest.js'
import * as m0022 from './0022_retro_followup_category.js'

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
  '0014_mentions': m0014,
  '0015_search': m0015,
  '0016_auto_status': m0016,
  '0017_attachments': m0017,
  '0018_retro_ai': m0018,
  '0019_ai_retired_spend': m0019,
  '0020_retro_ratification': m0020,
  '0021_pm_digest': m0021,
  '0022_retro_followup_category': m0022,
}

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
}
