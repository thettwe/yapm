import * as z from 'zod'
import { matchesSearchText } from '../search/score.js'
import {
  ISSUE_GROUPINGS,
  ISSUE_PRIORITIES,
  ISSUE_SORT_KEYS,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueSortKey,
  type IssueStatus,
  type SortDirection,
} from './context.js'
import { computeDeliverySignal, type LinkedEntities } from './delivery.js'

// The reality axis. All three resolve empty in issue-core (the delivery signal is always null);
// `connectors` taught `computeDeliverySignal` to return real signals, and `deploy-history-edge`
// gave the third one the deployment data it had been reserved for — each without changing this
// list or the persisted filter shape.
export const DELIVERY_PREDICATES = [
  'blocked-on-review',
  'failing-ci',
  'merged-not-deployed',
] as const

export type DeliveryPredicate = (typeof DELIVERY_PREDICATES)[number]

// A structured, typed filter — never free SQL. Intention axes query the row; the `delivery` axis
// routes through the delivery-signal seam and matches nothing when an issue has no linked git
// entities to consult.
export interface IssueFilter {
  readonly status?: readonly IssueStatus[]
  readonly priority?: readonly IssuePriority[]
  // null = the explicit "unassigned" option.
  readonly assigneeIds?: readonly (string | null)[]
  readonly labelIds?: readonly string[]
  readonly text?: string
  readonly delivery?: readonly DeliveryPredicate[]
}

// The statuses that mean the work is over.
export const TERMINAL_ISSUE_STATUSES = [
  'done',
  'canceled',
] as const satisfies readonly IssueStatus[]

// The lens the issue list opens on: a real value of the Status axis, seeded — not a hidden rule
// behind it. The member sees `Status 4`, can open it to read which four, and clears it with the
// control that is already there.
//
// DERIVED by exclusion and never listed, so a status added to `ISSUE_STATUSES` joins the default
// instead of being silently hidden by an include-list that fell behind.
export const DEFAULT_ISSUE_STATUS_FILTER: IssueFilter = {
  status: ISSUE_STATUSES.filter(
    (status) => !(TERMINAL_ISSUE_STATUSES as readonly IssueStatus[]).includes(status),
  ),
}

export interface IssueSort {
  readonly key: IssueSortKey
  readonly direction: SortDirection
}

// The minimal issue shape the evaluator reads. Rows from the synced query (with related
// labels/assignee) satisfy it structurally.
export interface IssueView {
  readonly status: IssueStatus
  readonly priority: IssuePriority
  readonly assigneeId: string | null
  readonly title: string
  readonly number?: number | null
  readonly labels?: readonly { readonly id: string }[]
}

// Not annotated with `z.ZodType<...>`: that erases the schema's input type to `unknown`,
// which breaks the `ReadonlyJSONValue` input constraint on the saved-view mutator args.
export const issueFilterSchema = z.object({
  status: z.array(z.enum(ISSUE_STATUSES)).optional(),
  priority: z.array(z.enum(ISSUE_PRIORITIES)).optional(),
  assigneeIds: z.array(z.string().nullable()).optional(),
  labelIds: z.array(z.string()).optional(),
  text: z.string().optional(),
  delivery: z.array(z.enum(DELIVERY_PREDICATES)).optional(),
})

export const issueSortSchema = z.object({
  key: z.enum(ISSUE_SORT_KEYS),
  direction: z.enum(['asc', 'desc']),
})

export const issueGroupingSchema = z.enum(ISSUE_GROUPINGS)

// Delegates to the search core so the list's text axis and the palette's ranking can never
// disagree about what "matches" means. The one thing that stays here is the blank-needle rule: an
// unset text axis matches every issue, which is the FILTER's meaning of empty, not search's.
// `body` is not passed — a filtered list row holds no description plaintext, so this is exactly the
// title-and-key predicate it has always been.
function matchesText(issue: IssueView, text: string, teamKey?: string): boolean {
  if (text.trim().length === 0) return true
  return matchesSearchText({ title: issue.title, number: issue.number, teamKey }, text)
}

// Intention axes only. Every predicate is AND-combined; within an axis, values are OR-ed.
function matchesIntention(issue: IssueView, filter: IssueFilter, teamKey?: string): boolean {
  if (filter.status && !filter.status.includes(issue.status)) return false
  if (filter.priority && !filter.priority.includes(issue.priority)) return false
  if (filter.assigneeIds && !filter.assigneeIds.includes(issue.assigneeId)) return false
  if (filter.labelIds && filter.labelIds.length > 0) {
    const ids = new Set((issue.labels ?? []).map((label) => label.id))
    if (!filter.labelIds.some((id) => ids.has(id))) return false
  }
  if (filter.text !== undefined && !matchesText(issue, filter.text, teamKey)) return false
  return true
}

// The reality axis. Routes through the delivery-signal seam, so an issue with no linked git
// entities has a null signal and matches no delivery predicate — "no data" means empty, never a
// guess. The caller supplies the linked entities; this function never queries.
function matchesDelivery(
  issue: IssueView,
  predicates: readonly DeliveryPredicate[],
  linked: LinkedEntities,
): boolean {
  if (predicates.length === 0) return true
  const signal = computeDeliverySignal(issue, linked)
  if (signal === null) return false
  return predicates.every((predicate) => {
    switch (predicate) {
      case 'failing-ci':
        return signal.ciHealth === 'failing'
      case 'blocked-on-review':
        return signal.pr === 'open'
      // The reserved slot, now filled. `deployedAt` is non-null exactly when some deployment
      // carried the merged PR's merge commit and succeeded. A deploy that batches several merges
      // carries only the tip commit, so this OVER-reports: a change that shipped inside a batch
      // still reads as not deployed. Deliberate (design §D3) — this filter may cost a glance, but
      // it may never hide a change that is genuinely unreleased.
      case 'merged-not-deployed':
        return signal.pr === 'merged' && signal.deployedAt === null
      default:
        return false
    }
  })
}

export interface EvaluateFilterOptions {
  readonly teamKey?: string
  // Linked work-graph entities per issue (keyed by issue reference). Empty in issue-core.
  readonly linkedFor?: (issue: IssueView) => LinkedEntities
}

export function matchesFilter(
  issue: IssueView,
  filter: IssueFilter,
  options: EvaluateFilterOptions = {},
): boolean {
  if (!matchesIntention(issue, filter, options.teamKey)) return false
  if (filter.delivery && filter.delivery.length > 0) {
    const linked = options.linkedFor?.(issue) ?? {}
    if (!matchesDelivery(issue, filter.delivery, linked)) return false
  }
  return true
}

export function evaluateFilter<T extends IssueView>(
  issues: readonly T[],
  filter: IssueFilter,
  options: EvaluateFilterOptions = {},
): T[] {
  return issues.filter((issue) => matchesFilter(issue, filter, options))
}
