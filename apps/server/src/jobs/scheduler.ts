import type { CycleFacts } from '@yapm/schema'
import type { DB } from '@yapm/schema/db'
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

  const maintenanceOptions: CycleMaintenanceOptions = digest
    ? {
        onCycleClosing: async (facts: CycleFacts) => {
          const team = await db
            .selectFrom('team')
            .select('workspace_id')
            .where('id', '=', facts.teamId)
            .executeTakeFirst()
          if (!team) return
          await boss.send(CYCLE_DIGEST_QUEUE, { workspaceId: team.workspace_id, facts })
        },
      }
    : {}

  await boss.work(CYCLE_MAINTENANCE_QUEUE, async () => {
    const result = await runCycleMaintenance(
      db,
      dbProvider,
      mutators,
      Date.now(),
      maintenanceOptions,
    )
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
