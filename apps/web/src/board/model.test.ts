import { initialRanks } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import {
  appendRank,
  type BoardCardData,
  buildColumns,
  compareCards,
  rankForSlot,
  shouldVirtualize,
  VIRTUALIZE_THRESHOLD,
} from './model'

// Mint n ranks and hand them back as definitely-present values (the board never reads a
// missing rank; the test asserts against concrete keys).
function ranks(n: number): string[] {
  const minted = initialRanks(n)
  return minted.map((rank) => {
    if (rank === undefined) throw new Error('missing rank')
    return rank
  })
}

function at(list: string[], index: number): string {
  const value = list[index]
  if (value === undefined) throw new Error(`no rank at ${index}`)
  return value
}

function card(partial: Partial<BoardCardData> & { id: string }): BoardCardData {
  return {
    number: 1,
    title: partial.id,
    status: 'todo',
    priority: 'no_priority',
    assigneeId: null,
    rank: null,
    updatedAt: 0,
    createdAt: 0,
    labels: [],
    assignee: null,
    ...partial,
  }
}

describe('compareCards', () => {
  it('orders real ranks ascending and null ranks last', () => {
    const rs = ranks(2)
    const cards = [
      card({ id: 'null-late', rank: null, createdAt: 20 }),
      card({ id: 'b', rank: at(rs, 1) }),
      card({ id: 'null-early', rank: null, createdAt: 10 }),
      card({ id: 'a', rank: at(rs, 0) }),
    ]
    const sorted = [...cards].sort(compareCards)
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b', 'null-early', 'null-late'])
  })
})

describe('buildColumns', () => {
  it('produces all six fixed columns in order, each rank-sorted', () => {
    const rs = ranks(2)
    const columns = buildColumns([
      card({ id: 'x2', status: 'in_progress', rank: at(rs, 1) }),
      card({ id: 'x1', status: 'in_progress', rank: at(rs, 0) }),
      card({ id: 'd1', status: 'done', rank: at(rs, 0) }),
    ])
    expect(columns.map((c) => c.status)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
      'canceled',
    ])
    const inProgress = columns.find((c) => c.status === 'in_progress')
    expect(inProgress?.cards.map((c) => c.id)).toEqual(['x1', 'x2'])
  })
})

describe('rankForSlot', () => {
  it('mints a rank strictly between real neighbours', () => {
    const rs = ranks(3)
    const finalOrder = [
      card({ id: 'a', rank: at(rs, 0) }),
      card({ id: 'moved', rank: at(rs, 2) }),
      card({ id: 'b', rank: at(rs, 1) }),
    ]
    const rank = rankForSlot(finalOrder, 1)
    expect(at(rs, 0) < rank).toBe(true)
    expect(rank < at(rs, 1)).toBe(true)
  })

  it('prepends when the moved card is first', () => {
    const rs = ranks(1)
    const finalOrder = [card({ id: 'moved', rank: 'zzz' }), card({ id: 'a', rank: at(rs, 0) })]
    const rank = rankForSlot(finalOrder, 0)
    expect(rank < at(rs, 0)).toBe(true)
  })

  it('appends past a null tail (dropping among never-moved cards)', () => {
    const rs = ranks(1)
    const finalOrder = [
      card({ id: 'a', rank: at(rs, 0) }),
      card({ id: 'moved', rank: null }),
      card({ id: 'null-card', rank: null }),
    ]
    const rank = rankForSlot(finalOrder, 1)
    expect(at(rs, 0) < rank).toBe(true)
  })

  it('does not throw when dropped between two equal-rank neighbours, and sorts after them', () => {
    // Equal-rank adjacency is a transient degenerate state (two clients minted the same key).
    // rankBetween(r, r) would throw 'a >= b'; the guard falls back to a strict mint after the
    // lower bound so the moved card self-heals into a strictly-ordered position on this write.
    const collided = at(ranks(1), 0)
    const finalOrder = [
      card({ id: 'a', rank: collided }),
      card({ id: 'moved', rank: null }),
      card({ id: 'b', rank: collided }),
    ]
    let rank = ''
    expect(() => {
      rank = rankForSlot(finalOrder, 1)
    }).not.toThrow()
    expect(typeof rank).toBe('string')
    expect(collided < rank).toBe(true)
  })
})

describe('shouldVirtualize', () => {
  it('stays plain at the threshold and virtualizes just past it', () => {
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD)).toBe(false)
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD + 1)).toBe(true)
    expect(shouldVirtualize(100)).toBe(false)
    expect(shouldVirtualize(101)).toBe(true)
  })

  it('stays plain for empty and small columns', () => {
    expect(shouldVirtualize(0)).toBe(false)
    expect(shouldVirtualize(1)).toBe(false)
  })
})

describe('appendRank', () => {
  it('mints a rank after the last real-ranked card', () => {
    const rs = ranks(2)
    const rank = appendRank([
      card({ id: 'a', rank: at(rs, 0) }),
      card({ id: 'b', rank: at(rs, 1) }),
    ])
    expect(at(rs, 1) < rank).toBe(true)
  })

  it('handles an empty column', () => {
    expect(typeof appendRank([])).toBe('string')
  })
})
