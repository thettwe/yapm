import type { Kysely } from 'kysely'
import type { WorkspaceRole } from '../zero/context.js'
import type { DB } from './types.js'

export interface AcceptInviteOptions {
  token: string
  userId: string
  userEmail?: string
  // Client-minted UUIDv7 primary keys, generated at the call site (constraint #4).
  memberId: string
  teamMembershipId: string
  now?: Date
}

export type AcceptInviteRefusal = 'not_found' | 'expired' | 'revoked' | 'email_mismatch'

export type AcceptInviteResult =
  | {
      ok: true
      workspaceId: string
      role: WorkspaceRole
      teamId: string | null
      joined: boolean
    }
  | { ok: false; reason: AcceptInviteRefusal }

function normalizeEmail(email: string | null | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

// Token-driven membership grant. An email invite is single-use and bound to that
// address; a link invite (email null) is reusable until it expires or is revoked.
// Validity is checked before any membership is created; the token itself is the
// capability, so there is no private row whose existence could leak.
export async function acceptInvite(
  db: Kysely<DB>,
  options: AcceptInviteOptions,
): Promise<AcceptInviteResult> {
  const now = options.now ?? new Date()

  return db.transaction().execute(async (trx) => {
    const invite = await trx
      .selectFrom('invite')
      .selectAll()
      .where('token', '=', options.token)
      .executeTakeFirst()

    if (!invite) return { ok: false, reason: 'not_found' }
    if (invite.revoked_at !== null) return { ok: false, reason: 'revoked' }
    if (invite.expires_at.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }

    if (invite.email !== null) {
      const bound = normalizeEmail(invite.email)
      if (normalizeEmail(options.userEmail) !== bound) {
        return { ok: false, reason: 'email_mismatch' }
      }
    }

    const existing = await trx
      .selectFrom('workspace_member')
      .select('id')
      .where('user_id', '=', options.userId)
      .executeTakeFirst()

    let joined = false
    if (!existing) {
      await trx
        .insertInto('workspace_member')
        .values({
          id: options.memberId,
          workspace_id: invite.workspace_id,
          user_id: options.userId,
          role: invite.role,
        })
        .onConflict((oc) => oc.column('user_id').doNothing())
        .execute()
      joined = true
    }

    if (invite.team_id !== null) {
      await trx
        .insertInto('team_membership')
        .values({
          id: options.teamMembershipId,
          team_id: invite.team_id,
          user_id: options.userId,
        })
        .onConflict((oc) => oc.columns(['team_id', 'user_id']).doNothing())
        .execute()
    }

    if (invite.email !== null) {
      await trx
        .updateTable('invite')
        .set({ revoked_at: now })
        .where('id', '=', invite.id)
        .where('revoked_at', 'is', null)
        .execute()
    }

    return {
      ok: true,
      workspaceId: invite.workspace_id,
      role: invite.role,
      teamId: invite.team_id,
      joined,
    }
  })
}
