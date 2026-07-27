import type * as z from 'zod'
import {
  acceptTriageArgs,
  activateCycleArgs,
  addIssueLabelArgs,
  addTeamMemberArgs,
  archiveTeamArgs,
  assignIssueArgs,
  castRetroVoteArgs,
  changeMemberRoleArgs,
  claimRetroFacilitatorArgs,
  completeCycleArgs,
  configureRetroArgs,
  convertRetroActionToIssueArgs,
  createCommentArgs,
  createCycleArgs,
  createInviteArgs,
  createIssueArgs,
  createLabelArgs,
  createProjectArgs,
  createRetroActionArgs,
  createRetroDraftArgs,
  createRetroGroupArgs,
  createSavedViewArgs,
  createTeamArgs,
  declineTriageArgs,
  deleteCommentArgs,
  deleteLabelArgs,
  deleteProjectArgs,
  deleteRetroActionArgs,
  deleteRetroArgs,
  deleteRetroCardArgs,
  deleteRetroDraftArgs,
  deleteSavedViewArgs,
  dissolveRetroGroupArgs,
  editCommentArgs,
  flagTriageArgs,
  followIssueArgs,
  labelRetroGroupArgs,
  markAllNotificationsReadArgs,
  markNotificationReadArgs,
  moveIssueArgs,
  moveRetroCardArgs,
  mutators,
  openRetroForCycleArgs,
  removeIssueLabelArgs,
  removeMemberArgs,
  removeTeamMemberArgs,
  renameLabelArgs,
  renameTeamArgs,
  renameWorkspaceArgs,
  retractRetroVoteArgs,
  retroPresenceHeartbeatArgs,
  revokeInviteArgs,
  routeIssueArgs,
  setIssueCycleArgs,
  setIssuePriorityArgs,
  setIssueProjectArgs,
  setIssueStatusArgs,
  setPreferenceArgs,
  setRetroFacilitatorArgs,
  setRetroPhaseArgs,
  setTeamAutoStatusArgs,
  startRetroTimerArgs,
  stopRetroTimerArgs,
  unfollowIssueArgs,
  updateCycleArgs,
  updateIssueArgs,
  updateProjectArgs,
  updateRetroActionArgs,
  updateRetroDraftArgs,
  updateSavedViewArgs,
} from './mutators.js'

// The agent-as-actor tool registry — PURE metadata, no AI-SDK or UI import. The gateway in
// `apps/server` turns each spec into an AI-SDK `tool` whose `execute` calls the SAME mutator the
// human UI calls, under the invoking user's `AuthContext` (the role ceiling is the primary
// injection defense). `inputSchema` IS the mutator's own exported Zod args schema — never a
// parallel schema — so the model can only ever call something a human could, with the same
// validation. The registry is derived from `defineMutators` (`buildMutatorToolSpecs`) so it stays
// exhaustive by construction.

// `write` = a normal state change; `destructive` = a delete / role change / irreversible-ish
// transition, flagged so a least-privilege run can exclude it. Both are human-in-the-loop
// (`needsApproval`); reads (exposed separately over the named queries) auto-run.
export type ToolKind = 'write' | 'destructive'

export interface MutatorToolSpec {
  // The mutator name, e.g. `issue.setStatus` — the AI-SDK tool name maps 1:1.
  readonly name: string
  readonly kind: ToolKind
  // The mutator's existing exported Zod args schema; reused verbatim as the tool `inputSchema`.
  readonly args: z.ZodType
}

// Per-mutator classification. Delete / remove / revoke / decline / archive / complete / role
// changes are `destructive`; everything else is a plain `write`.
const MUTATOR_TOOL_KINDS: Record<string, ToolKind> = {
  'workspace.rename': 'write',
  'preference.set': 'write',
  // Read state on somebody's own inbox. The mutator is structurally self-scoped (the recipient
  // comes from the verified ctx), so an agent acting on behalf of a user can only ever touch that
  // user's rows — and marking read destroys nothing.
  'notification.markRead': 'write',
  'notification.markAllRead': 'write',
  // Self-scoped in exactly the same structural way — the subscriber half of the key comes from the
  // verified ctx, so an agent can only ever follow or unfollow on behalf of the user it is acting
  // as. `unfollow` is a plain write rather than destructive because it writes a state and deletes
  // nothing: `follow` puts it back.
  'issueSubscription.follow': 'write',
  'issueSubscription.unfollow': 'write',
  'member.changeRole': 'destructive',
  'member.remove': 'destructive',
  'team.create': 'write',
  'team.rename': 'write',
  'team.archive': 'destructive',
  // Opting a team into status automation. A plain write: it is per-team, instantly reversible, and
  // its epoch means enabling it rewrites nothing that already happened.
  'team.setAutoStatus': 'write',
  'team.addMember': 'write',
  'team.removeMember': 'destructive',
  'invite.create': 'write',
  'invite.revoke': 'destructive',
  'issue.create': 'write',
  'issue.update': 'write',
  'issue.setStatus': 'write',
  'issue.setPriority': 'write',
  'issue.assign': 'write',
  'issue.move': 'write',
  'issue.setCycle': 'write',
  'issue.setProject': 'write',
  'issue.addLabel': 'write',
  'issue.removeLabel': 'write',
  'issue.flagTriage': 'write',
  'issue.acceptTriage': 'write',
  'issue.declineTriage': 'destructive',
  'issue.routeIssue': 'write',
  'cycle.create': 'write',
  'cycle.update': 'write',
  'cycle.activate': 'write',
  'cycle.complete': 'destructive',
  'project.create': 'write',
  'project.update': 'write',
  'project.delete': 'destructive',
  'label.create': 'write',
  'label.rename': 'write',
  'label.delete': 'destructive',
  'comment.create': 'write',
  'comment.edit': 'write',
  'comment.delete': 'destructive',
  'savedView.create': 'write',
  'savedView.update': 'write',
  'savedView.delete': 'destructive',
  // The retro. `retro.setPhase` is destructive because advancing out of `brainstorm` publishes every
  // participant's drafts, which cannot be unpublished — exactly the kind of one-way step a
  // least-privilege agent run must not take on its own.
  'retro.openForCycle': 'write',
  'retro.configure': 'write',
  'retro.delete': 'destructive',
  'retro.claimFacilitator': 'write',
  'retro.setFacilitator': 'write',
  'retro.setPhase': 'destructive',
  'retro.startTimer': 'write',
  'retro.stopTimer': 'write',
  'retro.convertActionToIssue': 'write',
  'retroDraft.create': 'write',
  'retroDraft.update': 'write',
  'retroDraft.delete': 'destructive',
  'retroCard.move': 'write',
  'retroCard.delete': 'destructive',
  'retroGroup.create': 'write',
  'retroGroup.label': 'write',
  'retroGroup.dissolve': 'destructive',
  'retroVote.cast': 'write',
  'retroVote.retract': 'write',
  'retroAction.create': 'write',
  'retroAction.update': 'write',
  'retroAction.delete': 'destructive',
  'retroPresence.heartbeat': 'write',
}

// Each mutator name -> its exported Zod args schema (the tool `inputSchema`).
const MUTATOR_TOOL_ARGS: Record<string, z.ZodType> = {
  'workspace.rename': renameWorkspaceArgs,
  'preference.set': setPreferenceArgs,
  'notification.markRead': markNotificationReadArgs,
  'notification.markAllRead': markAllNotificationsReadArgs,
  'issueSubscription.follow': followIssueArgs,
  'issueSubscription.unfollow': unfollowIssueArgs,
  'member.changeRole': changeMemberRoleArgs,
  'member.remove': removeMemberArgs,
  'team.create': createTeamArgs,
  'team.rename': renameTeamArgs,
  'team.archive': archiveTeamArgs,
  'team.setAutoStatus': setTeamAutoStatusArgs,
  'team.addMember': addTeamMemberArgs,
  'team.removeMember': removeTeamMemberArgs,
  'invite.create': createInviteArgs,
  'invite.revoke': revokeInviteArgs,
  'issue.create': createIssueArgs,
  'issue.update': updateIssueArgs,
  'issue.setStatus': setIssueStatusArgs,
  'issue.setPriority': setIssuePriorityArgs,
  'issue.assign': assignIssueArgs,
  'issue.move': moveIssueArgs,
  'issue.setCycle': setIssueCycleArgs,
  'issue.setProject': setIssueProjectArgs,
  'issue.addLabel': addIssueLabelArgs,
  'issue.removeLabel': removeIssueLabelArgs,
  'issue.flagTriage': flagTriageArgs,
  'issue.acceptTriage': acceptTriageArgs,
  'issue.declineTriage': declineTriageArgs,
  'issue.routeIssue': routeIssueArgs,
  'cycle.create': createCycleArgs,
  'cycle.update': updateCycleArgs,
  'cycle.activate': activateCycleArgs,
  'cycle.complete': completeCycleArgs,
  'project.create': createProjectArgs,
  'project.update': updateProjectArgs,
  'project.delete': deleteProjectArgs,
  'label.create': createLabelArgs,
  'label.rename': renameLabelArgs,
  'label.delete': deleteLabelArgs,
  'comment.create': createCommentArgs,
  'comment.edit': editCommentArgs,
  'comment.delete': deleteCommentArgs,
  'savedView.create': createSavedViewArgs,
  'savedView.update': updateSavedViewArgs,
  'savedView.delete': deleteSavedViewArgs,
  'retro.openForCycle': openRetroForCycleArgs,
  'retro.configure': configureRetroArgs,
  'retro.delete': deleteRetroArgs,
  'retro.claimFacilitator': claimRetroFacilitatorArgs,
  'retro.setFacilitator': setRetroFacilitatorArgs,
  'retro.setPhase': setRetroPhaseArgs,
  'retro.startTimer': startRetroTimerArgs,
  'retro.stopTimer': stopRetroTimerArgs,
  'retro.convertActionToIssue': convertRetroActionToIssueArgs,
  'retroDraft.create': createRetroDraftArgs,
  'retroDraft.update': updateRetroDraftArgs,
  'retroDraft.delete': deleteRetroDraftArgs,
  'retroCard.move': moveRetroCardArgs,
  'retroCard.delete': deleteRetroCardArgs,
  'retroGroup.create': createRetroGroupArgs,
  'retroGroup.label': labelRetroGroupArgs,
  'retroGroup.dissolve': dissolveRetroGroupArgs,
  'retroVote.cast': castRetroVoteArgs,
  'retroVote.retract': retractRetroVoteArgs,
  'retroAction.create': createRetroActionArgs,
  'retroAction.update': updateRetroActionArgs,
  'retroAction.delete': deleteRetroActionArgs,
  'retroPresence.heartbeat': retroPresenceHeartbeatArgs,
}

// Every mutator name in the `defineMutators` registry, e.g. `issue.setStatus`. The registry also
// carries a branded `~` phantom property, so only plain-object groups of mutators are walked.
export function mutatorToolNames(): string[] {
  const names: string[] = []
  const groups = mutators as unknown as Record<string, unknown>
  for (const group of Object.values(groups)) {
    if (typeof group !== 'object' || group === null) continue
    for (const mutator of Object.values(group as Record<string, { mutatorName?: string }>)) {
      if (mutator && typeof mutator.mutatorName === 'string') names.push(mutator.mutatorName)
    }
  }
  return names
}

// Derive one tool spec per mutator from `defineMutators`. Throws if a mutator lacks a
// classification or args schema, so the registry can never silently drop a tool (the unit test
// asserts the throw never fires — coverage is exhaustive by construction).
export function buildMutatorToolSpecs(): MutatorToolSpec[] {
  return mutatorToolNames().map((name) => {
    const kind = MUTATOR_TOOL_KINDS[name]
    const args = MUTATOR_TOOL_ARGS[name]
    if (kind === undefined || args === undefined) {
      throw new Error(`ai tool registry is missing an entry for mutator "${name}"`)
    }
    return { name, kind, args }
  })
}

// Every mutator tool is a state change, so all require human approval (reads auto-run, but reads
// are exposed separately, never as a mutator tool). Kept as a predicate so the wiring reads
// intent, not a bare boolean.
export function needsApproval(_kind: ToolKind): boolean {
  return true
}

export interface ActiveToolOptions {
  // Allow plain writes (default false — a read-only/summarize run mounts no write tools).
  readonly allowWrites?: boolean
  // Allow destructive writes (default false even when writes are allowed — least privilege).
  readonly allowDestructive?: boolean
}

// Least-privilege tool selection per task: choose the subset of mutator tools a run may call.
// A "summarize this cycle" run passes nothing (reads only); a member's edit run passes
// `allowWrites`; destructive tools stay off unless explicitly opted in.
export function activeMutatorTools(
  specs: readonly MutatorToolSpec[],
  options: ActiveToolOptions = {},
): string[] {
  const { allowWrites = false, allowDestructive = false } = options
  return specs
    .filter((spec) => {
      if (spec.kind === 'destructive') return allowWrites && allowDestructive
      return allowWrites
    })
    .map((spec) => spec.name)
}

// The audit shape for an agent-initiated mutation: the actor is the agent, acting on behalf of
// the invoking user, whose `AuthContext` was the enforced ceiling.
export interface AgentAuditEntry {
  readonly actor: 'agent'
  readonly onBehalfOf: string
  readonly tool: string
  readonly kind: ToolKind
}

export function agentAuditEntry(
  userId: string,
  spec: Pick<MutatorToolSpec, 'name' | 'kind'>,
): AgentAuditEntry {
  return { actor: 'agent', onBehalfOf: userId, tool: spec.name, kind: spec.kind }
}
