import { describe, expect, it } from 'vitest'
import {
  buildIssueTimeline,
  type IssueMoment,
  type IssueTimelineInput,
  latestMoment,
} from './issue-timeline.js'

const NOW = 1_760_000_000_000
const HOUR = 3_600_000
const DAY = 24 * HOUR

const MERGE_SHA = '8f21c4a9e0b7d3f1a2c5e8b4d6f0a1c3e5b7d9f2'
const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

// The mock's ENG-116: in progress on the board, planned into a cycle, matched to a pull request by
// its branch, opened, reviewed twice (changes requested, then approved), merged with 14 green
// checks — and nothing that carries the merge commit has been deployed.
function eng116(overrides: Partial<IssueTimelineInput> = {}): IssueTimelineInput {
  return {
    issue: {
      createdAt: NOW - 9 * DAY,
      creatorId: 'user-priya',
      cycleAssignedAt: NOW - 7 * DAY,
      cycleId: 'cycle-2',
      carryoverCount: 1,
    },
    cycle: {
      id: 'cycle-2',
      name: 'Cycle 2',
      number: 2,
      startDate: NOW - 7 * DAY,
      endDate: NOW + 7 * DAY,
    },
    links: [
      {
        pullRequestId: 'pr-188',
        source: 'branch',
        createdAt: NOW - 5 * DAY,
        pullRequest: {
          id: 'pr-188',
          repo: 'acme/payments',
          number: 188,
          url: 'https://github.com/acme/payments/pull/188',
          title: 'Saved cards behind a flag',
          state: 'merged',
          openedAt: NOW - 5 * DAY,
          mergedAt: NOW - 22 * HOUR,
          headSha: HEAD_SHA,
          mergeCommitSha: MERGE_SHA,
          ciChecks: Array.from({ length: 14 }, () => ({ conclusion: 'success' as const })),
          reviews: [
            { state: 'changes_requested', submittedAt: NOW - 3 * DAY, author: 'dana' },
            { state: 'approved', submittedAt: NOW - 2 * DAY, author: 'sam' },
          ],
        },
      },
    ],
    deployments: [],
    ...overrides,
  }
}

function kinds(moments: readonly IssueMoment[]): string[] {
  return moments.map((moment) => moment.kind)
}

describe('buildIssueTimeline', () => {
  it('emits exactly the moments a durable timestamp supports, in order', () => {
    const moments = buildIssueTimeline(eng116(), NOW)

    expect(kinds(moments)).toEqual([
      'created',
      'planned',
      'linked',
      'change_opened',
      'reviewed',
      'reviewed',
      'merged',
    ])
    for (let index = 1; index < moments.length; index += 1) {
      expect(moments[index]?.at).toBeGreaterThanOrEqual(moments[index - 1]?.at ?? 0)
    }
  })

  it('dates every moment from one clock', () => {
    for (const moment of buildIssueTimeline(eng116(), NOW)) {
      expect(moment.ageMs).toBe(NOW - moment.at)
    }
  })

  it('names the cycle a planned moment was planned into', () => {
    const planned = latestMoment(buildIssueTimeline(eng116(), NOW), 'planned')
    expect(planned).toMatchObject({
      at: NOW - 7 * DAY,
      cycleId: 'cycle-2',
      cycleName: 'Cycle 2',
      cycleNumber: 2,
      carryoverCount: 1,
    })
  })

  it('does not let a cycle row that is not the issue cycle name the moment', () => {
    const input = eng116({ cycle: { id: 'cycle-9', name: 'Cycle 9', number: 9 } })
    expect(latestMoment(buildIssueTimeline(input, NOW), 'planned')?.cycleName).toBeNull()
  })

  it('omits the planned moment entirely when nothing recorded the assignment', () => {
    const base = eng116()
    const input: IssueTimelineInput = {
      ...base,
      issue: { ...base.issue, cycleAssignedAt: null },
    }
    expect(kinds(buildIssueTimeline(input, NOW))).not.toContain('planned')
  })

  it('carries the link source, so the feed can say how the change was found', () => {
    const linked = latestMoment(buildIssueTimeline(eng116(), NOW), 'linked')
    expect(linked).toMatchObject({ source: 'branch', repo: 'acme/payments', number: 188 })
  })

  it('carries the round count and the latest state on every review moment', () => {
    const moments = buildIssueTimeline(eng116(), NOW)
    const reviews = moments.filter(
      (moment): moment is Extract<IssueMoment, { kind: 'reviewed' }> => moment.kind === 'reviewed',
    )
    expect(reviews.map((review) => review.round)).toEqual([1, 2])
    expect(reviews.map((review) => review.state)).toEqual(['changes_requested', 'approved'])
    for (const review of reviews) {
      expect(review.rounds).toBe(2)
      expect(review.latestState).toBe('approved')
    }
  })

  it('counts checks over conclusions and states no duration', () => {
    const merged = latestMoment(buildIssueTimeline(eng116(), NOW), 'merged')
    expect(merged).toMatchObject({
      mergeCommitSha: MERGE_SHA,
      checksPassed: 14,
      checksTotal: 14,
      checksHealth: 'passing',
    })
    // `ci_check` stores only `updatedAt` — no start and no finish — so nothing here may report how
    // long a check took. Asserted on the SHAPE so a future field cannot smuggle one in.
    expect(Object.keys(merged ?? {}).join(' ')).not.toMatch(/duration|took|elapsed|startedAt/iu)
  })

  it('reports a mixed check set honestly rather than rounding it green', () => {
    const base = eng116()
    const link = base.links?.[0]
    if (link?.pullRequest === undefined || link.pullRequest === null) throw new Error('fixture')
    const input: IssueTimelineInput = {
      ...base,
      links: [
        {
          ...link,
          pullRequest: {
            ...link.pullRequest,
            ciChecks: [
              { conclusion: 'success' },
              { conclusion: 'failure' },
              { conclusion: 'pending' },
            ],
          },
        },
      ],
    }
    expect(latestMoment(buildIssueTimeline(input, NOW), 'merged')).toMatchObject({
      checksPassed: 1,
      checksTotal: 3,
      checksHealth: 'failing',
    })
  })

  it('emits no status-transition moment even when lastHumanStatusAt is set', () => {
    const base = eng116()
    const input = {
      ...base,
      issue: { ...base.issue, lastHumanStatusAt: NOW - 6 * DAY, status: 'in_progress' },
    } as IssueTimelineInput
    const moments = buildIssueTimeline(input, NOW)
    for (const moment of moments) {
      expect(moment.kind).not.toMatch(/status|started|transition/u)
      // The scalar produced nothing: no moment is dated from it.
      expect(moment.at).not.toBe(NOW - 6 * DAY)
    }
  })

  it('emits no review-requested moment', () => {
    for (const moment of buildIssueTimeline(eng116(), NOW)) {
      expect(moment.kind).not.toMatch(/requested/u)
    }
  })

  it('emits nothing but created for a bare issue with no links', () => {
    const moments = buildIssueTimeline(
      { issue: { createdAt: NOW - DAY, creatorId: 'user-priya' } },
      NOW,
    )
    expect(kinds(moments)).toEqual(['created'])
  })

  it('emits no merged moment for an open pull request', () => {
    const base = eng116()
    const link = base.links?.[0]
    if (link?.pullRequest === undefined || link.pullRequest === null) throw new Error('fixture')
    const input: IssueTimelineInput = {
      ...base,
      links: [
        {
          ...link,
          pullRequest: {
            ...link.pullRequest,
            state: 'open',
            mergedAt: null,
            mergeCommitSha: null,
          },
        },
      ],
    }
    expect(kinds(buildIssueTimeline(input, NOW))).not.toContain('merged')
  })

  it('orders same-instant moments by the order the work happens in', () => {
    const moments = buildIssueTimeline(
      {
        issue: { createdAt: NOW, creatorId: 'user-priya', cycleAssignedAt: NOW },
        links: [
          {
            source: 'body',
            createdAt: NOW,
            pullRequest: {
              id: 'pr-1',
              repo: 'acme/payments',
              number: 1,
              state: 'merged',
              openedAt: NOW,
              mergedAt: NOW,
            },
          },
        ],
      },
      NOW,
    )
    expect(kinds(moments)).toEqual(['created', 'planned', 'linked', 'change_opened', 'merged'])
  })
})

describe('the deploy join', () => {
  it('emits the live moment for a deployment carrying the merge commit', () => {
    const input = eng116({
      deployments: [
        {
          repo: 'acme/payments',
          sha: MERGE_SHA,
          deployedAt: NOW - 20 * HOUR,
          environment: 'production',
        },
      ],
    })
    const deployed = latestMoment(buildIssueTimeline(input, NOW), 'deployed')
    expect(deployed).toMatchObject({
      at: NOW - 20 * HOUR,
      sha: MERGE_SHA,
      environment: 'production',
    })
  })

  it('takes the earliest success, not the newest redeploy of the same commit', () => {
    const input = eng116({
      deployments: [
        { repo: 'acme/payments', sha: MERGE_SHA, deployedAt: NOW - HOUR, environment: 'staging' },
        {
          repo: 'acme/payments',
          sha: MERGE_SHA,
          deployedAt: NOW - 20 * HOUR,
          environment: 'production',
        },
      ],
    })
    expect(latestMoment(buildIssueTimeline(input, NOW), 'deployed')?.at).toBe(NOW - 20 * HOUR)
  })

  it('does NOT accept a deployment carrying only the head commit', () => {
    const input = eng116({
      deployments: [
        { repo: 'acme/payments', sha: HEAD_SHA, deployedAt: NOW - HOUR, environment: 'production' },
      ],
    })
    expect(kinds(buildIssueTimeline(input, NOW))).not.toContain('deployed')
  })

  it('does NOT accept a deployment of the same commit in another repo', () => {
    const input = eng116({
      deployments: [
        { repo: 'acme/other', sha: MERGE_SHA, deployedAt: NOW - HOUR, environment: 'production' },
      ],
    })
    expect(kinds(buildIssueTimeline(input, NOW))).not.toContain('deployed')
  })

  it('does NOT accept a deployment that never succeeded', () => {
    const input = eng116({
      deployments: [
        { repo: 'acme/payments', sha: MERGE_SHA, deployedAt: null, environment: 'production' },
      ],
    })
    expect(kinds(buildIssueTimeline(input, NOW))).not.toContain('deployed')
  })
})
