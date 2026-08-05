import type { DeliveryMetric, DeliveryWindow } from '@yapm/schema'
import { collectKeys, FORBIDDEN_IDENTITY_KEYS } from '@yapm/schema/testing'
import { describe, expect, it } from 'vitest'
import type { SeedCycleRow, SeedIssueRow } from './rows'
import { buildTeamDeliveryFor } from './window-model'

const HOUR = 60 * 60 * 1000
const START = 1_700_000_000_000

function cycle(over: Partial<SeedCycleRow> & { id: string; number: number }): SeedCycleRow {
  return {
    name: `Cycle ${over.number}`,
    status: 'completed',
    startDate: START + over.number * 500 * HOUR,
    ...over,
  }
}

// The rows as `queries.issues.byTeam` really returns them: a superset carrying an assignee with a
// name and an email, a creator, and a review with a real GitHub login on it. The builder must
// project every one of those away.
interface IdentityBearingIssueRow extends SeedIssueRow {
  readonly assignee?: { readonly name: string; readonly email: string }
  readonly creator?: { readonly name: string; readonly email: string }
  readonly assigneeId?: string
}

function issue(over: Partial<IdentityBearingIssueRow> & { id: string }): IdentityBearingIssueRow {
  return {
    status: 'done',
    cycleId: null,
    assignee: { name: 'Ada Lovelace', email: 'ada@example.com' },
    creator: { name: 'Ada Lovelace', email: 'ada@example.com' },
    assigneeId: 'user-ada',
    ...over,
  }
}

function linkedPr(over: {
  openedAt: number
  mergedAt?: number | null
  reviewsAt?: readonly number[]
  ciConclusions?: readonly string[]
}): NonNullable<SeedIssueRow['issueLinks']> {
  return [
    {
      pullRequest: {
        openedAt: over.openedAt,
        mergedAt: over.mergedAt ?? null,
        reviews: (over.reviewsAt ?? []).map((submittedAt) => ({
          submittedAt,
          // The radioactive column: `review.author` is a real GitHub login in a synced table.
          author: 'octocat',
        })),
        ciChecks: (over.ciConclusions ?? []).map((conclusion) => ({ conclusion })),
      },
    },
  ]
}

function sixCycles(): SeedCycleRow[] {
  return [1, 2, 3, 4, 5, 6].map((number) => cycle({ id: `c${number}`, number }))
}

function metricOf(window: DeliveryWindow | null, key: string): DeliveryMetric {
  const found = (window?.sections ?? [])
    .flatMap((section) => section.metrics)
    .find((metric) => metric.key === key)
  if (found === undefined) throw new Error(`no metric ${key}`)
  return found
}

function sectionOf(window: DeliveryWindow | null, key: 'delivered' | 'flow') {
  const found = (window?.sections ?? []).find((section) => section.key === key)
  if (found === undefined) throw new Error(`no section ${key}`)
  return found
}

// The issues a connector-fed team has: two per cycle, each with a linked, reviewed, merged PR.
function issuesWithLinks(): IdentityBearingIssueRow[] {
  return [1, 2, 3, 4, 5, 6].flatMap((number) => {
    const opened = START + number * 500 * HOUR + HOUR
    return [
      issue({
        id: `i${number}a`,
        status: 'done',
        cycleId: `c${number}`,
        issueLinks: linkedPr({
          openedAt: opened,
          mergedAt: opened + 20 * HOUR,
          reviewsAt: [opened + 4 * HOUR, opened + 8 * HOUR],
          ciConclusions: ['success'],
        }),
      }),
      issue({
        id: `i${number}b`,
        status: 'in_progress',
        cycleId: `c${number}`,
        issueLinks: linkedPr({
          openedAt: opened,
          mergedAt: opened + 40 * HOUR,
          reviewsAt: [opened + 12 * HOUR],
          ciConclusions: ['failure'],
        }),
      }),
    ]
  })
}

function issuesWithoutLinks(): IdentityBearingIssueRow[] {
  return issuesWithLinks().map(({ issueLinks: _dropped, ...rest }) => rest)
}

// The single most important test in this change. `buildTeamDeliveryFor` is a NEW entry point into
// the measurement, so the blamelessness guarantee is re-proven here rather than re-argued: CLAUDE.md
// #8 is team-level metrics only, and every identity the synced rows carry is planted in the input
// above.
describe('buildTeamDeliveryFor is blameless by construction', () => {
  it('carries no identity-shaped key at any depth of the built model', () => {
    const model = buildTeamDeliveryFor(sixCycles(), issuesWithLinks(), 6)
    expect(model).not.toBeNull()

    const keys = collectKeys(model)
    // The absences below are only evidence if the walk reached the model. A build that returned
    // nothing would collect nothing, and every assertion after this one would hold vacuously.
    expect(keys).toContain('sections')
    expect(keys).toContain('metrics')
    expect(keys).toContain('caption')
    expect(keys).toContain('trend')

    for (const forbidden of FORBIDDEN_IDENTITY_KEYS) {
      expect(keys).not.toContain(forbidden)
    }
  })

  // The shape check alone would pass a caption that interpolated a login into a string. This is the
  // leak check: the planted names must not survive anywhere in the serialized model.
  it('leaks none of the planted names, logins or email addresses into any string', () => {
    const model = buildTeamDeliveryFor(sixCycles(), issuesWithLinks(), 6)
    const serialized = JSON.stringify(model)

    expect(serialized).not.toContain('Ada Lovelace')
    expect(serialized).not.toContain('ada@example.com')
    expect(serialized).not.toContain('octocat')
    expect(serialized).not.toContain('user-ada')
  })
})

describe('buildTeamDeliveryFor', () => {
  it('reads the window over completed cycles and names how many it found', () => {
    const model = buildTeamDeliveryFor(sixCycles(), issuesWithLinks(), 6)

    expect(model?.cycleCount).toBe(6)
    expect(model?.label).toBe('Last 6 completed cycles')
    expect(metricOf(model, 'total').value).toBe(12)
    expect(metricOf(model, 'shipped').value).toBe(6)
  })

  // A half-finished cycle drags every count down; excluding it is what keeps the trend from
  // reporting a decline that is only the calendar.
  it('excludes the cycle in progress', () => {
    const cycles = [...sixCycles(), cycle({ id: 'c7', number: 7, status: 'active' })]
    const issues = [...issuesWithLinks(), issue({ id: 'i7a', status: 'todo', cycleId: 'c7' })]

    const model = buildTeamDeliveryFor(cycles, issues, 6)

    expect(model?.cycleCount).toBe(6)
    expect(metricOf(model, 'total').value).toBe(12)
  })

  it('renders one point per window cycle rather than one aggregate', () => {
    const model = buildTeamDeliveryFor(sixCycles(), issuesWithLinks(), 6)

    expect(metricOf(model, 'total').trend).toEqual([2, 2, 2, 2, 2, 2])
    expect(metricOf(model, 'total').value).toBe(12)
  })

  // Comparing a full window against a partial one is arithmetic on incomparable things.
  it('drops the delta until two full windows of completed cycles exist', () => {
    const six = buildTeamDeliveryFor(sixCycles(), issuesWithLinks(), 6)
    expect(metricOf(six, 'total').delta).toBeNull()

    const three = buildTeamDeliveryFor(sixCycles(), issuesWithLinks(), 3)
    expect(metricOf(three, 'total').delta).toBe(0)
  })

  it('produces nothing at all for a team with no completed cycle', () => {
    const cycles = [
      cycle({ id: 'c1', number: 1, status: 'active' }),
      cycle({ id: 'c2', number: 2, status: 'upcoming' }),
    ]

    expect(buildTeamDeliveryFor(cycles, issuesWithLinks(), 6)).toBeNull()
    expect(buildTeamDeliveryFor([], [], 6)).toBeNull()
  })
})

// The two-team case, from one fixture: the ONLY difference is whether the issues carry a linked pull
// request. Delivered is computed from cycles alone and must be identical on both.
describe('a team with a connector and a team without one', () => {
  it('fills both sections when the issues carry linked pull requests', () => {
    const model = buildTeamDeliveryFor(sixCycles(), issuesWithLinks(), 6)

    expect(sectionOf(model, 'delivered').state).toBe('ready')
    expect(sectionOf(model, 'flow').state).toBe('ready')
    expect(metricOf(model, 'pr_cycle_time').value).toBe(30)
    expect(metricOf(model, 'ci_failing_rate').value).toBe(50)
  })

  it('fills Delivered and says what would light up Flow when nothing is linked', () => {
    const linked = buildTeamDeliveryFor(sixCycles(), issuesWithLinks(), 6)
    const unlinked = buildTeamDeliveryFor(sixCycles(), issuesWithoutLinks(), 6)

    const flow = sectionOf(unlinked, 'flow')
    expect(flow.state).toBe('empty')
    expect(flow.metrics).toEqual([])
    expect(flow.emptyState?.detail).toContain('the last 6 completed cycles')

    // No zeroed flow metric anywhere, and Delivered reads exactly as it does for the linked team.
    expect(sectionOf(unlinked, 'delivered')).toEqual(sectionOf(linked, 'delivered'))
  })
})
