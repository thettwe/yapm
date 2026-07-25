import {
  assembleLinkedEntities,
  computeDeliverySignal,
  computeDivergence,
  type DivergenceKind,
  type IssueLinkRow,
  type IssueStatus,
  type LinkedEntities,
} from '@yapm/schema'
import type { RealityStripProps } from '@yapm/ui/components/issue-row'

// A synced issue's `issueLinks -> pullRequest -> {ciChecks, reviews}` subtree structurally
// satisfies the seam's `IssueLinkRow`; this narrows the loosely-typed Zero result to it.
export type LinkedIssueRow = IssueLinkRow

export interface DeliveryView {
  // The reality-strip props, or null when the issue has no linked git entities (the quiet
  // "not linked" state). `pr`/`ci` are the seam's own string unions, passed straight through.
  readonly strip: RealityStripProps | null
  readonly divergence: DivergenceKind | null
}

// The human sentence the divergence flag announces — the one place status-vs-reality is named
// for the reader. Keyed by the seam's `DivergenceKind`.
export const DIVERGENCE_LABEL: Record<DivergenceKind, string> = {
  status_behind_merge: 'PR merged but this issue is not marked done',
  status_ahead_of_pr: 'Marked in review, but no open PR backs it',
  done_but_ci_failing: 'Marked done, but CI is failing',
}

// Assemble the linked entities for an issue from its raw synced links (empty for an unlinked
// issue). Kept separate so a row can memoize it once and reuse it for both the strip and the
// reality-aware filter's `linkedFor`.
export function linkedEntitiesFor(links: readonly LinkedIssueRow[] | undefined): LinkedEntities {
  return assembleLinkedEntities(links ?? [])
}

// Compute the reality strip + divergence for one issue over its assembled linked entities.
// Pure: routes through the unchanged `computeDeliverySignal`/`computeDivergence` seam.
export function deliveryView(
  issue: { readonly status: IssueStatus },
  linked: LinkedEntities,
): DeliveryView {
  const signal = computeDeliverySignal(issue, linked)
  const divergence = computeDivergence(issue.status, signal)
  if (signal === null) return { strip: null, divergence }
  return {
    strip: { pr: signal.pr, ci: signal.ciHealth, reviewAgeMs: signal.reviewAgeMs },
    divergence,
  }
}
