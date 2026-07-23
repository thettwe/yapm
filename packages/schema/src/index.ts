export type { Database, DatabaseOptions } from './db/client.js'
export { createDatabase, pingDatabase } from './db/client.js'
export type { MigrationOutcome } from './db/migrate.js'
export { createMigrator, migrateToLatest } from './db/migrate.js'
export type { SeedWorkspaceOptions } from './db/seed.js'
export { DEFAULT_WORKSPACE_NAME, seedWorkspace } from './db/seed.js'
export type {
  DB,
  NewWorkspace,
  Timestamp,
  Workspace,
  WorkspaceTable,
  WorkspaceUpdate,
} from './db/types.js'
export { newId } from './id.js'
