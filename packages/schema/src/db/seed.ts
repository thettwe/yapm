import { type Kysely, sql } from 'kysely'
import type { DB, Workspace, WorkspaceMember } from './types.js'

export const DEFAULT_WORKSPACE_NAME = 'yapm'

export const SEED_LOCK_ID = 4207331001
export const BOOTSTRAP_LOCK_ID = 4207331002

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

export interface BootstrapFirstAdminOptions {
  id: string
  userId: string
  userEmail?: string
  requiredEmail?: string
}

function normalizeEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

// First-authenticated-user-wins: promote the caller to `admin` only if the workspace
// has zero members yet. Advisory-locked (same pattern as `seedWorkspace`) so concurrent
// first sign-ins produce exactly one admin. Returns the created row, or `undefined` when
// a member already exists or the required-email gate rejects the caller.
export async function bootstrapFirstAdmin(
  db: Kysely<DB>,
  options: BootstrapFirstAdminOptions,
): Promise<WorkspaceMember | undefined> {
  const requiredEmail = normalizeEmail(options.requiredEmail)
  if (requiredEmail !== undefined && normalizeEmail(options.userEmail) !== requiredEmail) {
    return undefined
  }

  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${sql.lit(BOOTSTRAP_LOCK_ID)})`.execute(trx)

    const { rows } = await sql<WorkspaceMember>`
      insert into workspace_member (id, workspace_id, user_id, role)
      select ${options.id}, w.id, ${options.userId}, 'admin'
      from workspace w
      where not exists (select 1 from workspace_member)
      limit 1
      returning id, workspace_id, user_id, role, created_at, updated_at
    `.execute(trx)

    return rows[0]
  })
}
