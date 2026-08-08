import type { CiConclusion, IssueStatus, ReviewState } from './context.js'

// The reality strip's typed delivery signal, derived from an issue's linked work-graph
// entities (PR <-> CI run <-> review <-> deployment). What issue-core actually fixed is the two
// exported FUNCTION signatures — `computeDeliverySignal(issue, linked)` and
// `computeDivergence(status, signal)` — and both are unchanged. The value they pass between them
// has grown twice: `reviews` when the linked-entity tables landed, and now `deployedAt`, taking up
// the deferral `connectors` design decision 4 recorded ("a per-issue/per-team deployment query is
// deferred to the UI phase"). See deploy-history-edge design §D4.
export type PrState = 'draft' | 'open' | 'approved' | 'merged' | 'closed'

export type CiHealth = 'passing' | 'failing' | 'pending'

// Which clock `reviewAgeMs` measures. There is no review-requested event, so the fallback to the
// pull request's open time is not a review at all — and a surface that announced both as "reviewed
// Nd ago" would be claiming a review that never happened. Null when there is no age to measure.
export type ReviewAgeSource = 'review' | 'pr-open'

export interface DeliverySignal {
  readonly pr: PrState | null
  readonly ciHealth: CiHealth | null
  readonly reviewAgeMs: number | null
  readonly reviewAgeFrom: ReviewAgeSource | null
  // The moment this change first reached production: the earliest `deployedAt` among deployments
  // carrying a linked merged PR's merge commit. Null when nothing carried it — which includes the
  // batched-deploy case §D3 chose to over-report rather than guess at.
  readonly deployedAt: number | null
}

// The four facts every reality drawing may show, and no others: PR state, CI health, review age,
// and the deploy join. One shape for every surface — the list row's track, the team home's rows,
// the issue detail's rail — so a second, incompatible strip type cannot be declared beside it.
// Two limits ride along with it and are never papered over: `ci_check` carries no start/finish
// time (only `updatedAt`), so a duration for a check run is not derivable; and there is no
// review-requested event, so `reviewAgeMs` falls back to the PR's open time and nothing drawn
// from it may claim a reviewer has been waiting.
export interface DeliveryStrip {
  readonly pr: PrState | null
  readonly ci: CiHealth | null
  readonly reviewAgeMs: number | null
  // Optional so a surface that has no clock to report (a class row summarising N issues) may omit
  // it; a drawing given an age but no source states the age neutrally rather than naming a review.
  readonly reviewAgeFrom?: ReviewAgeSource | null
  readonly deployedAt: number | null
}

// The linked work-graph entities a delivery signal is computed over. Owned by `connectors`;
// empty for an unlinked issue, which is why the signal is null there. `deployments` is optional,
// so every caller that predates the deploy axis keeps compiling and keeps its result.
export interface LinkedEntities {
  readonly pullRequests?: readonly {
    readonly state: PrState
    readonly openedAt: number
    // The earliest deployment that carried THIS pull request's merge commit, or null when none
    // did. Keyed per pull request rather than rolled up onto the issue: the deploy axis reports the
    // NEWEST MERGED pull request, so a deploy axis flattened over every linked one would let an
    // older, shipped change vouch for a newer merge that never shipped — the strip would claim
    // "Deployed" and `merged-not-deployed` would hide the row. `undefined` means the producer did
    // not key deployments at all, and the flat `deployments` list below is read instead.
    readonly deployedAt?: number | null
  }[]
  readonly ciRuns?: readonly { readonly health: CiHealth }[]
  readonly reviews?: readonly { readonly state: ReviewState; readonly submittedAt: number }[]
  readonly deployments?: readonly { readonly deployedAt: number }[]
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

// The EARLIEST of a flat list: the moment the change first reached production, not the most recent
// redeploy of the same commit. Only read for callers that hand over an issue-level list rather
// than per-pull-request timestamps.
function earliestDeployedAt(
  deployments: readonly { readonly deployedAt: number }[],
): number | null {
  return deployments.reduce<number | null>(
    (earliest, deploy) =>
      earliest === null || deploy.deployedAt < earliest ? deploy.deployedAt : earliest,
    null,
  )
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
// review — how long the PR has been open awaiting one). Signature extended ADDITIVELY with an
// optional clock: every existing caller keeps wall-clock behavior, while a caller that must be
// deterministic under test (`buildTeamHome`) passes its own `now`.
export function computeDeliverySignal(
  _issue: DeliveryIssue,
  linked: LinkedEntities,
  now = Date.now(),
): DeliverySignal | null {
  const prs = linked.pullRequests ?? []
  const ciRuns = linked.ciRuns ?? []
  const reviews = linked.reviews ?? []
  // Unchanged on purpose: a deployment alone never manufactures a signal for an issue with no
  // linked PR. Deployments are repo-anchored, so without a PR there is nothing tying one to
  // this issue.
  if (prs.length === 0 && ciRuns.length === 0) return null

  const latestPr = prs.reduce<(typeof prs)[number] | undefined>(
    (latest, pr) => (latest === undefined || pr.openedAt > latest.openedAt ? pr : latest),
    undefined,
  )
  // Only a merged pull request can have shipped, so the deploy axis reads the newest MERGED one.
  // Keying it to `latestPr` instead would let any later unmerged link — a follow-up, a revert, a
  // stacked PR, a body reference — unclaim a deployment that provably happened.
  const latestMergedPr = prs
    .filter((pr) => pr.state === 'merged')
    .reduce<(typeof prs)[number] | undefined>(
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
      ? now - latestReview.submittedAt
      : latestPr !== undefined
        ? now - latestPr.openedAt
        : null
  const reviewAgeFrom: ReviewAgeSource | null =
    latestReview !== undefined ? 'review' : latestPr !== undefined ? 'pr-open' : null

  // The deploy axis reads the newest MERGED pull request. A producer that keys deployments per pull
  // request (`assembleLinkedEntities`) always sets the field, so a `null` there means "this change
  // did not ship" and must not be replaced by an older linked PR's deployment. `undefined` means
  // the caller handed over an issue-level list instead, which still rolls up to the earliest.
  const perPr = latestMergedPr === undefined ? undefined : latestMergedPr.deployedAt
  const deployedAt = perPr !== undefined ? perPr : earliestDeployedAt(linked.deployments ?? [])

  return {
    pr,
    ciHealth: aggregateCiHealth(ciRuns),
    reviewAgeMs,
    reviewAgeFrom,
    deployedAt,
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
// state + open time, its merge commit + repo (the deployment join's two keys), and its related
// checks/reviews. Structural — the synced `.related` result satisfies it.
export interface LinkedPullRequestRow {
  readonly state: PrState
  readonly openedAt: number
  readonly repo?: string | null
  readonly mergeCommitSha?: string | null
  readonly ciChecks?: readonly { readonly conclusion: CiConclusion }[]
  readonly reviews?: readonly { readonly state: ReviewState; readonly submittedAt: number }[]
}

export interface IssueLinkRow {
  readonly pullRequest?: LinkedPullRequestRow | null
}

// One team-scoped deployment row, as the `deployments.byTeam` synced query returns it. Structural,
// so the query result satisfies it without a mapping step.
export interface TeamDeploymentRow {
  readonly repo: string
  readonly sha?: string | null
  readonly deployedAt?: number | null
}

// The §D3 join in index form: `repo + sha -> the earliest moment a deployment carrying that commit
// succeeded`. Built ONCE per team deployment list, so a list of N issues costs O(deployments +
// issues) rather than rescanning the team's whole deploy history per row — the cost design §Risks
// promises ("a single pass over the team's deployments, not one per row").
export type DeploymentIndex = ReadonlyMap<string, number>

// A space separator, because neither a repo full name (`owner/name`) nor a git sha can contain
// one — so two distinct (repo, sha) pairs can never collide into a single key.
function deploymentKey(repo: string, sha: string): string {
  return `${repo} ${sha}`
}

export function buildDeploymentIndex(deployments: readonly TeamDeploymentRow[]): DeploymentIndex {
  const index = new Map<string, number>()
  for (const deploy of deployments) {
    // A deployment that carries the commit but never succeeded is not a deployment of it, and one
    // whose commit was never recorded (every row predating the deploy-history migration) cannot be
    // joined to anything.
    if (deploy.deployedAt == null || !deploy.sha) continue
    const key = deploymentKey(deploy.repo, deploy.sha)
    const earliest = index.get(key)
    if (earliest === undefined || deploy.deployedAt < earliest) index.set(key, deploy.deployedAt)
  }
  return index
}

function isDeploymentIndex(
  value: readonly TeamDeploymentRow[] | DeploymentIndex,
): value is DeploymentIndex {
  return typeof (value as DeploymentIndex).get === 'function'
}

// Assembles a `LinkedEntities` for one issue from its `issueLinks -> pullRequest -> {ciChecks,
// reviews}` related rows, mapping stored CI conclusions to the strip's health dots. This is
// the `connectors`-owned producer the seam consumes; feeding an empty list yields `{}`, i.e.
// the null signal. Pure and provider-neutral.
//
// `deployments` is the team's deployment rows — or the same rows pre-indexed by
// `buildDeploymentIndex`, which is what a list of many issues passes so the index is built once
// instead of per row. Optional: omitting it yields exactly today's result. The join is exact and
// same-repo — a merged PR's `mergeCommitSha` against a deployment's `sha` — with NO `headSha`
// fallback: a deploy carrying the head commit deployed the branch, not the merge, and matching it
// would reintroduce the false-positive class design §D3 rejects. The match is recorded ON the pull
// request that produced it, never flattened to the issue.
export function assembleLinkedEntities(
  links: readonly IssueLinkRow[],
  deployments?: readonly TeamDeploymentRow[] | DeploymentIndex,
): LinkedEntities {
  const index =
    deployments === undefined
      ? undefined
      : isDeploymentIndex(deployments)
        ? deployments
        : buildDeploymentIndex(deployments)
  const pullRequests: { state: PrState; openedAt: number; deployedAt: number | null }[] = []
  const ciRuns: { health: CiHealth }[] = []
  const reviews: { state: ReviewState; submittedAt: number }[] = []
  const deployed: { deployedAt: number }[] = []

  for (const link of links) {
    const pr = link.pullRequest
    if (!pr) continue
    const deployedAt =
      index !== undefined && pr.state === 'merged' && pr.mergeCommitSha && pr.repo
        ? (index.get(deploymentKey(pr.repo, pr.mergeCommitSha)) ?? null)
        : null
    pullRequests.push({ state: pr.state, openedAt: pr.openedAt, deployedAt })
    for (const check of pr.ciChecks ?? []) {
      ciRuns.push({ health: ciHealthFromConclusion(check.conclusion) })
    }
    for (const r of pr.reviews ?? []) {
      reviews.push({ state: r.state, submittedAt: r.submittedAt })
    }
    if (deployedAt !== null) deployed.push({ deployedAt })
  }

  return { pullRequests, ciRuns, reviews, deployments: deployed }
}
