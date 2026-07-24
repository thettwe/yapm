import type { IssueStatus } from './context.js'

// The reality strip's typed delivery signal, derived from an issue's linked work-graph
// entities (PR ↔ CI run ↔ deploy). The shape is fixed now so the row renders against it;
// `connectors` (change 8) supplies the linked entities that make it non-null.
export type PrState = 'draft' | 'open' | 'approved' | 'merged' | 'closed'

export type CiHealth = 'passing' | 'failing' | 'pending'

export interface DeliverySignal {
  readonly pr: PrState | null
  readonly ciHealth: CiHealth | null
  readonly reviewAgeMs: number | null
}

// The linked work-graph entities a delivery signal is computed over. Owned by `connectors`;
// empty in issue-core, which is why the signal is always null here.
export interface LinkedEntities {
  readonly pullRequests?: readonly { readonly state: PrState; readonly openedAt: number }[]
  readonly ciRuns?: readonly { readonly health: CiHealth }[]
}

// yapm's defining glyph: fires when the human-set status disagrees with git reality.
export type DivergenceKind = 'status_behind_merge' | 'status_ahead_of_pr' | 'done_but_ci_failing'

interface DeliveryIssue {
  readonly status: IssueStatus
}

// Pure seam. With no linked entities (issue-core) the signal is always null and the reality
// strip renders its quiet "not linked" state. When `connectors` lands the linked-entity
// tables, only this function's body and its `linked` input change — rows, queries, and the
// filter model are untouched.
export function computeDeliverySignal(
  _issue: DeliveryIssue,
  linked: LinkedEntities,
): DeliverySignal | null {
  const prs = linked.pullRequests ?? []
  const ciRuns = linked.ciRuns ?? []
  if (prs.length === 0 && ciRuns.length === 0) return null

  const latestPr = prs.reduce<(typeof prs)[number] | undefined>(
    (latest, pr) => (latest === undefined || pr.openedAt > latest.openedAt ? pr : latest),
    undefined,
  )

  return {
    pr: latestPr?.state ?? null,
    ciHealth: ciRuns.at(-1)?.health ?? null,
    reviewAgeMs: latestPr === undefined ? null : Date.now() - latestPr.openedAt,
  }
}

// Dormant in issue-core: a null signal yields no divergence regardless of the human status.
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
