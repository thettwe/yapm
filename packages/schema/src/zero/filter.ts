import * as z from 'zod'
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

// The reserved reality axis. These resolve empty in issue-core (the delivery signal is
// always null); `connectors` teaches `computeDeliverySignal` to return real signals and
// these light up with no change to this model.
export const DELIVERY_PREDICATES = [
  'blocked-on-review',
  'failing-ci',
  'merged-not-deployed',
] as const

export type DeliveryPredicate = (typeof DELIVERY_PREDICATES)[number]

// A structured, typed filter — never free SQL. Intention axes are queryable today; the
// `delivery` axis is reserved and matches nothing in this change.
export interface IssueFilter {
  readonly status?: readonly IssueStatus[]
  readonly priority?: readonly IssuePriority[]
  // null = the explicit "unassigned" option.
  readonly assigneeIds?: readonly (string | null)[]
  readonly labelIds?: readonly string[]
  readonly text?: string
  readonly delivery?: readonly DeliveryPredicate[]
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

function matchesText(issue: IssueView, text: string, teamKey?: string): boolean {
  const needle = text.trim().toLowerCase()
  if (needle.length === 0) return true
  if (issue.title.toLowerCase().includes(needle)) return true
  if (issue.number != null) {
    const key = teamKey ? `${teamKey}-${issue.number}` : String(issue.number)
    if (key.toLowerCase().includes(needle)) return true
  }
  return false
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

// The reality axis. Routes through the delivery-signal seam; in issue-core the signal is
// always null so any delivery predicate matches nothing — a delivery-only filter is empty
// by construction, which is why no reality views ship now.
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
      case 'merged-not-deployed':
        return signal.pr === 'merged'
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
