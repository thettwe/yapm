import { mustGetMutator, type Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import { mutators, setRetroAiReactionArgs } from './mutators.js'
import { retroColumnTemplate } from './retro/phase.js'
import { publishedCardFromDraft } from './server-mutators.js'

const ADMIN: AuthContext = { userID: 'user-admin', role: 'admin' }
const MEMBER: AuthContext = { userID: 'user-member', role: 'member' }
const OTHER: AuthContext = { userID: 'user-other', role: 'member' }
const VIEWER: AuthContext = { userID: 'user-viewer', role: 'viewer' }

const TEAM_ID = '019f8f00-0000-7000-8000-0000000000aa'
const RETRO_ID = '019f8f00-0000-7000-8000-0000000000c1'
const CYCLE_ID = '019f8f00-0000-7000-8000-0000000000d1'
const NEXT_CYCLE_ID = '019f8f00-0000-7000-8000-0000000000d2'

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
    run: () => {
      if (runQueue.length === 0) {
        throw new Error(
          'fakeTx: the mutator read a row this stub was not given. This stub answers queries in ' +
            'order and cannot see its own writes, so anything about how rows affect each other ' +
            'belongs in mutators.retro.pg.test.ts, against real Postgres.',
        )
      }
      return Promise.resolve(runQueue.shift())
    },
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

const retroRow = (over: Record<string, unknown> = {}) => ({
  id: RETRO_ID,
  teamId: TEAM_ID,
  title: 'Cycle 4 retrospective',
  cycleId: CYCLE_ID,
  nextCycleId: NEXT_CYCLE_ID,
  format: 'wentwell_didnt_action',
  phase: 'brainstorm',
  facilitatorId: null,
  isAnonymous: false,
  votesPerParticipant: 3,
  ...over,
})

const columnRow = (over: Record<string, unknown> = {}) => ({
  id: 'col-1',
  retroId: RETRO_ID,
  ...over,
})

const templateColumns = retroColumnTemplate('wentwell_didnt_action').map((column, index) => ({
  id: `col-${index}`,
  key: column.key,
  title: column.title,
  accentToken: column.accentToken,
  rank: `a${index}`,
}))

describe('retro.openForCycle', () => {
  const baseArgs = () => ({
    id: RETRO_ID,
    cycleId: CYCLE_ID,
    format: 'wentwell_didnt_action' as const,
    columns: templateColumns,
    createdAt: 1_000,
    updatedAt: 1_000,
  })

  it('opens a brainstorm retro with no facilitator and the format’s columns', async () => {
    const { tx, calls } = fakeTx([{ id: CYCLE_ID, teamId: TEAM_ID, name: 'Cycle 4' }, undefined])
    await mutators.retro.openForCycle.fn({ tx, args: baseArgs(), ctx: ADMIN })

    expect(calls[0]?.table).toBe('retro')
    expect(calls[0]?.value).toMatchObject({
      id: RETRO_ID,
      teamId: TEAM_ID,
      phase: 'brainstorm',
      facilitatorId: null,
      isAnonymous: false,
      votesPerParticipant: 3,
      createdBy: ADMIN.userID,
      title: 'Cycle 4 retrospective',
    })
    expect(calls.slice(1).map((call) => call.table)).toEqual([
      'retro_column',
      'retro_column',
      'retro_column',
    ])
  })

  it('is a no-op when the cycle already has a retro, so the scheduler cannot double-open', async () => {
    const { tx, calls } = fakeTx([
      { id: CYCLE_ID, teamId: TEAM_ID, name: 'Cycle 4' },
      { id: RETRO_ID },
    ])
    await mutators.retro.openForCycle.fn({ tx, args: baseArgs(), ctx: ADMIN })
    expect(calls).toEqual([])
  })

  it('refuses columns that do not match the named format', async () => {
    const args = {
      ...baseArgs(),
      columns: templateColumns.map((column, index) =>
        index === 0 ? { ...column, key: 'anything_i_want' } : column,
      ),
    }
    const { tx, calls } = fakeTx([{ id: CYCLE_ID, teamId: TEAM_ID, name: 'Cycle 4' }, undefined])
    const error = await capture(mutators.retro.openForCycle.fn({ tx, args, ctx: ADMIN }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidKey)
    expect(calls).toEqual([])
  })

  it('rejects a viewer before any existence check', async () => {
    const { tx, calls, runQueue } = fakeTx([{ id: CYCLE_ID, teamId: TEAM_ID, name: 'Cycle 4' }])
    const error = await capture(
      mutators.retro.openForCycle.fn({ tx, args: baseArgs(), ctx: VIEWER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
    expect(runQueue).toHaveLength(1)
  })
})

describe('retro.setPhase — the state machine a crafted mutation cannot cheat', () => {
  it('advances exactly one step and stamps nothing on the way forward', async () => {
    const { tx, calls } = fakeTx([retroRow({ facilitatorId: MEMBER.userID }), {}])
    await mutators.retro.setPhase.fn({
      tx,
      args: { id: RETRO_ID, to: 'group', updatedAt: 5 },
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      {
        table: 'retro',
        verb: 'update',
        value: { id: RETRO_ID, phase: 'group', closedAt: null, updatedAt: 5 },
      },
    ])
  })

  it.each([
    ['brainstorm', 'vote'],
    ['brainstorm', 'actions'],
    ['brainstorm', 'closed'],
    ['closed', 'brainstorm'],
    ['discuss', 'brainstorm'],
    ['vote', 'vote'],
  ] as const)('rejects %s -> %s', async (from, to) => {
    const { tx, calls } = fakeTx([retroRow({ phase: from })])
    const error = await capture(
      mutators.retro.setPhase.fn({ tx, args: { id: RETRO_ID, to, updatedAt: 5 }, ctx: ADMIN }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidPhase)
    expect(calls).toEqual([])
  })

  it('stamps closed_at on entering closed and clears it on the one legal step back', async () => {
    const closing = fakeTx([retroRow({ phase: 'actions' })])
    await mutators.retro.setPhase.fn({
      tx: closing.tx,
      args: { id: RETRO_ID, to: 'closed', updatedAt: 9 },
      ctx: ADMIN,
    })
    expect(closing.calls[0]?.value.closedAt).toBe(9)

    const reopening = fakeTx([retroRow({ phase: 'closed' })])
    await mutators.retro.setPhase.fn({
      tx: reopening.tx,
      args: { id: RETRO_ID, to: 'actions', updatedAt: 11 },
      ctx: ADMIN,
    })
    expect(reopening.calls[0]?.value.closedAt).toBeNull()
  })

  it('rejects a member who is neither the facilitator nor an admin', async () => {
    const { tx, calls } = fakeTx([
      retroRow({ facilitatorId: OTHER.userID }),
      { id: 'membership', teamId: TEAM_ID, userId: MEMBER.userID },
    ])
    const error = await capture(
      mutators.retro.setPhase.fn({
        tx,
        args: { id: RETRO_ID, to: 'group', updatedAt: 5 },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('rejects a viewer before reading the retro', async () => {
    const { tx, calls, runQueue } = fakeTx([retroRow()])
    const error = await capture(
      mutators.retro.setPhase.fn({
        tx,
        args: { id: RETRO_ID, to: 'group', updatedAt: 5 },
        ctx: VIEWER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
    expect(runQueue).toHaveLength(1)
  })
})

describe('the phase gate on every write', () => {
  it('refuses a vote while the server says the retro is in discuss', async () => {
    const { tx, calls } = fakeTx([retroRow({ phase: 'discuss' })])
    const error = await capture(
      mutators.retroVote.cast.fn({
        tx,
        args: {
          id: newId(),
          retroId: RETRO_ID,
          targetType: 'card',
          targetId: 'card-1',
          createdAt: 5,
        },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidPhase)
    expect(calls).toEqual([])
  })

  it('refuses a new draft once brainstorming is over', async () => {
    const { tx, calls } = fakeTx([retroRow({ phase: 'group' })])
    const error = await capture(
      mutators.retroDraft.create.fn({
        tx,
        args: {
          id: newId(),
          retroId: RETRO_ID,
          columnId: 'col-1',
          body: 'too late',
          rank: 'a0',
          createdAt: 5,
          updatedAt: 5,
        },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidPhase)
    expect(calls).toEqual([])
  })

  it('refuses every content write on a closed retro', async () => {
    for (const run of [
      () =>
        mutators.retroGroup.create.fn({
          tx: fakeTx([retroRow({ phase: 'closed' })]).tx,
          args: {
            id: newId(),
            retroId: RETRO_ID,
            columnId: 'col-1',
            rank: 'a0',
            createdAt: 1,
            updatedAt: 1,
          },
          ctx: ADMIN,
        }),
      () =>
        mutators.retroAction.create.fn({
          tx: fakeTx([retroRow({ phase: 'closed' })]).tx,
          args: { id: newId(), retroId: RETRO_ID, body: 'nope', createdAt: 1, updatedAt: 1 },
          ctx: ADMIN,
        }),
    ]) {
      expect(mutationErrorCode(await capture(run()))).toBe(MutationErrorCode.invalidPhase)
    }
  })
})

describe('retro.configure', () => {
  it('sets anonymity and the budget during brainstorm, facilitator only', async () => {
    const { tx, calls } = fakeTx([retroRow({ facilitatorId: MEMBER.userID }), {}, []])
    await mutators.retro.configure.fn({
      tx,
      args: { id: RETRO_ID, isAnonymous: true, votesPerParticipant: 5, updatedAt: 7 },
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      {
        table: 'retro',
        verb: 'update',
        value: { id: RETRO_ID, isAnonymous: true, votesPerParticipant: 5, updatedAt: 7 },
      },
    ])
  })

  it('cannot flip anonymity once the retro has left brainstorm', async () => {
    const { tx, calls } = fakeTx([retroRow({ phase: 'group', facilitatorId: ADMIN.userID })])
    const error = await capture(
      mutators.retro.configure.fn({
        tx,
        args: { id: RETRO_ID, isAnonymous: true, updatedAt: 7 },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidPhase)
    expect(calls).toEqual([])
  })

  // Stepping back into `brainstorm` is a legal single step, so the phase gate alone would let a
  // facilitator flip anonymity on a board whose cards are already published and synced.
  it('refuses an anonymity flip once the retro has cards, back in brainstorm', async () => {
    const { tx, calls } = fakeTx([retroRow({ facilitatorId: ADMIN.userID }), [{ id: 'card-1' }]])
    const error = await capture(
      mutators.retro.configure.fn({
        tx,
        args: { id: RETRO_ID, isAnonymous: true, updatedAt: 7 },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidPhase)
    expect(calls).toEqual([])
  })

  it('leaves the budget settable while the board is still empty', async () => {
    const { tx, calls } = fakeTx([retroRow({ facilitatorId: ADMIN.userID })])
    await mutators.retro.configure.fn({
      tx,
      args: { id: RETRO_ID, votesPerParticipant: 8, updatedAt: 7 },
      ctx: ADMIN,
    })
    expect(calls).toEqual([
      {
        table: 'retro',
        verb: 'update',
        value: { id: RETRO_ID, votesPerParticipant: 8, updatedAt: 7 },
      },
    ])
  })

  it('refuses a format change once any draft exists', async () => {
    const { tx, calls } = fakeTx([retroRow(), [{ id: 'draft-1' }], []])
    const error = await capture(
      mutators.retro.configure.fn({
        tx,
        args: {
          id: RETRO_ID,
          format: 'mad_sad_glad',
          columns: retroColumnTemplate('mad_sad_glad').map((column, index) => ({
            id: `new-${index}`,
            key: column.key,
            title: column.title,
            accentToken: column.accentToken,
            rank: `a${index}`,
          })),
          updatedAt: 7,
        },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidPhase)
    expect(calls).toEqual([])
  })
})

describe('retro facilitation', () => {
  it('lets any non-viewer member claim an empty facilitator seat', async () => {
    const { tx, calls } = fakeTx([retroRow(), { id: 'membership' }])
    await mutators.retro.claimFacilitator.fn({
      tx,
      args: { id: RETRO_ID, updatedAt: 3 },
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      {
        table: 'retro',
        verb: 'update',
        value: { id: RETRO_ID, facilitatorId: MEMBER.userID, updatedAt: 3 },
      },
    ])
  })

  it('refuses to take the seat from whoever holds it', async () => {
    const { tx, calls } = fakeTx([retroRow({ facilitatorId: OTHER.userID }), { id: 'membership' }])
    const error = await capture(
      mutators.retro.claimFacilitator.fn({
        tx,
        args: { id: RETRO_ID, updatedAt: 3 },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('retro drafts stay private to their author', () => {
  it('takes the author from ctx, never from args', async () => {
    const { tx, calls } = fakeTx([retroRow(), { id: 'membership' }, columnRow()])
    const id = newId()
    await mutators.retroDraft.create.fn({
      tx,
      args: {
        id,
        retroId: RETRO_ID,
        columnId: 'col-1',
        body: '  Review wait was long  ',
        rank: 'a0',
        createdAt: 4,
        updatedAt: 4,
      },
      ctx: MEMBER,
    })
    expect(calls[0]?.table).toBe('retro_draft')
    expect(calls[0]?.value).toMatchObject({
      id,
      authorId: MEMBER.userID,
      teamId: TEAM_ID,
      body: 'Review wait was long',
      publishedAt: null,
    })
  })

  it('refuses an empty card', async () => {
    const { tx, calls } = fakeTx([retroRow(), columnRow()])
    const error = await capture(
      mutators.retroDraft.create.fn({
        tx,
        args: {
          id: newId(),
          retroId: RETRO_ID,
          columnId: 'col-1',
          body: '   ',
          rank: 'a0',
          createdAt: 4,
          updatedAt: 4,
        },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidName)
    expect(calls).toEqual([])
  })

  it('refuses to let anyone — including an admin — edit another person’s draft', async () => {
    const { tx, calls } = fakeTx([
      { id: 'draft-1', retroId: RETRO_ID, authorId: OTHER.userID, publishedAt: null },
    ])
    const error = await capture(
      mutators.retroDraft.update.fn({
        tx,
        args: { id: 'draft-1', body: 'rewritten', updatedAt: 6 },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('refuses to edit a draft that has already been published', async () => {
    const { tx, calls } = fakeTx([
      { id: 'draft-1', retroId: RETRO_ID, authorId: ADMIN.userID, publishedAt: 10 },
    ])
    const error = await capture(
      mutators.retroDraft.update.fn({
        tx,
        args: { id: 'draft-1', body: 'rewritten', updatedAt: 12 },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidPhase)
    expect(calls).toEqual([])
  })
})

describe('publishing a draft into a card', () => {
  const draft = {
    id: 'draft-1',
    retroId: RETRO_ID,
    teamId: TEAM_ID,
    columnId: 'col-1',
    authorId: MEMBER.userID,
    body: 'Review wait was long',
    rank: 'a0',
    seedRef: null,
    createdAt: 4,
  }

  it('reuses the draft’s id, so nothing is minted and a re-run is idempotent', () => {
    expect(publishedCardFromDraft(draft, { isAnonymous: false }, 20).id).toBe('draft-1')
  })

  it('writes no author value at all for an anonymous retro', () => {
    const card = publishedCardFromDraft(draft, { isAnonymous: true }, 20)
    expect(card.authorDisplayId).toBeNull()
    expect(card.isAnonymous).toBe(true)
    expect(Object.values(card)).not.toContain(MEMBER.userID)
  })

  it('attributes the card when the retro is not anonymous', () => {
    const card = publishedCardFromDraft(draft, { isAnonymous: false }, 20)
    expect(card.authorDisplayId).toBe(MEMBER.userID)
  })

  it('carries the evidence reference through to the card', () => {
    const seeded = { ...draft, seedRef: { kind: 'widget', id: 'carried_twice_plus' } }
    expect(publishedCardFromDraft(seeded, { isAnonymous: true }, 20).seedRef).toEqual({
      kind: 'widget',
      id: 'carried_twice_plus',
    })
  })
})

describe('retroCard.move — the board’s single-write move', () => {
  it('writes exactly one card row and never renumbers siblings', async () => {
    const { tx, calls } = fakeTx([
      { id: 'card-1', retroId: RETRO_ID, columnId: 'col-1', groupId: null },
      retroRow({ phase: 'group' }),
      { id: 'group-1', retroId: RETRO_ID, columnId: 'col-1' },
      [],
    ])
    await mutators.retroCard.move.fn({
      tx,
      args: { id: 'card-1', groupId: 'group-1', rank: 'a1', updatedAt: 8 },
      ctx: ADMIN,
    })
    expect(calls).toEqual([
      {
        table: 'retro_card',
        verb: 'update',
        value: { id: 'card-1', groupId: 'group-1', rank: 'a1', updatedAt: 8 },
      },
      { table: 'retro_vote_tally', verb: 'delete', value: { targetId: 'card-1' } },
    ])
  })

  it('dissolves the group the card just emptied, and its dots with it', async () => {
    const { tx, calls } = fakeTx([
      { id: 'card-1', retroId: RETRO_ID, columnId: 'col-1', groupId: 'group-1' },
      retroRow({ phase: 'group' }),
      [],
      [{ id: 'vote-1' }],
    ])
    await mutators.retroCard.move.fn({
      tx,
      args: { id: 'card-1', groupId: null, rank: 'a2', updatedAt: 8 },
      ctx: ADMIN,
    })
    expect(calls.map((call) => `${call.table}.${call.verb}`)).toEqual([
      'retro_card.update',
      'retro_vote.delete',
      'retro_vote_tally.delete',
      'retro_group.delete',
    ])
  })

  it('refuses a group in another column', async () => {
    const { tx, calls } = fakeTx([
      { id: 'card-1', retroId: RETRO_ID, columnId: 'col-1', groupId: null },
      retroRow({ phase: 'group' }),
      { id: 'group-1', retroId: RETRO_ID, columnId: 'col-2' },
    ])
    const error = await capture(
      mutators.retroCard.move.fn({
        tx,
        args: { id: 'card-1', groupId: 'group-1', rank: 'a1', updatedAt: 8 },
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidTarget)
    expect(calls).toEqual([])
  })
})

describe('retroCard.delete is moderation, not editing', () => {
  it('lets the facilitator remove a card without ever learning who wrote it', async () => {
    const { tx, calls } = fakeTx([
      { id: 'card-1', retroId: RETRO_ID, columnId: 'col-1', groupId: null },
      retroRow({ phase: 'group', facilitatorId: MEMBER.userID, isAnonymous: true }),
      { id: 'membership' },
      [],
    ])
    await mutators.retroCard.delete.fn({ tx, args: { id: 'card-1' }, ctx: MEMBER })
    expect(calls.map((call) => `${call.table}.${call.verb}`)).toEqual([
      'retro_vote_tally.delete',
      'retro_card.delete',
    ])
  })

  // The board-consistency half of this lives in mutators.retro.pg.test.ts, where a real
  // transaction can answer "is the group empty now?" — here we only pin the write order.
  it('dissolves the group its last card just left, and clears that group’s dots', async () => {
    const { tx, calls } = fakeTx([
      { id: 'card-1', retroId: RETRO_ID, columnId: 'col-1', groupId: 'group-1' },
      retroRow({ phase: 'vote', facilitatorId: MEMBER.userID }),
      { id: 'membership' },
      [],
      [],
      [{ id: 'vote-1' }],
    ])
    await mutators.retroCard.delete.fn({ tx, args: { id: 'card-1' }, ctx: MEMBER })
    expect(calls.map((call) => `${call.table}.${call.verb}`)).toEqual([
      'retro_vote_tally.delete',
      'retro_card.delete',
      'retro_vote.delete',
      'retro_vote_tally.delete',
      'retro_group.delete',
    ])
  })

  it('refuses a member who neither facilitates nor wrote the card', async () => {
    const { tx, calls } = fakeTx([
      { id: 'card-1', retroId: RETRO_ID, columnId: 'col-1', groupId: null },
      retroRow({ phase: 'group', facilitatorId: OTHER.userID }),
      { id: 'membership' },
      undefined,
    ])
    const error = await capture(
      mutators.retroCard.delete.fn({ tx, args: { id: 'card-1' }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('retroVote.cast — budget and target rules', () => {
  const voteArgs = (over: Record<string, unknown> = {}) => ({
    id: newId(),
    retroId: RETRO_ID,
    targetType: 'card' as const,
    targetId: 'card-1',
    createdAt: 12,
    ...over,
  })

  it('casts a dot and bumps the tally optimistically on the client', async () => {
    const { tx, calls } = fakeTx(
      [
        retroRow({ phase: 'vote' }),
        { id: 'card-1', retroId: RETRO_ID, groupId: null },
        [],
        { targetId: 'card-1', count: 2 },
      ],
      'client',
    )
    await mutators.retroVote.cast.fn({ tx, args: voteArgs(), ctx: ADMIN })
    expect(calls.map((call) => `${call.table}.${call.verb}`)).toEqual([
      'retro_vote.insert',
      'retro_vote_tally.upsert',
    ])
    expect(calls[0]?.value.voterId).toBe(ADMIN.userID)
    expect(calls[1]?.value).toMatchObject({ targetId: 'card-1', count: 3, targetType: 'card' })
  })

  it('leaves the tally to the authoritative pass on the server', async () => {
    const { tx, calls } = fakeTx([
      retroRow({ phase: 'vote' }),
      { id: 'card-1', retroId: RETRO_ID, groupId: null },
      [],
    ])
    await mutators.retroVote.cast.fn({ tx, args: voteArgs(), ctx: ADMIN })
    expect(calls.map((call) => call.table)).toEqual(['retro_vote'])
  })

  it('stops the caller at their budget, counting only their own rows', async () => {
    const { tx, calls } = fakeTx([
      retroRow({ phase: 'vote', votesPerParticipant: 2 }),
      { id: 'card-1', retroId: RETRO_ID, groupId: null },
      [{ id: 'v1' }, { id: 'v2' }],
    ])
    const error = await capture(mutators.retroVote.cast.fn({ tx, args: voteArgs(), ctx: ADMIN }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.voteBudget)
    expect(calls).toEqual([])
  })

  it('sends a grouped card’s dot to its group instead', async () => {
    const { tx, calls } = fakeTx([
      retroRow({ phase: 'vote' }),
      { id: 'card-1', retroId: RETRO_ID, groupId: 'group-1' },
    ])
    const error = await capture(mutators.retroVote.cast.fn({ tx, args: voteArgs(), ctx: ADMIN }))
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidTarget)
    expect(calls).toEqual([])
  })

  it('refuses a target from another retro', async () => {
    const { tx, calls } = fakeTx([
      retroRow({ phase: 'vote' }),
      { id: 'group-9', retroId: 'other-retro' },
    ])
    const error = await capture(
      mutators.retroVote.cast.fn({
        tx,
        args: voteArgs({ targetType: 'group', targetId: 'group-9' }),
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidTarget)
    expect(calls).toEqual([])
  })
})

describe('retroVote.retract', () => {
  it('returns a dot to its voter and decrements the tally on the client', async () => {
    const { tx, calls } = fakeTx(
      [
        {
          id: 'vote-1',
          retroId: RETRO_ID,
          targetType: 'card',
          targetId: 'card-1',
          voterId: ADMIN.userID,
        },
        retroRow({ phase: 'vote' }),
        { targetId: 'card-1', count: 3 },
      ],
      'client',
    )
    await mutators.retroVote.retract.fn({ tx, args: { id: 'vote-1', updatedAt: 14 }, ctx: ADMIN })
    expect(calls.map((call) => `${call.table}.${call.verb}`)).toEqual([
      'retro_vote.delete',
      'retro_vote_tally.upsert',
    ])
    expect(calls[1]?.value.count).toBe(2)
  })

  it('refuses to retract someone else’s dot, admin or not', async () => {
    const { tx, calls } = fakeTx([
      {
        id: 'vote-1',
        retroId: RETRO_ID,
        targetType: 'card',
        targetId: 'card-1',
        voterId: OTHER.userID,
      },
    ])
    const error = await capture(
      mutators.retroVote.retract.fn({ tx, args: { id: 'vote-1', updatedAt: 14 }, ctx: ADMIN }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })
})

describe('retro.convertActionToIssue — the loop back into the tracker', () => {
  const actionRow = (over: Record<string, unknown> = {}) => ({
    id: 'action-1',
    retroId: RETRO_ID,
    body: 'Agree a same-day first-review target\nand rotate a review buddy',
    assigneeId: null,
    targetCycleId: null,
    issueId: null,
    ...over,
  })

  it('creates a real issue in the next cycle through the shared create path', async () => {
    const issueId = newId()
    const { tx, calls } = fakeTx([
      actionRow(),
      retroRow({ phase: 'actions' }),
      // issue.setCycle reads the issue, then the cycle
      { id: issueId, teamId: TEAM_ID },
      { id: NEXT_CYCLE_ID, teamId: TEAM_ID },
    ])
    await mutators.retro.convertActionToIssue.fn({
      tx,
      args: { actionId: 'action-1', issueId, createdAt: 20, updatedAt: 20 },
      ctx: ADMIN,
    })

    expect(calls.map((call) => `${call.table}.${call.verb}`)).toEqual([
      'issue.insert',
      'issue.update',
      'retro_action.update',
    ])
    expect(calls[0]?.value).toMatchObject({
      id: issueId,
      teamId: TEAM_ID,
      title: 'Agree a same-day first-review target',
      status: 'todo',
      needsTriage: false,
      creatorId: ADMIN.userID,
    })
    // No number is claimed here: that is the server override's authoritative job.
    expect(calls[0]?.value).not.toHaveProperty('number')
    expect(calls[1]?.value).toMatchObject({ cycleId: NEXT_CYCLE_ID, cycleAssignedAt: 20 })
    expect(calls[2]?.value).toMatchObject({ id: 'action-1', issueId })
  })

  it('prefers the action’s own target cycle over the retro’s next cycle', async () => {
    const issueId = newId()
    const { tx, calls } = fakeTx([
      actionRow({ targetCycleId: 'cycle-chosen' }),
      retroRow({ phase: 'discuss' }),
      { id: issueId, teamId: TEAM_ID },
      { id: 'cycle-chosen', teamId: TEAM_ID },
    ])
    await mutators.retro.convertActionToIssue.fn({
      tx,
      args: { actionId: 'action-1', issueId, createdAt: 20, updatedAt: 20 },
      ctx: ADMIN,
    })
    expect(calls[1]?.value.cycleId).toBe('cycle-chosen')
  })

  it('is idempotent: converting an already-converted action creates nothing', async () => {
    const { tx, calls } = fakeTx([
      actionRow({ issueId: 'issue-existing' }),
      retroRow({ phase: 'actions' }),
    ])
    await mutators.retro.convertActionToIssue.fn({
      tx,
      args: { actionId: 'action-1', issueId: newId(), createdAt: 20, updatedAt: 20 },
      ctx: ADMIN,
    })
    expect(calls).toEqual([])
  })

  it('still converts from a closed retro, and nothing else does', async () => {
    const issueId = newId()
    const { tx, calls } = fakeTx([
      actionRow(),
      retroRow({ phase: 'closed' }),
      { id: issueId, teamId: TEAM_ID },
      { id: NEXT_CYCLE_ID, teamId: TEAM_ID },
    ])
    await mutators.retro.convertActionToIssue.fn({
      tx,
      args: { actionId: 'action-1', issueId, createdAt: 20, updatedAt: 20 },
      ctx: ADMIN,
    })
    expect(calls[0]?.table).toBe('issue')
  })

  it('rejects a viewer before any existence check', async () => {
    const { tx, calls, runQueue } = fakeTx([actionRow()])
    const error = await capture(
      mutators.retro.convertActionToIssue.fn({
        tx,
        args: { actionId: 'action-1', issueId: newId(), createdAt: 20, updatedAt: 20 },
        ctx: VIEWER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
    expect(runQueue).toHaveLength(1)
  })
})

// One member's decision on one AI proposal. Three properties are asserted here rather than argued in
// a comment: the prologue order (so the mutator is not an existence oracle), the user component
// coming from the verified ctx and nowhere else, and the complete absence of anything minted or
// counted on this path.
describe('retroAiReaction — one member, one proposal, and no oracle', () => {
  const PROPOSAL_ID = '019f8f00-0000-7000-8000-0000000000e1'

  const proposalRow = (over: Record<string, unknown> = {}) => ({
    id: PROPOSAL_ID,
    retroId: RETRO_ID,
    teamId: TEAM_ID,
    category: 'improvement',
    ...over,
  })

  const setArgs = (over: Record<string, unknown> = {}) => ({
    proposalId: PROPOSAL_ID,
    value: 'agree' as const,
    createdAt: 5,
    updatedAt: 5,
    ...over,
  })

  // THE FALSIFIABLE CHECK (SCOPE §8, change 19). A viewer's call is refused before ANY read, so the
  // mutator cannot be used to learn whether a proposal id exists. Both halves matter: the two
  // rejections must be indistinguishable, AND the stub must still be holding every row it was given,
  // because an identical error reached after a read would still have leaked the answer through
  // timing. Reordering `canWrite` after the proposal load fails this and nothing else.
  it('rejects a viewer before any existence check, identically for a real and an invented id', async () => {
    const real = fakeTx([proposalRow(), retroRow({ phase: 'vote' })])
    const invented = fakeTx([proposalRow(), retroRow({ phase: 'vote' })])

    const onReal = await capture(
      mutators.retroAiReaction.set.fn({ tx: real.tx, args: setArgs(), ctx: VIEWER }),
    )
    const onInvented = await capture(
      mutators.retroAiReaction.set.fn({
        tx: invented.tx,
        args: setArgs({ proposalId: 'no-such-proposal' }),
        ctx: VIEWER,
      }),
    )

    expect(mutationErrorCode(onReal)).toBe(MutationErrorCode.notAuthorized)
    expect(mutationErrorCode(onInvented)).toBe(MutationErrorCode.notAuthorized)
    expect((onInvented as Error).message).toBe((onReal as Error).message)
    // Nothing was read in either case: the stub answers in order and both queues are untouched.
    expect(real.runQueue).toHaveLength(2)
    expect(invented.runQueue).toHaveLength(2)
    expect(real.calls).toEqual([])
    expect(invented.calls).toEqual([])
    // The only id either error carries is the one the caller itself supplied.
    expect((onInvented as { details: { id: string } }).details.id).toBe('no-such-proposal')
  })

  it('clears under the same prologue, and refuses a viewer before reading anything', async () => {
    const { tx, calls, runQueue } = fakeTx([proposalRow(), retroRow({ phase: 'vote' })])
    const error = await capture(
      mutators.retroAiReaction.clear.fn({ tx, args: { proposalId: PROPOSAL_ID }, ctx: VIEWER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
    expect(runQueue).toHaveLength(2)
  })

  // A proposal that really is missing is refused with the SAME generic error a wrong-team one gets,
  // so the read that happens after authorization discloses nothing either.
  it('refuses a missing proposal with the same generic rejection', async () => {
    const { tx, calls } = fakeTx([undefined])
    const error = await capture(
      mutators.retroAiReaction.set.fn({ tx, args: setArgs(), ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('refuses a member of another team', async () => {
    // proposal, retro, then the membership lookup that comes back empty
    const { tx, calls } = fakeTx([proposalRow(), retroRow({ phase: 'vote' }), undefined])
    const error = await capture(
      mutators.retroAiReaction.set.fn({ tx, args: setArgs(), ctx: OTHER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it.each(['group', 'vote'] as const)('accepts a reaction during %s', async (phase) => {
    const { tx, calls } = fakeTx([proposalRow(), retroRow({ phase }), { id: 'membership' }])
    await mutators.retroAiReaction.set.fn({ tx, args: setArgs(), ctx: MEMBER })

    expect(calls).toEqual([
      {
        table: 'retro_ai_reaction',
        verb: 'upsert',
        value: {
          proposalId: PROPOSAL_ID,
          userId: MEMBER.userID,
          retroId: RETRO_ID,
          teamId: TEAM_ID,
          value: 'agree',
          createdAt: 5,
          updatedAt: 5,
        },
      },
    ])
    // NOTHING IS MINTED. `(proposalId, userId)` is the whole key, so there is no id generated inside
    // a mutator body for a rebase to change under an optimistic result (CLAUDE.md constraint 4).
    expect(calls[0]?.value).not.toHaveProperty('id')
  })

  // `discuss` is where the verdict is stamped, so the window has to be shut by then: a reaction
  // accepted after the count would be silently uncounted.
  it.each(['brainstorm', 'discuss', 'actions', 'closed'] as const)(
    'refuses a reaction during %s',
    async (phase) => {
      const { tx, calls } = fakeTx([proposalRow(), retroRow({ phase })])
      const error = await capture(
        mutators.retroAiReaction.set.fn({ tx, args: setArgs(), ctx: ADMIN }),
      )
      expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidPhase)
      expect(calls).toEqual([])
    },
  )

  // The user half of the key is not merely taken from the ctx by convention — there is no argument
  // that could carry a user at all, so naming somebody else's row is impossible rather than a
  // `where` clause away. Both halves are asserted: the schema drops it, and the write uses the ctx.
  it('takes the user from the verified ctx, and the args cannot name one', () => {
    const parsed = setRetroAiReactionArgs.parse({
      ...setArgs(),
      userId: OTHER.userID,
      voterId: OTHER.userID,
    })
    expect(parsed).not.toHaveProperty('userId')
    expect(parsed).not.toHaveProperty('voterId')
    expect(Object.keys(parsed).sort()).toEqual(['createdAt', 'proposalId', 'updatedAt', 'value'])
  })

  it('rejects a value outside agree | disagree', () => {
    expect(() => setRetroAiReactionArgs.parse(setArgs({ value: 'abstain' }))).toThrow()
  })

  it('replaces rather than accumulates: the second reaction is an upsert on the same key', async () => {
    const first = fakeTx([proposalRow(), retroRow({ phase: 'vote' }), { id: 'membership' }])
    await mutators.retroAiReaction.set.fn({ tx: first.tx, args: setArgs(), ctx: MEMBER })
    const second = fakeTx([proposalRow(), retroRow({ phase: 'vote' }), { id: 'membership' }])
    await mutators.retroAiReaction.set.fn({
      tx: second.tx,
      args: setArgs({ value: 'disagree', updatedAt: 9 }),
      ctx: MEMBER,
    })

    expect(second.calls[0]?.verb).toBe('upsert')
    expect(second.calls[0]?.value).toMatchObject({
      proposalId: PROPOSAL_ID,
      userId: MEMBER.userID,
      value: 'disagree',
    })
    // Same key both times — one member holds at most one reaction per proposal as a storage fact.
    expect(second.calls[0]?.value.proposalId).toBe(first.calls[0]?.value.proposalId)
    expect(second.calls[0]?.value.userId).toBe(first.calls[0]?.value.userId)
  })

  it('deletes only the caller’s own key when clearing', async () => {
    const { tx, calls } = fakeTx([
      proposalRow(),
      retroRow({ phase: 'vote' }),
      { id: 'membership' },
      { proposalId: PROPOSAL_ID, userId: MEMBER.userID, value: 'agree' },
    ])
    await mutators.retroAiReaction.clear.fn({ tx, args: { proposalId: PROPOSAL_ID }, ctx: MEMBER })

    expect(calls).toEqual([
      {
        table: 'retro_ai_reaction',
        verb: 'delete',
        value: { proposalId: PROPOSAL_ID, userId: MEMBER.userID },
      },
    ])
  })

  // The palette offers "Clear my reaction" off a focus snapshot that can go stale, so a clear with
  // nothing to clear has to be a no-op rather than an error (design §G4).
  it('is a no-op when there is nothing to clear', async () => {
    const { tx, calls } = fakeTx([
      proposalRow(),
      retroRow({ phase: 'vote' }),
      { id: 'membership' },
      undefined,
    ])
    await mutators.retroAiReaction.clear.fn({ tx, args: { proposalId: PROPOSAL_ID }, ctx: MEMBER })
    expect(calls).toEqual([])
  })

  // THE OTHER HALF OF THE CENTRAL CLAIM, at the unit level: across every accepted call on this path,
  // the only table written is the reaction itself. A counter bump anywhere — on the proposal, on the
  // retro, on a tally table — fails here, which is what makes "no incremental tally" a test rather
  // than a comment.
  it('writes nothing but the reaction row — no tally, no counter, no proposal update', async () => {
    const set = fakeTx([proposalRow(), retroRow({ phase: 'vote' }), { id: 'membership' }])
    await mutators.retroAiReaction.set.fn({ tx: set.tx, args: setArgs(), ctx: MEMBER })
    const clear = fakeTx([
      proposalRow(),
      retroRow({ phase: 'vote' }),
      { id: 'membership' },
      { proposalId: PROPOSAL_ID, userId: MEMBER.userID, value: 'agree' },
    ])
    await mutators.retroAiReaction.clear.fn({
      tx: clear.tx,
      args: { proposalId: PROPOSAL_ID },
      ctx: MEMBER,
    })

    for (const call of [...set.calls, ...clear.calls]) {
      expect(call.table).toBe('retro_ai_reaction')
    }
    expect([...set.calls, ...clear.calls].map((call) => call.verb)).toEqual(['upsert', 'delete'])
  })
})

describe('retroAction.create carrying an AI proposal', () => {
  const PROPOSAL_ID = '019f8f00-0000-7000-8000-0000000000e1'

  const actionArgs = (over: Record<string, unknown> = {}) => ({
    id: 'action-ai-1',
    retroId: RETRO_ID,
    body: 'Hold scope where it was this cycle',
    createdAt: 30,
    updatedAt: 30,
    ...over,
  })

  // The falsifiable check the whole improvement→issue path turns on. The AI layer has no identity
  // dimension, so an owner here could only be invented — pinned rather than left to a default.
  it('creates the action with a null assignee and the proposal as provenance', async () => {
    const { tx, calls } = fakeTx([
      retroRow({ phase: 'discuss' }),
      { id: PROPOSAL_ID, retroId: RETRO_ID, teamId: TEAM_ID, category: 'improvement' },
    ])
    await mutators.retroAction.create.fn({
      tx,
      args: actionArgs({ aiProposalId: PROPOSAL_ID }),
      ctx: ADMIN,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.table).toBe('retro_action')
    expect(calls[0]?.value).toMatchObject({
      id: 'action-ai-1',
      retroId: RETRO_ID,
      aiProposalId: PROPOSAL_ID,
      assigneeId: null,
    })
  })

  it('leaves the provenance null when the action was written by a person', async () => {
    const { tx, calls } = fakeTx([retroRow({ phase: 'discuss' })])
    await mutators.retroAction.create.fn({ tx, args: actionArgs(), ctx: ADMIN })
    expect(calls[0]?.value).toMatchObject({ aiProposalId: null, assigneeId: null })
  })

  it('refuses a proposal that belongs to another retro', async () => {
    const { tx, calls } = fakeTx([
      retroRow({ phase: 'discuss' }),
      {
        id: PROPOSAL_ID,
        retroId: 'some-other-retro',
        teamId: TEAM_ID,
        category: 'improvement',
      },
    ])
    const error = await capture(
      mutators.retroAction.create.fn({
        tx,
        args: actionArgs({ aiProposalId: PROPOSAL_ID }),
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidTarget)
    expect(calls).toEqual([])
  })

  it('refuses a proposal id that names nothing', async () => {
    const { tx, calls } = fakeTx([retroRow({ phase: 'discuss' }), undefined])
    const error = await capture(
      mutators.retroAction.create.fn({
        tx,
        args: actionArgs({ aiProposalId: PROPOSAL_ID }),
        ctx: ADMIN,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.invalidTarget)
    expect(calls).toEqual([])
  })

  // Deliberately NOT gated on `verdict === 'agreed'` (design §D8): the UI offers the affordance on an
  // agreed improvement, but a facilitator acting on a contested one during `discuss` should not be
  // blocked by a machine-computed label, and a step back that cleared the verdict would otherwise
  // revoke an action the team had already agreed to create.
  it('does not read the proposal’s verdict, so a contested one can still become an action', async () => {
    const { tx, calls } = fakeTx([
      retroRow({ phase: 'discuss' }),
      {
        id: PROPOSAL_ID,
        retroId: RETRO_ID,
        teamId: TEAM_ID,
        category: 'improvement',
        verdict: 'contested',
      },
    ])
    await mutators.retroAction.create.fn({
      tx,
      args: actionArgs({ aiProposalId: PROPOSAL_ID }),
      ctx: ADMIN,
    })
    expect(calls[0]?.value).toMatchObject({ aiProposalId: PROPOSAL_ID })
  })
})

describe('timer and presence', () => {
  it('writes a durable end time, facilitator only', async () => {
    const { tx, calls } = fakeTx([retroRow({ facilitatorId: ADMIN.userID })])
    await mutators.retro.startTimer.fn({
      tx,
      args: { id: RETRO_ID, durationS: 300, endsAt: 1_000_300, updatedAt: 1_000_000 },
      ctx: ADMIN,
    })
    expect(calls[0]?.value).toMatchObject({ timerEndsAt: 1_000_300, timerDurationS: 300 })
  })

  it('refuses a non-facilitator', async () => {
    const { tx, calls } = fakeTx([retroRow({ facilitatorId: OTHER.userID }), { id: 'membership' }])
    const error = await capture(
      mutators.retro.startTimer.fn({
        tx,
        args: { id: RETRO_ID, durationS: 300, endsAt: 1_000_300, updatedAt: 1_000_000 },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  it('writes a presence heartbeat for the ctx user, never an args user', async () => {
    const { tx, calls } = fakeTx([retroRow({ phase: 'closed' }), { id: 'membership' }])
    await mutators.retroPresence.heartbeat.fn({
      tx,
      args: { retroId: RETRO_ID, focusTarget: 'col-1', lastSeenAt: 42 },
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      {
        table: 'retro_presence',
        verb: 'upsert',
        value: {
          retroId: RETRO_ID,
          userId: MEMBER.userID,
          teamId: TEAM_ID,
          focusTarget: 'col-1',
          lastSeenAt: 42,
        },
      },
    ])
  })
})

describe('the retro mutator registry', () => {
  it('registers every retro mutator under the name the server resolves', () => {
    for (const name of [
      'retro.openForCycle',
      'retro.configure',
      'retro.delete',
      'retro.claimFacilitator',
      'retro.setFacilitator',
      'retro.setPhase',
      'retro.startTimer',
      'retro.stopTimer',
      'retro.convertActionToIssue',
      'retroDraft.create',
      'retroDraft.update',
      'retroDraft.delete',
      'retroCard.move',
      'retroCard.delete',
      'retroGroup.create',
      'retroGroup.label',
      'retroGroup.dissolve',
      'retroVote.cast',
      'retroVote.retract',
      'retroAction.create',
      'retroAction.update',
      'retroAction.delete',
      'retroPresence.heartbeat',
      'retroAiReaction.set',
      'retroAiReaction.clear',
    ]) {
      expect(mustGetMutator(mutators, name).mutatorName).toBe(name)
    }
  })

  it('exposes no mutator that writes the card -> author binding from a client', () => {
    expect(() => mustGetMutator(mutators, 'retroCard.create')).toThrow()
    expect(() => mustGetMutator(mutators, 'retroCard.setAuthor')).toThrow()
    expect(() => mustGetMutator(mutators, 'retroCard.reveal')).toThrow()
  })
})
