import { mustGetMutator, type Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import {
  addTeamMember,
  archiveTeam,
  assertRenameWorkspaceAllowed,
  changeMemberRole,
  createInvite,
  createTeam,
  mutators,
  normalizeTeamKey,
  normalizeWorkspaceName,
  removeMember,
  removeTeamMember,
  renameTeam,
  renameWorkspace,
  revokeInvite,
  WORKSPACE_NAME_MAX_LENGTH,
} from './mutators.js'

const ADMIN: AuthContext = { userID: 'user-admin', role: 'admin' }
const MEMBER: AuthContext = { userID: 'user-member', role: 'member' }
const VIEWER: AuthContext = { userID: 'user-viewer', role: 'viewer' }
const NON_MEMBER: AuthContext = { userID: 'user-outsider', role: null }

const WORKSPACE_ID = '019f8f00-0000-7000-8000-000000000000'

interface RecordedCall {
  table: string
  verb: 'insert' | 'update' | 'delete'
  value: Record<string, unknown>
}

function fakeTx(runResults: unknown[] = []) {
  const calls: RecordedCall[] = []
  const runQueue = [...runResults]

  const tableMutator = (table: string) => ({
    insert: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'insert', value })
      return Promise.resolve()
    },
    update: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'update', value })
      return Promise.resolve()
    },
    delete: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'delete', value })
      return Promise.resolve()
    },
  })

  const tx = {
    location: 'server',
    reason: 'authoritative',
    run: () => Promise.resolve(runQueue.shift()),
    mutate: new Proxy(
      {},
      {
        get: (_target, table: string) => tableMutator(table),
      },
    ),
  } as unknown as Transaction

  return { tx, calls, runQueue }
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (thrown) {
    return thrown
  }
  return undefined
}

describe('normalizeWorkspaceName', () => {
  it('collapses runs of whitespace and trims the result', () => {
    expect(normalizeWorkspaceName('  Platform   Team \n')).toBe('Platform Team')
  })

  it('collapses a whitespace-only name to the empty string', () => {
    expect(normalizeWorkspaceName(' \t \n ')).toBe('')
  })
})

describe('normalizeTeamKey', () => {
  it('uppercases and strips whitespace', () => {
    expect(normalizeTeamKey(' plat form ')).toBe('PLATFORM')
  })
})

describe('assertRenameWorkspaceAllowed', () => {
  const args = (name: string) => ({ id: WORKSPACE_ID, name, updatedAt: 1_784_820_335_919 })

  it('returns the normalized name for an admin', () => {
    expect(assertRenameWorkspaceAllowed(args('  Platform  Team '), ADMIN)).toBe('Platform Team')
  })

  it.each([
    ['a member', MEMBER],
    ['a viewer', VIEWER],
    ['a non-member', NON_MEMBER],
    ['an unauthenticated caller', undefined],
  ])('rejects %s before looking at the name', (_label, ctx) => {
    const error = (() => {
      try {
        assertRenameWorkspaceAllowed(args(''), ctx)
      } catch (thrown) {
        return thrown
      }
      return undefined
    })()

    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
  })

  it('rejects an empty name for an admin', () => {
    expect(
      mutationErrorCode(assertThrows(() => assertRenameWorkspaceAllowed(args('   '), ADMIN))),
    ).toBe(MutationErrorCode.invalidName)
  })

  it('rejects a name longer than the column budget', () => {
    const long = 'x'.repeat(WORKSPACE_NAME_MAX_LENGTH + 1)
    expect(
      mutationErrorCode(assertThrows(() => assertRenameWorkspaceAllowed(args(long), ADMIN))),
    ).toBe(MutationErrorCode.invalidName)
  })
})

function assertThrows(fn: () => unknown): unknown {
  try {
    fn()
  } catch (thrown) {
    return thrown
  }
  return undefined
}

describe('renameWorkspace mutator', () => {
  const args = (name: string) => ({ id: WORKSPACE_ID, name, updatedAt: 1_784_820_335_919 })

  it('writes the normalized name for an admin', async () => {
    const { tx, calls } = fakeTx()
    await renameWorkspace.fn({ tx, args: args('  Platform  Team  '), ctx: ADMIN })
    expect(calls).toEqual([
      {
        table: 'workspace',
        verb: 'update',
        value: { id: WORKSPACE_ID, name: 'Platform Team', updatedAt: 1_784_820_335_919 },
      },
    ])
  })

  it('rejects a viewer write and records no mutation (rolls back)', async () => {
    const { tx, calls } = fakeTx()
    const error = await capture(renameWorkspace.fn({ tx, args: args('ok'), ctx: VIEWER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('changeMemberRole mutator', () => {
  const args = { id: newId(), role: 'viewer' as const, updatedAt: 1_784_820_335_919 }

  it('lets an admin change a role', async () => {
    const { tx, calls } = fakeTx([{ id: args.id, userId: 'user-x', role: 'member' }])
    await changeMemberRole.fn({ tx, args, ctx: ADMIN })
    expect(calls).toEqual([
      {
        table: 'workspace_member',
        verb: 'update',
        value: { id: args.id, role: 'viewer', updatedAt: args.updatedAt },
      },
    ])
  })

  it.each([
    ['a member', MEMBER],
    ['a viewer', VIEWER],
    ['a non-member', NON_MEMBER],
    ['an unauthenticated caller', undefined],
  ])('rejects %s before reading the target row', async (_label, ctx) => {
    const { tx, calls, runQueue } = fakeTx([{ id: args.id, userId: 'user-x', role: 'member' }])
    const error = await capture(changeMemberRole.fn({ tx, args, ctx }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
    expect(runQueue).toHaveLength(1)
  })

  it('protects the last admin from demotion', async () => {
    const { tx, calls } = fakeTx([
      { id: args.id, userId: 'user-x', role: 'admin' },
      [{ id: args.id, role: 'admin' }],
    ])
    const error = await capture(changeMemberRole.fn({ tx, args, ctx: ADMIN }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.lastAdmin)
    expect(calls).toEqual([])
  })

  it('allows demoting an admin when another admin remains', async () => {
    const { tx, calls } = fakeTx([
      { id: args.id, userId: 'user-x', role: 'admin' },
      [
        { id: args.id, role: 'admin' },
        { id: 'other', role: 'admin' },
      ],
    ])
    await changeMemberRole.fn({ tx, args, ctx: ADMIN })
    expect(calls).toHaveLength(1)
  })
})

describe('removeMember mutator', () => {
  it('lets a member remove its own membership (leave)', async () => {
    const memberId = newId()
    const { tx, calls } = fakeTx([{ id: memberId, userId: MEMBER.userID, role: 'member' }])
    await removeMember.fn({ tx, args: { id: memberId }, ctx: MEMBER })
    expect(calls).toEqual([{ table: 'workspace_member', verb: 'delete', value: { id: memberId } }])
  })

  it('rejects a member removing someone else', async () => {
    const memberId = newId()
    const { tx, calls } = fakeTx([{ id: memberId, userId: 'someone-else', role: 'member' }])
    const error = await capture(removeMember.fn({ tx, args: { id: memberId }, ctx: MEMBER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects an unauthenticated caller before reading', async () => {
    const memberId = newId()
    const { tx, runQueue } = fakeTx([{ id: memberId, userId: 'x', role: 'member' }])
    const error = await capture(removeMember.fn({ tx, args: { id: memberId }, ctx: undefined }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(runQueue).toHaveLength(1)
  })

  it('protects the last admin from removal', async () => {
    const memberId = newId()
    const { tx, calls } = fakeTx([
      { id: memberId, userId: 'user-x', role: 'admin' },
      [{ id: memberId, role: 'admin' }],
    ])
    const error = await capture(removeMember.fn({ tx, args: { id: memberId }, ctx: ADMIN }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.lastAdmin)
    expect(calls).toEqual([])
  })
})

describe('createTeam mutator', () => {
  const baseArgs = () => ({
    id: newId(),
    workspaceId: WORKSPACE_ID,
    name: '  Platform  Team  ',
    key: ' plat ',
    createdAt: 1_784_820_335_919,
    updatedAt: 1_784_820_335_919,
  })

  it('lets an admin create a team with a normalized name and key, minting the id at the call site', async () => {
    const args = baseArgs()
    const { tx, calls } = fakeTx([undefined])
    await createTeam.fn({ tx, args, ctx: ADMIN })
    expect(calls).toEqual([
      {
        table: 'team',
        verb: 'insert',
        value: {
          id: args.id,
          workspaceId: WORKSPACE_ID,
          name: 'Platform Team',
          key: 'PLAT',
          createdAt: args.createdAt,
          updatedAt: args.updatedAt,
        },
      },
    ])
  })

  it.each([
    ['a member', MEMBER],
    ['a viewer', VIEWER],
  ])('rejects %s creating a team', async (_label, ctx) => {
    const { tx, calls } = fakeTx([undefined])
    const error = await capture(createTeam.fn({ tx, args: baseArgs(), ctx }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects a colliding key with no write', async () => {
    const args = baseArgs()
    const { tx, calls } = fakeTx([{ id: 'existing', key: 'PLAT' }])
    const error = await capture(createTeam.fn({ tx, args, ctx: ADMIN }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.duplicateKey)
    expect(calls).toEqual([])
  })

  it('rejects an invalid key', async () => {
    const args = { ...baseArgs(), key: '123-bad' }
    const { tx, calls } = fakeTx([undefined])
    const error = await capture(createTeam.fn({ tx, args, ctx: ADMIN }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidKey)
    expect(calls).toEqual([])
  })
})

describe('team rename and archive', () => {
  it('rejects a non-admin rename', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id }])
    const error = await capture(
      renameTeam.fn({ tx, args: { id, name: 'X', updatedAt: 1 }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('lets an admin archive a team', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id }])
    await archiveTeam.fn({ tx, args: { id, archivedAt: 10, updatedAt: 10 }, ctx: ADMIN })
    expect(calls).toEqual([
      { table: 'team', verb: 'update', value: { id, archivedAt: 10, updatedAt: 10 } },
    ])
  })
})

describe('team membership self-serve and admin management', () => {
  const teamId = newId()

  it('lets a viewer join a visible team (self-serve) without gaining write power', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id: teamId, archivedAt: null }])
    await addTeamMember.fn({
      tx,
      args: { id, teamId, userId: VIEWER.userID, createdAt: 5 },
      ctx: VIEWER,
    })
    expect(calls).toEqual([
      {
        table: 'team_membership',
        verb: 'insert',
        value: { id, teamId, userId: VIEWER.userID, createdAt: 5 },
      },
    ])
  })

  it('rejects a member adding a different user', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id: teamId, archivedAt: null }])
    const error = await capture(
      addTeamMember.fn({ tx, args: { id, teamId, userId: 'other', createdAt: 5 }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('lets an admin add any user', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id: teamId, archivedAt: null }])
    await addTeamMember.fn({ tx, args: { id, teamId, userId: 'other', createdAt: 5 }, ctx: ADMIN })
    expect(calls).toHaveLength(1)
  })

  it('refuses joining an archived team', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id: teamId, archivedAt: 999 }])
    const error = await capture(
      addTeamMember.fn({
        tx,
        args: { id, teamId, userId: MEMBER.userID, createdAt: 5 },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('lets a member leave (remove own membership)', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId, userId: MEMBER.userID }])
    await removeTeamMember.fn({ tx, args: { id }, ctx: MEMBER })
    expect(calls).toEqual([{ table: 'team_membership', verb: 'delete', value: { id } }])
  })

  it('rejects a member removing another user from a team', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId, userId: 'someone-else' }])
    const error = await capture(removeTeamMember.fn({ tx, args: { id }, ctx: MEMBER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('invite create and revoke', () => {
  it('lets an admin create an invite with createdBy taken from ctx, not args', async () => {
    const args = {
      id: newId(),
      workspaceId: WORKSPACE_ID,
      token: newId(),
      role: 'member' as const,
      expiresAt: 20,
      createdAt: 10,
    }
    const { tx, calls } = fakeTx()
    await createInvite.fn({ tx, args, ctx: ADMIN })
    expect(calls).toEqual([
      {
        table: 'invite',
        verb: 'insert',
        value: {
          id: args.id,
          workspaceId: WORKSPACE_ID,
          token: args.token,
          role: 'member',
          email: undefined,
          teamId: undefined,
          createdBy: ADMIN.userID,
          expiresAt: 20,
          createdAt: 10,
        },
      },
    ])
  })

  it.each([
    ['a member', MEMBER],
    ['a viewer', VIEWER],
    ['a non-member', NON_MEMBER],
  ])('rejects %s creating an invite', async (_label, ctx) => {
    const args = {
      id: newId(),
      workspaceId: WORKSPACE_ID,
      token: newId(),
      role: 'member' as const,
      expiresAt: 20,
      createdAt: 10,
    }
    const { tx, calls } = fakeTx()
    const error = await capture(createInvite.fn({ tx, args, ctx }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects a non-admin revoke before reading the invite', async () => {
    const id = newId()
    const { tx, runQueue } = fakeTx([{ id }])
    const error = await capture(revokeInvite.fn({ tx, args: { id, revokedAt: 5 }, ctx: MEMBER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(runQueue).toHaveLength(1)
  })

  it('lets an admin revoke an invite', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id }])
    await revokeInvite.fn({ tx, args: { id, revokedAt: 5 }, ctx: ADMIN })
    expect(calls).toEqual([{ table: 'invite', verb: 'update', value: { id, revokedAt: 5 } }])
  })
})

describe('setPreference mutator', () => {
  const args = (over: Partial<Parameters<typeof mutators.preference.set.fn>[0]['args']> = {}) => ({
    id: newId(),
    theme: 'focused' as const,
    accent: '#3366ff' as string | null,
    updatedAt: 1_784_820_335_919,
    ...over,
  })

  it('inserts a first row with a call-site-minted id and user_id from ctx (not args)', async () => {
    const a = args()
    const { tx, calls } = fakeTx([undefined])
    await mutators.preference.set.fn({ tx, args: a, ctx: MEMBER })
    expect(calls).toEqual([
      {
        table: 'user_preference',
        verb: 'insert',
        value: {
          id: a.id,
          userId: MEMBER.userID,
          theme: 'focused',
          accent: '#3366ff',
          createdAt: a.updatedAt,
          updatedAt: a.updatedAt,
        },
      },
    ])
  })

  it('updates the caller own existing row, ignoring the args id (own-row-only)', async () => {
    const existingId = newId()
    const { tx, calls } = fakeTx([
      { id: existingId, userId: MEMBER.userID, theme: 'warm', accent: null },
    ])
    await mutators.preference.set.fn({
      tx,
      args: args({ theme: 'editorial', accent: null }),
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      {
        table: 'user_preference',
        verb: 'update',
        value: { id: existingId, theme: 'editorial', accent: null, updatedAt: 1_784_820_335_919 },
      },
    ])
  })

  it('lets an authenticated non-member set their own preference', async () => {
    const { tx, calls } = fakeTx([undefined])
    await mutators.preference.set.fn({ tx, args: args({ accent: null }), ctx: NON_MEMBER })
    expect(calls).toHaveLength(1)
  })

  it('rejects an unparseable accent with no write', async () => {
    const { tx, calls } = fakeTx([undefined])
    const error = await capture(
      mutators.preference.set.fn({ tx, args: args({ accent: 'not-a-color' }), ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidColor)
    expect(calls).toEqual([])
  })

  it('rejects an unauthenticated caller before reading the existing row', async () => {
    const { tx, calls, runQueue } = fakeTx([{ id: 'x', userId: 'x', theme: 'warm', accent: null }])
    const error = await capture(mutators.preference.set.fn({ tx, args: args(), ctx: undefined }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
    expect(runQueue).toHaveLength(1)
  })
})

describe('the mutator registry', () => {
  it('registers every mutator under the name the client and server resolve', () => {
    expect(mutators.workspace.rename.mutatorName).toBe('workspace.rename')
    for (const name of [
      'workspace.rename',
      'preference.set',
      'member.changeRole',
      'member.remove',
      'team.create',
      'team.rename',
      'team.archive',
      'team.addMember',
      'team.removeMember',
      'invite.create',
      'invite.revoke',
    ]) {
      expect(mustGetMutator(mutators, name).mutatorName).toBe(name)
    }
    expect(() => mustGetMutator(mutators, 'workspace.destroy')).toThrow()
  })
})
