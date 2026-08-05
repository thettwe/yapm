import { describe, expect, it } from 'vitest'
import type { CiConclusion } from './context.js'
import {
  assembleLinkedEntities,
  ciHealthFromConclusion,
  computeDeliverySignal,
  computeDivergence,
  type IssueLinkRow,
  type LinkedEntities,
  type LinkedPullRequestRow,
  type TeamDeploymentRow,
} from './delivery.js'

const issue = { status: 'todo' } as const

describe('ciHealthFromConclusion', () => {
  it('maps terminal-ok to passing, terminal-bad to failing, non-terminal to pending', () => {
    const cases: [CiConclusion, string][] = [
      ['success', 'passing'],
      ['neutral', 'passing'],
      ['skipped', 'passing'],
      ['failure', 'failing'],
      ['cancelled', 'failing'],
      ['timed_out', 'failing'],
      ['action_required', 'failing'],
      ['pending', 'pending'],
    ]
    for (const [conclusion, health] of cases) {
      expect(ciHealthFromConclusion(conclusion)).toBe(health)
    }
  })
})

describe('computeDeliverySignal', () => {
  it('is null for an unlinked issue (empty or absent linked entities)', () => {
    expect(computeDeliverySignal(issue, {})).toBeNull()
    expect(computeDeliverySignal(issue, { pullRequests: [], ciRuns: [], reviews: [] })).toBeNull()
  })

  it('reflects the latest PR state and rolled-up CI health', () => {
    const linked: LinkedEntities = {
      pullRequests: [
        { state: 'draft', openedAt: 100 },
        { state: 'open', openedAt: 200 },
      ],
      ciRuns: [{ health: 'passing' }, { health: 'failing' }],
    }
    const signal = computeDeliverySignal(issue, linked)
    expect(signal?.pr).toBe('open')
    expect(signal?.ciHealth).toBe('failing')
  })

  it('rolls CI up as failing > pending > passing', () => {
    expect(
      computeDeliverySignal(issue, { ciRuns: [{ health: 'passing' }, { health: 'pending' }] })
        ?.ciHealth,
    ).toBe('pending')
    expect(
      computeDeliverySignal(issue, { ciRuns: [{ health: 'passing' }, { health: 'passing' }] })
        ?.ciHealth,
    ).toBe('passing')
  })

  it('upgrades an open PR to approved when the newest review approves', () => {
    const now = Date.now()
    const signal = computeDeliverySignal(issue, {
      pullRequests: [{ state: 'open', openedAt: now - 10_000 }],
      reviews: [
        { state: 'changes_requested', submittedAt: now - 5_000 },
        { state: 'approved', submittedAt: now - 1_000 },
      ],
    })
    expect(signal?.pr).toBe('approved')
  })

  it('keeps an open PR open when the newest review still requests changes', () => {
    const now = Date.now()
    const signal = computeDeliverySignal(issue, {
      pullRequests: [{ state: 'open', openedAt: now - 10_000 }],
      reviews: [
        { state: 'approved', submittedAt: now - 5_000 },
        { state: 'changes_requested', submittedAt: now - 1_000 },
      ],
    })
    expect(signal?.pr).toBe('open')
  })

  it('derives review age from the newest review, else the PR open time', () => {
    const now = Date.now()
    const withReview = computeDeliverySignal(issue, {
      pullRequests: [{ state: 'open', openedAt: now - 20_000 }],
      reviews: [{ state: 'commented', submittedAt: now - 3_000 }],
    })
    expect(withReview?.reviewAgeMs).toBeGreaterThanOrEqual(3_000)
    expect(withReview?.reviewAgeMs).toBeLessThan(10_000)

    const noReview = computeDeliverySignal(issue, {
      pullRequests: [{ state: 'open', openedAt: now - 8_000 }],
    })
    expect(noReview?.reviewAgeMs).toBeGreaterThanOrEqual(8_000)
  })
})

describe('computeDivergence over real signals', () => {
  it('flags a merged PR under a not-done issue (status_behind_merge)', () => {
    const signal = computeDeliverySignal(
      { status: 'in_progress' },
      { pullRequests: [{ state: 'merged', openedAt: 1 }] },
    )
    expect(computeDivergence('in_progress', signal)).toBe('status_behind_merge')
    expect(computeDivergence('done', signal)).toBeNull()
  })

  it('flags a done issue whose CI is red (done_but_ci_failing)', () => {
    const signal = computeDeliverySignal(
      { status: 'done' },
      { pullRequests: [{ state: 'open', openedAt: 1 }], ciRuns: [{ health: 'failing' }] },
    )
    expect(computeDivergence('done', signal)).toBe('done_but_ci_failing')
  })

  it('flags an in-review issue with no real open PR (status_ahead_of_pr)', () => {
    const draftSignal = computeDeliverySignal(
      { status: 'in_review' },
      { pullRequests: [{ state: 'draft', openedAt: 1 }] },
    )
    expect(computeDivergence('in_review', draftSignal)).toBe('status_ahead_of_pr')
  })

  it('is null when git reality agrees with the human status', () => {
    const signal = computeDeliverySignal(
      { status: 'in_review' },
      { pullRequests: [{ state: 'open', openedAt: 1 }], ciRuns: [{ health: 'passing' }] },
    )
    expect(computeDivergence('in_review', signal)).toBeNull()
  })
})

describe('assembleLinkedEntities', () => {
  it('flattens issue->PR links into the seam input, mapping CI conclusions', () => {
    const links: IssueLinkRow[] = [
      {
        pullRequest: {
          state: 'open',
          openedAt: 500,
          ciChecks: [{ conclusion: 'failure' }, { conclusion: 'success' }],
          reviews: [{ state: 'approved', submittedAt: 600 }],
        },
      },
      { pullRequest: null },
    ]
    const linked = assembleLinkedEntities(links)
    expect(linked.pullRequests).toEqual([{ state: 'open', openedAt: 500 }])
    expect(linked.ciRuns).toEqual([{ health: 'failing' }, { health: 'passing' }])
    expect(linked.reviews).toEqual([{ state: 'approved', submittedAt: 600 }])
  })

  it('produces a null signal for an issue with no links', () => {
    expect(computeDeliverySignal(issue, assembleLinkedEntities([]))).toBeNull()
  })

  it('round-trips through the seam to a real signal', () => {
    const signal = computeDeliverySignal(
      issue,
      assembleLinkedEntities([
        {
          pullRequest: {
            state: 'open',
            openedAt: Date.now() - 1000,
            ciChecks: [{ conclusion: 'success' }],
            reviews: [{ state: 'approved', submittedAt: Date.now() - 500 }],
          },
        },
      ]),
    )
    expect(signal).toEqual({
      pr: 'approved',
      ciHealth: 'passing',
      reviewAgeMs: expect.any(Number),
      deployedAt: null,
    })
  })
})

// The PR->deployment edge: an exact, same-repo match on the merge commit. Both directions in one
// place, plus the three ways a near-match must NOT count.
describe('assembleLinkedEntities — the deployment join', () => {
  const mergedPr = (over: Partial<LinkedPullRequestRow> = {}): IssueLinkRow[] => [
    {
      pullRequest: {
        state: 'merged',
        openedAt: 500,
        repo: 'acme/app',
        mergeCommitSha: 'cafebabe',
        ciChecks: [{ conclusion: 'success' }],
        ...over,
      },
    },
  ]

  const deployedAtOf = (links: IssueLinkRow[], deployments: TeamDeploymentRow[]) =>
    computeDeliverySignal(issue, assembleLinkedEntities(links, deployments))?.deployedAt ?? null

  it('reports the earliest deployment carrying the merge commit', () => {
    expect(
      deployedAtOf(mergedPr(), [
        { repo: 'acme/app', sha: 'cafebabe', deployedAt: 9_000 },
        { repo: 'acme/app', sha: 'cafebabe', deployedAt: 4_000 },
      ]),
    ).toBe(4_000)
  })

  it('reports nothing when no deployment carried that commit', () => {
    expect(deployedAtOf(mergedPr(), [{ repo: 'acme/app', sha: 'other', deployedAt: 4_000 }])).toBe(
      null,
    )
  })

  it('does not count a same-sha deployment in a different repo', () => {
    expect(
      deployedAtOf(mergedPr(), [{ repo: 'acme/other', sha: 'cafebabe', deployedAt: 4_000 }]),
    ).toBe(null)
  })

  it('does not count a deployment that carried the commit but never succeeded', () => {
    expect(
      deployedAtOf(mergedPr(), [{ repo: 'acme/app', sha: 'cafebabe', deployedAt: null }]),
    ).toBe(null)
  })

  it('does not match on the head sha — a deployed branch is not a deployed merge', () => {
    expect(
      deployedAtOf(mergedPr({ mergeCommitSha: null }), [
        { repo: 'acme/app', sha: 'headsha', deployedAt: 4_000 },
      ]),
    ).toBe(null)
  })

  it('does not consider an unmerged PR deployed', () => {
    expect(
      deployedAtOf(mergedPr({ state: 'open' }), [
        { repo: 'acme/app', sha: 'cafebabe', deployedAt: 4_000 },
      ]),
    ).toBe(null)
  })

  it('never manufactures a signal from deployments alone', () => {
    expect(
      computeDeliverySignal(
        issue,
        assembleLinkedEntities([], [{ repo: 'acme/app', sha: 'cafebabe', deployedAt: 4_000 }]),
      ),
    ).toBeNull()
  })

  it('yields the same result as before the deploy axis when the argument is omitted', () => {
    expect(deployedAtOf(mergedPr(), [])).toBe(null)
    expect(assembleLinkedEntities(mergedPr()).deployments).toEqual([])
  })
})
