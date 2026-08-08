import { buildIssueTimeline, type CiConclusion, type IssueTimelineInput } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import { deliveryView, type LinkedIssueRow, linkedEntitiesFor } from '@/issues/delivery'
import {
  agoPhrase,
  buildRailView,
  checksFact,
  momentsForChange,
  monoSubline,
} from './timeline-view'

// The phrasing layer's own honesty rules, over the same derivation the page reads. Three things are
// checked here that the page's own test cannot see: a check that has not reported is not a failure,
// an age under a minute is not "now ago", and an issue with TWO linked changes must not have its
// plain register describing one change and its mono register and rail describing the other.

const NOW = 1_760_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const MERGE_SHA = '8f21c4a9e0b7d3f1a2c5e8b4d6f0a1c3e5b7d9f2'

function withChecks(conclusions: readonly CiConclusion[]): IssueTimelineInput {
  return {
    issue: { createdAt: NOW - 9 * DAY, creatorId: 'user-1' },
    links: [
      {
        source: 'branch',
        createdAt: NOW - 5 * DAY,
        pullRequest: {
          id: 'pr-188',
          repo: 'acme/payments',
          number: 188,
          state: 'merged',
          openedAt: NOW - 5 * DAY,
          mergedAt: NOW - 22 * HOUR,
          mergeCommitSha: MERGE_SHA,
          ciChecks: conclusions.map((conclusion) => ({ conclusion })),
        },
      },
    ],
  }
}

function checksLine(conclusions: readonly CiConclusion[]): string | null {
  const merged = buildIssueTimeline(withChecks(conclusions), NOW).find(
    (moment) => moment.kind === 'merged',
  )
  if (merged === undefined || merged.kind !== 'merged') throw new Error('fixture has no merge')
  return checksFact(merged)
}

const green = (count: number): CiConclusion[] => Array.from({ length: count }, () => 'success')

describe('checksFact', () => {
  it('states the passing count when every check is green', () => {
    expect(checksLine(green(14))).toBe('14/14 checks passed')
  })

  // The regression this exists for: the failing count was derived as `total - passed`, which counts
  // a check that has not reported yet as a failure. Eleven green, one red and two still running is
  // "1 of 14 failing", never "3 of 14 failing".
  it('counts only the checks that actually failed, and says so about the ones still running', () => {
    const fact = checksLine([...green(11), 'failure', 'pending', 'pending'])
    expect(fact).toBe('1 of 14 checks failing, 2 still reporting')
    expect(fact).not.toMatch(/3 of 14/)
  })

  it('states a failure without a pending clause when nothing is still running', () => {
    expect(checksLine([...green(13), 'failure'])).toBe('1 of 14 checks failing')
  })

  it('does not claim a failure when the only unfinished checks are pending', () => {
    expect(checksLine(['success', 'pending'])).toBe('1/2 checks reported')
  })

  it('says nothing at all when no check ran, and never states a duration', () => {
    expect(checksLine([])).toBeNull()
    expect(checksLine(['success'])).not.toMatch(/took|duration|elapsed/)
  })
})

describe('agoPhrase', () => {
  it('says "just now" under a minute rather than "now ago"', () => {
    expect(agoPhrase(20_000)).toBe('just now')
    expect(agoPhrase(20_000)).not.toMatch(/now ago/)
  })

  it('suffixes every measurable age', () => {
    expect(agoPhrase(3 * DAY)).toBe('3d ago')
    expect(agoPhrase(22 * HOUR)).toBe('22h ago')
  })
})

// Two linked changes: an older one that merged, and a newer one still open. `computeDeliverySignal`
// describes the newest-opened change, so every register on the page has to describe that same one.
const TWO_CHANGES = [
  {
    pullRequest: {
      id: 'pr-100',
      repo: 'acme/payments',
      number: 100,
      state: 'merged',
      openedAt: NOW - 10 * DAY,
      mergedAt: NOW - 8 * DAY,
      mergeCommitSha: MERGE_SHA,
      ciChecks: [{ conclusion: 'success' }],
      reviews: [{ state: 'approved', submittedAt: NOW - 9 * DAY }],
    },
  },
  {
    pullRequest: {
      id: 'pr-200',
      repo: 'acme/payments',
      number: 200,
      state: 'open',
      openedAt: NOW - 2 * DAY,
      ciChecks: [{ conclusion: 'success' }],
    },
  },
] as const

const TWO_CHANGE_INPUT: IssueTimelineInput = {
  issue: { createdAt: NOW - 12 * DAY, creatorId: 'user-1' },
  links: [
    { source: 'branch', createdAt: NOW - 10 * DAY, pullRequest: TWO_CHANGES[0].pullRequest },
    { source: 'branch', createdAt: NOW - 2 * DAY, pullRequest: TWO_CHANGES[1].pullRequest },
  ],
}

describe('the two registers agree about which change backs the issue', () => {
  it('narrows the mono line and the rail to the change the signal describes', () => {
    const view = deliveryView(
      { status: 'in_progress' },
      linkedEntitiesFor(TWO_CHANGES as unknown as readonly LinkedIssueRow[]),
    )
    expect(view.pullRequestId).toBe('pr-200')

    const moments = momentsForChange(buildIssueTimeline(TWO_CHANGE_INPUT, NOW), view.pullRequestId)

    const mono = monoSubline(moments, view.divergence)
    expect(mono?.text).toMatch(/PR #200/)
    expect(mono?.text).not.toMatch(/#100/)
    // The open change has not merged, so no merge commit may stand beside a phrase computed over
    // it: that sha belongs to the other change entirely.
    expect(mono?.text).not.toMatch(/8f21c4a/)

    const rail = buildRailView(moments, null)
    const drawn = rail.stations.map((station) => `${station.label} ${station.fact ?? ''}`).join(' ')
    expect(drawn).toMatch(/PR #200/)
    expect(drawn).not.toMatch(/#100/)
    expect(rail.stations.map((station) => station.id)).not.toContain('merged')
    // The header promises exactly what the rail drew, and nothing the other change earned.
    expect(rail.chain).toBe('idea → built')
  })

  it('keeps the moments that belong to the issue rather than to a change', () => {
    const moments = momentsForChange(buildIssueTimeline(TWO_CHANGE_INPUT, NOW), 'pr-200')
    expect(moments.some((moment) => moment.kind === 'created')).toBe(true)
  })

  it('narrows nothing when there is no change to narrow to', () => {
    const all = buildIssueTimeline(TWO_CHANGE_INPUT, NOW)
    expect(momentsForChange(all, null)).toBe(all)
  })
})
