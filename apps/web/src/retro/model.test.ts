import {
  isRetroWriteAllowed,
  RETRO_COLUMN_ACCENTS,
  RETRO_FORMAT_COLUMNS,
  RETRO_FORMATS,
  RETRO_PHASES,
  RETRO_PRESENCE_STALE_MS,
  RETRO_WRITE_OPS,
} from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import {
  ACCENT_TO_KIND,
  appendRank,
  buildRetroColumns,
  compareByRank,
  countdownSeconds,
  formatCountdown,
  formatDuration,
  isFacilitator,
  livePresence,
  myVotesFor,
  nextPhase,
  openRetroArgs,
  PHASE_HINT,
  PHASE_LABEL,
  previousPhase,
  RETRO_FORMAT_LABEL,
  type RetroCardData,
  type RetroColumnData,
  type RetroGroupData,
  type RetroPresenceData,
  type RetroVoteRowData,
  rankForSlot,
  remainingVotes,
  resolveVoteTarget,
  retroCan,
  TIMER_PRESETS_S,
  tallyFor,
  voteTarget,
} from './model'

const column = (id: string, rank: string): RetroColumnData => ({
  id,
  key: id,
  title: id,
  accentToken: 'neutral',
  rank,
})

const card = (over: Partial<RetroCardData> & { id: string; rank: string }): RetroCardData => ({
  columnId: 'c1',
  groupId: null,
  body: over.id,
  isAnonymous: false,
  authorDisplayId: null,
  seedRef: null,
  createdAt: 0,
  ...over,
})

const group = (over: Partial<RetroGroupData> & { id: string; rank: string }): RetroGroupData => ({
  columnId: 'c1',
  label: null,
  ...over,
})

describe('the phase model mirrors the schema', () => {
  it('labels and hints every phase', () => {
    for (const phase of RETRO_PHASES) {
      expect(PHASE_LABEL[phase]).toBeTruthy()
      expect(PHASE_HINT[phase]).toBeTruthy()
    }
  })

  it('walks forward and back one phase at a time, and stops at both ends', () => {
    expect(previousPhase('brainstorm')).toBeNull()
    expect(nextPhase('closed')).toBeNull()
    for (const [index, phase] of RETRO_PHASES.entries()) {
      expect(nextPhase(phase)).toBe(RETRO_PHASES[index + 1] ?? null)
      expect(previousPhase(phase)).toBe(index === 0 ? null : RETRO_PHASES[index - 1])
    }
  })
})

describe('retroCan', () => {
  // The UI's affordances and the server's authority are the SAME predicate: if these ever
  // disagree, a button offers a write the mutator will reject.
  it('agrees with isRetroWriteAllowed over every phase and operation', () => {
    for (const phase of RETRO_PHASES) {
      for (const op of RETRO_WRITE_OPS) {
        expect(retroCan(phase, op, { canWrite: true })).toBe(isRetroWriteAllowed(phase, op))
      }
    }
  })

  it('refuses everything for a viewer', () => {
    for (const phase of RETRO_PHASES) {
      for (const op of RETRO_WRITE_OPS) {
        expect(retroCan(phase, op, { canWrite: false })).toBe(false)
      }
    }
  })

  it('refuses a facilitator-only affordance to a non-facilitator', () => {
    expect(retroCan('brainstorm', 'timer', { canWrite: true, facilitator: false })).toBe(false)
    expect(retroCan('brainstorm', 'timer', { canWrite: true, facilitator: true })).toBe(true)
  })
})

describe('isFacilitator', () => {
  it('is the seat holder or a workspace admin, and never an anonymous session', () => {
    expect(isFacilitator({ facilitatorId: 'u1' }, 'u1', false)).toBe(true)
    expect(isFacilitator({ facilitatorId: 'u1' }, 'u2', false)).toBe(false)
    expect(isFacilitator({ facilitatorId: 'u1' }, 'u2', true)).toBe(true)
    expect(isFacilitator({ facilitatorId: null }, null, false)).toBe(false)
  })
})

describe('compareByRank', () => {
  // Ranks are minted per author over rows only that author can see, so two authors CAN mint the
  // same key. The id tiebreak is what keeps the revealed board identical on every client.
  it('orders by rank then by id, so equal ranks stay deterministic', () => {
    const rows = [
      { id: 'b', rank: 'V0' },
      { id: 'a', rank: 'V0' },
      { id: 'c', rank: 'V1' },
    ]
    expect([...rows].sort(compareByRank).map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('buildRetroColumns', () => {
  const columns = [column('c2', 'V1'), column('c1', 'V0')]

  it('orders columns by rank and counts every card in the column', () => {
    const cards = [card({ id: 'k1', rank: 'V0' }), card({ id: 'k2', rank: 'V1', columnId: 'c2' })]
    const built = buildRetroColumns(columns, cards, [])
    expect(built.map((entry) => entry.column.id)).toEqual(['c1', 'c2'])
    expect(built[0]?.cardCount).toBe(1)
  })

  it('interleaves groups and ungrouped cards by rank, with grouped cards inside their group', () => {
    const cards = [
      card({ id: 'loose', rank: 'V2' }),
      card({ id: 'in-b', rank: 'V1', groupId: 'g1' }),
      card({ id: 'in-a', rank: 'V0', groupId: 'g1' }),
    ]
    const built = buildRetroColumns(columns, cards, [group({ id: 'g1', rank: 'V1' })])
    const items = built[0]?.items ?? []
    expect(items.map((item) => item.id)).toEqual(['g1', 'loose'])
    expect(items[0]?.kind).toBe('group')
    expect(items[0]?.kind === 'group' ? items[0].cards.map((c) => c.id) : []).toEqual([
      'in-a',
      'in-b',
    ])
    expect(built[0]?.cardCount).toBe(3)
  })

  it('keeps a group with no cards visible rather than silently dropping it', () => {
    const built = buildRetroColumns(columns, [], [group({ id: 'g1', rank: 'V0' })])
    expect(built[0]?.items).toHaveLength(1)
    expect(built[0]?.cardCount).toBe(0)
  })
})

describe('voting', () => {
  it('targets the group for a cluster and the card for a loose card', () => {
    expect(voteTarget({ kind: 'group', id: 'g1', rank: 'V0', label: null, cards: [] })).toEqual({
      targetType: 'group',
      targetId: 'g1',
    })
    const loose = card({ id: 'k1', rank: 'V0' })
    expect(voteTarget({ kind: 'card', id: 'k1', rank: 'V0', card: loose })).toEqual({
      targetType: 'card',
      targetId: 'k1',
    })
  })

  // The board and the command palette both act on a bare focused id, so the retarget rule has to
  // live somewhere both can call: a dot at a CLUSTERED card is a guaranteed mutator rejection.
  it('retargets a clustered card to its cluster, from a bare id', () => {
    const cards = [card({ id: 'k1', rank: 'V0' }), card({ id: 'k2', rank: 'V1', groupId: 'g1' })]
    expect(resolveVoteTarget(cards, 'k1', 'card')).toEqual({ targetType: 'card', targetId: 'k1' })
    expect(resolveVoteTarget(cards, 'k2', 'card')).toEqual({ targetType: 'group', targetId: 'g1' })
    expect(resolveVoteTarget(cards, 'g1', 'group')).toEqual({ targetType: 'group', targetId: 'g1' })
    expect(resolveVoteTarget(cards, 'gone', 'card')).toEqual({
      targetType: 'card',
      targetId: 'gone',
    })
  })

  const vote = (id: string, targetId: string): RetroVoteRowData => ({
    id,
    targetType: 'card',
    targetId,
    createdAt: 0,
  })

  it('reads the team tally by target and the caller’s own dots separately', () => {
    const tallies = [{ targetId: 'k1', count: 4 }]
    expect(tallyFor(tallies, 'k1')).toBe(4)
    expect(tallyFor(tallies, 'k2')).toBe(0)
    const mine = [vote('v1', 'k1'), vote('v2', 'k1'), vote('v3', 'k2')]
    expect(myVotesFor(mine, 'k1')).toHaveLength(2)
  })

  it('never reports a negative remaining budget, even over budget', () => {
    expect(remainingVotes(3, [vote('v1', 'k1')])).toBe(2)
    expect(remainingVotes(1, [vote('v1', 'k1'), vote('v2', 'k1')])).toBe(0)
  })
})

describe('rank minting', () => {
  it('appends after the highest existing rank', () => {
    const rank = appendRank([{ rank: 'V0' }, { rank: 'V2' }, { rank: 'V1' }])
    expect(rank > 'V2').toBe(true)
  })

  it('appends from null for an empty destination', () => {
    expect(appendRank([])).toBeTruthy()
  })

  it('mints strictly between the neighbours of a slot', () => {
    const order = [{ rank: 'V0' }, { rank: 'x' }, { rank: 'V2' }]
    const rank = rankForSlot(order, 1)
    expect(rank > 'V0').toBe(true)
    expect(rank < 'V2').toBe(true)
  })

  it('self-heals when the neighbours collide, instead of throwing', () => {
    const order = [{ rank: 'V1' }, { rank: 'x' }, { rank: 'V1' }]
    expect(rankForSlot(order, 1) > 'V1').toBe(true)
  })

  it('mints before the first row when the slot is the head', () => {
    const rank = rankForSlot([{ rank: 'x' }, { rank: 'V1' }], 0)
    expect(rank < 'V1').toBe(true)
  })
})

describe('presence and the timer', () => {
  const here = (id: string, lastSeenAt: number): RetroPresenceData => ({
    userId: id,
    focusTarget: null,
    lastSeenAt,
    name: id,
  })

  it('drops heartbeats older than the prune window', () => {
    const now = 10_000_000
    const rows = [here('fresh', now - 1000), here('stale', now - RETRO_PRESENCE_STALE_MS - 1)]
    expect(livePresence(rows, now).map((row) => row.userId)).toEqual(['fresh'])
  })

  it('counts down to the durable end and floors at zero', () => {
    expect(countdownSeconds(null, 0)).toBeNull()
    expect(countdownSeconds(65_000, 5_000)).toBe(60)
    expect(countdownSeconds(1_000, 9_000)).toBe(0)
  })

  it('formats a countdown as m:ss', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(600)).toBe('10:00')
  })

  it('labels every timer preset', () => {
    for (const seconds of TIMER_PRESETS_S) {
      expect(formatDuration(seconds)).toMatch(/min$/)
    }
    expect(formatDuration(90)).toBe('90s')
  })
})

describe('accents and formats', () => {
  it('maps every stored accent key to a token kind — a column accent is never a colour', () => {
    for (const accent of RETRO_COLUMN_ACCENTS) {
      expect(ACCENT_TO_KIND[accent]).toBe(accent)
    }
    expect(Object.keys(ACCENT_TO_KIND)).toHaveLength(RETRO_COLUMN_ACCENTS.length)
  })

  it('labels every format', () => {
    for (const format of RETRO_FORMATS) {
      expect(RETRO_FORMAT_LABEL[format]).toBeTruthy()
    }
  })
})

describe('openRetroArgs', () => {
  const completed = { id: 'c1', number: 1, status: 'completed' as const, startDate: 100 }
  const skipped = { id: 'c2', number: 2, status: 'completed' as const, startDate: 200 }
  const open = { id: 'c3', number: 3, status: 'upcoming' as const, startDate: 300 }

  // `retro.openForCycle` re-validates the columns against the named format, so a call site that
  // drifts from the template is rejected server-side. This is the client half of that contract.
  it('mints ids at the call site and matches the format template exactly', () => {
    for (const format of RETRO_FORMATS) {
      const args = openRetroArgs(completed, [completed, open], format)
      expect(args.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(
        args.columns.map((c) => ({ key: c.key, title: c.title, accentToken: c.accentToken })),
      ).toEqual(
        RETRO_FORMAT_COLUMNS[format].map((c) => ({
          key: c.key,
          title: c.title,
          accentToken: c.accentToken,
        })),
      )
      const ranks = args.columns.map((c) => c.rank)
      expect([...ranks].sort()).toEqual(ranks)
      expect(new Set(args.columns.map((c) => c.id)).size).toBe(args.columns.length)
    }
  })

  it('mints a fresh retro id every call', () => {
    const a = openRetroArgs(completed, [completed, open], 'wentwell_didnt_action')
    const b = openRetroArgs(completed, [completed, open], 'wentwell_didnt_action')
    expect(a.id).not.toBe(b.id)
  })

  // The action target is the ROLLOVER's successor rule, not the next row by start date: a cycle
  // that is already completed is skipped, so an action can never default into finished work.
  it('resolves the action target with the rollover rule, skipping completed cycles', () => {
    const args = openRetroArgs(completed, [completed, skipped, open], 'wentwell_didnt_action')
    expect(args.nextCycleId).toBe('c3')
  })

  it('has no action target when nothing open follows the cycle', () => {
    const args = openRetroArgs(completed, [completed, skipped], 'wentwell_didnt_action')
    expect(args.nextCycleId).toBeNull()
  })
})
