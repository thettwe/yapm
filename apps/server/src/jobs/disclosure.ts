import { renderPmDigestReady } from '@yapm/email'
import type { DB, PendingPmDigestReadyEmail } from '@yapm/schema/db'
import {
  deleteDisclosureAuditOlderThan,
  pendingPmDigestReadyEmails,
  resolvePmAudienceTeamIds,
  stampNotificationsEmailed,
} from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import type { Mailer } from '../mail/index.js'
import {
  NOTIFICATION_EMAIL_BATCH_LIMIT,
  NOTIFICATION_EMAIL_DEBOUNCE_MS,
  NOTIFICATION_EMAIL_MAX_AGE_MS,
  type SweepLogger,
} from './notifications.js'

export const AI_DISCLOSURE_RETENTION_QUEUE = 'ai-disclosure-retention'
export const AI_PM_DIGEST_READY_QUEUE = 'ai-pm-digest-ready-email'

const DAY_MS = 24 * 60 * 60 * 1000

export interface DisclosureRetentionOptions {
  db: Kysely<DB>
  retentionDays: number
  logger: SweepLogger
  now: number
}

// The bound on `ai_disclosure_audit`, and the only one it has. An audit log that grows without limit
// is not a governed one — it is an unbounded per-workspace record kept until the disk fills.
//
// It runs whether or not AI is switched on and whether or not a mailer exists, exactly like
// notification retention and unlike every AI block: an instance that once had disclosure enabled and
// then turned `AI_PM_DIGEST` off must still have its log swept, because a bound that stops being
// enforced when the feature is disabled is not a bound.
//
// Idempotent by construction — the delete is `created_at < cutoff`, so a second run in the same
// window removes nothing — and it logs only when it actually deleted something, matching
// `runNotificationRetention`.
export async function runDisclosureRetention(options: DisclosureRetentionOptions): Promise<number> {
  const { db, retentionDays, logger, now } = options
  const deleted = await deleteDisclosureAuditOlderThan(db, new Date(now - retentionDays * DAY_MS))
  if (deleted > 0) {
    logger.info({ deleted, retentionDays }, 'ai disclosure audit retention swept')
  }
  return deleted
}

export interface PmDigestReadyEmailSweepOptions {
  db: Kysely<DB>
  // Null means the notice is off, or no transport is configured. The sweep is then a TOTAL no-op: it
  // reads nothing, sends nothing and stamps nothing, so registering it anyway can never surprise
  // anyone — the same clean disablement every other email in this product has.
  mailer: Mailer | null
  publicUrl: string | null
  logger: SweepLogger
  now: number
}

export interface PmDigestReadyEmailSweepResult {
  readonly sent: number
  // Selected, then dropped because the reader's entitlement no longer covers the notice's team.
  readonly withheld: number
  readonly failures: number
}

const EMPTY_SWEEP: PmDigestReadyEmailSweepResult = { sent: 0, withheld: 0, failures: 0 }

// The label the fan-out baked into `subject_title`, split back into its two halves for the template.
// A notice whose label does not carry the separator still renders — the team half degrades to the
// whole string and the cycle half to the empty string — because a missing cycle name is not a reason
// to withhold a link somebody was told they would get.
function labelOf(row: PendingPmDigestReadyEmail): { teamName: string; cycleName: string } {
  const [teamName, ...rest] = row.subjectTitle.split(' · ')
  return { teamName: teamName ?? '', cycleName: rest.join(' · ') }
}

// One pass of the ready-notice sweep.
//
// ENTITLEMENT IS RE-RESOLVED HERE, per recipient, through `resolvePmAudienceTeamIds` — the one
// resolver — because the selecting query deliberately carries no access predicate of its own. A
// reader dropped from the audience, a team whose `pmVisible` was turned off, or a workspace whose
// kill switch was set between publish and sweep is withheld and left unstamped: if entitlement comes
// back, so does the notice. The fourth way a read can stop — the digest being retracted — is carried
// by the selection itself, and is left unstamped for the same reason.
//
// Every failure is contained: a transport error fails exactly one recipient, leaves their rows
// unstamped for the next window, and the sweep carries on. Nothing thrown escapes to pg-boss.
export async function runPmDigestReadyEmailSweep(
  options: PmDigestReadyEmailSweepOptions,
): Promise<PmDigestReadyEmailSweepResult> {
  const { db, mailer, publicUrl, logger, now } = options
  if (mailer === null || publicUrl === null) return EMPTY_SWEEP

  const rows = await pendingPmDigestReadyEmails(db, {
    createdBefore: new Date(now - NOTIFICATION_EMAIL_DEBOUNCE_MS),
    createdAfter: new Date(now - NOTIFICATION_EMAIL_MAX_AGE_MS),
    limit: NOTIFICATION_EMAIL_BATCH_LIMIT,
  })
  if (rows.length === 0) return EMPTY_SWEEP

  // One resolve per recipient, not per row: a reader named on several teams that all published in
  // the same window would otherwise re-read the same config blob once per notice.
  const entitlements = new Map<string, ReadonlySet<string>>()
  const entitlementOf = async (recipientId: string): Promise<ReadonlySet<string>> => {
    const cached = entitlements.get(recipientId)
    if (cached !== undefined) return cached
    const resolved = new Set(await resolvePmAudienceTeamIds(db, recipientId))
    entitlements.set(recipientId, resolved)
    return resolved
  }

  let sent = 0
  let withheld = 0
  let failures = 0

  for (const row of rows) {
    const entitled = await entitlementOf(row.recipientId)
    if (!entitled.has(row.teamId)) {
      withheld += 1
      continue
    }
    try {
      const message = await renderPmDigestReady({ publicUrl, ...labelOf(row) })
      await mailer.send({ to: [row.email], message })
      await stampNotificationsEmailed(
        db,
        [
          {
            recipientId: row.recipientId,
            kind: row.kind,
            subjectId: row.subjectId,
            eventKey: row.eventKey,
          },
        ],
        new Date(now),
      )
      sent += 1
    } catch (error) {
      failures += 1
      logger.error(
        { err: error, transport: mailer.transport },
        'pm digest ready notice delivery failed; the row is left unstamped for the next sweep',
      )
    }
  }

  if (sent > 0 || withheld > 0 || failures > 0) {
    logger.info({ sent, withheld, failures }, 'pm digest ready notice sweep ran')
  }
  return { sent, withheld, failures }
}
