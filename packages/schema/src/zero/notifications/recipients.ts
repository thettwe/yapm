// Who a triggering mutation tells, computed as a pure function of ids so the rule is testable
// without a database and identical wherever it runs.
//
// The cap is not hygiene. The fan-out runs INSIDE the triggering mutation's own Postgres
// transaction, so a pathological issue — hundreds of distinct prior commenters — would turn a
// one-row update into a long transaction holding locks. Bounding the recipient set here bounds the
// insert, and the prior-commenter read that feeds it is bounded by the same constant.
export const NOTIFICATION_RECIPIENT_CAP = 50

function collect(candidates: readonly (string | null | undefined)[], actorId: string): string[] {
  const seen = new Set<string>()
  const recipients: string[] = []
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue
    // Nobody is notified about their own action — which also makes a self-assignment silent.
    if (candidate === actorId) continue
    if (seen.has(candidate)) continue
    seen.add(candidate)
    recipients.push(candidate)
    if (recipients.length >= NOTIFICATION_RECIPIENT_CAP) break
  }
  return recipients
}

export interface AssignmentRecipientsInput {
  readonly assigneeId: string | null | undefined
  readonly actorId: string
}

// An assignment is addressed at exactly one person: the assignee the mutation set.
export function assignmentRecipients(input: AssignmentRecipientsInput): string[] {
  return collect([input.assigneeId], input.actorId)
}

export interface CommentRecipientsInput {
  readonly assigneeId: string | null | undefined
  readonly creatorId: string | null | undefined
  readonly priorCommenterIds: readonly string[]
  readonly actorId: string
}

// A comment reaches everyone already involved in the issue: its assignee, its creator, and whoever
// commented before. Order is stable (assignee, creator, then commenters oldest-first) so the row
// set a test asserts on does not depend on iteration luck.
export function commentRecipients(input: CommentRecipientsInput): string[] {
  return collect([input.assigneeId, input.creatorId, ...input.priorCommenterIds], input.actorId)
}
