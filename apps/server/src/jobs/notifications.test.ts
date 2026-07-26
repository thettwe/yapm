import type { DB, PendingNotificationEmail } from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import type { PgBoss } from 'pg-boss'
import { describe, expect, it, vi } from 'vitest'
import type { Mailer } from '../mail/index.js'
import {
  groupNotificationEmails,
  NOTIFICATION_EMAIL_QUEUE,
  NOTIFICATION_RETENTION_QUEUE,
  notificationSubjectPath,
  runNotificationEmailSweep,
} from './notifications.js'
import { CYCLE_MAINTENANCE_QUEUE, startScheduler } from './scheduler.js'

const TEAM = '11111111-1111-7111-8111-111111111111'
const ISSUE_A = '22222222-2222-7222-8222-222222222222'
const ISSUE_B = '33333333-3333-7333-8333-333333333333'

function pending(overrides: Partial<PendingNotificationEmail> = {}): PendingNotificationEmail {
  return {
    recipientId: 'user-b',
    actorId: 'user-a',
    actorName: 'Ada',
    kind: 'issue_assigned',
    teamId: TEAM,
    subjectType: 'issue',
    subjectId: ISSUE_A,
    subjectKey: 'ENG-12',
    subjectTitle: 'Ship the inbox',
    eventKey: '1000',
    email: 'b@example.com',
    name: 'Bee',
    mode: 'assigned_only',
    createdAt: new Date(1000),
    ...overrides,
  }
}

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() }
}

// Any read or write through this fails the test by name. It is how "stamps nothing" is proved
// rather than asserted: the sweep cannot have touched the database at all.
function untouchableDb(): Kysely<DB> {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`the sweep touched the database: ${String(property)}`)
      },
    },
  ) as Kysely<DB>
}

function recordingMailer(send: Mailer['send']): { mailer: Mailer; sent: unknown[] } {
  const sent: unknown[] = []
  return {
    sent,
    mailer: {
      transport: 'smtp',
      send: async (message) => {
        sent.push(message)
        await send(message)
      },
    },
  }
}

describe('groupNotificationEmails', () => {
  it('collapses several notifications for one recipient into one batch', () => {
    const batches = groupNotificationEmails([
      pending({ eventKey: '1000', subjectId: ISSUE_A }),
      pending({ eventKey: '2000', subjectId: ISSUE_B, subjectKey: 'ENG-13' }),
    ])

    expect(batches).toHaveLength(1)
    expect(batches[0]?.to).toBe('b@example.com')
    expect(batches[0]?.items).toHaveLength(2)
    expect(batches[0]?.keys).toHaveLength(2)
  })

  it('keeps recipients apart', () => {
    const batches = groupNotificationEmails([
      pending({ recipientId: 'user-b', email: 'b@example.com' }),
      pending({ recipientId: 'user-c', email: 'c@example.com' }),
    ])

    expect(batches.map((batch) => batch.to)).toEqual(['b@example.com', 'c@example.com'])
  })

  it('words each item with the shared copy, naming the actor and the issue as it was', () => {
    const [batch] = groupNotificationEmails([pending()])

    expect(batch?.items[0]?.title).toBe('Ada assigned you ENG-12')
    expect(batch?.items[0]?.summary).toBe('Ship the inbox')
  })

  it('falls back to an anonymous actor when the actor account is gone', () => {
    const [batch] = groupNotificationEmails([pending({ actorName: null })])

    expect(batch?.items[0]?.title).toBe('Someone assigned you ENG-12')
  })

  it('carries no comment body anywhere, for either kind', () => {
    const batches = groupNotificationEmails([
      pending({ kind: 'issue_commented', mode: 'all', subjectTitle: 'Ship the inbox' }),
    ])

    expect(JSON.stringify(batches)).not.toContain('body')
  })

  it('emails only actionable kinds under the default assigned_only mode', () => {
    const batches = groupNotificationEmails([
      pending({ kind: 'issue_assigned', eventKey: '1' }),
      pending({ kind: 'issue_commented', eventKey: '2' }),
    ])

    expect(batches[0]?.items).toHaveLength(1)
    expect(batches[0]?.keys[0]?.kind).toBe('issue_assigned')
  })

  it('emails every kind under all, and nothing under none', () => {
    const all = groupNotificationEmails([
      pending({ kind: 'issue_assigned', eventKey: '1', mode: 'all' }),
      pending({ kind: 'issue_commented', eventKey: '2', mode: 'all' }),
    ])
    const none = groupNotificationEmails([
      pending({ kind: 'issue_assigned', eventKey: '1', mode: 'none' }),
    ])

    expect(all[0]?.items).toHaveLength(2)
    expect(none).toHaveLength(0)
  })
})

describe('notificationSubjectPath', () => {
  it('builds the app-relative path the inbox opens, never an absolute URL', () => {
    const path = notificationSubjectPath({ subjectType: 'issue', teamId: TEAM, subjectId: ISSUE_A })

    expect(path).toBe(`/teams/${TEAM}/issues?open=${ISSUE_A}`)
    expect(path.startsWith('/')).toBe(true)
  })
})

describe('runNotificationEmailSweep — email disabled', () => {
  it('completes, throws nothing and never reaches the database with a null mailer', async () => {
    const logger = silentLogger()

    const result = await runNotificationEmailSweep({
      db: untouchableDb(),
      mailer: null,
      publicUrl: 'https://yapm.example.com',
      logger,
      now: Date.now(),
    })

    expect(result).toEqual({ recipients: 0, notifications: 0, failures: 0 })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('is equally inert when a mailer exists but no public URL does', async () => {
    const { mailer, sent } = recordingMailer(() => Promise.resolve())

    const result = await runNotificationEmailSweep({
      db: untouchableDb(),
      mailer,
      publicUrl: null,
      logger: silentLogger(),
      now: Date.now(),
    })

    expect(result.recipients).toBe(0)
    expect(sent).toHaveLength(0)
  })
})

interface RecordedQueue {
  name: string
}
interface RecordedSchedule {
  name: string
  cron: string
}

function fakeBoss(failOnQueue?: string) {
  const queues: RecordedQueue[] = []
  const schedules: RecordedSchedule[] = []
  const boss = {
    on: () => boss,
    start: () => Promise.resolve(),
    createQueue: (name: string) => {
      if (name === failOnQueue) return Promise.reject(new Error(`pg-boss refused ${name}`))
      queues.push({ name })
      return Promise.resolve()
    },
    work: () => Promise.resolve('worker-id'),
    schedule: (name: string, cron: string) => {
      schedules.push({ name, cron })
      return Promise.resolve()
    },
    send: () => Promise.resolve('job-id'),
    stop: () => Promise.resolve(),
  }
  return { boss: boss as unknown as PgBoss, queues, schedules }
}

describe('startScheduler — notification queue topology', () => {
  it('registers retention without a mailer, and no delivery queue', async () => {
    const { boss, queues, schedules } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
      notifications: { retentionDays: 30, retentionCron: '7 3 * * *' },
      boss,
    })

    expect(queues.map((queue) => queue.name)).toEqual([NOTIFICATION_RETENTION_QUEUE])
    expect(schedules).toEqual([{ name: NOTIFICATION_RETENTION_QUEUE, cron: '7 3 * * *' }])
  })

  it('registers both queues when a mailer exists', async () => {
    const { boss, queues } = fakeBoss()
    const { mailer } = recordingMailer(() => Promise.resolve())

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
      notifications: {
        retentionDays: 30,
        retentionCron: '7 3 * * *',
        email: { mailer, publicUrl: 'https://yapm.example.com', cron: '*/2 * * * *' },
      },
      boss,
    })

    expect(queues.map((queue) => queue.name)).toEqual([
      NOTIFICATION_RETENTION_QUEUE,
      NOTIFICATION_EMAIL_QUEUE,
    ])
  })

  // ONE boss, TWO independent blocks. Registered in a single `await` chain, an unrelated failure in
  // the cycle block took notification retention and email delivery down with it — and `index.ts`
  // catches and logs the throw, so the instance served requests looking entirely healthy.
  it('still registers notification jobs when the cycle block fails to register', async () => {
    const { boss, queues, schedules } = fakeBoss(CYCLE_MAINTENANCE_QUEUE)
    const logger = { info: vi.fn(), error: vi.fn() }

    const scheduler = await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: logger as never,
      cycles: { cron: '* * * * *' },
      notifications: { retentionDays: 30, retentionCron: '7 3 * * *' },
      boss,
    })

    expect(queues.map((queue) => queue.name)).toEqual([NOTIFICATION_RETENTION_QUEUE])
    expect(schedules).toEqual([{ name: NOTIFICATION_RETENTION_QUEUE, cron: '7 3 * * *' }])
    expect(logger.error).toHaveBeenCalledTimes(1)
    // And the handle comes back regardless, so the caller can still stop the boss it started.
    await scheduler.stop()
  })

  it('still registers cycle jobs when the notification block fails to register', async () => {
    const { boss, queues } = fakeBoss(NOTIFICATION_RETENTION_QUEUE)
    const logger = { info: vi.fn(), error: vi.fn() }

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: logger as never,
      cycles: { cron: '* * * * *' },
      notifications: { retentionDays: 30, retentionCron: '7 3 * * *' },
      boss,
    })

    expect(queues.map((queue) => queue.name)).toEqual([CYCLE_MAINTENANCE_QUEUE])
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('registers nothing when neither block is supplied', async () => {
    const { boss, queues } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
      boss,
    })

    expect(queues).toEqual([])
  })
})
