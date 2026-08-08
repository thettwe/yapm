import type { CiConclusion, ConnectorLinkSource, PullRequestState, ReviewState } from './context.js'
import {
  assembleLinkedEntities,
  buildDeploymentIndex,
  type CiHealth,
  ciHealthFromConclusion,
  type TeamDeploymentRow,
} from './delivery.js'

// THE ONE DERIVATION the issue detail's rail and its activity feed both read. Two derivations of
// "when did this merge" is how one page ends up dating one moment two ways, which is the same
// failure the shared phrase dictionary exists to prevent on the wording axis.
//
// The rule that governs every kind below: A MOMENT IS EMITTED IFF A DURABLE TIMESTAMP SUPPORTS IT.
// Three things therefore cannot exist in this file, and each absence is a mock element that does
// not ship:
//
//   1. NO STATUS-TRANSITION MOMENT OF ANY KIND. `issue.lastHumanStatusAt` is a single scalar: it
//      says when a human last set a status, not which status and not what it was before. There is
//      no issue status-history table. "Work started · board todo → in-progress" is two claims the
//      scalar cannot make, so the timeline never makes them; the scalar is used only where it is
//      honest, as ONE SIDE of the divergence contrast the callout draws.
//   2. NO REVIEW-REQUESTED MOMENT. There is no such event anywhere in the work graph, so "waiting
//      on a reviewer since X" is indistinguishable from "this PR has been open since X".
//   3. NO CHECK DURATION. `ci_check` carries only `updatedAt` — no start and no finish. The age of
//      a check is derivable from a timestamp; "checks took 4m" is not derivable from anything.
//
// Strings never appear here beyond the enum kinds themselves: a surface phrases these; the
// derivation only decides what is true.

export const ISSUE_MOMENT_KINDS = [
  'created',
  'planned',
  'linked',
  'change_opened',
  'reviewed',
  'merged',
  'deployed',
] as const

export type IssueMomentKind = (typeof ISSUE_MOMENT_KINDS)[number]

interface MomentBase {
  readonly at: number
  // Milliseconds behind `now`, computed from the SAME clock for every moment on the page, so two
  // fact lines describing one timeline can never disagree about how long ago something happened.
  readonly ageMs: number
}

export interface IssueCreatedMoment extends MomentBase {
  readonly kind: 'created'
  readonly creatorId: string
}

export interface IssuePlannedMoment extends MomentBase {
  readonly kind: 'planned'
  readonly cycleId: string | null
  readonly cycleName: string | null
  readonly cycleNumber: number | null
  readonly cycleStartDate: number | null
  readonly cycleEndDate: number | null
  readonly carryoverCount: number
}

export interface IssueLinkedMoment extends MomentBase {
  readonly kind: 'linked'
  readonly source: ConnectorLinkSource
  readonly pullRequestId: string | null
  readonly repo: string | null
  readonly number: number | null
  readonly url: string | null
}

export interface IssueChangeOpenedMoment extends MomentBase {
  readonly kind: 'change_opened'
  readonly pullRequestId: string | null
  readonly repo: string | null
  readonly number: number | null
  readonly url: string | null
  readonly title: string | null
  readonly state: PullRequestState
  // The commit the branch was at. NOT a branch name and NOT a base ref: `pull_request` stores
  // neither, so the mock's "eng-116-apple-pay → main" has nothing behind it and no field here
  // pretends otherwise.
  readonly headSha: string | null
}

export interface IssueReviewedMoment extends MomentBase {
  readonly kind: 'reviewed'
  readonly pullRequestId: string | null
  readonly state: ReviewState
  readonly author: string | null
  // 1-based position among this pull request's reviews in submission order, and the total. The
  // rail draws one Reviewed station, so the last review has to carry the whole shape of the
  // exchange ("changes requested, then approved") without the surface re-deriving it.
  readonly round: number
  readonly rounds: number
  readonly latestState: ReviewState
}

export interface IssueMergedMoment extends MomentBase {
  readonly kind: 'merged'
  readonly pullRequestId: string | null
  readonly repo: string | null
  readonly number: number | null
  readonly mergeCommitSha: string | null
  // All four counts, because `total - passed` is NOT the failing count: a check that has not
  // reported yet is neither passed nor failed, and a surface left to subtract would call every
  // pending check a failure. `passed + failing + pending === total`.
  readonly checksPassed: number
  readonly checksFailing: number
  readonly checksPending: number
  readonly checksTotal: number
  readonly checksHealth: CiHealth | null
}

export interface IssueDeployedMoment extends MomentBase {
  readonly kind: 'deployed'
  readonly pullRequestId: string | null
  readonly repo: string | null
  readonly sha: string | null
  readonly environment: string | null
}

export type IssueMoment =
  | IssueCreatedMoment
  | IssuePlannedMoment
  | IssueLinkedMoment
  | IssueChangeOpenedMoment
  | IssueReviewedMoment
  | IssueMergedMoment
  | IssueDeployedMoment

export interface IssueTimelineIssueRow {
  readonly createdAt: number
  readonly creatorId: string
  readonly cycleAssignedAt?: number | null
  readonly cycleId?: string | null
  readonly carryoverCount?: number | null
}

export interface IssueTimelineCycleRow {
  readonly id: string
  readonly name: string
  readonly number?: number | null
  readonly startDate?: number | null
  readonly endDate?: number | null
}

export interface IssueTimelineReviewRow {
  readonly state: ReviewState
  readonly submittedAt: number
  readonly author?: string | null
}

export interface IssueTimelinePullRequestRow {
  readonly id?: string | null
  readonly repo?: string | null
  readonly number?: number | null
  readonly url?: string | null
  readonly title?: string | null
  readonly state: PullRequestState
  readonly openedAt: number
  readonly mergedAt?: number | null
  readonly headSha?: string | null
  readonly mergeCommitSha?: string | null
  readonly ciChecks?: readonly { readonly conclusion: CiConclusion }[]
  readonly reviews?: readonly IssueTimelineReviewRow[]
}

export interface IssueTimelineLinkRow {
  readonly pullRequestId?: string | null
  readonly source: ConnectorLinkSource
  readonly createdAt: number
  readonly pullRequest?: IssueTimelinePullRequestRow | null
}

// A team deployment row plus the one extra column the rail names. Structural, so the synced
// `deployments.byTeam` result satisfies it without a mapping step.
export interface IssueTimelineDeploymentRow extends TeamDeploymentRow {
  readonly environment?: string | null
}

export interface IssueTimelineInput {
  readonly issue: IssueTimelineIssueRow
  readonly links?: readonly IssueTimelineLinkRow[]
  readonly deployments?: readonly IssueTimelineDeploymentRow[]
  // The cycle the issue is assigned to, when it is synced. Absent only leaves the planned moment
  // without a name; it never suppresses the moment, because `cycleAssignedAt` is the durable fact.
  readonly cycle?: IssueTimelineCycleRow | null
}

// Ordering within one instant. Two rows can share a millisecond (a seeded fixture, a batched
// ingest), and a rail that drew "merged" above "change opened" would be lying about causality for
// free, so equal timestamps fall back to the order the work actually happens in.
const KIND_RANK: Record<IssueMomentKind, number> = {
  created: 0,
  planned: 1,
  linked: 2,
  change_opened: 3,
  reviewed: 4,
  merged: 5,
  deployed: 6,
}

function checkCounts(checks: readonly { readonly conclusion: CiConclusion }[]): {
  passed: number
  failing: number
  pending: number
  total: number
  health: CiHealth | null
} {
  let passed = 0
  let failing = 0
  let pending = 0
  for (const check of checks) {
    const health = ciHealthFromConclusion(check.conclusion)
    if (health === 'passing') passed += 1
    else if (health === 'failing') failing += 1
    else pending += 1
  }
  const total = checks.length
  const health: CiHealth | null =
    total === 0 ? null : failing > 0 ? 'failing' : pending > 0 ? 'pending' : 'passing'
  return { passed, failing, pending, total, health }
}

// Pure and ordered. O(links + reviews + checks + deployments) for one issue, so a page can memoize
// it on the row's identity and stay inside its interaction budget.
export function buildIssueTimeline(
  { issue, links = [], deployments = [], cycle }: IssueTimelineInput,
  now: number = Date.now(),
): readonly IssueMoment[] {
  const moments: IssueMoment[] = []
  const at = (value: number) => ({ at: value, ageMs: now - value })

  moments.push({ kind: 'created', ...at(issue.createdAt), creatorId: issue.creatorId })

  if (issue.cycleAssignedAt != null) {
    // The cycle row is only allowed to name this moment when it IS the cycle the issue sits in.
    // A stale row from a previous assignment would date a real moment with the wrong cycle.
    const named = cycle != null && (issue.cycleId == null || cycle.id === issue.cycleId)
    moments.push({
      kind: 'planned',
      ...at(issue.cycleAssignedAt),
      cycleId: issue.cycleId ?? null,
      cycleName: named ? cycle.name : null,
      cycleNumber: named ? (cycle.number ?? null) : null,
      cycleStartDate: named ? (cycle.startDate ?? null) : null,
      cycleEndDate: named ? (cycle.endDate ?? null) : null,
      carryoverCount: issue.carryoverCount ?? 0,
    })
  }

  // The deploy join is the deploy-history-edge join and nothing else: same repo, a merged pull
  // request's `mergeCommitSha` against a deployment's `sha`, earliest success wins. NO `headSha`
  // fallback — a deploy carrying the head commit shipped the branch, not the merge.
  const deployIndex = buildDeploymentIndex(deployments)

  for (const link of links) {
    const pr = link.pullRequest ?? null
    const pullRequestId = pr?.id ?? link.pullRequestId ?? null

    moments.push({
      kind: 'linked',
      ...at(link.createdAt),
      source: link.source,
      pullRequestId,
      repo: pr?.repo ?? null,
      number: pr?.number ?? null,
      url: pr?.url ?? null,
    })

    if (pr === null) continue

    moments.push({
      kind: 'change_opened',
      ...at(pr.openedAt),
      pullRequestId,
      repo: pr.repo ?? null,
      number: pr.number ?? null,
      url: pr.url ?? null,
      title: pr.title ?? null,
      state: pr.state,
      headSha: pr.headSha ?? null,
    })

    const reviews = [...(pr.reviews ?? [])].sort((a, b) => a.submittedAt - b.submittedAt)
    const latestState = reviews.at(-1)?.state
    reviews.forEach((review, index) => {
      if (latestState === undefined) return
      moments.push({
        kind: 'reviewed',
        ...at(review.submittedAt),
        pullRequestId,
        state: review.state,
        author: review.author ?? null,
        round: index + 1,
        rounds: reviews.length,
        latestState,
      })
    })

    if (pr.mergedAt != null) {
      const counts = checkCounts(pr.ciChecks ?? [])
      moments.push({
        kind: 'merged',
        ...at(pr.mergedAt),
        pullRequestId,
        repo: pr.repo ?? null,
        number: pr.number ?? null,
        mergeCommitSha: pr.mergeCommitSha ?? null,
        checksPassed: counts.passed,
        checksFailing: counts.failing,
        checksPending: counts.pending,
        checksTotal: counts.total,
        checksHealth: counts.health,
      })
    }

    // The join itself is `assembleLinkedEntities`, called with the same prebuilt index — not a
    // second copy of its rule. Writing the `repo + sha` lookup out again here would be one more
    // place for the `headSha` fallback to creep back in, and one more key format to keep in step.
    const deployedAt = assembleLinkedEntities([link], deployIndex).pullRequests?.[0]?.deployedAt
    if (deployedAt == null) continue
    // The join decided WHETHER and WHEN; the row is re-found only to name the environment, which
    // the index does not carry.
    const row = deployments.find(
      (deploy) =>
        deploy.deployedAt === deployedAt &&
        deploy.repo === pr.repo &&
        deploy.sha === pr.mergeCommitSha,
    )
    moments.push({
      kind: 'deployed',
      ...at(deployedAt),
      pullRequestId,
      repo: pr.repo ?? null,
      sha: pr.mergeCommitSha ?? null,
      environment: row?.environment ?? null,
    })
  }

  return moments
    .map((moment, index) => ({ moment, index }))
    .sort(
      (a, b) =>
        a.moment.at - b.moment.at ||
        KIND_RANK[a.moment.kind] - KIND_RANK[b.moment.kind] ||
        a.index - b.index,
    )
    .map((entry) => entry.moment)
}

// The last moment of a kind, which is what every station on the rail wants: the newest review
// carries the round count, the newest merge carries the check counts. Kept beside the derivation
// so a surface does not grow its own scan (and pick a different tie-break).
export function latestMoment<TKind extends IssueMomentKind>(
  moments: readonly IssueMoment[],
  kind: TKind,
): Extract<IssueMoment, { kind: TKind }> | null {
  for (let index = moments.length - 1; index >= 0; index -= 1) {
    const moment = moments[index]
    if (moment !== undefined && moment.kind === kind) {
      return moment as Extract<IssueMoment, { kind: TKind }>
    }
  }
  return null
}
