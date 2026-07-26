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
}: {
  teamMembers: readonly MentionTeamMember[]
  workspaceMembers: readonly MentionMemberRow[]
  users: readonly MentionUserRow[]
  selfId: string | null
}): MentionCandidate[] {
  const onTeam = new Set(teamMembers.map((member) => member.id))
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
    const admin = member.role === 'admin'
    candidates.push({
      id: member.userId,
      name: mentionDisplayName(user, member.userId),
      email: user?.email ?? undefined,
      image: user?.image ?? undefined,
      eligible: admin,
      ...(admin ? { matchOnly: true } : { reason: NOT_ON_TEAM_REASON }),
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
