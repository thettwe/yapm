import { mustGetMutator, type Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import { mutators } from './mutators.js'

const ADMIN: AuthContext = { userID: 'user-admin', role: 'admin' }
const MEMBER: AuthContext = { userID: 'user-member', role: 'member' }
const VIEWER: AuthContext = { userID: 'user-viewer', role: 'viewer' }

const WORKSPACE_ID = '019f8f00-0000-7000-8000-0000000000cc'
const TEAM_ID = '019f8f00-0000-7000-8000-0000000000aa'
const OTHER_TEAM_ID = '019f8f00-0000-7000-8000-0000000000bb'

interface RecordedCall {
  table: string
  verb: 'insert' | 'update' | 'delete' | 'upsert'
  value: Record<string, unknown>
}

function fakeTx(runResults: unknown[] = [], location: 'client' | 'server' = 'server') {
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
    upsert: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'upsert', value })
      return Promise.resolve()
    },
  })
  const tx = {
    location,
    reason: location === 'server' ? 'authoritative' : 'optimistic',
    run: () => Promise.resolve(runQueue.shift()),
    mutate: new Proxy({}, { get: (_t, table: string) => tableMutator(table) }),
  } as unknown as Transaction
  return { tx, calls }
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (thrown) {
    return thrown
  }
  return undefined
}

describe('project.create', () => {
  const baseArgs = () => ({
    id: newId(),
    workspaceId: WORKSPACE_ID,
    name: '  Roadmap Q3  ',
    createdAt: 1_000,
    updatedAt: 1_000,
  })

  it('creates a planned project without a lead for a member', async () => {
    const { tx, calls } = fakeTx([])
    await mutators.project.create.fn({ tx, args: baseArgs(), ctx: MEMBER })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.table).toBe('project')
    expect(calls[0]?.value.status).toBe('planned')
    expect(calls[0]?.value.name).toBe('Roadmap Q3')
    expect(calls[0]?.value.leadId).toBeNull()
    expect(calls[0]?.value.targetDate).toBeNull()
  })

  it('validates the lead is a workspace member', async () => {
    const { tx, calls } = fakeTx([undefined])
    const error = await capture(
      mutators.project.create.fn({
        tx,
        args: { ...baseArgs(), leadId: 'ghost' },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.crossTeam)
    expect(calls).toEqual([])
  })

  it('accepts a lead that is a workspace member', async () => {
    const { tx, calls } = fakeTx([{ id: 'wm1', userId: 'user-member' }])
    await mutators.project.create.fn({
      tx,
      args: { ...baseArgs(), leadId: 'user-member', status: 'active', targetDate: 5_000 },
      ctx: MEMBER,
    })
    expect(calls[0]?.value.leadId).toBe('user-member')
    expect(calls[0]?.value.status).toBe('active')
    expect(calls[0]?.value.targetDate).toBe(5_000)
  })

  it('rejects a viewer before any write', async () => {
    const { tx, calls } = fakeTx([])
    const error = await capture(mutators.project.create.fn({ tx, args: baseArgs(), ctx: VIEWER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects an empty name', async () => {
    const { tx, calls } = fakeTx([])
    const error = await capture(
      mutators.project.create.fn({ tx, args: { ...baseArgs(), name: '   ' }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidName)
    expect(calls).toEqual([])
  })
})

describe('project.update', () => {
  it('writes only the provided fields', async () => {
    const { tx, calls } = fakeTx([{ id: 'p1', workspaceId: WORKSPACE_ID }])
    await mutators.project.update.fn({
      tx,
      args: { id: 'p1', status: 'completed', updatedAt: 3 },
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      { table: 'project', verb: 'update', value: { id: 'p1', status: 'completed', updatedAt: 3 } },
    ])
  })

  it('clears the target date with an explicit null', async () => {
    const { tx, calls } = fakeTx([{ id: 'p1', workspaceId: WORKSPACE_ID }])
    await mutators.project.update.fn({
      tx,
      args: { id: 'p1', targetDate: null, updatedAt: 3 },
      ctx: ADMIN,
    })
    expect(calls[0]?.value).toEqual({ id: 'p1', targetDate: null, updatedAt: 3 })
  })

  it('rejects a viewer before any write', async () => {
    const { tx, calls } = fakeTx([])
    const error = await capture(
      mutators.project.update.fn({ tx, args: { id: 'p1', name: 'x', updatedAt: 3 }, ctx: VIEWER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects a missing project generically', async () => {
    const { tx, calls } = fakeTx([undefined])
    const error = await capture(
      mutators.project.update.fn({ tx, args: { id: 'p1', name: 'x', updatedAt: 3 }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('project.delete', () => {
  it('deletes an existing project', async () => {
    const { tx, calls } = fakeTx([{ id: 'p1', workspaceId: WORKSPACE_ID }])
    await mutators.project.delete.fn({ tx, args: { id: 'p1' }, ctx: ADMIN })
    expect(calls).toEqual([{ table: 'project', verb: 'delete', value: { id: 'p1' } }])
  })

  it('rejects a viewer', async () => {
    const { tx, calls } = fakeTx([])
    const error = await capture(mutators.project.delete.fn({ tx, args: { id: 'p1' }, ctx: VIEWER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('issue.setProject', () => {
  it('assigns an issue to a project (any team) via the issue write gate', async () => {
    const { tx, calls } = fakeTx([
      { id: 'i1', teamId: TEAM_ID },
      { id: 'p1', workspaceId: WORKSPACE_ID },
    ])
    await mutators.issue.setProject.fn({
      tx,
      args: { id: 'i1', projectId: 'p1', updatedAt: 3 },
      ctx: ADMIN,
    })
    expect(calls).toEqual([
      { table: 'issue', verb: 'update', value: { id: 'i1', projectId: 'p1', updatedAt: 3 } },
    ])
  })

  it('allows an issue from any team to join a workspace-level project', async () => {
    const { tx, calls } = fakeTx([
      { id: 'i1', teamId: OTHER_TEAM_ID },
      { id: 'p1', workspaceId: WORKSPACE_ID },
    ])
    await mutators.issue.setProject.fn({
      tx,
      args: { id: 'i1', projectId: 'p1', updatedAt: 3 },
      ctx: ADMIN,
    })
    expect(calls[0]?.value.projectId).toBe('p1')
  })

  it('rejects a non-existent project', async () => {
    const { tx, calls } = fakeTx([{ id: 'i1', teamId: TEAM_ID }, undefined])
    const error = await capture(
      mutators.issue.setProject.fn({
        tx,
        args: { id: 'i1', projectId: 'ghost', updatedAt: 3 },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.crossTeam)
    expect(calls).toEqual([])
  })

  it('clears the project with a null projectId without a project read', async () => {
    const { tx, calls } = fakeTx([{ id: 'i1', teamId: TEAM_ID }])
    await mutators.issue.setProject.fn({
      tx,
      args: { id: 'i1', projectId: null, updatedAt: 3 },
      ctx: ADMIN,
    })
    expect(calls).toEqual([
      { table: 'issue', verb: 'update', value: { id: 'i1', projectId: null, updatedAt: 3 } },
    ])
  })

  it('rejects a viewer before any write', async () => {
    const { tx, calls } = fakeTx([])
    const error = await capture(
      mutators.issue.setProject.fn({
        tx,
        args: { id: 'i1', projectId: 'p1', updatedAt: 3 },
        ctx: VIEWER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('project registry', () => {
  it('registers the project mutators', () => {
    for (const name of ['project.create', 'project.update', 'project.delete', 'issue.setProject']) {
      expect(mustGetMutator(mutators, name).mutatorName).toBe(name)
    }
  })
})
