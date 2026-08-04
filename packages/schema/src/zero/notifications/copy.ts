import type { NotificationKind } from '../context.js'

// The one place a notification is turned into words, shared by the inbox row and the email
// template so the two can never describe the same event differently.
//
// WHAT IS NOT HERE, and must not arrive later: any excerpt of the comment body. Leaving it out
// removes a content leak at send time (an email is delivered outside the app's permission model)
// and means this change needs no rich-text-to-plaintext walker at all — that dependency belongs to
// the later `mentions` change, which owns the document walk anyway.

export interface NotificationCopyInput {
  readonly kind: NotificationKind
  readonly actorName: string | null
  readonly subjectKey: string | null
  readonly subjectTitle: string
}

export interface NotificationCopy {
  // The actor-and-verb line: what happened, and who did it.
  readonly title: string
  // The subject it happened to, as it was at the time (design D3).
  readonly summary: string
}

const UNKNOWN_ACTOR = 'Someone'

function actorLabel(actorName: string | null): string {
  const trimmed = actorName?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : UNKNOWN_ACTOR
}

function titleFor(kind: NotificationKind, actor: string, subject: string): string {
  switch (kind) {
    case 'issue_assigned':
      return `${actor} assigned you ${subject}`
    case 'issue_commented':
      return `${actor} commented on ${subject}`
    case 'mention':
      return `${actor} mentioned you in ${subject}`
    case 'pm_digest_published':
      return PM_DIGEST_PUBLISHED_TITLE
  }
}

// ACTOR-FREE, and that is the point rather than an omission. A PM outside the team learning WHICH
// individual released a digest is accountability in the wrong direction — the same refusal that kept
// `published_by` out of the Zero schema. The fan-out writes the system principal, and because the
// title never interpolates an actor the `'Someone'` fallback can never render here either.
const PM_DIGEST_PUBLISHED_TITLE = 'A cycle digest was shared with you'

export function notificationCopy(input: NotificationCopyInput): NotificationCopy {
  const actor = actorLabel(input.actorName)
  const subject = input.subjectKey ?? 'an issue'
  return {
    title: titleFor(input.kind, actor, subject),
    summary: input.subjectTitle,
  }
}
