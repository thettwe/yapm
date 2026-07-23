import type { Kysely } from 'kysely'
import type { WorkspaceRole } from '../zero/context.js'
import type { DB } from './types.js'

// The single access edge: presence of a row = access, `role` = capability. Returns
// `null` for an authenticated user who is not (yet) a member.
export async function lookupWorkspaceRole(
  db: Kysely<DB>,
  userId: string,
): Promise<WorkspaceRole | null> {
  const row = await db
    .selectFrom('workspace_member')
    .select('role')
    .where('user_id', '=', userId)
    .executeTakeFirst()

  return row?.role ?? null
}
