import { describe, expect, it } from 'vitest'
import { ISSUE_STATUSES, type IssueStatus } from './context.js'
import {
  assembleLinkedEntities,
  computeDeliverySignal,
  computeDivergence,
  type IssueLinkRow,
  type LinkedEntities,
} from './delivery.js'
import {
  DEFAULT_ISSUE_STATUS_FILTER,
  evaluateFilter,
  type IssueView,
  matchesFilter,
  TERMINAL_ISSUE_STATUSES,
} from './filter.js'

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

describe('delivery predicates narrow to matching linked delivery state', () => {
  const failingCi = issue({ title: 'FailingCI', number: 1 })
  const blocked = issue({ title: 'Blocked', number: 2 })
  const mergedDeployed = issue({ title: 'MergedDeployed', number: 3 })
  const rows = [failingCi, blocked, mergedDeployed]

  const linkedFor = (row: IssueView): LinkedEntities => {
    if (row === failingCi) {
      return {
        pullRequests: [{ state: 'open', openedAt: 1_000 }],
        ciRuns: [{ health: 'failing' }],
      }
    }
    if (row === blocked) {
      return { pullRequests: [{ state: 'open', openedAt: 1_000 }], ciRuns: [{ health: 'passing' }] }
    }
    return { pullRequests: [{ state: 'merged', openedAt: 1_000 }], ciRuns: [{ health: 'passing' }] }
  }

  it('narrows failing-ci to the issue whose linked CI is failing', () => {
    expect(
      evaluateFilter(rows, { delivery: ['failing-ci'] }, { linkedFor }).map((r) => r.title),
    ).toEqual(['FailingCI'])
  })

  it('narrows blocked-on-review to issues with an open, unreviewed PR', () => {
    expect(
      evaluateFilter(rows, { delivery: ['blocked-on-review'] }, { linkedFor }).map((r) => r.title),
    ).toEqual(['FailingCI', 'Blocked'])
  })

  it('matches nothing for any delivery predicate when an issue has no linked entities at all', () => {
    expect(
      evaluateFilter(rows, { delivery: ['merged-not-deployed'] }, { linkedFor: () => ({}) }),
    ).toEqual([])
  })
})

// `merged-not-deployed` shipped as a reserved slot: selectable, spec-sanctioned, and empty because
// nothing recorded which commit reached production. The slot is now filled, so the predicate is
// asserted against real deployment data rather than against its own emptiness.
describe('merged-not-deployed, with the reserved slot filled', () => {
  const shipped = issue({ title: 'Shipped', number: 1 })
  const waiting = issue({ title: 'Waiting', number: 2 })
  const rows = [shipped, waiting]

  const linkedFor = (row: IssueView): LinkedEntities => ({
    pullRequests: [{ state: 'merged', openedAt: 1_000 }],
    ciRuns: [{ health: 'passing' }],
    deployments: row === shipped ? [{ deployedAt: 5_000 }] : [],
  })

  it('narrows to the merged change whose commit no deployment carried', () => {
    expect(
      evaluateFilter(rows, { delivery: ['merged-not-deployed'] }, { linkedFor }).map(
        (r) => r.title,
      ),
    ).toEqual(['Waiting'])
  })

  // Two merged pull requests on one issue, an older one shipped and the newest not. The signal's
  // `pr` axis reports the NEWEST, so the deploy axis has to report the newest too — read off the
  // issue as a whole, the old deploy would hide a change nobody has released.
  it('still matches when an OLDER linked PR shipped but the newest one did not', () => {
    const links: IssueLinkRow[] = [
      {
        pullRequest: {
          state: 'merged',
          openedAt: 1_000,
          repo: 'acme/app',
          mergeCommitSha: 'shipped',
          ciChecks: [{ conclusion: 'success' }],
        },
      },
      {
        pullRequest: {
          state: 'merged',
          openedAt: 8_000,
          repo: 'acme/app',
          mergeCommitSha: 'waiting',
          ciChecks: [{ conclusion: 'success' }],
        },
      },
    ]
    const linked = assembleLinkedEntities(links, [
      { repo: 'acme/app', sha: 'shipped', deployedAt: 5_000 },
    ])
    expect(
      matchesFilter(issue(), { delivery: ['merged-not-deployed'] }, { linkedFor: () => linked }),
    ).toBe(true)
  })

  it('does not match a merged change that is still open rather than undeployed', () => {
    expect(
      matchesFilter(
        issue(),
        { delivery: ['merged-not-deployed'] },
        {
          linkedFor: () => ({
            pullRequests: [{ state: 'open', openedAt: 1_000 }],
            ciRuns: [{ health: 'passing' }],
          }),
        },
      ),
    ).toBe(false)
  })
})

describe('DEFAULT_ISSUE_STATUS_FILTER', () => {
  it('is every status minus the terminal ones, derived rather than listed', () => {
    const expected = ISSUE_STATUSES.filter(
      (status) => !(TERMINAL_ISSUE_STATUSES as readonly IssueStatus[]).includes(status),
    )
    expect(DEFAULT_ISSUE_STATUS_FILTER.status).toEqual(expected)
  })

  it('hides the terminal statuses and keeps every live one', () => {
    for (const status of ISSUE_STATUSES) {
      const terminal = (TERMINAL_ISSUE_STATUSES as readonly IssueStatus[]).includes(status)
      expect(matchesFilter(issue({ status }), DEFAULT_ISSUE_STATUS_FILTER)).toBe(!terminal)
    }
  })

  it('constrains nothing but the status axis, so clearing it restores the archive', () => {
    expect(Object.keys(DEFAULT_ISSUE_STATUS_FILTER)).toEqual(['status'])
    expect(matchesFilter(issue({ status: 'done' }), {})).toBe(true)
  })
})
