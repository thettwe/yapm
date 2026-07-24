import { type CycleStatus, compareCycles, isUnfinished } from '@yapm/schema'
import type { IssueRowData } from '@/issues/model'

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
}

export interface CycleRowData {
  readonly id: string
  readonly number: number | null
  readonly name: string
  readonly status: CycleStatus
  readonly startDate: number
  readonly endDate: number
}

// The human key for a cycle. Before the server-assigned number replicates it renders pending.
export function cycleKey(cycle: { number: number | null }): string {
  return cycle.number == null ? 'Cycle …' : `Cycle ${cycle.number}`
}

export interface CycleProgress {
  readonly total: number
  readonly done: number
  readonly percent: number
}

// Simple progress over a cycle's issues: how many have reached a finished status (done or
// canceled) out of the total assigned. Percent is 0 for an empty cycle (never NaN).
export function cycleProgress(issues: readonly IssueRowData[]): CycleProgress {
  const total = issues.length
  const done = issues.filter((issue) => !isUnfinished(issue.status)).length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return { total, done, percent }
}

export interface PartitionedCycles {
  readonly active: readonly CycleRowData[]
  readonly upcoming: readonly CycleRowData[]
  readonly completed: readonly CycleRowData[]
}

// Split cycles by status, each list in the canonical cycle order (by number, then start date).
export function partitionCycles(cycles: readonly CycleRowData[]): PartitionedCycles {
  const sorted = [...cycles].sort((a, b) =>
    compareCycles(
      { id: a.id, status: a.status, number: a.number, startDate: a.startDate },
      { id: b.id, status: b.status, number: b.number, startDate: b.startDate },
    ),
  )
  return {
    active: sorted.filter((cycle) => cycle.status === 'active'),
    upcoming: sorted.filter((cycle) => cycle.status === 'upcoming'),
    completed: sorted.filter((cycle) => cycle.status === 'completed').reverse(),
  }
}

// The cycle to feature: the earliest active cycle, or the earliest upcoming one when none is
// active yet, or null when the team has no open cycle.
export function currentCycle(cycles: readonly CycleRowData[]): CycleRowData | null {
  const { active, upcoming } = partitionCycles(cycles)
  return active[0] ?? upcoming[0] ?? null
}

export function formatCycleRange(startDate: number, endDate: number): string {
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(startDate)} – ${fmt(endDate)}`
}
