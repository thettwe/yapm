import type { CycleStatus, IssueStatus } from './context.js'

// The two terminal statuses. An issue in one of these is "finished" and is never rolled over
// when its cycle completes; every other status is unfinished work that must not be dropped.
export const FINISHED_ISSUE_STATUSES: readonly IssueStatus[] = ['done', 'canceled']

export function isUnfinished(status: IssueStatus): boolean {
  return !FINISHED_ISSUE_STATUSES.includes(status)
}

export interface CycleOrderRow {
  readonly id: string
  readonly status: CycleStatus
  readonly number?: number | null
  readonly startDate: number
}

// Deterministically choose the rollover destination for a cycle that is completing: the
// earliest still-open cycle (upcoming or active) in the same team that sorts after the
// source. Ordering is by `number` when both have one, then by startDate, then id — the same
// total order the UI lists cycles in. Returns null when no open successor exists, in which
// case unfinished issues are unassigned (cycleId -> null) rather than silently dropped.
export function nextCycleId(
  cycles: readonly CycleOrderRow[],
  source: CycleOrderRow,
): string | null {
  const candidates = cycles
    .filter((c) => c.id !== source.id && c.status !== 'completed')
    .filter((c) => compareCycles(source, c) < 0)
    .sort(compareCycles)
  return candidates[0]?.id ?? null
}

export function compareCycles(a: CycleOrderRow, b: CycleOrderRow): number {
  const an = a.number ?? null
  const bn = b.number ?? null
  if (an !== null && bn !== null && an !== bn) return an - bn
  if (an !== null && bn === null) return -1
  if (an === null && bn !== null) return 1
  if (a.startDate !== b.startDate) return a.startDate - b.startDate
  return a.id.localeCompare(b.id)
}
