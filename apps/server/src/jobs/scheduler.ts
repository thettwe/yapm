import { type CycleFacts, newId, upsertCycleDigest } from '@yapm/schema'
import { cycleFactsForTeam, cyclesNeedingDigest, type DB } from '@yapm/schema/db'
import { createServerMutators } from '@yapm/schema/server'
import type { Kysely } from 'kysely'
import { fromKysely, PgBoss, type QueuePolicy } from 'pg-boss'
import { enrichCycleFactsWithAreas } from '../ai/areas.js'
import { runCycleDigest } from '../ai/digest.js'
import type { AiGateway } from '../ai/gateway.js'
import type { ChangedFilesReader } from '../connectors/github/files.js'
import type { Logger } from '../logger.js'
import type { Mailer } from '../mail/index.js'
import type { StorageProvider } from '../storage/provider.js'
import type { ZeroDatabase } from '../zero/db-provider.js'
import { ATTACHMENT_GC_QUEUE, runAttachmentGc } from './attachments.js'
import { type CycleMaintenanceOptions, runCycleMaintenance } from './cycles.js'
import {
  NOTIFICATION_EMAIL_QUEUE,
  NOTIFICATION_RETENTION_QUEUE,
  runNotificationEmailSweep,
  runNotificationRetention,
} from './notifications.js'
import {
  runSearchIndexTail,
  runSearchReconcile,
  SEARCH_INDEX_QUEUE,
  SEARCH_RECONCILE_QUEUE,
} from './search.js'

export const CYCLE_MAINTENANCE_QUEUE = 'cycle-maintenance'
export const CYCLE_DIGEST_QUEUE = 'cycle-digest'
export { ATTACHMENT_GC_QUEUE } from './attachments.js'
export { NOTIFICATION_EMAIL_QUEUE, NOTIFICATION_RETENTION_QUEUE } from './notifications.js'
export { SEARCH_INDEX_QUEUE, SEARCH_RECONCILE_QUEUE } from './search.js'

// The tail's safety net. pg-boss cron granularity is one minute, which is far coarser than the
// re-arm interval — this exists ONLY so a lost or failed job cannot stop indexing forever, which is
// why it is a constant rather than an environment variable. Everything an operator would plausibly
// turn is one.
const SEARCH_INDEX_WATCHDOG_CRON = '* * * * *'

// The manual-completion sweep bound: a cycle completed by hand (through the shared `cycle.complete`
// mutator, which the scheduler never re-selects) is picked up for a digest by the next maintenance
// cron if it completed within this window. Generous enough to survive a slow cron or a brief
// outage, tight enough that enabling AI on an existing instance never back-fills every past cycle.
const MANUAL_COMPLETION_SWEEP_WINDOW_MS = 60 * 60 * 1000
const MANUAL_COMPLETION_SWEEP_LIMIT = 25

export interface Scheduler {
  stop: () => Promise<void>
}

export interface DigestSchedulerOptions {
  // The BYO-key gateway. Present ⇒ a digest is pre-computed at cycle close (gated by
  // AI_DIGEST_ON_CYCLE_CLOSE upstream); absent ⇒ no digest job is scheduled and no facts are read.
  gateway: AiGateway
  // Present ⇒ the worker may enrich the facts with product-area labels before generating. Absent or
  // null (no GitHub App env) ⇒ the digest runs exactly as it did before, un-enriched.
  changedFilesReader?: ChangedFilesReader | null
}

export interface CycleSchedulerOptions {
  cron: string
  digest?: DigestSchedulerOptions
}

// Present ⇒ the delivery sweep is registered. Absent ⇒ it is not, and retention still is: the two
// are gated separately because retention is what bounds the synced set, not an email feature.
export interface NotificationEmailSchedulerOptions {
  mailer: Mailer
  publicUrl: string
  cron: string
}

export interface NotificationSchedulerOptions {
  retentionDays: number
  retentionCron: string
  email?: NotificationEmailSchedulerOptions
}

// Present ⇒ the two index passes are registered on the SHARED boss. Absent (SEARCH_INDEX=false) ⇒
// they are not, and the search route keeps answering from whatever the index already holds.
export interface SearchSchedulerOptions {
  intervalSeconds: number
  reconcileCron: string
  textConfig: string
}

// Present ⇒ the orphaned-attachment sweep is registered on the SHARED boss. Absent ⇒ it is not,
// and unattached uploads simply accumulate — which is a disk-space question, never a correctness
// one, so it is independently gated like every other block.
export interface AttachmentSchedulerOptions {
  provider: StorageProvider
  graceHours: number
  cron: string
}

// Every block is independently optional, extending the shape `digest?:` already used. Turning off
// cycle maintenance therefore no longer silently turns off notification retention.
export interface StartSchedulerOptions {
  db: Kysely<DB>
  dbProvider: ZeroDatabase
  logger: Logger
  cycles?: CycleSchedulerOptions
  notifications?: NotificationSchedulerOptions
  search?: SearchSchedulerOptions
  attachments?: AttachmentSchedulerOptions
  // Injected by tests so the queue topology — which queues exist, and on what cron — is assertable
  // without a database or real polling. Mirrors the GitHub connector's `boss?:`.
  boss?: PgBoss
}

interface CycleDigestJobData {
  workspaceId: string
  facts: CycleFacts
}

// pg-boss runs on the same Postgres (the third container — no new service). It installs its
// own `pgboss` schema on start, independent of the Kysely migrator. The scheduled jobs are
// singletons across replicas (pg-boss dedupes the cron enqueue), and the workers drive idempotent
// passes, so it is safe to run the app multi-replica. When a gateway is supplied, cycle close also
// enqueues a bounded, off-the-hot-path digest job per completed cycle.
//
// ONE PgBoss instance and ONE `boss.start()` in this file, whatever is enabled. A third instance in
// the process (beside this one and the GitHub connector's) is three concurrent installs of the
// `pgboss` schema on a fresh volume — a boot race invisible in dev and ugly exactly once, on a
// self-hoster's first `docker compose up`.
export async function startScheduler(options: StartSchedulerOptions): Promise<Scheduler> {
  const { db, dbProvider, logger, cycles, notifications, search, attachments } = options

  const boss = options.boss ?? new PgBoss({ db: fromKysely(db), schema: 'pgboss' })
  if (options.boss === undefined) {
    boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'))
    await boss.start()
  }

  // The two blocks are registered INDEPENDENTLY, and neither can cancel the other. One `boss`
  // instance is shared, so a single `await` chain made an unrelated failure in the cycle block —
  // one bad cron, one queue name pg-boss refuses — silently take notification retention and email
  // delivery with it, while the caller's own catch left the started boss running with no handle to
  // stop it. Registration failures are logged and survived; the handle is returned regardless.
  if (cycles) {
    try {
      await registerCycleJobs({ boss, db, dbProvider, logger, cycles })
    } catch (error) {
      logger.error({ err: error }, 'cycle job registration failed; other scheduled jobs continue')
    }
  }
  if (notifications) {
    try {
      await registerNotificationJobs({ boss, db, logger, notifications })
    } catch (error) {
      logger.error(
        { err: error },
        'notification job registration failed; other scheduled jobs continue',
      )
    }
  }
  if (search) {
    try {
      await registerSearchJobs({ boss, db, logger, search })
    } catch (error) {
      logger.error({ err: error }, 'search job registration failed; other scheduled jobs continue')
    }
  }
  if (attachments) {
    try {
      await registerAttachmentJobs({ boss, db, logger, attachments })
    } catch (error) {
      logger.error(
        { err: error },
        'attachment job registration failed; other scheduled jobs continue',
      )
    }
  }

  return {
    stop: async () => {
      await boss.stop({ graceful: true })
    },
  }
}

interface RegisterCycleJobsOptions {
  boss: PgBoss
  db: Kysely<DB>
  dbProvider: ZeroDatabase
  logger: Logger
  cycles: CycleSchedulerOptions
}

async function registerCycleJobs(options: RegisterCycleJobsOptions): Promise<void> {
  const { boss, db, dbProvider, logger } = options
  const { cron, digest } = options.cycles
  const mutators = createServerMutators()

  await boss.createQueue(CYCLE_MAINTENANCE_QUEUE)

  // The digest pre-compute worker: one structured-output call per completed cycle, off the hot
  // path. Bounded (`generateStructured` mounts no tools) and rate-limited by pg-boss concurrency
  // (one at a time), so a slow model call never blocks a request or the maintenance pass.
  if (digest) {
    await boss.createQueue(CYCLE_DIGEST_QUEUE)
    await boss.work<CycleDigestJobData>(CYCLE_DIGEST_QUEUE, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        // Area enrichment happens HERE, in the worker, not at enqueue: the digest queue is already
        // `batchSize: 1`, which serializes the provider calls for free, and putting unbounded
        // network I/O inside the cycle-maintenance pass would let a slow GitHub response delay
        // every other team's rollover. It never throws and never blocks the digest.
        const facts = await enrichCycleFactsWithAreas(
          {
            db,
            changedFilesReader: digest.changedFilesReader ?? null,
            gateway: digest.gateway,
            logger,
          },
          job.data,
        )
        const result = await runCycleDigest(
          {
            gateway: digest.gateway,
            db,
            dbProvider,
            onError: (error) => logger.error({ err: error }, 'cycle digest run failed'),
          },
          { workspaceId: job.data.workspaceId, facts },
        )
        logger.info(
          { cycleId: job.data.facts.cycleId, status: result.status },
          'cycle digest computed',
        )
      }
    })
  }

  const enqueueDigest = async (facts: CycleFacts): Promise<void> => {
    const team = await db
      .selectFrom('team')
      .select('workspace_id')
      .where('id', '=', facts.teamId)
      .executeTakeFirst()
    if (!team) return
    await boss.send(CYCLE_DIGEST_QUEUE, { workspaceId: team.workspace_id, facts })
  }

  const maintenanceOptions: CycleMaintenanceOptions = digest
    ? { onCycleClosing: enqueueDigest }
    : {}

  await boss.work(CYCLE_MAINTENANCE_QUEUE, async () => {
    const now = Date.now()
    const result = await runCycleMaintenance(db, dbProvider, mutators, now, maintenanceOptions)
    // Catch cycles completed by hand (through the shared `cycle.complete` mutator, off the
    // scheduler's radar) so an AI-configured workspace gets a digest for them too — reconstructing
    // the pre-rollover facts from the rollover-origin marker, off the hot path. The scheduler-closed
    // cycles in this same pass are excluded (they already enqueued with fresh facts).
    if (digest) {
      await sweepManualCompletions({
        db,
        dbProvider,
        now,
        exclude: result.completed,
        enqueue: enqueueDigest,
        logger,
      })
    }
    if (result.activated.length > 0 || result.completed.length > 0) {
      logger.info(
        {
          activated: result.activated,
          completed: result.completed,
          retrosOpened: result.retrosOpened,
        },
        'cycle maintenance ran',
      )
    }
  })

  await boss.schedule(CYCLE_MAINTENANCE_QUEUE, cron)
  logger.info({ cron }, 'cycle maintenance scheduled')
}

interface RegisterNotificationJobsOptions {
  boss: PgBoss
  db: Kysely<DB>
  logger: Logger
  notifications: NotificationSchedulerOptions
}

// Retention is registered unconditionally; the delivery sweep only when a mailer exists, so an
// instance with email off queues nothing that could sit retrying against a transport it has not got.
async function registerNotificationJobs(options: RegisterNotificationJobsOptions): Promise<void> {
  const { boss, db, logger } = options
  const { retentionDays, retentionCron, email } = options.notifications

  await boss.createQueue(NOTIFICATION_RETENTION_QUEUE)
  await boss.work(NOTIFICATION_RETENTION_QUEUE, async () => {
    await runNotificationRetention({ db, retentionDays, logger, now: Date.now() })
  })
  await boss.schedule(NOTIFICATION_RETENTION_QUEUE, retentionCron)
  logger.info({ cron: retentionCron, retentionDays }, 'notification retention scheduled')

  if (!email) return

  await boss.createQueue(NOTIFICATION_EMAIL_QUEUE)
  await boss.work(NOTIFICATION_EMAIL_QUEUE, async () => {
    // The sweep contains its own transport failures and never rejects, so this worker cannot
    // disturb the cycle or connector jobs sharing the process.
    await runNotificationEmailSweep({
      db,
      mailer: email.mailer,
      publicUrl: email.publicUrl,
      logger,
      now: Date.now(),
    })
  })
  await boss.schedule(NOTIFICATION_EMAIL_QUEUE, email.cron)
  logger.info(
    { cron: email.cron, transport: email.mailer.transport },
    'notification email delivery scheduled',
  )
}

interface RegisterSearchJobsOptions {
  boss: PgBoss
  db: Kysely<DB>
  logger: Logger
  search: SearchSchedulerOptions
}

// `createQueue` is a no-op on an existing queue and `updateQueue` cannot change a policy
// (`UpdateQueueOptions` omits it), so a queue created by an earlier build keeps its old policy
// forever — and the wrong policy here does not fail, it silently degrades the tail to the watchdog's
// once a minute. Declaring the policy rather than assuming it costs one read at boot. Dropping the
// queue discards its queued jobs, which are self-re-arming idempotent passes; the next one re-arms.
async function ensurePolicy(boss: PgBoss, name: string, policy: QueuePolicy): Promise<void> {
  const existing = await boss.getQueue(name)
  if (existing !== null && existing.policy !== policy) await boss.deleteQueue(name)
  await boss.createQueue(name, { policy })
}

// Two queues on the SHARED boss — no second `PgBoss`, no second `boss.start()`.
//
// The tail cannot be a cron: pg-boss's granularity is one minute and the design's staleness bound
// is seconds. So the worker RE-ARMS itself with `startAfter: intervalSeconds` at the end of every
// pass, and a one-minute cron watchdog heals a chain broken by a lost or failed job.
//
// THE POLICY IS `short`, NOT `exclusive` (design I8). `exclusive` allows one job queued *or active*,
// which means the re-arm — issued from inside the active job — is rejected and returns null: the
// chain dies after exactly one pass, silently, with the watchdog then indexing once a minute
// forever. `short` allows one job QUEUED, unlimited active, which is the property actually wanted:
// the re-arm always succeeds (nothing is queued at that moment) and a watchdog tick is dropped
// whenever the chain is alive, so chains cannot multiply and a broken one is still healed.
//
// The re-arm is in a `finally`: a pass that throws must not end indexing until the next watchdog
// tick, and a pg-boss retry of the failed job would re-run the same pass rather than a fresh one.
async function registerSearchJobs(options: RegisterSearchJobsOptions): Promise<void> {
  const { boss, db, logger } = options
  const { intervalSeconds, reconcileCron, textConfig } = options.search

  await ensurePolicy(boss, SEARCH_INDEX_QUEUE, 'short')
  await boss.work(SEARCH_INDEX_QUEUE, async () => {
    try {
      await runSearchIndexTail({ db, logger })
    } finally {
      await boss.send(SEARCH_INDEX_QUEUE, {}, { startAfter: intervalSeconds })
    }
  })
  await boss.schedule(SEARCH_INDEX_QUEUE, SEARCH_INDEX_WATCHDOG_CRON)
  // The chain's first link. Without it a fresh boot waits up to a minute for the watchdog before
  // indexing anything, which on an empty index is the whole corpus.
  await boss.send(SEARCH_INDEX_QUEUE, {}, { startAfter: intervalSeconds })

  await ensurePolicy(boss, SEARCH_RECONCILE_QUEUE, 'exclusive')
  await boss.work(SEARCH_RECONCILE_QUEUE, async () => {
    await runSearchReconcile({ db, logger, textConfig })
  })
  await boss.schedule(SEARCH_RECONCILE_QUEUE, reconcileCron)
  logger.info(
    { intervalSeconds, reconcileCron, textConfig, watchdogCron: SEARCH_INDEX_WATCHDOG_CRON },
    'search index maintenance scheduled',
  )
}

interface RegisterAttachmentJobsOptions {
  boss: PgBoss
  db: Kysely<DB>
  logger: Logger
  attachments: AttachmentSchedulerOptions
}

// A FOURTH independent block on the SHARED `boss` — no second `PgBoss`, no second `boss.start()`.
// The comment on `startScheduler` says why: a third instance in the process is a third concurrent
// install of the `pgboss` schema on a fresh volume, a boot race invisible in dev and ugly exactly
// once, on a self-hoster's first `docker compose up`.
async function registerAttachmentJobs(options: RegisterAttachmentJobsOptions): Promise<void> {
  const { boss, db, logger } = options
  const { provider, graceHours, cron } = options.attachments

  await boss.createQueue(ATTACHMENT_GC_QUEUE)
  await boss.work(ATTACHMENT_GC_QUEUE, async () => {
    // The sweep contains its own per-row failures and never rejects.
    await runAttachmentGc({ db, provider, logger, graceHours, now: Date.now() })
  })
  await boss.schedule(ATTACHMENT_GC_QUEUE, cron)
  logger.info({ cron, graceHours, storage: provider.kind }, 'attachment orphan sweep scheduled')
}

interface SweepManualCompletionsOptions {
  db: Kysely<DB>
  dbProvider: ZeroDatabase
  now: number
  exclude: string[]
  enqueue: (facts: CycleFacts) => Promise<void>
  logger: Logger
}

// Enqueue a digest for each recently hand-completed cycle that has no digest row yet. Before
// enqueuing, stamp a `pending` `cycle_digest` (unique on `cycle_id`) so a following maintenance pass
// does not re-select — and re-spend on — the same cycle before the worker writes the real result;
// the worker's `upsertCycleDigest` then updates that row in place. Facts are reconstructed AFTER
// rollover via the rollover-origin marker, so the carried set is intact.
async function sweepManualCompletions(options: SweepManualCompletionsOptions): Promise<void> {
  const { db, dbProvider, now, exclude, enqueue, logger } = options
  const orphans = await cyclesNeedingDigest(db, {
    completedSince: new Date(now - MANUAL_COMPLETION_SWEEP_WINDOW_MS),
    exclude,
    limit: MANUAL_COMPLETION_SWEEP_LIMIT,
  })
  for (const orphan of orphans) {
    const facts = await cycleFactsForTeam(db, orphan.teamId, orphan.id)
    if (!facts) continue
    await dbProvider.transaction((tx) =>
      upsertCycleDigest(tx, {
        id: newId(),
        teamId: facts.teamId,
        cycleId: facts.cycleId,
        status: 'pending',
        content: null,
        provider: null,
        model: null,
        generatedAt: null,
        inputToken: null,
        outputToken: null,
        estimatedCostUsd: null,
        now,
      }),
    )
    await enqueue(facts)
    logger.info({ cycleId: orphan.id }, 'enqueued digest for a manually-completed cycle')
  }
}
