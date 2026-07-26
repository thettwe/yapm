import type { WorkspaceRole } from '@yapm/schema'
import type { MentionCandidate } from '@yapm/ui/components/rich-text'

// The copy a person sees when the name they typed belongs to someone who cannot read this issue.
// It names a fact about the issue, not about them: a mention that looks like it worked and did
// not is the worst outcome for a communication feature, and an accusation is the second worst.
export const NOT_ON_TEAM_REASON = "Not on this team — can't be mentioned here"

export interface MentionUserRow {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
}

export interface MentionMemberRow {
  userId: string
  role: WorkspaceRole
}

export interface MentionTeamMember {
  id: string
  name: string
  image?: string | null
}

export function mentionDisplayName(user: MentionUserRow | undefined, fallback: string): string {
  return user?.name ?? user?.email ?? fallback
}

export interface MentionScope {
  teamMembers: readonly MentionTeamMember[]
  workspaceMembers: readonly MentionMemberRow[]
  selfId: string | null
}

/**
 * WHO CAN READ THIS ISSUE, and therefore who may be mentioned on it: a member of the issue's team,
 * or a workspace admin. The client's copy of the server's `eligibleMentionees` predicate, kept in
 * one place because two surfaces need it — the typeahead, which must not offer a name the server
 * would drop, and the renderer, which must not resolve a name for somebody who cannot read the
 * document containing it.
 *
 * The viewer is included: a self-mention notifies nobody but still stores and renders normally.
 */
export function eligibleMentionIds({
  teamMembers,
  workspaceMembers,
  selfId,
}: MentionScope): ReadonlySet<string> {
  const ids = new Set(teamMembers.map((member) => member.id))
  for (const member of workspaceMembers) {
    if (member.role === 'admin') ids.add(member.userId)
  }
  if (selfId !== null) ids.add(selfId)
  return ids
}

/**
 * Every person the `@` list may know about on this issue, in three bands.
 *
 * ELIGIBILITY mirrors the server's read predicate — a member of the issue's team, or a workspace
 * admin — because a name the UI offers and the server then drops would be a mention that silently
 * did nothing. CANDIDACY is narrower: an admin who is not on the team is `matchOnly`, so they do
 * not pad a team's list but still appear once the author names them. Everybody else in the
 * workspace is carried as INELIGIBLE with a reason, so the list can say why rather than going
 * quiet on a name the author can see in every other surface of the app.
 *
 * This reveals nothing new: `queries.users.all` already replicates the whole user table to every
 * workspace member, and `queries.teams.all().related('members')` every team's membership.
 */
export function buildMentionables({
  teamMembers,
  workspaceMembers,
  users,
  selfId,
}: MentionScope & { users: readonly MentionUserRow[] }): MentionCandidate[] {
  const onTeam = new Set(teamMembers.map((member) => member.id))
  const eligible = eligibleMentionIds({ teamMembers, workspaceMembers, selfId })
  const byId = new Map(users.map((user) => [user.id, user]))
  const candidates: MentionCandidate[] = []

  for (const member of teamMembers) {
    if (member.id === selfId) continue
    const user = byId.get(member.id)
    candidates.push({
      id: member.id,
      name: member.name,
      email: user?.email ?? undefined,
      image: member.image ?? undefined,
      eligible: true,
    })
  }

  for (const member of workspaceMembers) {
    if (onTeam.has(member.userId) || member.userId === selfId) continue
    const user = byId.get(member.userId)
    // Eligible off the team means an admin, from the one predicate above rather than from a second
    // reading of `role` that could drift away from it.
    const canMention = eligible.has(member.userId)
    candidates.push({
      id: member.userId,
      name: mentionDisplayName(user, member.userId),
      email: user?.email ?? undefined,
      image: user?.image ?? undefined,
      eligible: canMention,
      ...(canMention ? { matchOnly: true } : { reason: NOT_ON_TEAM_REASON }),
    })
  }

  return candidates
}

/**
 * The id→name map every rendered mention resolves through. Built from the live user rows so a
 * rename reaches every existing document, and so a hand-crafted `label` cannot make a mention
 * appear to name somebody it does not.
 */
export function mentionNamesFrom(users: readonly MentionUserRow[]): ReadonlyMap<string, string> {
  return new Map(users.map((user) => [user.id, mentionDisplayName(user, user.id)]))
}

/**
 * The same map, narrowed to the people who can read THIS issue — which is the form every render
 * surface wants. Built from the whole workspace roster instead, a mention of somebody who cannot
 * read the issue resolves and renders as a full chip, so only half of "an unresolvable OR
 * ineligible mention renders inert" would ship. An id absent from the map falls through to the
 * renderer's existing safe default: inert `@label` text, no chip.
 */
export function mentionNamesFor(
  scope: MentionScope & { users: readonly MentionUserRow[] },
): ReadonlyMap<string, string> {
  const eligible = eligibleMentionIds(scope)
  return mentionNamesFrom(scope.users.filter((user) => eligible.has(user.id)))
}
