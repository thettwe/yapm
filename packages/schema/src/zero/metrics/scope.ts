import type { CiConclusion, IssueStatus } from '../context.js'
import { ciHealthFromConclusion } from '../delivery.js'

// The measurement scope: ONE definition of every delivery formula, evaluated against a set of
// cycles rather than a single one. A retro passes one cycle; the team Delivery view passes a
// rolling window. Nothing below knows which caller it has.
//
// Two guarantees are STRUCTURAL here, not editorial:
//   1. No identity dimension at any depth. Neither the input nor the output carries an assignee,
//      author, reviewer, creator or user id, so a per-person number is not renderable.
//   2. Degrades to the data that exists. `deliveredCounts` needs cycles alone; `flowMeasures`
//      returns `NO_FLOW` rather than zeros when no connector has fed anything in.

export interface DeliveryPrInput {
  readonly openedAt: number
  readonly mergedAt?: number | null
  readonly reviewSubmittedAt?: readonly number[]
  readonly ciConclusions?: readonly CiConclusion[]
}

// An issue as a metric reads it: its cycle edges and the two carryover facts, and NOTHING about
// who touched it.
export interface DeliveryIssueInput {
  readonly id: string
  readonly status: IssueStatus
  readonly cycleId: string | null
  readonly rolledOverFromCycleId?: string | null
  readonly carryoverCount?: number | null
  readonly cycleAssignedAt?: number | null
  readonly pullRequests?: readonly DeliveryPrInput[]
}

export interface DeliveryCycleInput {
  readonly id: string
  readonly name: string
  readonly startDate: number
  // Every issue that touched this cycle: the ones still pointing at it plus the ones the rollover
  // carried out of it (`rolledOverFromCycleId === cycle.id`), which no longer point at it.
  readonly issues: readonly DeliveryIssueInput[]
}

export interface DeliveryScope {
  // The cycles that constitute this scope: id → startDate. For a retro, exactly one entry.
  readonly cycleStarts: ReadonlyMap<string, number>
  // Every issue that TOUCHED any of those cycles, each appearing once.
  readonly issues: readonly DeliveryIssueInput[]
}

export function scopeOfCycle(cycle: DeliveryCycleInput): DeliveryScope {
  return { cycleStarts: new Map([[cycle.id, cycle.startDate]]), issues: cycle.issues }
}

// Pooling is by issue id, not by concatenation: an issue the rollover carried from one window cycle
// into the next appears in both cycles' lists, and counting it twice would inflate `total`.
export function scopeOfCycles(cycles: readonly DeliveryCycleInput[]): DeliveryScope {
  const cycleStarts = new Map<string, number>()
  const issues = new Map<string, DeliveryIssueInput>()
  for (const cycle of cycles) {
    cycleStarts.set(cycle.id, cycle.startDate)
    for (const issue of cycle.issues) if (!issues.has(issue.id)) issues.set(issue.id, issue)
  }
  return { cycleStarts, issues: [...issues.values()] }
}

function inScope(scope: DeliveryScope, issue: DeliveryIssueInput): boolean {
  return issue.cycleId != null && scope.cycleStarts.has(issue.cycleId)
}

export interface DeliveredCounts {
  readonly total: number
  readonly shipped: number
  readonly carriedOut: number
  readonly carriedIn: number
  readonly carriedTwicePlus: number
  readonly addedMidCycle: number
  readonly canceled: number
}

// Delivered, from cycles alone. `carriedOut` is reconstructed from `rolledOverFromCycleId` because a
// carried issue no longer points at the cycle it left; `carriedTwicePlus` and `addedMidCycle` are
// facts rather than guesses thanks to `carryover_count` and `cycle_assigned_at`.
//
// Every membership test is a lookup in `cycleStarts`, which for a one-cycle scope reduces to the
// `=== cycle.id` comparison it replaced. `carriedOut` and `carriedIn` are relative to the SCOPE, so
// at window scope a carry from one window cycle to the next is neither — it never left the window.
// `carriedTwicePlus` is deliberately NOT relative to the scope in that way: it counts repeat
// rollovers out of ANY cycle in the scope, which is what its name, its sparkline and its caption all
// say. Reading it off `carriedOut` would ask whether the issue left the whole window, and report
// "the plan is holding" for exactly the rollover a window exists to surface.
export function deliveredCounts(scope: DeliveryScope): DeliveredCounts {
  const within = scope.issues.filter((issue) => inScope(scope, issue))
  const carriedOut = scope.issues.filter(
    (issue) =>
      issue.rolledOverFromCycleId != null &&
      scope.cycleStarts.has(issue.rolledOverFromCycleId) &&
      !inScope(scope, issue),
  )

  return {
    total: within.length + carriedOut.length,
    shipped: within.filter((issue) => issue.status === 'done').length,
    carriedOut: carriedOut.length,
    carriedIn: within.filter(
      (issue) =>
        issue.rolledOverFromCycleId != null && !scope.cycleStarts.has(issue.rolledOverFromCycleId),
    ).length,
    // Any issue the rollover moved out of a cycle IN SCOPE, having already been moved before —
    // whether or not it then left the scope. The one exclusion is the issue pointing back at the
    // very cycle it rolled out of: that issue was re-assigned into its origin cycle, undoing the
    // hop the marker records, and it is not a carry at any scope. With it excluded this is exactly
    // the `carriedOut.filter(...)` expression it replaced whenever the scope is one cycle.
    carriedTwicePlus: scope.issues.filter(
      (issue) =>
        issue.rolledOverFromCycleId != null &&
        issue.cycleId !== issue.rolledOverFromCycleId &&
        scope.cycleStarts.has(issue.rolledOverFromCycleId) &&
        (issue.carryoverCount ?? 0) >= 2,
    ).length,
    // Only issues STILL in scope: `cycle_assigned_at` records the last assignment, so for an issue
    // the rollover carried out it already describes the successor cycle, not this one. The
    // comparison is against the ISSUE'S OWN cycle start rather than a scope-wide start, which is
    // what keeps "added mid-cycle" exact when the scope is a window of many cycles.
    addedMidCycle: within.filter(
      (issue) =>
        issue.cycleAssignedAt != null &&
        issue.cycleAssignedAt > (scope.cycleStarts.get(issue.cycleId as string) as number),
    ).length,
    canceled: within.filter((issue) => issue.status === 'canceled').length,
  }
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
  return value
}

export function round(value: number, places = 1): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export const HOUR_MS = 60 * 60 * 1000

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

export function pullRequests(scope: DeliveryScope): readonly DeliveryPrInput[] {
  return scope.issues.flatMap((issue) => issue.pullRequests ?? [])
}

export interface FlowMeasures {
  readonly prCycleTimeHours: number | undefined
  readonly timeToFirstReviewHours: number | undefined
  readonly reviewRounds: number | undefined
  readonly issuesWithoutPr: number | undefined
  readonly ciFailingRate: number | undefined
}

export const NO_FLOW: FlowMeasures = {
  prCycleTimeHours: undefined,
  timeToFirstReviewHours: undefined,
  reviewRounds: undefined,
  issuesWithoutPr: undefined,
  ciFailingRate: undefined,
}

// Flow, from connector-fed delivery data. Speed and stability are computed as a pair (cycle time
// next to the CI failing rate) so neither can be optimized at the other's expense. At window scope
// the PRs pool across every cycle in the window, so the medians are true window medians rather than
// medians of per-cycle medians.
export function flowMeasures(scope: DeliveryScope): FlowMeasures {
  const prs = pullRequests(scope)
  if (prs.length === 0) return NO_FLOW

  const cycleTimes = prs
    .filter((pr) => pr.mergedAt != null)
    .map((pr) => ((pr.mergedAt as number) - pr.openedAt) / HOUR_MS)
    .filter((hours) => hours >= 0)

  const firstReviewWaits = prs
    .map((pr) => {
      const submitted = pr.reviewSubmittedAt ?? []
      if (submitted.length === 0) return undefined
      return (Math.min(...submitted) - pr.openedAt) / HOUR_MS
    })
    .filter((hours): hours is number => hours !== undefined && hours >= 0)

  const reviewCounts = prs
    .filter((pr) => (pr.reviewSubmittedAt ?? []).length > 0)
    .map((pr) => (pr.reviewSubmittedAt ?? []).length)

  const within = scope.issues.filter((issue) => inScope(scope, issue))
  const prsWithChecks = prs.filter((pr) => (pr.ciConclusions ?? []).length > 0)
  const failing = prsWithChecks.filter((pr) =>
    (pr.ciConclusions ?? []).some((conclusion) => ciHealthFromConclusion(conclusion) === 'failing'),
  )

  const prCycleTime = median(cycleTimes)
  const firstReview = median(firstReviewWaits)
  const rounds = median(reviewCounts)

  return {
    prCycleTimeHours: prCycleTime === undefined ? undefined : round(prCycleTime),
    timeToFirstReviewHours: firstReview === undefined ? undefined : round(firstReview),
    reviewRounds: rounds === undefined ? undefined : round(rounds),
    issuesWithoutPr:
      within.length === 0
        ? undefined
        : within.filter((issue) => (issue.pullRequests ?? []).length === 0).length,
    ciFailingRate:
      prsWithChecks.length === 0
        ? undefined
        : Math.round((failing.length / prsWithChecks.length) * 100),
  }
}

// Whether review wait dominated lead time — the literature's highest-value retro topic, and a
// property of the system rather than of any reviewer.
export function reviewWaitDominates(flow: FlowMeasures): boolean {
  if (flow.timeToFirstReviewHours === undefined) return false
  if (flow.prCycleTimeHours === undefined || flow.prCycleTimeHours <= 0) return false
  return flow.timeToFirstReviewHours / flow.prCycleTimeHours >= 0.5
}
