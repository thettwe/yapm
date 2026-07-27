import type { IssueStatus, PullRequestState } from './context.js'

// The rungs automation may climb. `canceled` is off-ladder by CONSTRUCTION rather than by a
// branch: it is excluded from the key type, so a status with no rung can neither be a target nor
// be climbed from, and adding a seventh `IssueStatus` fails to compile here until someone decides
// where — or whether — it sits. Giving `canceled` a number would make it reachable from a
// comparison, which is the hostile write design.md §D2 refuses.
export type AutoStatusRung = Exclude<IssueStatus, 'canceled'>

export const AUTO_STATUS_RANK: Readonly<Record<AutoStatusRung, number>> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  in_review: 3,
  done: 4,
}

// The ceiling on how many linked issues one pull-request event may drive. A branch name carrying
// a dozen magic words is a mistake rather than an intent; the bound keeps one delivery's blast
// radius reviewable and its transaction bounded.
export const AUTO_STATUS_MAX_LINKED_ISSUES = 25

// The status category whose definition each PR state restates (design.md §D1). `draft` and
// `closed` are absent by construction — declined in §D2, not deferred behind a flag.
const AUTO_STATUS_TARGET: Readonly<Partial<Record<PullRequestState, AutoStatusRung>>> = {
  merged: 'done',
  open: 'in_review',
}

export interface AutoStatusInput {
  // The team's setting AND its epoch: null is off, a timestamp is "on, since then".
  readonly autoStatusSince: number | null
  readonly currentStatus: IssueStatus
  readonly needsTriage: boolean
  readonly lastHumanStatusAt: number | null
  // null when the pull-request row is new, so an insert is always an edge.
  readonly previousPrState: PullRequestState | null
  // The effective state just written, not the state the provider reported.
  readonly prState: PullRequestState
  // The event's own instant, never `now()` — a redelivered or reconciliation-healed event must
  // compare as the moment it describes.
  readonly eventAt: number
}

export function decideAutoStatus(input: AutoStatusInput): IssueStatus | null {
  const { autoStatusSince, currentStatus, lastHumanStatusAt, prState } = input

  if (autoStatusSince === null) return null
  if (input.eventAt < autoStatusSince) return null
  if (input.previousPrState === prState) return null
  if (input.needsTriage) return null
  if (currentStatus === 'canceled') return null
  if (lastHumanStatusAt !== null && lastHumanStatusAt > input.eventAt) return null

  const target = AUTO_STATUS_TARGET[prState]
  if (target === undefined) return null
  if (AUTO_STATUS_RANK[target] <= AUTO_STATUS_RANK[currentStatus]) return null

  return target
}
