import {
  assembleLinkedEntities,
  computeDeliverySignal,
  computeDivergence,
  type DeliveryStrip,
  type DeploymentIndex,
  type DivergenceKind,
  type IssueLinkRow,
  type IssueStatus,
  type LinkedEntities,
  type RestPhrase,
  sayRestPhrase,
  type TeamDeploymentRow,
} from '@yapm/schema'

// A synced issue's `issueLinks -> pullRequest -> {ciChecks, reviews}` subtree structurally
// satisfies the seam's `IssueLinkRow`; this narrows the loosely-typed Zero result to it.
export type LinkedIssueRow = IssueLinkRow

export interface DeliveryView {
  // The four drawn facts, or null when the issue has no linked git entities (the quiet
  // "not linked" state). `pr`/`ci` are the seam's own string unions, passed straight through.
  readonly strip: DeliveryStrip | null
  readonly divergence: DivergenceKind | null
  // What the row says at rest, from the shared dictionary's neutral register. Derived from the
  // SAME signal the track is drawn from — one `computeDeliverySignal` per row, never two.
  readonly phrase: RestPhrase
  // WHICH linked change the phrase and the strip above describe. Passed through so a surface that
  // draws a second register over the same issue narrows to that change instead of picking its own.
  readonly pullRequestId: string | null
}

// The human sentence the `//` break carries — the one place status-vs-reality is named for the
// reader. Keyed by the seam's `DivergenceKind`.
export const DIVERGENCE_LABEL: Record<DivergenceKind, string> = {
  status_behind_merge: 'PR merged but this issue is not marked done',
  status_ahead_of_pr: 'Marked in review, but no open PR backs it',
  done_but_ci_failing: 'Marked done, but CI is failing',
}

// Assemble the linked entities for an issue from its raw synced links (empty for an unlinked
// issue). Kept separate so a row can memoize it once and reuse it for both the strip and the
// reality-aware filter's `linkedFor`. `deployments` is the whole team's deployment rows — the same
// data for every row, so a LIST passes the pre-built `DeploymentIndex` (one pass over the team's
// deployments, shared by every row) and a single-issue surface can pass the raw array.
export function linkedEntitiesFor(
  links: readonly LinkedIssueRow[] | undefined,
  deployments?: readonly TeamDeploymentRow[] | DeploymentIndex,
): LinkedEntities {
  return assembleLinkedEntities(links ?? [], deployments)
}

// Compute the reality strip + divergence for one issue over its assembled linked entities.
// Pure: routes through the unchanged `computeDeliverySignal`/`computeDivergence` seam.
export function deliveryView(
  issue: { readonly status: IssueStatus },
  linked: LinkedEntities,
): DeliveryView {
  const signal = computeDeliverySignal(issue, linked)
  const divergence = computeDivergence(issue.status, signal)
  const phrase = sayRestPhrase(issue.status, signal, divergence, 'neutral')
  if (signal === null) return { strip: null, divergence, phrase, pullRequestId: null }
  return {
    phrase,
    pullRequestId: signal.pullRequestId,
    strip: {
      pr: signal.pr,
      ci: signal.ciHealth,
      reviewAgeMs: signal.reviewAgeMs,
      reviewAgeFrom: signal.reviewAgeFrom,
      deployedAt: signal.deployedAt,
    },
    divergence,
  }
}
