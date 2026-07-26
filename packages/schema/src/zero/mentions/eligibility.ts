import type { Transaction } from '@rocicorp/zero'
import { zql } from '../schema.js'

// WHO MAY BE MENTIONED ON AN ISSUE — the authoritative answer, server-side.
//
// It is the same disjunction `teamScoped` (queries.ts) and `assertTeamAccess` (mutators.ts)
// implement: a workspace ADMIN, or a member of the ISSUE'S TEAM. Mentionability is a READ
// predicate, not a write one, which is why a viewer on the team qualifies and why the admin bypass
// is included rather than quietly dropped — an admin genuinely can read the issue, so excluding
// them would make the eligibility rule a lie about the permission it claims to mirror.
//
// It DENIES BY OMISSION. A candidate who is unknown and a candidate who is disallowed both simply
// fail to appear in the returned set; there is no error and no distinction, so the fan-out can
// never be used to probe whether an id names a real person.

// The intersection, separated out so the rule is unit-testable with no database: a candidate
// survives iff the team or the admin read named them, and the result keeps the candidates' own
// order rather than either read's.
export function intersectEligible(
  candidateIds: readonly string[],
  teamMemberIds: Iterable<string>,
  workspaceAdminIds: Iterable<string>,
): Set<string> {
  const allowed = new Set<string>(teamMemberIds)
  for (const id of workspaceAdminIds) allowed.add(id)
  return new Set(candidateIds.filter((id) => allowed.has(id)))
}

// TWO READS, BOTH BOUNDED, NEVER ONE PER CANDIDATE. This runs inside the triggering mutation's
// open transaction, so N round trips is exactly the lock-holding pattern
// `NOTIFICATION_RECIPIENT_CAP` exists to prevent — and `candidateIds` arrives already capped, so
// both `IN` lists are bounded by that same constant.
export async function eligibleMentionees(
  tx: Transaction,
  teamId: string,
  candidateIds: readonly string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set<string>()

  const memberships = (await tx.run(
    zql.team_membership.where('teamId', teamId).where('userId', 'IN', candidateIds),
  )) as { userId: string }[]
  const admins = (await tx.run(
    zql.workspace_member.where('role', 'admin').where('userId', 'IN', candidateIds),
  )) as { userId: string }[]

  return intersectEligible(
    candidateIds,
    memberships.map((membership) => membership.userId),
    admins.map((admin) => admin.userId),
  )
}
