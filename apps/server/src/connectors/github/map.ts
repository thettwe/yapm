import {
  type CiConclusion,
  DEPLOYMENT_STATES,
  type DeploymentState,
  newId,
  type PullRequestState,
  parseIssueRefs,
  type ReviewState,
  type WorkGraphMutation,
} from '@yapm/schema'
import type {
  CheckRunEvent,
  CheckSuiteEvent,
  DeploymentStatusEvent,
  GithubPullRequest,
  PullRequestEvent,
  PullRequestReviewEvent,
} from './payloads.js'

export const GITHUB_PROVIDER = 'github'

function toEpochMs(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

// The raw PR lifecycle: a merged PR is `closed` with `merged`/`merged_at` set, which is the
// load-bearing merged-vs-just-closed distinction for the reality strip. `approved` is NOT a
// stored PR state — it is review-derived in `computeDeliverySignal`.
export function derivePrState(pr: GithubPullRequest): PullRequestState {
  if (pr.merged === true || (pr.merged_at ?? null) !== null) return 'merged'
  if (pr.state === 'closed') return 'closed'
  if (pr.draft === true) return 'draft'
  return 'open'
}

const REVIEW_STATE_MAP: Record<string, ReviewState> = {
  approved: 'approved',
  changes_requested: 'changes_requested',
  dismissed: 'dismissed',
  commented: 'commented',
}

export function mapReviewState(raw: string): ReviewState {
  return REVIEW_STATE_MAP[raw.toLowerCase()] ?? 'commented'
}

// A check is `pending` until GitHub reports `status: completed`; then its `conclusion` maps
// across. GitHub's `stale` (and any unknown/`null` conclusion) folds into `pending`.
export function mapCiConclusion(
  status: string,
  conclusion: string | null | undefined,
): CiConclusion {
  if (status !== 'completed') return 'pending'
  switch (conclusion) {
    case 'success':
    case 'failure':
    case 'neutral':
    case 'cancelled':
    case 'skipped':
    case 'timed_out':
    case 'action_required':
      return conclusion
    default:
      return 'pending'
  }
}

const DEPLOYMENT_STATE_SET = new Set<string>(DEPLOYMENT_STATES)

export function mapDeploymentState(raw: string): DeploymentState {
  return (DEPLOYMENT_STATE_SET.has(raw) ? raw : 'pending') as DeploymentState
}

// `installationKey` is the provider's external installation id; the worker rewrites it to the
// internal `connector_installation` id before the mutation reaches the write path.
function pullRequestMutation(
  pr: GithubPullRequest,
  repo: string,
  installationKey: string,
  now: number,
): WorkGraphMutation {
  return {
    kind: 'upsertPullRequest',
    id: newId(),
    installationId: installationKey,
    provider: GITHUB_PROVIDER,
    repo,
    number: pr.number,
    externalId: String(pr.id),
    title: pr.title ?? null,
    state: derivePrState(pr),
    url: pr.html_url ?? null,
    headSha: pr.head?.sha ?? null,
    openedAt: toEpochMs(pr.created_at, now),
    mergedAt: pr.merged_at ? toEpochMs(pr.merged_at, now) : null,
    updatedAt: toEpochMs(pr.updated_at, now),
    issueRefs: parseIssueRefs({ branch: pr.head?.ref, body: pr.body }),
  }
}

function checkMutation(
  installationKey: string,
  prExternalId: string,
  externalId: string,
  name: string | null,
  status: string,
  conclusion: string | null | undefined,
  headSha: string | null,
  sourceUpdatedAt: number,
): WorkGraphMutation {
  return {
    kind: 'upsertCiCheck',
    id: newId(),
    installationId: installationKey,
    provider: GITHUB_PROVIDER,
    prExternalId,
    externalId,
    name,
    conclusion: mapCiConclusion(status, conclusion),
    headSha,
    sourceUpdatedAt,
  }
}

// Maps a single verified webhook payload to provider-neutral work-graph mutations. Pure and
// offline — no octokit call — so the whole event set is fixture-testable. Events yapm does not
// model as work-graph edges (`push`, `status`, `issues`, and the `installation*` lifecycle,
// which the worker handles out of band) yield an empty list.
export function mapGithubEvent(
  eventType: string,
  payload: unknown,
  installationKey: string,
  now: number,
): WorkGraphMutation[] {
  switch (eventType) {
    case 'pull_request': {
      const event = payload as PullRequestEvent
      return [
        pullRequestMutation(event.pull_request, event.repository.full_name, installationKey, now),
      ]
    }
    case 'pull_request_review': {
      const event = payload as PullRequestReviewEvent
      return [
        {
          kind: 'upsertReview',
          id: newId(),
          installationId: installationKey,
          provider: GITHUB_PROVIDER,
          prExternalId: String(event.pull_request.id),
          externalId: String(event.review.id),
          author: event.review.user?.login ?? null,
          state: mapReviewState(event.review.state),
          submittedAt: toEpochMs(event.review.submitted_at, now),
        },
      ]
    }
    case 'check_run': {
      const event = payload as CheckRunEvent
      const prId = event.check_run.pull_requests?.[0]?.id
      if (prId === undefined) return []
      return [
        checkMutation(
          installationKey,
          String(prId),
          String(event.check_run.id),
          event.check_run.name ?? null,
          event.check_run.status,
          event.check_run.conclusion,
          event.check_run.head_sha ?? null,
          toEpochMs(event.check_run.completed_at ?? event.check_run.started_at, now),
        ),
      ]
    }
    case 'check_suite': {
      const event = payload as CheckSuiteEvent
      const prId = event.check_suite.pull_requests?.[0]?.id
      if (prId === undefined) return []
      return [
        checkMutation(
          installationKey,
          String(prId),
          String(event.check_suite.id),
          null,
          event.check_suite.status,
          event.check_suite.conclusion,
          event.check_suite.head_sha ?? null,
          toEpochMs(event.check_suite.updated_at, now),
        ),
      ]
    }
    case 'deployment_status': {
      const event = payload as DeploymentStatusEvent
      return [
        {
          kind: 'upsertDeployment',
          id: newId(),
          installationId: installationKey,
          provider: GITHUB_PROVIDER,
          repo: event.repository.full_name,
          externalId: String(event.deployment.id),
          ref: event.deployment.ref ?? null,
          environment: event.deployment_status.environment ?? event.deployment.environment ?? null,
          state: mapDeploymentState(event.deployment_status.state),
          sourceUpdatedAt: toEpochMs(
            event.deployment_status.updated_at ?? event.deployment_status.created_at,
            now,
          ),
        },
      ]
    }
    default:
      return []
  }
}
