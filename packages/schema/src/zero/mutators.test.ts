import { mustGetMutator, type Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import type { AuthContext } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import {
  assertRenameWorkspaceAllowed,
  mutators,
  normalizeWorkspaceName,
  WORKSPACE_NAME_MAX_LENGTH,
} from './mutators.js'

const ADMIN: AuthContext = { userID: 'user-1', role: 'admin' }
const MEMBER: AuthContext = { userID: 'user-2', role: 'member' }
const VIEWER: AuthContext = { userID: 'user-3', role: 'viewer' }

const WORKSPACE_ID = '019f8f00-0000-7000-8000-000000000000'

function args(name: string) {
  return { id: WORKSPACE_ID, name, updatedAt: 1_784_820_335_919 }
}

interface RecordedUpdate {
  id: string
  name: string
  updatedAt: number
}

function recordingTransaction() {
  const updates: RecordedUpdate[] = []
  const tx = {
    location: 'server',
    reason: 'authoritative',
    mutate: {
      workspace: {
        update: (row: RecordedUpdate) => {
          updates.push(row)
          return Promise.resolve()
        },
      },
    },
  } as unknown as Transaction
  return { tx, updates }
}

describe('normalizeWorkspaceName', () => {
  it('collapses runs of whitespace and trims the result', () => {
    expect(normalizeWorkspaceName('  Platform   Team \n')).toBe('Platform Team')
  })

  it('collapses a whitespace-only name to the empty string', () => {
    expect(normalizeWorkspaceName(' \t \n ')).toBe('')
  })
})

describe('assertRenameWorkspaceAllowed', () => {
  it('returns the normalized name for a writer', () => {
    expect(assertRenameWorkspaceAllowed(args('  Platform  Team '), ADMIN)).toBe('Platform Team')
    expect(assertRenameWorkspaceAllowed(args('yapm'), MEMBER)).toBe('yapm')
  })

  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['tabs and newlines', '\t\n'],
    ['a non-breaking space', ' '],
  ])('rejects a %s name', (_label, name) => {
    const error = (() => {
      try {
        assertRenameWorkspaceAllowed(args(name), MEMBER)
      } catch (thrown) {
        return thrown
      }
      return undefined
    })()

    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidName)
    expect((error as Error).message).toBe('Workspace name cannot be empty')
  })

  it('rejects a name longer than the column budget', () => {
    const error = (() => {
      try {
        assertRenameWorkspaceAllowed(args('x'.repeat(WORKSPACE_NAME_MAX_LENGTH + 1)), MEMBER)
      } catch (thrown) {
        return thrown
      }
      return undefined
    })()

    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidName)
  })

  it('accepts a name exactly at the limit', () => {
    const name = 'x'.repeat(WORKSPACE_NAME_MAX_LENGTH)
    expect(assertRenameWorkspaceAllowed(args(name), MEMBER)).toBe(name)
  })

  it.each([
    ['a viewer', VIEWER],
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
})

describe('the renameWorkspace mutator', () => {
  it('writes the normalized name and the caller-minted timestamp', async () => {
    const { tx, updates } = recordingTransaction()

    await mutators.workspace.rename.fn({ tx, args: args('  Platform  Team  '), ctx: MEMBER })

    expect(updates).toEqual([
      { id: WORKSPACE_ID, name: 'Platform Team', updatedAt: 1_784_820_335_919 },
    ])
  })

  it('writes nothing when the name is rejected', async () => {
    const { tx, updates } = recordingTransaction()

    await expect(
      mutators.workspace.rename.fn({ tx, args: args('   '), ctx: MEMBER }),
    ).rejects.toThrow('Workspace name cannot be empty')
    expect(updates).toEqual([])
  })

  it('rejects arguments that do not match the validator', async () => {
    const { tx, updates } = recordingTransaction()

    await expect(
      mutators.workspace.rename.fn({
        tx,
        args: { id: WORKSPACE_ID, name: 'ok', updatedAt: 'yesterday' } as never,
        ctx: MEMBER,
      }),
    ).rejects.toThrow()
    expect(updates).toEqual([])
  })

  it('is registered under the name both the client and the server resolve', () => {
    expect(mutators.workspace.rename.mutatorName).toBe('workspace.rename')
    expect(mustGetMutator(mutators, 'workspace.rename')).toBe(mutators.workspace.rename)
    expect(() => mustGetMutator(mutators, 'workspace.destroy')).toThrow()
  })
})
