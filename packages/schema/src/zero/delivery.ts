import type { CiConclusion, IssueStatus, ReviewState } from './context.js'

// The reality strip's typed delivery signal, derived from an issue's linked work-graph
// entities (PR <-> CI run <-> review). The exported shape is fixed and UNCHANGED from
// issue-core; `connectors` (change 8) supplies the linked entities that make it non-null.
export type PrState = 'draft' | 'open' | 'approved' | 'merged' | 'closed'

export type CiHealth = 'passing' | 'failing' | 'pending'

export interface DeliverySignal {
  readonly pr: PrState | null
  readonly ciHealth: CiHealth | null
  readonly reviewAgeMs: number | null
}

// The linked work-graph entities a delivery signal is computed over. Owned by `connectors`;
// empty for an unlinked issue, which is why the signal is null there. The exported seam
// signatures are unchanged — only this input's shape (adding `reviews`) and the function
// bodies below changed when the linked-entity tables landed, exactly as issue-core promised.
export interface LinkedEntities {
  readonly pullRequests?: readonly { readonly state: PrState; readonly openedAt: number }[]
  readonly ciRuns?: readonly { readonly health: CiHealth }[]
  readonly reviews?: readonly { readonly state: ReviewState; readonly submittedAt: number }[]
}

// yapm's defining glyph: fires when the human-set status disagrees with git reality.
export type DivergenceKind = 'status_behind_merge' | 'status_ahead_of_pr' | 'done_but_ci_failing'

interface DeliveryIssue {
  readonly status: IssueStatus
}

// Provider-neutral map from a stored CI conclusion to the strip's three-way health dot.
// A not-yet-terminal run is `pending`; terminal-and-ok (success/neutral/skipped) is
// `passing`; terminal-and-bad (failure/cancelled/timed_out/action_required) is `failing`.
export function ciHealthFromConclusion(conclusion: CiConclusion): CiHealth {
  switch (conclusion) {
    case 'success':
    case 'neutral':
    case 'skipped':
      return 'passing'
    case 'failure':
    case 'cancelled':
    case 'timed_out':
    case 'action_required':
      return 'failing'
    default:
      return 'pending'
  }
}

// Rolls up many checks into one dot: any failing dominates, then any pending, else passing.
function aggregateCiHealth(runs: readonly { readonly health: CiHealth }[]): CiHealth | null {
  if (runs.length === 0) return null
  if (runs.some((run) => run.health === 'failing')) return 'failing'
  if (runs.some((run) => run.health === 'pending')) return 'pending'
  return 'passing'
}

// Pure seam. With no linked entities the signal is null and the reality strip renders its
// quiet "not linked" state. Real linked PRs/CI/reviews now produce a real signal: the latest
// PR's lifecycle state (upgraded to `approved` when the newest review approves an open PR),
// the rolled-up CI health, and the review age (time since the newest review, or — before any
// review — how long the PR has been open awaiting one). Signature UNCHANGED.
export function computeDeliverySignal(
  _issue: DeliveryIssue,
  linked: LinkedEntities,
): DeliverySignal | null {
  const prs = linked.pullRequests ?? []
  const ciRuns = linked.ciRuns ?? []
  const reviews = linked.reviews ?? []
  if (prs.length === 0 && ciRuns.length === 0) return null

  const latestPr = prs.reduce<(typeof prs)[number] | undefined>(
    (latest, pr) => (latest === undefined || pr.openedAt > latest.openedAt ? pr : latest),
    undefined,
  )
  const latestReview = reviews.reduce<(typeof reviews)[number] | undefined>(
    (latest, r) => (latest === undefined || r.submittedAt > latest.submittedAt ? r : latest),
    undefined,
  )

  let pr = latestPr?.state ?? null
  if (pr === 'open' && latestReview?.state === 'approved') pr = 'approved'

  const reviewAgeMs =
    latestReview !== undefined
      ? Date.now() - latestReview.submittedAt
      : latestPr !== undefined
        ? Date.now() - latestPr.openedAt
        : null

  return {
    pr,
    ciHealth: aggregateCiHealth(ciRuns),
    reviewAgeMs,
  }
}

// Fires when the human status disagrees with git reality: a merged PR under a not-done
// issue, a done issue whose CI is red, or an in-review issue with no real open PR behind it.
// A null signal (unlinked issue) yields no divergence. Signature UNCHANGED.
export function computeDivergence(
  status: IssueStatus,
  signal: DeliverySignal | null,
): DivergenceKind | null {
  if (signal === null) return null

  if (signal.pr === 'merged' && status !== 'done' && status !== 'canceled') {
    return 'status_behind_merge'
  }
  if (status === 'done' && signal.ciHealth === 'failing') {
    return 'done_but_ci_failing'
  }
  if (status === 'in_review' && (signal.pr === null || signal.pr === 'draft')) {
    return 'status_ahead_of_pr'
  }
  return null
}

// A linked PR row as reached through the Zero relationship graph off an issue: its lifecycle
// state + open time, and its related checks/reviews. Structural — the synced `.related`
// result satisfies it.
export interface LinkedPullRequestRow {
  readonly state: PrState
  readonly openedAt: number
  readonly ciChecks?: readonly { readonly conclusion: CiConclusion }[]
  readonly reviews?: readonly { readonly state: ReviewState; readonly submittedAt: number }[]
}

export interface IssueLinkRow {
  readonly pullRequest?: LinkedPullRequestRow | null
}

// Assembles a `LinkedEntities` for one issue from its `issueLinks -> pullRequest -> {ciChecks,
// reviews}` related rows, mapping stored CI conclusions to the strip's health dots. This is
// the `connectors`-owned producer the seam consumes; feeding an empty list yields `{}`, i.e.
// the null signal. Pure and provider-neutral.
export function assembleLinkedEntities(links: readonly IssueLinkRow[]): LinkedEntities {
  const pullRequests: { state: PrState; openedAt: number }[] = []
  const ciRuns: { health: CiHealth }[] = []
  const reviews: { state: ReviewState; submittedAt: number }[] = []

  for (const link of links) {
    const pr = link.pullRequest
    if (!pr) continue
    pullRequests.push({ state: pr.state, openedAt: pr.openedAt })
    for (const check of pr.ciChecks ?? []) {
      ciRuns.push({ health: ciHealthFromConclusion(check.conclusion) })
    }
    for (const r of pr.reviews ?? []) {
      reviews.push({ state: r.state, submittedAt: r.submittedAt })
    }
  }

  return { pullRequests, ciRuns, reviews }
}
