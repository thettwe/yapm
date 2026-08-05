import type {
  CiConclusion,
  CycleStatus,
  DeliveryCycleInput,
  DeliveryIssueInput,
  DeliveryPrInput,
  IssueStatus,
} from '@yapm/schema'

// The client side of the differentiator: the synced work-graph rows both surfaces already have,
// shaped into a `DeliveryScope`. Everything below is a pure projection over rows the caller can
// already read — no new query surface, no server round trip, so both views are live and
// offline-correct.
//
// The identity guarantee travels with the shape: nothing here reads an assignee, author, reviewer or
// creator, and `DeliveryIssueInput` has nowhere to put one. The synced rows carry all four; the
// projection is the wall.

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

export function pullRequestsOf(issue: SeedIssueRow): readonly DeliveryPrInput[] {
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

export function toSeedIssue(issue: SeedIssueRow): DeliveryIssueInput {
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
export function issuesTouching(
  cycleId: string,
  issues: readonly SeedIssueRow[],
): DeliveryIssueInput[] {
  return issues
    .filter(
      (issue) =>
        (issue.cycleId ?? null) === cycleId || (issue.rolledOverFromCycleId ?? null) === cycleId,
    )
    .map(toSeedIssue)
}

// One cycle as the metrics read it. Both builders project through this: the retro passes one cycle
// plus its priors, the team view passes a window plus the window before it.
export function toDeliveryCycle(
  cycle: SeedCycleRow,
  issues: readonly SeedIssueRow[],
): DeliveryCycleInput {
  return {
    id: cycle.id,
    name: cycle.name,
    startDate: cycle.startDate,
    issues: issuesTouching(cycle.id, issues),
  }
}

export function toDeliveryCycles(
  cycles: readonly SeedCycleRow[],
  issues: readonly SeedIssueRow[],
): DeliveryCycleInput[] {
  return cycles.map((cycle) => toDeliveryCycle(cycle, issues))
}
