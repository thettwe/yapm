import { describe, expect, it } from 'vitest'
import { computeDeliverySignal, computeDivergence } from './delivery.js'
import { evaluateFilter, type IssueView, matchesFilter } from './filter.js'

const issue = (over: Partial<IssueView> = {}): IssueView => ({
  status: 'todo',
  priority: 'medium',
  assigneeId: null,
  title: 'Fix the thing',
  number: 12,
  labels: [],
  ...over,
})

describe('computeDeliverySignal', () => {
  it('returns null when there are no linked entities (issue-core has none)', () => {
    expect(computeDeliverySignal(issue(), {})).toBeNull()
    expect(computeDeliverySignal(issue(), { pullRequests: [], ciRuns: [] })).toBeNull()
  })
})

describe('computeDivergence', () => {
  it('is dormant (null) whenever the delivery signal is null, regardless of status', () => {
    for (const status of ['backlog', 'in_progress', 'in_review', 'done'] as const) {
      expect(computeDivergence(status, null)).toBeNull()
    }
  })
})

describe('intention filters narrow synced rows', () => {
  const rows: IssueView[] = [
    issue({ status: 'todo', priority: 'high', assigneeId: 'u1', title: 'Alpha', number: 1 }),
    issue({ status: 'done', priority: 'low', assigneeId: null, title: 'Beta', number: 2 }),
    issue({
      status: 'in_progress',
      priority: 'high',
      assigneeId: 'u2',
      title: 'Gamma',
      number: 3,
      labels: [{ id: 'bug' }],
    }),
  ]

  it('filters by status', () => {
    expect(evaluateFilter(rows, { status: ['done'] }).map((r) => r.title)).toEqual(['Beta'])
  })

  it('filters by priority (OR within an axis)', () => {
    expect(evaluateFilter(rows, { priority: ['high'] }).map((r) => r.title)).toEqual([
      'Alpha',
      'Gamma',
    ])
  })

  it('treats a null assignee id as the explicit unassigned option', () => {
    expect(evaluateFilter(rows, { assigneeIds: [null] }).map((r) => r.title)).toEqual(['Beta'])
  })

  it('filters by label membership', () => {
    expect(evaluateFilter(rows, { labelIds: ['bug'] }).map((r) => r.title)).toEqual(['Gamma'])
  })

  it('matches text against title and the human key', () => {
    expect(evaluateFilter(rows, { text: 'gam' }, { teamKey: 'ENG' }).map((r) => r.title)).toEqual([
      'Gamma',
    ])
    expect(evaluateFilter(rows, { text: 'eng-2' }, { teamKey: 'ENG' }).map((r) => r.title)).toEqual(
      ['Beta'],
    )
  })

  it('AND-combines axes', () => {
    expect(
      evaluateFilter(rows, { status: ['in_progress'], priority: ['high'] }).map((r) => r.title),
    ).toEqual(['Gamma'])
  })
})

describe('the reserved delivery axis', () => {
  const rows = [issue({ title: 'A' }), issue({ title: 'B' })]

  it('yields empty by construction for a delivery-only filter (signal is always null)', () => {
    expect(evaluateFilter(rows, { delivery: ['failing-ci'] })).toEqual([])
    expect(evaluateFilter(rows, { delivery: ['blocked-on-review'] })).toEqual([])
  })

  it('empties a filter even when its intention axis would have matched', () => {
    expect(
      matchesFilter(issue({ status: 'todo' }), { status: ['todo'], delivery: ['failing-ci'] }),
    ).toBe(false)
  })
})
