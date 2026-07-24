import { describe, expect, it } from 'vitest'
import { buildGroups, DEFAULT_SORT, type IssueRowData } from './model'

const issue = (over: Partial<IssueRowData> & { id: string }): IssueRowData => ({
  number: 1,
  title: 't',
  status: 'todo',
  priority: 'medium',
  assigneeId: null,
  cycleId: null,
  updatedAt: 0,
  createdAt: 0,
  ...over,
})

const base = {
  filter: {},
  sort: DEFAULT_SORT,
  teamKey: 'TEAM',
} as const

describe('buildGroups — group by cycle', () => {
  it('buckets issues per cycleId, applies cycleName, and orders "No cycle" last', () => {
    const issues = [
      issue({ id: 'a', cycleId: 'c1' }),
      issue({ id: 'b', cycleId: 'c2' }),
      issue({ id: 'c', cycleId: null }),
      issue({ id: 'd', cycleId: 'c1' }),
    ]
    const names: Record<string, string> = { c1: 'Beta', c2: 'Alpha' }
    const { groups } = buildGroups(issues, {
      ...base,
      grouping: 'cycle',
      cycleName: (id) => names[id] ?? id,
    })

    expect(groups.map((group) => group.label)).toEqual(['Alpha', 'Beta', 'No cycle'])
    const noCycle = groups[groups.length - 1]
    expect(noCycle?.label).toBe('No cycle')
    expect(noCycle?.issues.map((i) => i.id)).toEqual(['c'])
    const beta = groups.find((group) => group.label === 'Beta')
    expect(beta?.issues.map((i) => i.id).sort()).toEqual(['a', 'd'])
  })
})

describe('buildGroups — filter by cycle', () => {
  it('keeps only issues whose cycleId is in the cycleIds list', () => {
    const issues = [
      issue({ id: 'a', cycleId: 'c1' }),
      issue({ id: 'b', cycleId: 'c2' }),
      issue({ id: 'c', cycleId: null }),
    ]
    const { ordered } = buildGroups(issues, {
      ...base,
      grouping: 'none',
      cycleIds: ['c1'],
    })
    expect(ordered.map((i) => i.id)).toEqual(['a'])
  })

  it('selects issues with no cycle when null is included in cycleIds', () => {
    const issues = [
      issue({ id: 'a', cycleId: 'c1' }),
      issue({ id: 'b', cycleId: null }),
      issue({ id: 'c', cycleId: null }),
    ]
    const { ordered } = buildGroups(issues, {
      ...base,
      grouping: 'none',
      cycleIds: [null, 'c1'],
    })
    expect(ordered.map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not filter by cycle when cycleIds is absent', () => {
    const issues = [issue({ id: 'a', cycleId: 'c1' }), issue({ id: 'b', cycleId: null })]
    const { ordered } = buildGroups(issues, { ...base, grouping: 'none' })
    expect(ordered.map((i) => i.id).sort()).toEqual(['a', 'b'])
  })
})
