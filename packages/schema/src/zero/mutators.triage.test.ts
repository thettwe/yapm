import type { Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import { mutators } from './mutators.js'

const MEMBER: AuthContext = { userID: 'user-member', role: 'member' }
const VIEWER: AuthContext = { userID: 'user-viewer', role: 'viewer' }

const TEAM_ID = '019f8f00-0000-7000-8000-0000000000aa'
const OTHER_TEAM_ID = '019f8f00-0000-7000-8000-0000000000bb'

interface RecordedCall {
  table: string
  verb: 'insert' | 'update' | 'delete' | 'upsert'
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
    upsert: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'upsert', value })
      return Promise.resolve()
    },
  })

  const tx = {
    location: 'server',
    reason: 'authoritative',
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

const membershipRow = (userID: string) => ({ id: newId(), teamId: TEAM_ID, userId: userID })

describe('issue.flagTriage', () => {
  it('sets needsTriage true for a writer', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }, membershipRow(MEMBER.userID)])
    await mutators.issue.flagTriage.fn({ tx, args: { id, updatedAt: 5 }, ctx: MEMBER })
    expect(calls).toEqual([
      { table: 'issue', verb: 'update', value: { id, needsTriage: true, updatedAt: 5 } },
    ])
  })

  it('rejects a viewer before any write', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }])
    const error = await capture(
      mutators.issue.flagTriage.fn({ tx, args: { id, updatedAt: 5 }, ctx: VIEWER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toHaveLength(0)
  })
})

describe('issue.acceptTriage', () => {
  it('clears the flag and leaves status untouched', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }, membershipRow(MEMBER.userID)])
    await mutators.issue.acceptTriage.fn({ tx, args: { id, updatedAt: 7 }, ctx: MEMBER })
    expect(calls).toEqual([
      { table: 'issue', verb: 'update', value: { id, needsTriage: false, updatedAt: 7 } },
    ])
  })

  it('rejects a viewer before any write', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }])
    const error = await capture(
      mutators.issue.acceptTriage.fn({ tx, args: { id, updatedAt: 7 }, ctx: VIEWER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toHaveLength(0)
  })
})

describe('issue.declineTriage', () => {
  it('clears the flag and cancels the issue', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }, membershipRow(MEMBER.userID)])
    await mutators.issue.declineTriage.fn({ tx, args: { id, updatedAt: 9 }, ctx: MEMBER })
    expect(calls).toEqual([
      {
        table: 'issue',
        verb: 'update',
        value: { id, needsTriage: false, status: 'canceled', updatedAt: 9 },
      },
    ])
  })

  it('rejects a viewer', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }])
    const error = await capture(
      mutators.issue.declineTriage.fn({ tx, args: { id, updatedAt: 9 }, ctx: VIEWER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toHaveLength(0)
  })
})

describe('issue.routeIssue', () => {
  it('clears the flag and applies same-team fields atomically', async () => {
    const id = newId()
    const cycleId = newId()
    const labelId = newId()
    const { tx, calls } = fakeTx([
      { id, teamId: TEAM_ID },
      membershipRow(MEMBER.userID),
      membershipRow(MEMBER.userID),
      { id: cycleId, teamId: TEAM_ID },
      { id: labelId, teamId: TEAM_ID },
    ])
    await mutators.issue.routeIssue.fn({
      tx,
      args: {
        id,
        status: 'todo',
        assigneeId: MEMBER.userID,
        cycleId,
        addLabelIds: [labelId],
        updatedAt: 11,
      },
      ctx: MEMBER,
    })
    const update = calls.find((call) => call.verb === 'update')
    expect(update?.value).toEqual({
      id,
      needsTriage: false,
      status: 'todo',
      assigneeId: MEMBER.userID,
      cycleId,
      updatedAt: 11,
    })
    expect(calls.find((call) => call.verb === 'upsert')?.value).toEqual({
      issueId: id,
      labelId,
      teamId: TEAM_ID,
      createdAt: 11,
    })
  })

  it('rejects a cross-team cycle', async () => {
    const id = newId()
    const cycleId = newId()
    const { tx, calls } = fakeTx([
      { id, teamId: TEAM_ID },
      membershipRow(MEMBER.userID),
      { id: cycleId, teamId: OTHER_TEAM_ID },
    ])
    const error = await capture(
      mutators.issue.routeIssue.fn({ tx, args: { id, cycleId, updatedAt: 11 }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.crossTeam)
    expect(calls.find((call) => call.verb === 'update')).toBeUndefined()
  })

  it('rejects a cross-team assignee', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }, membershipRow(MEMBER.userID), undefined])
    const error = await capture(
      mutators.issue.routeIssue.fn({
        tx,
        args: { id, assigneeId: 'user-other', updatedAt: 11 },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.crossTeam)
    expect(calls.find((call) => call.verb === 'update')).toBeUndefined()
  })

  it('rejects a cross-team label', async () => {
    const id = newId()
    const labelId = newId()
    const { tx, calls } = fakeTx([
      { id, teamId: TEAM_ID },
      membershipRow(MEMBER.userID),
      { id: labelId, teamId: OTHER_TEAM_ID },
    ])
    const error = await capture(
      mutators.issue.routeIssue.fn({
        tx,
        args: { id, addLabelIds: [labelId], updatedAt: 11 },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.crossTeam)
    expect(calls.find((call) => call.verb === 'update')).toBeUndefined()
    expect(calls.find((call) => call.verb === 'upsert')).toBeUndefined()
  })

  it('rejects a viewer before any write', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }])
    const error = await capture(
      mutators.issue.routeIssue.fn({
        tx,
        args: { id, status: 'todo', updatedAt: 11 },
        ctx: VIEWER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toHaveLength(0)
  })
})
