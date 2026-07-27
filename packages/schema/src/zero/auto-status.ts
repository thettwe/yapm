import type { Transaction } from '@rocicorp/zero'
import { type IssueStatus, type PullRequestState, SYSTEM_AUTH_CONTEXT } from './context.js'
import { mutators } from './mutators.js'
import { zql } from './schema.js'

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

// The team the pull request was written into, and the wall clock of THIS delivery (the instant the
// status row is stamped with). Structurally the ingest path's own `WorkGraphContext`, restated here
// so the import direction stays `work-graph.ts -> auto-status.ts -> mutators.ts` with no edge back.
export interface AutoStatusContext {
  readonly teamId: string
  readonly now: number
}

export interface AutoStatusPullRequestInput {
  readonly pullRequestId: string
  // The stored state before this delivery; null when the pull-request row was just inserted, so an
  // insert is always an edge.
  readonly previousState: PullRequestState | null
  // The EFFECTIVE state actually written, not the state the provider reported — `merged` is pinned
  // terminal by the ingest path, and the ladder must reason about the row, not the payload.
  readonly state: PullRequestState
  readonly eventAt: number
}

interface AutoStatusIssueRow {
  id: string
  status: IssueStatus
  needsTriage: boolean
  lastHumanStatusAt: number | null
}

// The provider-neutral half of status automation: given one pull-request state edge, advance the
// issues that edge links to. Reached only from `applyWorkGraphMutation`'s `upsertPullRequest` case,
// so a second connector emitting the same union variant inherits this with no code of its own.
//
// Guards 1-3 of the §D6 ladder are hoisted ahead of the reads because they are issue-independent —
// a team with automation off (the default, and every existing instance) must not pay 26 queries for
// every comment on a merged pull request. Every per-issue guard stays inside `decideAutoStatus`.
//
// The write is `issue.setStatus`, the same function the keyboard shortcut and the board drag call,
// under `SYSTEM_AUTH_CONTEXT`: `canWrite` and `assertTeamAccess` re-run, so the permission check is
// real rather than decorative, and `last_human_status_at` is deliberately NOT stamped — that
// absence is the audit record that the last status write was not a person's.
export async function applyAutoStatusForPullRequest(
  tx: Transaction,
  ctx: AutoStatusContext,
  input: AutoStatusPullRequestInput,
): Promise<void> {
  if (input.previousState === input.state) return

  const team = (await tx.run(zql.team.where('id', ctx.teamId).one())) as
    | { autoStatusSince: number | null }
    | undefined
  const autoStatusSince = team?.autoStatusSince ?? null
  if (autoStatusSince === null) return
  if (input.eventAt < autoStatusSince) return

  const links = (await tx.run(
    zql.issue_link
      .where('pullRequestId', input.pullRequestId)
      .orderBy('issueId', 'asc')
      .limit(AUTO_STATUS_MAX_LINKED_ISSUES),
  )) as { issueId: string }[]

  for (const link of links) {
    const issue = (await tx.run(zql.issue.where('id', link.issueId).one())) as
      | AutoStatusIssueRow
      | undefined
    if (!issue) continue

    const target = decideAutoStatus({
      autoStatusSince,
      currentStatus: issue.status,
      needsTriage: issue.needsTriage,
      lastHumanStatusAt: issue.lastHumanStatusAt ?? null,
      previousPrState: input.previousState,
      prState: input.state,
      eventAt: input.eventAt,
    })
    if (target === null) continue

    await mutators.issue.setStatus.fn({
      tx,
      args: { id: issue.id, status: target, updatedAt: ctx.now },
      ctx: SYSTEM_AUTH_CONTEXT,
    })
  }
}
