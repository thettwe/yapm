import type { DB } from '@yapm/schema/db'
import { deleteAttachment, listOrphanedAttachments } from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import type { Logger } from '../logger.js'
import { objectKeyFor, type StorageProvider, thumbnailKeyFor } from '../storage/provider.js'

export const ATTACHMENT_GC_QUEUE = 'attachment-gc'

// One pass's ceiling. Bounded so a single cron tick can never be unbounded work against a database
// that is also serving requests; the remainder is picked up by the next tick, still orphaned.
export const ATTACHMENT_GC_BATCH_LIMIT = 500

const HOUR_MS = 60 * 60 * 1000

export interface AttachmentGcOptions {
  db: Kysely<DB>
  provider: StorageProvider
  logger: Pick<Logger, 'info' | 'error'>
  graceHours: number
  now: number
  limit?: number
}

export interface AttachmentGcResult {
  readonly collected: number
  readonly failed: number
}

// The sweep that stops abandoned pastes accumulating: an attachment with NEITHER an issue nor a
// comment, older than the grace window, has its bytes and its row removed.
//
// ORDER IS THUMBNAIL → OBJECT → ROW, objects before the row. A crash between them leaves a row
// whose bytes are gone, which the read path already folds into the standard refusal — rather than
// bytes nobody can name, which is a leak only a bucket listing could find.
//
// DANGLING OBJECTS ARE NOT SWEPT. Listing a bucket to find objects with no row is an O(objects)
// operation against a paid API on a cron, and this ordering makes the leak one-directional and
// small. An operator-run reconciliation belongs with `yapm backup`, not here.
//
// The grace window has a real sharp edge: somebody who uploads an image and then leaves the tab
// open longer than the window without the document saving loses it. The 24-hour default makes that
// essentially impossible for a human, and it is env-tunable for an operator who disagrees — but it
// is a policy, not a proof.
//
// Contains its own per-row failures and NEVER rejects, so this worker cannot disturb the cycle,
// notification or search jobs sharing the process.
export async function runAttachmentGc(options: AttachmentGcOptions): Promise<AttachmentGcResult> {
  const { db, provider, logger, graceHours, now } = options
  const limit = options.limit ?? ATTACHMENT_GC_BATCH_LIMIT

  let orphans: Awaited<ReturnType<typeof listOrphanedAttachments>>
  try {
    orphans = await listOrphanedAttachments(db, {
      createdBefore: new Date(now - graceHours * HOUR_MS),
      limit,
    })
  } catch (error) {
    logger.error({ err: error }, 'attachment gc could not list orphans; skipping this pass')
    return { collected: 0, failed: 0 }
  }

  let collected = 0
  let failed = 0

  for (const orphan of orphans) {
    try {
      await provider.delete(thumbnailKeyFor(orphan.teamId, orphan.id))
      await provider.delete(objectKeyFor(orphan.teamId, orphan.id))
      await deleteAttachment(db, orphan.id)
      collected += 1
    } catch (error) {
      // One unreachable object must not abort the pass — the next tick re-selects this row, because
      // it is still an orphan, and the ones after it are collected now rather than never.
      failed += 1
      logger.error({ err: error, attachmentId: orphan.id }, 'attachment gc failed for one row')
    }
  }

  if (collected > 0 || failed > 0) {
    logger.info({ collected, failed, graceHours }, 'attachment orphan sweep ran')
  }
  return { collected, failed }
}
