import { type CycleFacts, newId, upsertCycleDigest } from '@yapm/schema'
import { cycleFactsForTeam, cyclesNeedingDigest, type DB } from '@yapm/schema/db'
import { createServerMutators } from '@yapm/schema/server'
import type { Kysely } from 'kysely'
import { fromKysely, PgBoss } from 'pg-boss'
import { runCycleDigest } from '../ai/digest.js'
import type { AiGateway } from '../ai/gateway.js'
import type { Logger } from '../logger.js'
import type { ZeroDatabase } from '../zero/db-provider.js'
import { type CycleMaintenanceOptions, runCycleMaintenance } from './cycles.js'

export const CYCLE_MAINTENANCE_QUEUE = 'cycle-maintenance'
export const CYCLE_DIGEST_QUEUE = 'cycle-digest'

// The manual-completion sweep bound: a cycle completed by hand (through the shared `cycle.complete`
// mutator, which the scheduler never re-selects) is picked up for a digest by the next maintenance
// cron if it completed within this window. Generous enough to survive a slow cron or a brief
// outage, tight enough that enabling AI on an existing instance never back-fills every past cycle.
const MANUAL_COMPLETION_SWEEP_WINDOW_MS = 60 * 60 * 1000
const MANUAL_COMPLETION_SWEEP_LIMIT = 25

export interface CycleScheduler {
  stop: () => Promise<void>
}

export interface DigestSchedulerOptions {
  // The BYO-key gateway. Present ⇒ a digest is pre-computed at cycle close (gated by
  // AI_DIGEST_ON_CYCLE_CLOSE upstream); absent ⇒ no digest job is scheduled and no facts are read.
  gateway: AiGateway
}

export interface StartCycleSchedulerOptions {
  db: Kysely<DB>
  dbProvider: ZeroDatabase
  logger: Logger
  cron: string
  digest?: DigestSchedulerOptions
}

interface CycleDigestJobData {
  workspaceId: string
  facts: CycleFacts
}

// pg-boss runs on the same Postgres (the third container — no new service). It installs its
// own `pgboss` schema on start, independent of the Kysely migrator. The scheduled job is a
// singleton across replicas (pg-boss dedupes the cron enqueue), and the worker drives the
// idempotent maintenance pass, so it is safe to run the app multi-replica. When a gateway is
// supplied, cycle close also enqueues a bounded, off-the-hot-path digest job per completed cycle.
export async function startCycleScheduler(
  options: StartCycleSchedulerOptions,
): Promise<CycleScheduler> {
  const { db, dbProvider, logger, cron, digest } = options
  const mutators = createServerMutators()

  const boss = new PgBoss({ db: fromKysely(db), schema: 'pgboss' })
  boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'))

  await boss.start()
  await boss.createQueue(CYCLE_MAINTENANCE_QUEUE)

  // The digest pre-compute worker: one structured-output call per completed cycle, off the hot
  // path. Bounded (`generateStructured` mounts no tools) and rate-limited by pg-boss concurrency
  // (one at a time), so a slow model call never blocks a request or the maintenance pass.
  if (digest) {
    await boss.createQueue(CYCLE_DIGEST_QUEUE)
    await boss.work<CycleDigestJobData>(CYCLE_DIGEST_QUEUE, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        const result = await runCycleDigest(
          {
            gateway: digest.gateway,
            db,
            dbProvider,
            onError: (error) => logger.error({ err: error }, 'cycle digest run failed'),
          },
          job.data,
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
        { activated: result.activated, completed: result.completed },
        'cycle maintenance ran',
      )
    }
  })

  await boss.schedule(CYCLE_MAINTENANCE_QUEUE, cron)
  logger.info({ cron }, 'cycle maintenance scheduled')

  return {
    stop: async () => {
      await boss.stop({ graceful: true })
    },
  }
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
