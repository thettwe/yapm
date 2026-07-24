import { mustGetMutator, type Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import { mutators } from './mutators.js'
import { createServerMutators } from './server-mutators.js'

const ADMIN: AuthContext = { userID: 'user-admin', role: 'admin' }
const VIEWER: AuthContext = { userID: 'user-viewer', role: 'viewer' }

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

describe('cycle.create', () => {
  const baseArgs = () => ({
    id: newId(),
    teamId: TEAM_ID,
    name: '  Sprint 1  ',
    startDate: 1_000,
    endDate: 2_000,
    createdAt: 1_000,
    updatedAt: 1_000,
  })

  it('creates an upcoming cycle without a number for an admin', async () => {
    const { tx, calls } = fakeTx([])
    await mutators.cycle.create.fn({ tx, args: baseArgs(), ctx: ADMIN })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.table).toBe('cycle')
    expect(calls[0]?.value.status).toBe('upcoming')
    expect(calls[0]?.value.name).toBe('Sprint 1')
    expect(calls[0]?.value).not.toHaveProperty('number')
  })

  it('rejects a viewer before any write', async () => {
    const { tx, calls } = fakeTx([])
    const error = await capture(mutators.cycle.create.fn({ tx, args: baseArgs(), ctx: VIEWER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects an end date that is not after the start date', async () => {
    const args = { ...baseArgs(), startDate: 2_000, endDate: 2_000 }
    const { tx, calls } = fakeTx([])
    const error = await capture(mutators.cycle.create.fn({ tx, args, ctx: ADMIN }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidDate)
    expect(calls).toEqual([])
  })
})

describe('cycle.update', () => {
  const existingCycle = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    teamId: TEAM_ID,
    status: 'upcoming',
    number: null,
    startDate: 1_000,
    endDate: 2_000,
    ...over,
  })

  it('rejects a viewer before any write', async () => {
    const { tx, calls } = fakeTx([])
    const error = await capture(
      mutators.cycle.update.fn({
        tx,
        args: { id: 'c1', name: 'Renamed', updatedAt: 3 },
        ctx: VIEWER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects a start-only update that lands on or after the existing end date', async () => {
    const { tx, calls } = fakeTx([existingCycle()])
    const error = await capture(
      mutators.cycle.update.fn({
        tx,
        args: { id: 'c1', startDate: 2_000, updatedAt: 3 },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidDate)
    expect(calls).toEqual([])
  })

  it('rejects an end-only update that lands on or before the existing start date', async () => {
    const { tx, calls } = fakeTx([existingCycle()])
    const error = await capture(
      mutators.cycle.update.fn({
        tx,
        args: { id: 'c1', endDate: 1_000, updatedAt: 3 },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidDate)
    expect(calls).toEqual([])
  })

  it('writes only the provided fields on a valid partial update', async () => {
    const { tx, calls } = fakeTx([existingCycle()])
    await mutators.cycle.update.fn({
      tx,
      args: { id: 'c1', endDate: 3_000, updatedAt: 3 },
      ctx: ADMIN,
    })
    expect(calls).toEqual([
      { table: 'cycle', verb: 'update', value: { id: 'c1', endDate: 3_000, updatedAt: 3 } },
    ])
  })
})

describe('cycle.complete rollover', () => {
  const cycleRow = (over: Record<string, unknown>) => ({
    id: 'c1',
    teamId: TEAM_ID,
    status: 'active',
    number: 1,
    startDate: 100,
    ...over,
  })

  it('completes the cycle and rolls unfinished issues into the next open cycle', async () => {
    const cycles = [
      cycleRow({}),
      { id: 'c2', teamId: TEAM_ID, status: 'upcoming', number: 2, startDate: 200 },
    ]
    const issues = [
      { id: 'i1', status: 'todo' },
      { id: 'i2', status: 'done' },
      { id: 'i3', status: 'in_progress' },
      { id: 'i4', status: 'canceled' },
    ]
    const { tx, calls } = fakeTx([cycleRow({}), cycles, issues])
    await mutators.cycle.complete.fn({ tx, args: { id: 'c1', updatedAt: 500 }, ctx: ADMIN })

    expect(calls[0]).toEqual({
      table: 'cycle',
      verb: 'update',
      value: { id: 'c1', status: 'completed', updatedAt: 500 },
    })
    const moved = calls.slice(1)
    expect(moved.map((c) => c.value.id)).toEqual(['i1', 'i3'])
    for (const call of moved) {
      expect(call.table).toBe('issue')
      expect(call.value.cycleId).toBe('c2')
    }
  })

  it('unassigns unfinished issues when no open successor exists', async () => {
    const cycles = [cycleRow({})]
    const issues = [{ id: 'i1', status: 'todo' }]
    const { tx, calls } = fakeTx([cycleRow({}), cycles, issues])
    await mutators.cycle.complete.fn({ tx, args: { id: 'c1', updatedAt: 9 }, ctx: ADMIN })
    expect(calls[1]).toEqual({
      table: 'issue',
      verb: 'update',
      value: { id: 'i1', cycleId: null, updatedAt: 9 },
    })
  })

  it('is idempotent: a re-run on an already-completed cycle writes nothing', async () => {
    const { tx, calls } = fakeTx([cycleRow({ status: 'completed' })])
    await mutators.cycle.complete.fn({ tx, args: { id: 'c1', updatedAt: 9 }, ctx: ADMIN })
    expect(calls).toEqual([])
  })

  it('rejects a viewer before any write', async () => {
    const { tx, calls } = fakeTx([cycleRow({})])
    const error = await capture(
      mutators.cycle.complete.fn({ tx, args: { id: 'c1', updatedAt: 9 }, ctx: VIEWER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('issue.setCycle', () => {
  it('assigns an issue to a same-team cycle', async () => {
    const { tx, calls } = fakeTx([
      { id: 'i1', teamId: TEAM_ID },
      { id: 'c1', teamId: TEAM_ID },
    ])
    await mutators.issue.setCycle.fn({
      tx,
      args: { id: 'i1', cycleId: 'c1', updatedAt: 3 },
      ctx: ADMIN,
    })
    expect(calls).toEqual([
      { table: 'issue', verb: 'update', value: { id: 'i1', cycleId: 'c1', updatedAt: 3 } },
    ])
  })

  it('rejects a cross-team cycle', async () => {
    const { tx, calls } = fakeTx([
      { id: 'i1', teamId: TEAM_ID },
      { id: 'c1', teamId: OTHER_TEAM_ID },
    ])
    const error = await capture(
      mutators.issue.setCycle.fn({
        tx,
        args: { id: 'i1', cycleId: 'c1', updatedAt: 3 },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.crossTeam)
    expect(calls).toEqual([])
  })

  it('clears the cycle with a null cycleId without a cycle read', async () => {
    const { tx, calls } = fakeTx([{ id: 'i1', teamId: TEAM_ID }])
    await mutators.issue.setCycle.fn({
      tx,
      args: { id: 'i1', cycleId: null, updatedAt: 3 },
      ctx: ADMIN,
    })
    expect(calls).toEqual([
      { table: 'issue', verb: 'update', value: { id: 'i1', cycleId: null, updatedAt: 3 } },
    ])
  })
})

describe('cycle registry', () => {
  it('registers cycle mutators and the server number override', () => {
    for (const name of ['cycle.create', 'cycle.update', 'cycle.activate', 'cycle.complete']) {
      expect(mustGetMutator(mutators, name).mutatorName).toBe(name)
    }
    const serverMutators = createServerMutators()
    expect(mustGetMutator(serverMutators, 'cycle.create').mutatorName).toBe('cycle.create')
  })
})
