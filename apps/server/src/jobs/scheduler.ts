import type { DB } from '@yapm/schema/db'
import { createServerMutators } from '@yapm/schema/server'
import type { Kysely } from 'kysely'
import { fromKysely, PgBoss } from 'pg-boss'
import type { Logger } from '../logger.js'
import type { ZeroDatabase } from '../zero/db-provider.js'
import { runCycleMaintenance } from './cycles.js'

export const CYCLE_MAINTENANCE_QUEUE = 'cycle-maintenance'

export interface CycleScheduler {
  stop: () => Promise<void>
}

export interface StartCycleSchedulerOptions {
  db: Kysely<DB>
  dbProvider: ZeroDatabase
  logger: Logger
  cron: string
}

// pg-boss runs on the same Postgres (the third container — no new service). It installs its
// own `pgboss` schema on start, independent of the Kysely migrator. The scheduled job is a
// singleton across replicas (pg-boss dedupes the cron enqueue), and the worker drives the
// idempotent maintenance pass, so it is safe to run the app multi-replica.
export async function startCycleScheduler(
  options: StartCycleSchedulerOptions,
): Promise<CycleScheduler> {
  const { db, dbProvider, logger, cron } = options
  const mutators = createServerMutators()

  const boss = new PgBoss({ db: fromKysely(db), schema: 'pgboss' })
  boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'))

  await boss.start()
  await boss.createQueue(CYCLE_MAINTENANCE_QUEUE)

  await boss.work(CYCLE_MAINTENANCE_QUEUE, async () => {
    const result = await runCycleMaintenance(db, dbProvider, mutators, Date.now())
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
