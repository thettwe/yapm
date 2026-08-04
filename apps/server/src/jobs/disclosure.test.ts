import type { DB, PendingPmDigestReadyEmail } from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import type { PgBoss } from 'pg-boss'
import { describe, expect, it, vi } from 'vitest'
import type { Mailer } from '../mail/index.js'
import {
  AI_DISCLOSURE_RETENTION_QUEUE,
  AI_PM_DIGEST_READY_QUEUE,
  runPmDigestReadyEmailSweep,
} from './disclosure.js'
import { NOTIFICATION_RETENTION_QUEUE } from './notifications.js'
import { startScheduler } from './scheduler.js'

const TEAM_A = '11111111-1111-7111-8111-111111111111'
const TEAM_B = '22222222-2222-7222-8222-222222222222'
const DIGEST = '33333333-3333-7333-8333-333333333333'

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() }
}

// Any read or write through this fails the test by name. It is how "reads nothing, stamps nothing"
// is PROVED rather than asserted.
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

function pending(overrides: Partial<PendingPmDigestReadyEmail> = {}): PendingPmDigestReadyEmail {
  return {
    recipientId: 'reader-1',
    kind: 'pm_digest_published',
    teamId: TEAM_A,
    subjectId: DIGEST,
    subjectTitle: 'Platform · Cycle 14',
    eventKey: '1000',
    email: 'reader@example.com',
    mode: 'assigned_only',
    ...overrides,
  }
}

interface SweepStubs {
  rows: PendingPmDigestReadyEmail[]
  entitlements: Record<string, string[]>
}

// The two `@yapm/schema/db` calls the sweep makes are stubbed at the module boundary, so the sweep's
// OWN logic — the entitlement re-resolve, the withholding, the stamping — is what is under test
// rather than Postgres.
const stubs: SweepStubs = { rows: [], entitlements: {} }
const stamped: unknown[] = []

vi.mock('@yapm/schema/db', () => ({
  deleteDisclosureAuditOlderThan: vi.fn(),
  pendingPmDigestReadyEmails: () => Promise.resolve(stubs.rows),
  resolvePmAudienceTeamIds: (_db: unknown, userId: string) =>
    Promise.resolve(stubs.entitlements[userId] ?? []),
  stampNotificationsEmailed: (_db: unknown, keys: unknown) => {
    stamped.push(keys)
    return Promise.resolve()
  },
}))

function recordingMailer(send: Mailer['send'] = () => Promise.resolve()) {
  const sent: unknown[] = []
  return {
    sent,
    mailer: {
      transport: 'smtp' as const,
      send: async (message: Parameters<Mailer['send']>[0]) => {
        sent.push(message)
        await send(message)
      },
    } satisfies Mailer,
  }
}

describe('the PM digest ready notice sweep', () => {
  // The clean-disablement rule every email in this product follows: no transport is not a degraded
  // state, it is nothing happening at all.
  it('is a total no-op with no mailer, and throws nothing', async () => {
    stubs.rows = [pending()]
    const result = await runPmDigestReadyEmailSweep({
      db: untouchableDb(),
      mailer: null,
      publicUrl: 'https://yapm.example.com',
      logger: silentLogger(),
      now: 10_000_000,
    })
    expect(result).toEqual({ sent: 0, withheld: 0, failures: 0 })
  })

  it('is a total no-op with no public URL', async () => {
    stubs.rows = [pending()]
    const result = await runPmDigestReadyEmailSweep({
      db: untouchableDb(),
      mailer: recordingMailer().mailer,
      publicUrl: null,
      logger: silentLogger(),
      now: 10_000_000,
    })
    expect(result).toEqual({ sent: 0, withheld: 0, failures: 0 })
  })

  it('mails an entitled reader a link, and stamps exactly that row', async () => {
    stamped.length = 0
    stubs.rows = [pending()]
    stubs.entitlements = { 'reader-1': [TEAM_A] }
    const { mailer, sent } = recordingMailer()

    const result = await runPmDigestReadyEmailSweep({
      db: {} as never,
      mailer,
      publicUrl: 'https://yapm.example.com',
      logger: silentLogger(),
      now: 10_000_000,
    })

    expect(result).toEqual({ sent: 1, withheld: 0, failures: 0 })
    expect(sent).toHaveLength(1)
    const message = sent[0] as { to: string[]; message: { html: string; text: string } }
    expect(message.to).toEqual(['reader@example.com'])
    expect(message.message.text).toContain('https://yapm.example.com/digests')
    expect(stamped).toEqual([
      [
        {
          recipientId: 'reader-1',
          kind: 'pm_digest_published',
          subjectId: DIGEST,
          eventKey: '1000',
        },
      ],
    ])
  })

  // ENTITLEMENT IS RE-RESOLVED AT SEND TIME, through the one resolver. A reader dropped from the
  // audience, a team switched off, or the kill switch set between publish and sweep all collapse to
  // the same answer — no team ids — and all mean no mail.
  it('withholds from a reader whose resolved audience no longer covers the team', async () => {
    stamped.length = 0
    stubs.rows = [pending()]
    stubs.entitlements = { 'reader-1': [TEAM_B] }
    const { mailer, sent } = recordingMailer()

    const result = await runPmDigestReadyEmailSweep({
      db: {} as never,
      mailer,
      publicUrl: 'https://yapm.example.com',
      logger: silentLogger(),
      now: 10_000_000,
    })

    expect(result).toEqual({ sent: 0, withheld: 1, failures: 0 })
    expect(sent).toEqual([])
    // Unstamped: if entitlement comes back inside the recency window, so does the notice.
    expect(stamped).toEqual([])
  })

  it('withholds when the kill switch has emptied the reader’s resolved set entirely', async () => {
    stubs.rows = [pending()]
    stubs.entitlements = { 'reader-1': [] }
    const { mailer, sent } = recordingMailer()

    const result = await runPmDigestReadyEmailSweep({
      db: {} as never,
      mailer,
      publicUrl: 'https://yapm.example.com',
      logger: silentLogger(),
      now: 10_000_000,
    })

    expect(result).toEqual({ sent: 0, withheld: 1, failures: 0 })
    expect(sent).toEqual([])
  })

  // Contained, exactly as the notification sweep contains its own: one recipient fails, the row is
  // left unstamped for the next window, and nothing escapes to pg-boss.
  it('contains a transport failure, leaves the row unstamped and does not throw', async () => {
    stamped.length = 0
    stubs.rows = [pending(), pending({ recipientId: 'reader-2', email: 'two@example.com' })]
    stubs.entitlements = { 'reader-1': [TEAM_A], 'reader-2': [TEAM_A] }
    const logger = silentLogger()
    const { mailer } = recordingMailer((message) =>
      (message.to as string[])[0] === 'reader@example.com'
        ? Promise.reject(new Error('relay refused'))
        : Promise.resolve(),
    )

    const result = await runPmDigestReadyEmailSweep({
      db: {} as never,
      mailer,
      publicUrl: 'https://yapm.example.com',
      logger,
      now: 10_000_000,
    })

    expect(result).toEqual({ sent: 1, withheld: 0, failures: 1 })
    expect(stamped).toHaveLength(1)
    expect(logger.error).toHaveBeenCalledOnce()
  })
})

interface RecordedSchedule {
  name: string
  cron: string
}

function fakeBoss() {
  const queues: string[] = []
  const schedules: RecordedSchedule[] = []
  const boss = {
    on: () => boss,
    start: () => Promise.resolve(),
    createQueue: (name: string) => {
      queues.push(name)
      return Promise.resolve()
    },
    work: () => Promise.resolve('worker-id'),
    schedule: (name: string, cron: string) => {
      schedules.push({ name, cron })
      return Promise.resolve()
    },
    send: () => Promise.resolve('job-id'),
    getQueue: () => Promise.resolve(null),
    deleteQueue: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  }
  return { boss: boss as unknown as PgBoss, queues, schedules }
}

describe('startScheduler — disclosure queue topology', () => {
  // The bound has to hold on an instance with AI off and no mailer, because the table exists there
  // too. This is the assertion that stops retention from being quietly gated on a feature switch.
  it('registers retention on the SHARED boss with AI and the mailer both absent', async () => {
    const { boss, queues, schedules } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      disclosure: { retentionDays: 365, retentionCron: '23 3 * * *' },
      boss,
    })

    expect(queues).toEqual([AI_DISCLOSURE_RETENTION_QUEUE])
    expect(schedules).toEqual([{ name: AI_DISCLOSURE_RETENTION_QUEUE, cron: '23 3 * * *' }])
  })

  it('registers the ready queue only when a mailer and the switch are both present', async () => {
    const { boss, queues } = fakeBoss()
    const { mailer } = recordingMailer()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      disclosure: {
        retentionDays: 365,
        retentionCron: '23 3 * * *',
        email: { mailer, publicUrl: 'https://yapm.example.com', cron: '*/2 * * * *' },
      },
      boss,
    })

    expect(queues).toEqual([AI_DISCLOSURE_RETENTION_QUEUE, AI_PM_DIGEST_READY_QUEUE])
  })

  // ONE boss, six blocks. The three-container promise is what this asserts: the disclosure block
  // shares the instance the notification block is registered on.
  it('shares one boss with the notification block, and staggers the two nightly crons', async () => {
    const { boss, queues, schedules } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      notifications: { retentionDays: 30, retentionCron: '7 3 * * *' },
      disclosure: { retentionDays: 365, retentionCron: '23 3 * * *' },
      boss,
    })

    expect(queues).toEqual([NOTIFICATION_RETENTION_QUEUE, AI_DISCLOSURE_RETENTION_QUEUE])
    expect(schedules.map((entry) => entry.cron)).toEqual(['7 3 * * *', '23 3 * * *'])
  })
})
