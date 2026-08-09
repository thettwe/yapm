import { type CycleStatus, compareCycles, cycleKeyOf } from '@yapm/schema'

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

// The human key for a cycle, resolved through the schema seam so the register, the issue list and
// triage cannot spell the same cycle two ways.
export function cycleKey(cycle: { number: number | null }): string {
  return cycleKeyOf(cycle)
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
    new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${fmt(startDate)} – ${fmt(endDate)}`
}
