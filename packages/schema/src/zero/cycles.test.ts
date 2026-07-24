import { describe, expect, it } from 'vitest'
import { ISSUE_STATUSES } from './context.js'
import { type CycleOrderRow, compareCycles, isUnfinished, nextCycleId } from './cycles.js'

describe('isUnfinished', () => {
  it('treats every status except done and canceled as unfinished', () => {
    for (const status of ISSUE_STATUSES) {
      const finished = status === 'done' || status === 'canceled'
      expect(isUnfinished(status)).toBe(!finished)
    }
  })
})

const cycle = (over: Partial<CycleOrderRow> & { id: string }): CycleOrderRow => ({
  status: 'upcoming',
  number: null,
  startDate: 0,
  ...over,
})

describe('nextCycleId', () => {
  it('picks the earliest open successor by number', () => {
    const c1 = cycle({ id: 'c1', number: 1, status: 'active' })
    const c2 = cycle({ id: 'c2', number: 2, status: 'upcoming' })
    const c3 = cycle({ id: 'c3', number: 3, status: 'upcoming' })
    expect(nextCycleId([c1, c2, c3], c1)).toBe('c2')
  })

  it('skips completed successors', () => {
    const c1 = cycle({ id: 'c1', number: 1, status: 'active' })
    const c2 = cycle({ id: 'c2', number: 2, status: 'completed' })
    const c3 = cycle({ id: 'c3', number: 3, status: 'upcoming' })
    expect(nextCycleId([c1, c2, c3], c1)).toBe('c3')
  })

  it('never rolls into an earlier cycle', () => {
    const c1 = cycle({ id: 'c1', number: 1, status: 'upcoming' })
    const c2 = cycle({ id: 'c2', number: 2, status: 'active' })
    expect(nextCycleId([c1, c2], c2)).toBeNull()
  })

  it('returns null when no open successor exists (issues get unassigned)', () => {
    const c1 = cycle({ id: 'c1', number: 1, status: 'active' })
    const c2 = cycle({ id: 'c2', number: 2, status: 'completed' })
    expect(nextCycleId([c1, c2], c1)).toBeNull()
  })

  it('falls back to startDate then id when numbers are absent', () => {
    const c1 = cycle({ id: 'c1', startDate: 100, status: 'active' })
    const c2 = cycle({ id: 'c2', startDate: 200, status: 'upcoming' })
    expect(nextCycleId([c1, c2], c1)).toBe('c2')
  })
})

describe('compareCycles', () => {
  it('orders numbered cycles before unnumbered ones', () => {
    const numbered = cycle({ id: 'a', number: 5 })
    const pending = cycle({ id: 'b', number: null, startDate: 0 })
    expect(compareCycles(numbered, pending)).toBeLessThan(0)
  })
})
