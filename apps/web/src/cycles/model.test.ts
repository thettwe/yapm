import { describe, expect, it } from 'vitest'
import { type CycleRowData, currentCycle, cycleKey, partitionCycles } from './model'

const cycle = (over: Partial<CycleRowData> & { id: string }): CycleRowData => ({
  number: null,
  name: 'Cycle',
  status: 'upcoming',
  startDate: 0,
  endDate: 1,
  ...over,
})

describe('partitionCycles', () => {
  it('splits by status, ordering completed newest-first', () => {
    const result = partitionCycles([
      cycle({ id: 'a', number: 1, status: 'completed' }),
      cycle({ id: 'b', number: 2, status: 'active' }),
      cycle({ id: 'c', number: 3, status: 'upcoming' }),
      cycle({ id: 'd', number: 4, status: 'completed' }),
    ])
    expect(result.active.map((c) => c.id)).toEqual(['b'])
    expect(result.upcoming.map((c) => c.id)).toEqual(['c'])
    expect(result.completed.map((c) => c.id)).toEqual(['d', 'a'])
  })
})

describe('currentCycle', () => {
  it('prefers the earliest active cycle', () => {
    const cycles = [
      cycle({ id: 'up', number: 3, status: 'upcoming' }),
      cycle({ id: 'act', number: 2, status: 'active' }),
    ]
    expect(currentCycle(cycles)?.id).toBe('act')
  })

  it('falls back to the earliest upcoming cycle', () => {
    expect(currentCycle([cycle({ id: 'up', number: 1, status: 'upcoming' })])?.id).toBe('up')
  })

  it('returns null when no open cycle exists', () => {
    expect(currentCycle([cycle({ id: 'x', status: 'completed' })])).toBeNull()
  })
})

describe('cycleKey', () => {
  it('renders pending before the number replicates', () => {
    expect(cycleKey({ number: null })).toBe('Cycle …')
    expect(cycleKey({ number: 7 })).toBe('Cycle 7')
  })
})
