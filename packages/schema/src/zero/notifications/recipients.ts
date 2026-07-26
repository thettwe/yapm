// Who a triggering mutation tells, computed as a pure function of ids so the rule is testable
// without a database and identical wherever it runs.
//
// The cap is not hygiene. The fan-out runs INSIDE the triggering mutation's own Postgres
// transaction, so a pathological issue — hundreds of distinct prior commenters — would turn a
// one-row update into a long transaction holding locks. Bounding the recipient set here bounds the
// insert, and the prior-commenter read that feeds it is bounded by the same constant.
export const NOTIFICATION_RECIPIENT_CAP = 50

// Deduplicates in first-seen order, dropping blanks and the actor. Deliberately UNCAPPED: which end
// of an over-long list is safe to discard is the caller's knowledge, not this helper's, and a cap
// applied here can only ever fall on the end the list happens to be built from.
function distinct(
  candidates: readonly (string | null | undefined)[],
  actorId: string,
  seen: Set<string>,
): string[] {
  const recipients: string[] = []
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue
    // Nobody is notified about their own action — which also makes a self-assignment silent.
    if (candidate === actorId) continue
    if (seen.has(candidate)) continue
    seen.add(candidate)
    recipients.push(candidate)
  }
  return recipients
}

export interface AssignmentRecipientsInput {
  readonly assigneeId: string | null | undefined
  readonly actorId: string
}

// An assignment is addressed at exactly one person: the assignee the mutation set.
export function assignmentRecipients(input: AssignmentRecipientsInput): string[] {
  return distinct([input.assigneeId], input.actorId, new Set<string>())
}

export interface CommentRecipientsInput {
  readonly assigneeId: string | null | undefined
  readonly creatorId: string | null | undefined
  // Oldest-first, as the fan-out hands them over.
  readonly priorCommenterIds: readonly string[]
  readonly actorId: string
}

// A comment reaches everyone already involved in the issue: its assignee, its creator, and whoever
// commented before. Order is stable (assignee, creator, then commenters oldest-first) so the row
// set a test asserts on does not depend on iteration luck.
export function commentRecipients(input: CommentRecipientsInput): string[] {
  const seen = new Set<string>()
  // The assignee and the creator are addressed by the issue itself, so they hold their slots
  // unconditionally — at most two of the budget.
  const involved = distinct([input.assigneeId, input.creatorId], input.actorId, seen)
  const commenters = distinct(input.priorCommenterIds, input.actorId, seen)
  // TRUNCATE FROM THE OLDEST END, after the union rather than during it. The assignee and the
  // creator spend slots out of the same budget, so filling the cap front-to-back down an
  // oldest-first list drops however many they took off the NEWEST end — on a thread past the cap,
  // exactly the two people most recently in the conversation. Dropping the least-recent
  // participants instead is what the bound is for.
  const budget = Math.max(0, NOTIFICATION_RECIPIENT_CAP - involved.length)
  return [...involved, ...commenters.slice(Math.max(0, commenters.length - budget))]
}
