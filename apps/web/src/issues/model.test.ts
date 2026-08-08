import type { IssueSortKey } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import { buildGroups, DEFAULT_SORT, type IssueRowData, parseIssueKey } from './model'

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

describe('buildGroups — group by project', () => {
  it('buckets issues per projectId, applies projectName, and orders "No project" last', () => {
    const issues = [
      issue({ id: 'a', projectId: 'p1' }),
      issue({ id: 'b', projectId: 'p2' }),
      issue({ id: 'c', projectId: null }),
      issue({ id: 'd', projectId: 'p1' }),
    ]
    const names: Record<string, string> = { p1: 'Beta', p2: 'Alpha' }
    const { groups } = buildGroups(issues, {
      ...base,
      grouping: 'project',
      projectName: (id) => names[id] ?? id,
    })

    expect(groups.map((g) => g.label)).toEqual(['Alpha', 'Beta', 'No project'])
    const noProject = groups[groups.length - 1]
    expect(noProject?.label).toBe('No project')
    expect(noProject?.issues.map((i) => i.id)).toEqual(['c'])
    const beta = groups.find((g) => g.label === 'Beta')
    expect(beta?.issues.map((i) => i.id).sort()).toEqual(['a', 'd'])
  })
})

describe('buildGroups — filter by project', () => {
  it('keeps only issues whose projectId is in projectIds', () => {
    const issues = [
      issue({ id: 'a', projectId: 'p1' }),
      issue({ id: 'b', projectId: 'p2' }),
      issue({ id: 'c', projectId: null }),
    ]
    const { ordered } = buildGroups(issues, { ...base, grouping: 'none', projectIds: ['p1'] })
    expect(ordered.map((i) => i.id)).toEqual(['a'])
  })

  it('selects issues with no project when null is included', () => {
    const issues = [
      issue({ id: 'a', projectId: 'p1' }),
      issue({ id: 'b', projectId: null }),
      issue({ id: 'c', projectId: null }),
    ]
    const { ordered } = buildGroups(issues, {
      ...base,
      grouping: 'none',
      projectIds: [null, 'p1'],
    })
    expect(ordered.map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not filter by project when projectIds is absent', () => {
    const issues = [issue({ id: 'a', projectId: 'p1' }), issue({ id: 'b', projectId: null })]
    const { ordered } = buildGroups(issues, { ...base, grouping: 'none' })
    expect(ordered.map((i) => i.id).sort()).toEqual(['a', 'b'])
  })
})

// Every sort key over one fixture whose SIX ascending orders are six distinct permutations, so a
// comparator case that fell through to the default (`updated`) would produce the wrong order for
// every other key rather than accidentally agreeing with it.
describe('buildGroups — the six sort keys', () => {
  const issues = [
    issue({
      id: 'a',
      priority: 'low',
      status: 'done',
      assigneeId: 'u2',
      createdAt: 3,
      updatedAt: 2,
      number: 1,
    }),
    issue({
      id: 'b',
      priority: 'medium',
      status: 'todo',
      assigneeId: 'u3',
      createdAt: 2,
      updatedAt: 1,
      number: 3,
    }),
    issue({
      id: 'c',
      priority: 'urgent',
      status: 'in_progress',
      assigneeId: 'u1',
      createdAt: 1,
      updatedAt: 3,
      number: 2,
    }),
  ]

  const ASCENDING = [
    ['priority', ['a', 'b', 'c']],
    ['status', ['b', 'c', 'a']],
    ['assignee', ['c', 'a', 'b']],
    ['created', ['c', 'b', 'a']],
    ['number', ['a', 'c', 'b']],
    ['updated', ['b', 'a', 'c']],
  ] as const satisfies readonly (readonly [IssueSortKey, readonly string[]])[]

  it.each(ASCENDING)('%s sorts ascending', (key, expected) => {
    const { ordered } = buildGroups(issues, {
      ...base,
      grouping: 'none',
      sort: { key, direction: 'asc' },
    })
    expect(ordered.map((i) => i.id)).toEqual([...expected])
  })

  it.each(ASCENDING)('%s reverses under the direction toggle', (key, expected) => {
    const { ordered } = buildGroups(issues, {
      ...base,
      grouping: 'none',
      sort: { key, direction: 'desc' },
    })
    expect(ordered.map((i) => i.id)).toEqual([...expected].reverse())
  })
})

describe('parseIssueKey', () => {
  it('accepts this team key, case-insensitively', () => {
    expect(parseIssueKey('ENG-116', 'ENG')).toBe(116)
    expect(parseIssueKey('eng-116', 'ENG')).toBe(116)
    expect(parseIssueKey('Eng-116', 'eng')).toBe(116)
  })

  it('accepts the bare number the side panel link emits', () => {
    expect(parseIssueKey('116', 'ENG')).toBe(116)
    expect(parseIssueKey('116', undefined)).toBe(116)
  })

  it('refuses another team key rather than answering with a shared number', () => {
    expect(parseIssueKey('OPS-116', 'ENG')).toBeNull()
  })

  it('refuses anything that is not one of the two spellings', () => {
    for (const segment of ['', 'ENG', 'ENG-', '-116', 'ENG-116-2', 'ENG 116', '11a', 'ENG-1.5']) {
      expect(parseIssueKey(segment, 'ENG')).toBeNull()
    }
  })

  it('is undecided, not wrong, while the team key is still syncing', () => {
    expect(parseIssueKey('ENG-116', undefined)).toBeUndefined()
    // A malformed segment needs no team key to be refused.
    expect(parseIssueKey('nonsense', undefined)).toBeNull()
  })
})
