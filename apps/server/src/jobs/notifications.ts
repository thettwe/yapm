import type { NotificationDigestItem } from '@yapm/email'
import { renderNotificationDigest } from '@yapm/email'
import {
  ACTIONABLE_NOTIFICATION_KINDS,
  isActionableNotification,
  notificationCopy,
} from '@yapm/schema'
import type { DB, NotificationKey, PendingNotificationEmail } from '@yapm/schema/db'
import {
  deleteNotificationsOlderThan,
  pendingNotificationEmails,
  stampNotificationsEmailed,
} from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import type { Mailer } from '../mail/index.js'

export const NOTIFICATION_EMAIL_QUEUE = 'notification-email'
export const NOTIFICATION_RETENTION_QUEUE = 'notification-retention'

// The debounce (design D14): a notification is only mailed once it has sat unread for this long, so
// a burst of writes becomes one message and anything read in-app in the meantime is never mailed.
// A constant rather than an env var because it is only meaningful relative to the sweep cron — an
// operator who lengthens the cron does not need to re-tune it.
export const NOTIFICATION_EMAIL_DEBOUNCE_MS = 2 * 60 * 1000

// Never resurrect a backlog: turning email on for an existing instance mails nothing older than
// this, so the first sweep is not a month of history.
export const NOTIFICATION_EMAIL_MAX_AGE_MS = 24 * 60 * 60 * 1000

// One sweep's ceiling. Bounds both the query and the number of messages a single cron tick can
// hand a relay; the remainder is picked up by the next tick, still unstamped.
export const NOTIFICATION_EMAIL_BATCH_LIMIT = 500

const DAY_MS = 24 * 60 * 60 * 1000

// The inbox opens an issue at `/teams/$teamId/issues?open=<id>` (apps/web inbox-view). Email cannot
// use the router, so the one place that path is spelled as a string is here — and if the route ever
// moves, an email link is the thing that breaks silently, which is why it is named rather than
// inlined at the call site.
// Switching on `subjectType` rather than ignoring it is what makes a future subject type a compile
// error here instead of an email full of issue links to something that is not an issue.
export function notificationSubjectPath(row: {
  subjectType: PendingNotificationEmail['subjectType']
  teamId: string
  subjectId: string
}): string {
  switch (row.subjectType) {
    case 'issue':
      return `/teams/${row.teamId}/issues?open=${encodeURIComponent(row.subjectId)}`
  }
}

// The per-recipient batch: exactly one message, and exactly the keys it covers, so a send that
// succeeds stamps what it sent and a send that fails stamps nothing.
export interface NotificationEmailBatch {
  readonly recipientId: string
  readonly to: string
  readonly keys: readonly NotificationKey[]
  readonly items: readonly NotificationDigestItem[]
}

function keyOf(row: PendingNotificationEmail): NotificationKey {
  return {
    recipientId: row.recipientId,
    kind: row.kind,
    subjectId: row.subjectId,
    eventKey: row.eventKey,
  }
}

// H1's posture, applied per recipient: `assigned_only` (the default) emails only kinds addressed at
// a person, `all` emails every kind, `none` emails nothing. The in-app row is never affected —
// the preference governs delivery, not the notification.
//
// DEFENCE IN DEPTH. The same rule is applied in SQL, before the sweep's `limit`, so a `none`-mode
// recipient's backlog can never consume the batch budget (`pendingNotificationEmails`). This keeps
// the classification testable without a database and catches any caller that reads pending rows
// some other way.
function wantsEmail(row: PendingNotificationEmail): boolean {
  switch (row.mode) {
    case 'none':
      return false
    case 'all':
      return true
    case 'assigned_only':
      return isActionableNotification(row.kind)
  }
}

// Pure: pending rows in, one batch per recipient out, preserving the query's order. Separated from
// the sweep so the grouping, the preference filter and the copy are testable without a database.
export function groupNotificationEmails(
  rows: readonly PendingNotificationEmail[],
): readonly NotificationEmailBatch[] {
  const batches = new Map<
    string,
    { to: string; keys: NotificationKey[]; items: NotificationDigestItem[] }
  >()

  for (const row of rows) {
    if (!wantsEmail(row)) continue
    const existing = batches.get(row.recipientId) ?? { to: row.email, keys: [], items: [] }
    const copy = notificationCopy({
      kind: row.kind,
      actorName: row.actorName,
      subjectKey: row.subjectKey,
      subjectTitle: row.subjectTitle,
    })
    existing.keys.push(keyOf(row))
    existing.items.push({
      title: copy.title,
      summary: copy.summary,
      path: notificationSubjectPath(row),
    })
    batches.set(row.recipientId, existing)
  }

  return [...batches].map(([recipientId, batch]) => ({
    recipientId,
    to: batch.to,
    keys: batch.keys,
    items: batch.items,
  }))
}

export interface SweepLogger {
  info: (obj: object, msg: string) => void
  error: (obj: object, msg: string) => void
}

export interface NotificationEmailSweepOptions {
  db: Kysely<DB>
  // Null means email is off. The sweep is then a total no-op: it reads nothing, sends nothing and
  // stamps nothing, so registering it anyway can never surprise anyone.
  mailer: Mailer | null
  publicUrl: string | null
  logger: SweepLogger
  now: number
}

export interface NotificationEmailSweepResult {
  readonly recipients: number
  readonly notifications: number
  readonly failures: number
}

const EMPTY_SWEEP: NotificationEmailSweepResult = { recipients: 0, notifications: 0, failures: 0 }

// One pass of the delivery sweep. Every failure is contained here: a transport error fails exactly
// one recipient's batch, leaves that batch's rows unstamped for the next window, and the sweep
// carries on with the rest. Nothing thrown escapes to pg-boss, so no job retries forever and the
// cycle and connector jobs sharing this process are never disturbed.
export async function runNotificationEmailSweep(
  options: NotificationEmailSweepOptions,
): Promise<NotificationEmailSweepResult> {
  const { db, mailer, publicUrl, logger, now } = options
  if (mailer === null || publicUrl === null) return EMPTY_SWEEP

  const rows = await pendingNotificationEmails(db, {
    createdBefore: new Date(now - NOTIFICATION_EMAIL_DEBOUNCE_MS),
    createdAfter: new Date(now - NOTIFICATION_EMAIL_MAX_AGE_MS),
    actionableKinds: [...ACTIONABLE_NOTIFICATION_KINDS],
    limit: NOTIFICATION_EMAIL_BATCH_LIMIT,
  })

  const batches = groupNotificationEmails(rows)
  if (batches.length === 0) return EMPTY_SWEEP

  let recipients = 0
  let notifications = 0
  let failures = 0

  for (const batch of batches) {
    try {
      const message = await renderNotificationDigest({ publicUrl, items: batch.items })
      await mailer.send({ to: [batch.to], message })
      await stampNotificationsEmailed(db, batch.keys, new Date(now))
      recipients += 1
      notifications += batch.keys.length
    } catch (error) {
      failures += 1
      logger.error(
        { err: error, transport: mailer.transport, notifications: batch.keys.length },
        'notification email delivery failed; rows left unstamped for the next sweep',
      )
    }
  }

  if (recipients > 0 || failures > 0) {
    logger.info({ recipients, notifications, failures }, 'notification email sweep ran')
  }
  return { recipients, notifications, failures }
}

export interface NotificationRetentionOptions {
  db: Kysely<DB>
  retentionDays: number
  logger: SweepLogger
  now: number
}

// Retention runs whether or not a mailer exists: it is what bounds the synced set, which is a
// hydration cost on every client, not an email feature.
export async function runNotificationRetention(
  options: NotificationRetentionOptions,
): Promise<number> {
  const { db, retentionDays, logger, now } = options
  const deleted = await deleteNotificationsOlderThan(db, new Date(now - retentionDays * DAY_MS))
  if (deleted > 0) {
    logger.info({ deleted, retentionDays }, 'notification retention swept')
  }
  return deleted
}
