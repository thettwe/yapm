import type { AttachmentRow, DB } from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import type { PgBoss } from 'pg-boss'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageProvider } from '../storage/provider.js'
import { ATTACHMENT_GC_QUEUE, runAttachmentGc } from './attachments.js'
import {
  NOTIFICATION_RETENTION_QUEUE,
  SEARCH_INDEX_QUEUE,
  SEARCH_RECONCILE_QUEUE,
  startScheduler,
} from './scheduler.js'

// The two accessors are `packages/schema`'s (the `db/attachment.ts` one-file rule), so the sweep's
// own behaviour — what it deletes, in what order, and what it survives — is what this file tests.
// The SQL those two emit is the schema package's business and is covered against live Postgres.
const listOrphanedAttachments = vi.hoisted(() => vi.fn())
const deleteAttachment = vi.hoisted(() => vi.fn())

vi.mock('@yapm/schema/db', () => ({ listOrphanedAttachments, deleteAttachment }))

const TEAM = '11111111-1111-7111-8111-111111111111'
const HOUR_MS = 60 * 60 * 1000
const NOW = Date.parse('2026-07-27T04:23:00.000Z')

function row(id: string, createdAt: Date): AttachmentRow {
  return {
    id,
    teamId: TEAM,
    issueId: null,
    commentId: null,
    uploaderId: 'user-a',
    filename: 'pasted.png',
    contentType: 'image/png',
    byteSize: 4096,
    hasThumbnail: true,
    createdAt,
  }
}

function recordingProvider(fail?: (key: string) => boolean): {
  provider: StorageProvider
  deleted: string[]
} {
  const deleted: string[] = []
  return {
    deleted,
    provider: {
      kind: 'local',
      put: () => Promise.resolve(),
      get: () => Promise.resolve(null),
      delete: (key) => {
        if (fail?.(key)) return Promise.reject(new Error(`unreachable object ${key}`))
        deleted.push(key)
        return Promise.resolve()
      },
      health: () => Promise.resolve(),
    },
  }
}

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() }
}

const db = {} as Kysely<DB>

describe('runAttachmentGc', () => {
  beforeEach(() => {
    listOrphanedAttachments.mockReset()
    deleteAttachment.mockReset()
    deleteAttachment.mockResolvedValue(true)
  })

  // THUMBNAIL → OBJECT → ROW, objects before the row. A crash between them must leave a row whose
  // bytes are gone — already the standard refusal — rather than bytes nobody can name.
  it('deletes the thumbnail, then the object, then the row', async () => {
    const order: string[] = []
    const { provider } = recordingProvider()
    const wrapped: StorageProvider = {
      ...provider,
      delete: async (key) => {
        order.push(key)
        await provider.delete(key)
      },
    }
    deleteAttachment.mockImplementation((_db: unknown, id: string) => {
      order.push(`row:${id}`)
      return Promise.resolve(true)
    })
    listOrphanedAttachments.mockResolvedValue([row('a', new Date(NOW - 48 * HOUR_MS))])

    const result = await runAttachmentGc({
      db,
      provider: wrapped,
      logger: silentLogger(),
      graceHours: 24,
      now: NOW,
    })

    expect(order).toEqual([`${TEAM}/a.thumb`, `${TEAM}/a`, 'row:a'])
    expect(result).toEqual({ collected: 1, failed: 0 })
  })

  // The grace window is the sweep's whole policy, and it is expressed as a cutoff handed to the
  // statement rather than as a filter applied to rows it already fetched.
  it('asks for rows older than the grace window, bounded by the limit', async () => {
    listOrphanedAttachments.mockResolvedValue([])
    const { provider } = recordingProvider()

    await runAttachmentGc({
      db,
      provider,
      logger: silentLogger(),
      graceHours: 24,
      now: NOW,
      limit: 7,
    })

    expect(listOrphanedAttachments).toHaveBeenCalledWith(db, {
      createdBefore: new Date(NOW - 24 * HOUR_MS),
      limit: 7,
    })
  })

  it('touches nothing when there is nothing to collect', async () => {
    listOrphanedAttachments.mockResolvedValue([])
    const { provider, deleted } = recordingProvider()

    const result = await runAttachmentGc({
      db,
      provider,
      logger: silentLogger(),
      graceHours: 24,
      now: NOW,
    })

    expect(deleted).toEqual([])
    expect(deleteAttachment).not.toHaveBeenCalled()
    expect(result).toEqual({ collected: 0, failed: 0 })
  })

  // One unreachable object must not abort the pass: the rows after it are collected now rather than
  // never, and the failed one is still an orphan so the next tick re-selects it.
  it('contains a per-row failure and keeps going', async () => {
    const { provider, deleted } = recordingProvider((key) => key === `${TEAM}/b`)
    listOrphanedAttachments.mockResolvedValue([
      row('a', new Date(NOW - 48 * HOUR_MS)),
      row('b', new Date(NOW - 48 * HOUR_MS)),
      row('c', new Date(NOW - 48 * HOUR_MS)),
    ])
    const logger = silentLogger()

    const result = await runAttachmentGc({ db, provider, logger, graceHours: 24, now: NOW })

    expect(result).toEqual({ collected: 2, failed: 1 })
    expect(deleted).toEqual([
      `${TEAM}/a.thumb`,
      `${TEAM}/a`,
      `${TEAM}/b.thumb`,
      `${TEAM}/c.thumb`,
      `${TEAM}/c`,
    ])
    // The failed row's own row delete never ran, so it stays an orphan.
    expect(deleteAttachment.mock.calls.map((call) => call[1])).toEqual(['a', 'c'])
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  // NEVER rejects: this worker shares a process and a pg-boss instance with the cycle, notification
  // and search jobs.
  it('survives a listing failure without rejecting', async () => {
    listOrphanedAttachments.mockRejectedValue(new Error('database went away'))
    const { provider } = recordingProvider()
    const logger = silentLogger()

    await expect(
      runAttachmentGc({ db, provider, logger, graceHours: 24, now: NOW }),
    ).resolves.toEqual({ collected: 0, failed: 0 })
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})

interface RecordedSchedule {
  name: string
  cron: string
}

function fakeBoss(failOnQueue?: string) {
  const queues: string[] = []
  const schedules: RecordedSchedule[] = []
  const constructed = 0
  const boss = {
    on: () => boss,
    start: () => Promise.resolve(),
    createQueue: (name: string) => {
      if (name === failOnQueue) return Promise.reject(new Error(`pg-boss refused ${name}`))
      queues.push(name)
      return Promise.resolve()
    },
    getQueue: () => Promise.resolve(null),
    deleteQueue: () => Promise.resolve(),
    work: () => Promise.resolve('worker-id'),
    schedule: (name: string, cron: string) => {
      schedules.push({ name, cron })
      return Promise.resolve()
    },
    send: () => Promise.resolve('job-id'),
    stop: () => Promise.resolve(),
  }
  return { boss: boss as unknown as PgBoss, queues, schedules, constructed: () => constructed }
}

const storage: StorageProvider = {
  kind: 'local',
  put: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  delete: () => Promise.resolve(),
  health: () => Promise.resolve(),
}

describe('startScheduler — attachment queue topology', () => {
  it('registers the sweep on the configured cron, on the shared boss', async () => {
    const { boss, queues, schedules } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      attachments: { provider: storage, graceHours: 24, cron: '23 4 * * *' },
      boss,
    })

    expect(queues).toEqual([ATTACHMENT_GC_QUEUE])
    expect(schedules).toEqual([{ name: ATTACHMENT_GC_QUEUE, cron: '23 4 * * *' }])
  })

  // The fourth block is INDEPENDENT, like the other three: its failure must not take retention or
  // the search passes with it, and the handle still comes back.
  it('leaves the other three blocks registered when the attachment block fails', async () => {
    const { boss, queues } = fakeBoss(ATTACHMENT_GC_QUEUE)
    const logger = silentLogger()

    const scheduler = await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: logger as never,
      notifications: { retentionDays: 30, retentionCron: '7 3 * * *' },
      search: { intervalSeconds: 10, reconcileCron: '*/5 * * * *', textConfig: 'simple' },
      attachments: { provider: storage, graceHours: 24, cron: '23 4 * * *' },
      boss,
    })

    expect(queues).toEqual([
      NOTIFICATION_RETENTION_QUEUE,
      SEARCH_INDEX_QUEUE,
      SEARCH_RECONCILE_QUEUE,
    ])
    expect(logger.error).toHaveBeenCalledTimes(1)
    await scheduler.stop()
  })

  // ONE `PgBoss` and ONE `boss.start()` in this file, whatever is enabled. A second instance is a
  // second concurrent install of the `pgboss` schema on a fresh volume — a boot race invisible in
  // dev and ugly exactly once, on a self-hoster's first `docker compose up`. The injected boss is
  // the only one that can exist here, and `start` is never called on it.
  it('constructs no PgBoss of its own when one is injected', async () => {
    const started = vi.fn()
    const { boss, queues } = fakeBoss()
    ;(boss as unknown as { start: () => Promise<void> }).start = () => {
      started()
      return Promise.resolve()
    }

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      notifications: { retentionDays: 30, retentionCron: '7 3 * * *' },
      attachments: { provider: storage, graceHours: 24, cron: '23 4 * * *' },
      boss,
    })

    expect(started).not.toHaveBeenCalled()
    expect(queues).toEqual([NOTIFICATION_RETENTION_QUEUE, ATTACHMENT_GC_QUEUE])
  })
})
