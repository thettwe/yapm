import {
  buildRetroSeed,
  type CiConclusion,
  type CycleStatus,
  compareCycles,
  type IssueStatus,
  type RetroSeed,
  type RetroSeedCycleInput,
  type RetroSeedIssueInput,
  type RetroSeedMetric,
  type RetroSeedPrInput,
} from '@yapm/schema'

// The client side of the differentiator: the synced work-graph rows the retro already has, shaped
// into `buildRetroSeed`'s input. Everything below is a pure projection over rows the caller can
// already read — no new query surface, no server round trip, so the panel is live and offline-correct.
//
// The identity guarantee travels with the shape: nothing here reads an assignee, author, reviewer or
// creator, and `RetroSeedIssueInput` has nowhere to put one.

export interface SeedPrRow {
  readonly openedAt: number
  readonly mergedAt?: number | null
  readonly ciChecks?: readonly { readonly conclusion: string }[]
  readonly reviews?: readonly { readonly submittedAt: number }[]
}

export interface SeedIssueRow {
  readonly id: string
  readonly status: IssueStatus
  readonly cycleId?: string | null
  readonly rolledOverFromCycleId?: string | null
  readonly carryoverCount?: number | null
  readonly cycleAssignedAt?: number | null
  readonly issueLinks?: readonly { readonly pullRequest?: SeedPrRow | null }[]
}

export interface SeedCycleRow {
  readonly id: string
  readonly name: string
  readonly status: CycleStatus
  readonly number?: number | null
  readonly startDate: number
}

const MAX_PRIOR_CYCLES = 3

function pullRequestsOf(issue: SeedIssueRow): readonly RetroSeedPrInput[] {
  return (issue.issueLinks ?? [])
    .map((link) => link.pullRequest)
    .filter((pr): pr is SeedPrRow => pr != null)
    .map((pr) => ({
      openedAt: pr.openedAt,
      mergedAt: pr.mergedAt ?? null,
      reviewSubmittedAt: (pr.reviews ?? []).map((review) => review.submittedAt),
      ciConclusions: (pr.ciChecks ?? []).map((check) => check.conclusion as CiConclusion),
    }))
}

function toSeedIssue(issue: SeedIssueRow): RetroSeedIssueInput {
  return {
    id: issue.id,
    status: issue.status,
    cycleId: issue.cycleId ?? null,
    rolledOverFromCycleId: issue.rolledOverFromCycleId ?? null,
    carryoverCount: issue.carryoverCount ?? 0,
    cycleAssignedAt: issue.cycleAssignedAt ?? null,
    pullRequests: pullRequestsOf(issue),
  }
}

// Every issue that TOUCHED a cycle: the ones still pointing at it plus the ones the rollover carried
// out of it, which no longer point at it but kept the origin marker.
function issuesTouching(cycleId: string, issues: readonly SeedIssueRow[]): RetroSeedIssueInput[] {
  return issues
    .filter(
      (issue) =>
        (issue.cycleId ?? null) === cycleId || (issue.rolledOverFromCycleId ?? null) === cycleId,
    )
    .map(toSeedIssue)
}

function toSeedCycle(cycle: SeedCycleRow, issues: readonly SeedIssueRow[]): RetroSeedCycleInput {
  return {
    id: cycle.id,
    name: cycle.name,
    startDate: cycle.startDate,
    issues: issuesTouching(cycle.id, issues),
  }
}

// The sparkline's history: up to three COMPLETED cycles of the same team that sort before this one,
// oldest first, by the same total order the cycles list uses.
export function priorCyclesFor(
  cycle: SeedCycleRow,
  cycles: readonly SeedCycleRow[],
): SeedCycleRow[] {
  return cycles
    .filter((candidate) => candidate.id !== cycle.id && candidate.status === 'completed')
    .filter((candidate) => compareCycles(candidate, cycle) < 0)
    .sort(compareCycles)
    .slice(-MAX_PRIOR_CYCLES)
}

// Null when the retro has no cycle to reflect on, or the cycle is not in the caller's synced slice —
// the panel then renders nothing rather than a board of zeros.
export function buildRetroSeedFor(
  cycleId: string | null,
  cycles: readonly SeedCycleRow[],
  issues: readonly SeedIssueRow[],
): RetroSeed | null {
  if (cycleId === null) return null
  const cycle = cycles.find((candidate) => candidate.id === cycleId)
  if (cycle === undefined) return null
  return buildRetroSeed({
    cycle: toSeedCycle(cycle, issues),
    priorCycles: priorCyclesFor(cycle, cycles).map((prior) => toSeedCycle(prior, issues)),
  })
}

export function formatSeedValue(metric: RetroSeedMetric): string {
  switch (metric.unit) {
    case 'hours':
      return `${metric.value}h`
    case 'percent':
      return `${metric.value}%`
    default:
      return `${metric.value}`
  }
}

// Trends lead, absolutes follow — and a trend is only ever "better"/"worse" for the SYSTEM. A metric
// with no `betterWhen` (carried in, in scope, canceled) is reported as movement with no judgement.
export type SeedTrendTone = 'better' | 'worse' | 'neutral'

export function seedTrendTone(metric: RetroSeedMetric): SeedTrendTone | null {
  if (metric.delta === null || metric.delta === 0) return null
  if (metric.betterWhen === null) return 'neutral'
  const improved = metric.betterWhen === 'lower' ? metric.delta < 0 : metric.delta > 0
  return improved ? 'better' : 'worse'
}

export function formatSeedDelta(metric: RetroSeedMetric): string | null {
  if (metric.delta === null) return null
  if (metric.delta === 0) return 'no change'
  const magnitude = Math.abs(metric.delta)
  const suffix = metric.unit === 'hours' ? 'h' : metric.unit === 'percent' ? '%' : ''
  // A true minus sign, not a hyphen, so a screen reader reads "minus" rather than a dash.
  return `${metric.delta > 0 ? '+' : '−'}${magnitude}${suffix} vs. last cycle`
}

export interface SparklineGeometry {
  readonly points: string
  readonly last: { readonly x: number; readonly y: number }
}

// A flat series renders on the mid-line rather than collapsing to the floor, so "unchanged" reads as
// steady instead of as zero.
export function sparklineGeometry(
  trend: readonly number[],
  width: number,
  height: number,
): SparklineGeometry | null {
  if (trend.length < 2) return null
  const min = Math.min(...trend)
  const max = Math.max(...trend)
  const span = max - min
  const step = width / (trend.length - 1)
  const coords = trend.map((value, index) => ({
    x: Math.round(index * step * 100) / 100,
    y: span === 0 ? height / 2 : Math.round((height - ((value - min) / span) * height) * 100) / 100,
  }))
  const last = coords.at(-1)
  if (last === undefined) return null
  return { points: coords.map((point) => `${point.x},${point.y}`).join(' '), last }
}
