import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import type { WorkspaceRole } from '../zero/context.js'
import { createDatabase, type Database } from './client.js'
import { acceptInvite } from './invite.js'
import { migrateToLatest } from './migrate.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the invite acceptance test must not be skipped')
}

interface InviteSeed {
  role?: WorkspaceRole
  email?: string
  teamId?: string
  expiresAt?: Date
  revokedAt?: Date
}

describe.skipIf(DATABASE_URL === undefined)('acceptInvite', () => {
  let database: Database
  let workspaceId: string

  async function seedInvite(seed: InviteSeed = {}): Promise<string> {
    const token = newId()
    await database.db
      .insertInto('invite')
      .values({
        id: newId(),
        workspace_id: workspaceId,
        token,
        role: seed.role ?? 'member',
        created_by: 'creator',
        expires_at: seed.expiresAt ?? new Date(Date.now() + 3_600_000),
        ...(seed.email === undefined ? {} : { email: seed.email }),
        ...(seed.teamId === undefined ? {} : { team_id: seed.teamId }),
        ...(seed.revokedAt === undefined ? {} : { revoked_at: seed.revokedAt }),
      })
      .execute()
    return token
  }

  async function roleOf(userId: string): Promise<WorkspaceRole | undefined> {
    const row = await database.db
      .selectFrom('workspace_member')
      .select('role')
      .where('user_id', '=', userId)
      .executeTakeFirst()
    return row?.role
  }

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    workspaceId = newId()
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'invite-test' })
      .execute()
  }, 30_000)

  afterAll(async () => {
    // Cascades to member/team/team_membership/invite rows created under it.
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.close()
  })

  it('grants membership with the invite role via a shareable link', async () => {
    const token = await seedInvite({ role: 'viewer' })
    const userId = newId()

    const result = await acceptInvite(database.db, {
      token,
      userId,
      memberId: newId(),
      teamMembershipId: newId(),
    })

    expect(result).toMatchObject({ ok: true, role: 'viewer', joined: true })
    expect(await roleOf(userId)).toBe('viewer')
  })

  it('keeps a shareable link valid across multiple users', async () => {
    const token = await seedInvite()
    const first = newId()
    const second = newId()

    const a = await acceptInvite(database.db, {
      token,
      userId: first,
      memberId: newId(),
      teamMembershipId: newId(),
    })
    const b = await acceptInvite(database.db, {
      token,
      userId: second,
      memberId: newId(),
      teamMembershipId: newId(),
    })

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(await roleOf(first)).toBe('member')
    expect(await roleOf(second)).toBe('member')
  })

  it('consumes a single-use email invite and binds it to the address', async () => {
    const token = await seedInvite({ email: 'Invitee@Example.com' })

    const mismatch = await acceptInvite(database.db, {
      token,
      userId: newId(),
      userEmail: 'someone-else@example.com',
      memberId: newId(),
      teamMembershipId: newId(),
    })
    expect(mismatch).toEqual({ ok: false, reason: 'email_mismatch' })

    const bound = newId()
    const accepted = await acceptInvite(database.db, {
      token,
      userId: bound,
      userEmail: 'invitee@example.com',
      memberId: newId(),
      teamMembershipId: newId(),
    })
    expect(accepted.ok).toBe(true)
    expect(await roleOf(bound)).toBe('member')

    const reuse = await acceptInvite(database.db, {
      token,
      userId: newId(),
      userEmail: 'invitee@example.com',
      memberId: newId(),
      teamMembershipId: newId(),
    })
    expect(reuse).toEqual({ ok: false, reason: 'revoked' })
  })

  it('refuses an expired invite', async () => {
    const token = await seedInvite({ expiresAt: new Date(Date.now() - 1_000) })

    const result = await acceptInvite(database.db, {
      token,
      userId: newId(),
      memberId: newId(),
      teamMembershipId: newId(),
    })
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses a revoked invite', async () => {
    const token = await seedInvite({ revokedAt: new Date(Date.now() - 1_000) })

    const result = await acceptInvite(database.db, {
      token,
      userId: newId(),
      memberId: newId(),
      teamMembershipId: newId(),
    })
    expect(result).toEqual({ ok: false, reason: 'revoked' })
  })

  it('refuses an unknown token', async () => {
    const result = await acceptInvite(database.db, {
      token: 'no-such-token',
      userId: newId(),
      memberId: newId(),
      teamMembershipId: newId(),
    })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('adds team membership when the invite names a team', async () => {
    const teamId = newId()
    await database.db
      .insertInto('team')
      .values({ id: teamId, workspace_id: workspaceId, name: 'Platform', key: newId().slice(0, 8) })
      .execute()
    const token = await seedInvite({ teamId })
    const userId = newId()

    const result = await acceptInvite(database.db, {
      token,
      userId,
      memberId: newId(),
      teamMembershipId: newId(),
    })

    expect(result.ok).toBe(true)
    const membership = await database.db
      .selectFrom('team_membership')
      .select('id')
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    expect(membership).toBeDefined()
  })
})
