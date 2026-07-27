import type { PgBoss, QueuePolicy } from 'pg-boss'
import { describe, expect, it, vi } from 'vitest'
import {
  CYCLE_MAINTENANCE_QUEUE,
  NOTIFICATION_RETENTION_QUEUE,
  SEARCH_INDEX_QUEUE,
  SEARCH_RECONCILE_QUEUE,
  startScheduler,
} from './scheduler.js'

interface RecordedQueue {
  name: string
  policy?: QueuePolicy
}
interface RecordedSchedule {
  name: string
  cron: string
}
interface RecordedSend {
  name: string
  startAfter: unknown
}

// One recorder for one boss. Everything every block registers lands here, which is also how "no
// second PgBoss" is asserted: a block that constructed its own would register nothing visible.
function fakeBoss(failOnQueue?: string, existingPolicies: Record<string, QueuePolicy> = {}) {
  const queues: RecordedQueue[] = []
  const schedules: RecordedSchedule[] = []
  const sends: RecordedSend[] = []
  const deleted: string[] = []
  const workers = new Map<string, () => Promise<unknown>>()
  let started = 0
  const boss = {
    on: () => boss,
    start: () => {
      started += 1
      return Promise.resolve()
    },
    getQueue: (name: string) =>
      Promise.resolve(
        existingPolicies[name] === undefined ? null : { name, policy: existingPolicies[name] },
      ),
    deleteQueue: (name: string) => {
      deleted.push(name)
      return Promise.resolve()
    },
    createQueue: (name: string, options?: { policy?: QueuePolicy }) => {
      if (name === failOnQueue) return Promise.reject(new Error(`pg-boss refused ${name}`))
      queues.push(options?.policy === undefined ? { name } : { name, policy: options.policy })
      return Promise.resolve()
    },
    work: (name: string, ...rest: unknown[]) => {
      const handler = rest[rest.length - 1] as () => Promise<unknown>
      workers.set(name, handler)
      return Promise.resolve('worker-id')
    },
    schedule: (name: string, cron: string) => {
      schedules.push({ name, cron })
      return Promise.resolve()
    },
    send: (name: string, _data?: unknown, options?: { startAfter?: unknown }) => {
      sends.push({ name, startAfter: options?.startAfter })
      return Promise.resolve('job-id')
    },
    stop: () => Promise.resolve(),
  }
  return {
    boss: boss as unknown as PgBoss,
    queues,
    schedules,
    sends,
    deleted,
    workers,
    startCount: () => started,
  }
}

const SEARCH = { intervalSeconds: 10, reconcileCron: '*/5 * * * *', textConfig: 'simple' }

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('startScheduler — search queue topology', () => {
  it('creates both queues, the exclusive index queue, the watchdog and the env cron', async () => {
    const { boss, queues, schedules, sends } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      search: SEARCH,
      boss,
    })

    // `short` on the tail, not `exclusive`: `exclusive` counts ACTIVE jobs too, so the re-arm
    // issued from inside the running pass is rejected and the chain dies after one pass. Verified
    // against pg-boss 12 rather than reasoned about; see design I8.
    expect(queues).toEqual([
      { name: SEARCH_INDEX_QUEUE, policy: 'short' },
      { name: SEARCH_RECONCILE_QUEUE, policy: 'exclusive' },
    ])
    // One job queued at a time is what keeps the two arming paths — the self re-arm and the
    // watchdog — from multiplying into two chains.
    expect(schedules).toEqual([
      { name: SEARCH_INDEX_QUEUE, cron: '* * * * *' },
      { name: SEARCH_RECONCILE_QUEUE, cron: '*/5 * * * *' },
    ])
    // The chain's first link, so a fresh boot does not wait a whole watchdog minute.
    expect(sends).toEqual([{ name: SEARCH_INDEX_QUEUE, startAfter: 10 }])
  })

  // `createQueue` does nothing to an existing queue and `updateQueue` cannot change a policy, so a
  // queue left over from an earlier build would silently keep degrading the tail to once a minute.
  it('recreates a queue whose policy has drifted, and leaves a correct one alone', async () => {
    const drifted = fakeBoss(undefined, { [SEARCH_INDEX_QUEUE]: 'exclusive' })
    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      search: SEARCH,
      boss: drifted.boss,
    })
    expect(drifted.deleted).toEqual([SEARCH_INDEX_QUEUE])

    const correct = fakeBoss(undefined, {
      [SEARCH_INDEX_QUEUE]: 'short',
      [SEARCH_RECONCILE_QUEUE]: 'exclusive',
    })
    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      search: SEARCH,
      boss: correct.boss,
    })
    expect(correct.deleted).toEqual([])
  })

  it('registers nothing for search when the block is absent', async () => {
    const { boss, queues, schedules } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      notifications: { retentionDays: 30, retentionCron: '7 3 * * *' },
      boss,
    })

    expect(queues.map((queue) => queue.name)).toEqual([NOTIFICATION_RETENTION_QUEUE])
    expect(schedules.map((schedule) => schedule.name)).toEqual([NOTIFICATION_RETENTION_QUEUE])
  })

  it('shares ONE boss across every block and starts no second one', async () => {
    const { boss, queues, startCount } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      cycles: { cron: '* * * * *' },
      notifications: { retentionDays: 30, retentionCron: '7 3 * * *' },
      search: SEARCH,
      boss,
    })

    expect(queues.map((queue) => queue.name)).toEqual([
      CYCLE_MAINTENANCE_QUEUE,
      NOTIFICATION_RETENTION_QUEUE,
      SEARCH_INDEX_QUEUE,
      SEARCH_RECONCILE_QUEUE,
    ])
    // An injected boss is already started by its owner; a second `boss.start()` on a fresh volume
    // is three concurrent installs of the `pgboss` schema.
    expect(startCount()).toBe(0)
  })

  it('survives a search registration failure without taking the other blocks down', async () => {
    const { boss, queues } = fakeBoss(SEARCH_INDEX_QUEUE)
    const logger = silentLogger()

    const scheduler = await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: logger as never,
      cycles: { cron: '* * * * *' },
      notifications: { retentionDays: 30, retentionCron: '7 3 * * *' },
      search: SEARCH,
      boss,
    })

    expect(queues.map((queue) => queue.name)).toEqual([
      CYCLE_MAINTENANCE_QUEUE,
      NOTIFICATION_RETENTION_QUEUE,
    ])
    expect(logger.error).toHaveBeenCalledTimes(1)
    await scheduler.stop()
  })

  it('still registers search when the cycle block fails', async () => {
    const { boss, queues } = fakeBoss(CYCLE_MAINTENANCE_QUEUE)
    const logger = silentLogger()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: logger as never,
      cycles: { cron: '* * * * *' },
      search: SEARCH,
      boss,
    })

    expect(queues.map((queue) => queue.name)).toEqual([SEARCH_INDEX_QUEUE, SEARCH_RECONCILE_QUEUE])
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  // The re-arm is the whole cadence: a pass that throws must not stop indexing until the watchdog
  // notices, so it lives in a `finally`.
  it('re-arms the tail even when the pass throws', async () => {
    const { boss, sends, workers } = fakeBoss()
    const failing = {
      selectFrom: () => {
        throw new Error('database gone')
      },
    }

    await startScheduler({
      db: failing as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      search: SEARCH,
      boss,
    })

    const worker = workers.get(SEARCH_INDEX_QUEUE)
    await expect(worker?.()).rejects.toThrow()
    expect(sends).toEqual([
      { name: SEARCH_INDEX_QUEUE, startAfter: 10 },
      { name: SEARCH_INDEX_QUEUE, startAfter: 10 },
    ])
  })
})
