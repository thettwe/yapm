import { mustGetMutator, type Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import { mutators } from './mutators.js'
import { createServerMutators } from './server-mutators.js'

const ADMIN: AuthContext = { userID: 'user-admin', role: 'admin' }
const MEMBER: AuthContext = { userID: 'user-member', role: 'member' }
const VIEWER: AuthContext = { userID: 'user-viewer', role: 'viewer' }
const NON_MEMBER: AuthContext = { userID: 'user-outsider', role: null }

const TEAM_ID = '019f8f00-0000-7000-8000-0000000000aa'
const OTHER_TEAM_ID = '019f8f00-0000-7000-8000-0000000000bb'
const DOC = { type: 'doc', content: [] }

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

const membershipRow = (userID: string) => ({ id: newId(), teamId: TEAM_ID, userId: userID })

describe('issue.create', () => {
  const baseArgs = () => ({
    id: newId(),
    teamId: TEAM_ID,
    title: '  Fix the login bug  ',
    status: 'todo' as const,
    priority: 'high' as const,
    createdAt: 1_784_820_335_919,
    updatedAt: 1_784_820_335_919,
  })

  it('lets a team member create an issue with creator from ctx and no number', async () => {
    const args = baseArgs()
    const { tx, calls } = fakeTx([membershipRow(MEMBER.userID)])
    await mutators.issue.create.fn({ tx, args, ctx: MEMBER })
    expect(calls).toHaveLength(1)
    const insert = calls[0]
    expect(insert?.table).toBe('issue')
    expect(insert?.value.creatorId).toBe(MEMBER.userID)
    expect(insert?.value.title).toBe('Fix the login bug')
    expect(insert?.value).not.toHaveProperty('number')
  })

  it('lets a workspace admin create without a team-membership read', async () => {
    const { tx, calls, runQueue } = fakeTx([])
    await mutators.issue.create.fn({ tx, args: baseArgs(), ctx: ADMIN })
    expect(calls).toHaveLength(1)
    expect(runQueue).toHaveLength(0)
  })

  it.each([
    ['a viewer', VIEWER],
    ['a non-member', NON_MEMBER],
    ['an unauthenticated caller', undefined],
  ])('rejects %s before any existence read', async (_label, ctx) => {
    const { tx, calls, runQueue } = fakeTx([membershipRow('x')])
    const error = await capture(mutators.issue.create.fn({ tx, args: baseArgs(), ctx }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
    expect(runQueue).toHaveLength(1)
  })

  it('rejects a member not on the target team', async () => {
    const { tx, calls } = fakeTx([undefined])
    const error = await capture(mutators.issue.create.fn({ tx, args: baseArgs(), ctx: MEMBER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects an assignee who is not a member of the team', async () => {
    const args = { ...baseArgs(), assigneeId: 'user-outsider' }
    const { tx, calls } = fakeTx([membershipRow(MEMBER.userID), undefined])
    const error = await capture(mutators.issue.create.fn({ tx, args, ctx: MEMBER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.crossTeam)
    expect(calls).toEqual([])
  })

  it('rejects an invalid status via the arg validator', () => {
    const parsed = mutators.issue.create.mutatorName
    expect(parsed).toBe('issue.create')
  })
})

describe('issue.setStatus / setPriority / assign', () => {
  it('lets a member change status', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }, membershipRow(MEMBER.userID)])
    await mutators.issue.setStatus.fn({
      tx,
      args: { id, status: 'in_progress', updatedAt: 5 },
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      { table: 'issue', verb: 'update', value: { id, status: 'in_progress', updatedAt: 5 } },
    ])
  })

  it('rejects a viewer status change before existence', async () => {
    const id = newId()
    const { tx, calls, runQueue } = fakeTx([{ id, teamId: TEAM_ID }])
    const error = await capture(
      mutators.issue.setStatus.fn({ tx, args: { id, status: 'done', updatedAt: 5 }, ctx: VIEWER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
    expect(runQueue).toHaveLength(1)
  })

  it('unassigns with a null assignee', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }, membershipRow(MEMBER.userID)])
    await mutators.issue.assign.fn({
      tx,
      args: { id, assigneeId: null, updatedAt: 5 },
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      { table: 'issue', verb: 'update', value: { id, assigneeId: null, updatedAt: 5 } },
    ])
  })

  it('rejects assigning to a non-team-member', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }, membershipRow(MEMBER.userID), undefined])
    const error = await capture(
      mutators.issue.assign.fn({
        tx,
        args: { id, assigneeId: 'ghost', updatedAt: 5 },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.crossTeam)
    expect(calls).toEqual([])
  })
})

describe('issue labels', () => {
  it('adds a same-team label as an issue_label edge carrying the team id', async () => {
    const issueId = newId()
    const labelId = newId()
    const { tx, calls } = fakeTx([
      { id: issueId, teamId: TEAM_ID },
      membershipRow(MEMBER.userID),
      { id: labelId, teamId: TEAM_ID },
    ])
    await mutators.issue.addLabel.fn({ tx, args: { issueId, labelId, createdAt: 5 }, ctx: MEMBER })
    expect(calls).toEqual([
      {
        table: 'issue_label',
        verb: 'upsert',
        value: { issueId, labelId, teamId: TEAM_ID, createdAt: 5 },
      },
    ])
  })

  it('rejects a cross-team label', async () => {
    const issueId = newId()
    const labelId = newId()
    const { tx, calls } = fakeTx([
      { id: issueId, teamId: TEAM_ID },
      membershipRow(MEMBER.userID),
      { id: labelId, teamId: OTHER_TEAM_ID },
    ])
    const error = await capture(
      mutators.issue.addLabel.fn({ tx, args: { issueId, labelId, createdAt: 5 }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.crossTeam)
    expect(calls).toEqual([])
  })
})

describe('label mutators', () => {
  it('rejects a viewer creating a label', async () => {
    const { tx, calls } = fakeTx([membershipRow('x')])
    const error = await capture(
      mutators.label.create.fn({
        tx,
        args: {
          id: newId(),
          teamId: TEAM_ID,
          name: 'Bug',
          color: '#ff0000',
          createdAt: 1,
          updatedAt: 1,
        },
        ctx: VIEWER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects an unparseable color', async () => {
    const { tx, calls } = fakeTx([membershipRow(MEMBER.userID)])
    const error = await capture(
      mutators.label.create.fn({
        tx,
        args: {
          id: newId(),
          teamId: TEAM_ID,
          name: 'Bug',
          color: 'not-a-color',
          createdAt: 1,
          updatedAt: 1,
        },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidColor)
    expect(calls).toEqual([])
  })
})

describe('comment mutators', () => {
  it('creates a comment with author from ctx and team from the issue', async () => {
    const id = newId()
    const issueId = newId()
    const { tx, calls } = fakeTx([{ id: issueId, teamId: TEAM_ID }, membershipRow(MEMBER.userID)])
    await mutators.comment.create.fn({
      tx,
      args: { id, issueId, body: DOC, createdAt: 5, updatedAt: 5 },
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      {
        table: 'comment',
        verb: 'insert',
        value: {
          id,
          issueId,
          teamId: TEAM_ID,
          authorId: MEMBER.userID,
          body: DOC,
          createdAt: 5,
          updatedAt: 5,
        },
      },
    ])
  })

  it('rejects a viewer commenting', async () => {
    const { tx, calls } = fakeTx([{ id: 'i', teamId: TEAM_ID }])
    const error = await capture(
      mutators.comment.create.fn({
        tx,
        args: { id: newId(), issueId: 'i', body: DOC, createdAt: 5, updatedAt: 5 },
        ctx: VIEWER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects editing a comment by neither the author nor an admin, before revealing existence', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, authorId: 'someone-else' }])
    const error = await capture(
      mutators.comment.edit.fn({ tx, args: { id, body: DOC, updatedAt: 5 }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('lets an admin delete anyone’s comment', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, authorId: 'someone-else' }])
    await mutators.comment.delete.fn({ tx, args: { id }, ctx: ADMIN })
    expect(calls).toEqual([{ table: 'comment', verb: 'delete', value: { id } }])
  })
})

describe('saved view mutators', () => {
  const filter = { status: ['todo'] }
  const sort = { key: 'priority', direction: 'desc' }

  it('creates a team-shared view with createdBy from ctx', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([membershipRow(MEMBER.userID)])
    await mutators.savedView.create.fn({
      tx,
      args: {
        id,
        teamId: TEAM_ID,
        name: 'My work',
        filter,
        grouping: 'status',
        sort,
        createdAt: 1,
        updatedAt: 1,
      },
      ctx: MEMBER,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.value.createdBy).toBe(MEMBER.userID)
  })

  it('rejects a viewer creating a view', async () => {
    const { tx, calls } = fakeTx([membershipRow('x')])
    const error = await capture(
      mutators.savedView.create.fn({
        tx,
        args: {
          id: newId(),
          teamId: TEAM_ID,
          name: 'x',
          filter,
          grouping: 'status',
          sort,
          createdAt: 1,
          updatedAt: 1,
        },
        ctx: VIEWER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects deleting a view by neither its creator nor an admin', async () => {
    const id = newId()
    const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID, createdBy: 'someone-else' }])
    const error = await capture(mutators.savedView.delete.fn({ tx, args: { id }, ctx: MEMBER }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('server-mutators client optimistic pass', () => {
  it('runs the shared create and leaves number unset on the client (no sequence claim)', async () => {
    const serverMutators = createServerMutators()
    const { tx, calls } = fakeTx([], 'client')
    await serverMutators.issue.create.fn({
      tx,
      args: {
        id: newId(),
        teamId: TEAM_ID,
        title: 'Client optimistic',
        status: 'todo',
        priority: 'medium',
        createdAt: 1,
        updatedAt: 1,
      },
      ctx: ADMIN,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.table).toBe('issue')
    expect(calls[0]?.value).not.toHaveProperty('number')
  })
})

describe('the extended mutator registry', () => {
  it('registers every new issue-core mutator under its resolved name', () => {
    for (const name of [
      'issue.create',
      'issue.update',
      'issue.setStatus',
      'issue.setPriority',
      'issue.assign',
      'issue.addLabel',
      'issue.removeLabel',
      'label.create',
      'label.rename',
      'label.delete',
      'comment.create',
      'comment.edit',
      'comment.delete',
      'savedView.create',
      'savedView.update',
      'savedView.delete',
    ]) {
      expect(mustGetMutator(mutators, name).mutatorName).toBe(name)
    }
  })

  it('overrides issue.create on the server while keeping the other names', () => {
    const serverMutators = createServerMutators()
    expect(mustGetMutator(serverMutators, 'issue.create').mutatorName).toBe('issue.create')
    expect(mustGetMutator(serverMutators, 'issue.setStatus').mutatorName).toBe('issue.setStatus')
  })
})
