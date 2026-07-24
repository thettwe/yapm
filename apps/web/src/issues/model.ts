import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssueFilter,
  type IssueGrouping,
  type IssuePriority,
  type IssueSort,
  type IssueStatus,
  matchesFilter,
} from '@yapm/schema'
import type { PriorityKind } from '@yapm/ui/components/priority-mark'
import type { StatusKind } from '@yapm/ui/components/status-glyph'

// Schema status/priority enums use snake_case; the design-system glyph primitives use
// kebab-case kinds. These total maps bridge the two without leaking string literals.
export const STATUS_TO_KIND: Record<IssueStatus, StatusKind> = {
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'in-progress',
  in_review: 'in-review',
  done: 'done',
  canceled: 'canceled',
}

export const PRIORITY_TO_KIND: Record<IssuePriority, PriorityKind> = {
  no_priority: 'no-priority',
  low: 'low',
  medium: 'medium',
  high: 'high',
  urgent: 'urgent',
}

export const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  canceled: 'Canceled',
}

export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  no_priority: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

// The fixed status category order (VISION: opinionated, non-configurable).
export const STATUS_ORDER = ISSUE_STATUSES

// Urgent sorts highest; no_priority lowest.
const PRIORITY_RANK: Record<IssuePriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  no_priority: 0,
}

export const UNASSIGNED = '__unassigned__'
export const NO_LABEL = '__no_label__'

export interface IssueLabelRow {
  readonly id: string
  readonly name: string
  readonly color: string
}

export interface IssueAssigneeRow {
  readonly id: string
  readonly name?: string | null
  readonly email?: string | null
  readonly image?: string | null
}

// The list's view of a synced issue row (satisfies the schema `IssueView` structurally so the
// shared filter evaluator applies unchanged).
export interface IssueRowData {
  readonly id: string
  readonly number?: number | null
  readonly title: string
  readonly status: IssueStatus
  readonly priority: IssuePriority
  readonly assigneeId: string | null
  readonly rank?: string | null
  readonly updatedAt: number
  readonly createdAt: number
  readonly labels?: readonly IssueLabelRow[]
  readonly assignee?: IssueAssigneeRow | null
}

export interface IssueGroup {
  readonly key: string
  readonly label: string
  readonly status?: IssueStatus
  readonly priority?: IssuePriority
  readonly issues: readonly IssueRowData[]
}

function compareBy(sort: IssueSort): (a: IssueRowData, b: IssueRowData) => number {
  const dir = sort.direction === 'asc' ? 1 : -1
  return (a, b) => {
    let primary = 0
    switch (sort.key) {
      case 'priority':
        primary = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        break
      case 'status':
        primary = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
        break
      case 'assignee':
        primary = (a.assigneeId ?? '').localeCompare(b.assigneeId ?? '')
        break
      case 'created':
        primary = a.createdAt - b.createdAt
        break
      case 'number':
        primary = (a.number ?? Number.POSITIVE_INFINITY) - (b.number ?? Number.POSITIVE_INFINITY)
        break
      default:
        primary = a.updatedAt - b.updatedAt
    }
    if (primary !== 0) return primary * dir
    // Stable tiebreak: most-recently-updated first, then id.
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
    return a.id.localeCompare(b.id)
  }
}

export const DEFAULT_SORT: IssueSort = { key: 'priority', direction: 'desc' }
export const DEFAULT_GROUPING: IssueGrouping = 'status'

function labelToneless(name: string): string {
  return name.trim().toLowerCase()
}

export interface GroupOptions {
  readonly filter: IssueFilter
  readonly grouping: IssueGrouping
  readonly sort: IssueSort
  readonly teamKey?: string
  readonly assigneeName?: (id: string) => string
}

// Filter (locally, over synced rows) → group → sort within each group. Groups render in a
// deterministic order: status uses the fixed category order; priority uses rank; assignee/label
// are alphabetical with the empty bucket last.
export function buildGroups(
  issues: readonly IssueRowData[],
  options: GroupOptions,
): { groups: IssueGroup[]; ordered: IssueRowData[] } {
  const filtered = issues.filter((issue) =>
    matchesFilter(issue, options.filter, { teamKey: options.teamKey }),
  )
  const cmp = compareBy(options.sort)

  const groups = groupBy(filtered, options)
  for (const group of groups) {
    ;(group.issues as IssueRowData[]).sort(cmp)
  }
  const ordered = groups.flatMap((group) => group.issues)
  return { groups, ordered }
}

function groupBy(issues: readonly IssueRowData[], options: GroupOptions): IssueGroup[] {
  const { grouping } = options

  if (grouping === 'none') {
    return [{ key: 'all', label: 'All issues', issues: [...issues] }]
  }

  if (grouping === 'status') {
    return STATUS_ORDER.map((status) => ({
      key: status,
      label: STATUS_LABEL[status],
      status,
      issues: issues.filter((issue) => issue.status === status),
    })).filter((group) => group.issues.length > 0)
  }

  if (grouping === 'priority') {
    return [...ISSUE_PRIORITIES]
      .sort((a, b) => PRIORITY_RANK[b] - PRIORITY_RANK[a])
      .map((priority) => ({
        key: priority,
        label: PRIORITY_LABEL[priority],
        priority,
        issues: issues.filter((issue) => issue.priority === priority),
      }))
      .filter((group) => group.issues.length > 0)
  }

  if (grouping === 'assignee') {
    const buckets = new Map<string, IssueRowData[]>()
    for (const issue of issues) {
      const key = issue.assigneeId ?? UNASSIGNED
      const bucket = buckets.get(key) ?? []
      bucket.push(issue)
      buckets.set(key, bucket)
    }
    const name = options.assigneeName ?? ((id: string) => id)
    return [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        label: key === UNASSIGNED ? 'Unassigned' : name(key),
        issues: bucket,
      }))
      .sort((a, b) => {
        if (a.key === UNASSIGNED) return 1
        if (b.key === UNASSIGNED) return -1
        return a.label.localeCompare(b.label)
      })
  }

  // label: an issue appears under each of its labels, or under "No label".
  const buckets = new Map<string, { label: string; issues: IssueRowData[] }>()
  for (const issue of issues) {
    const labels = issue.labels ?? []
    if (labels.length === 0) {
      const bucket = buckets.get(NO_LABEL) ?? { label: 'No label', issues: [] }
      bucket.issues.push(issue)
      buckets.set(NO_LABEL, bucket)
      continue
    }
    for (const label of labels) {
      const key = `label:${label.id}`
      const bucket = buckets.get(key) ?? { label: label.name, issues: [] }
      bucket.issues.push(issue)
      buckets.set(key, bucket)
    }
  }
  return [...buckets.entries()]
    .map(([key, value]) => ({ key, label: value.label, issues: value.issues }))
    .sort((a, b) => {
      if (a.key === NO_LABEL) return 1
      if (b.key === NO_LABEL) return -1
      return labelToneless(a.label).localeCompare(labelToneless(b.label))
    })
}

// The human key. Before the server-assigned number replicates it renders as pending.
export function issueKey(teamKey: string, issue: { number?: number | null }): string {
  return issue.number == null ? `${teamKey}‑…` : `${teamKey}-${issue.number}`
}

export function isPendingNumber(issue: { number?: number | null }): boolean {
  return issue.number == null
}
