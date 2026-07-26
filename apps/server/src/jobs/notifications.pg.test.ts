import { newId } from '@yapm/schema'
import type { Database, NotificationEvent } from '@yapm/schema/db'
import { createDatabase, migrateToLatest, recordNotifications } from '@yapm/schema/db'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Mailer, OutboundMessage } from '../mail/index.js'
import {
  NOTIFICATION_EMAIL_BATCH_LIMIT,
  NOTIFICATION_EMAIL_DEBOUNCE_MS,
  NOTIFICATION_EMAIL_MAX_AGE_MS,
  runNotificationEmailSweep,
  runNotificationRetention,
} from './notifications.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the notification delivery sweep test must not be skipped',
  )
}

const PUBLIC_URL = 'https://yapm.example.com'
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0)
// Settled past the debounce, comfortably inside the 24-hour window.
const SETTLED = NOW - NOTIFICATION_EMAIL_DEBOUNCE_MS - 60_000

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() }
}

function recordingMailer(
  send: (message: OutboundMessage) => Promise<void> = () => Promise.resolve(),
): { mailer: Mailer; sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = []
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

describe.skipIf(DATABASE_URL === undefined)('notification delivery sweep (live db)', () => {
  let database: Database
  const workspaceId = newId()
  const teamId = newId()
  const otherTeamId = newId()
  const actorId = `actor-${newId()}`
  const recipientId = `recipient-${newId()}`
  let teamMembershipId: string

  const event = (overrides: Partial<NotificationEvent> = {}): NotificationEvent => ({
    recipientId,
    actorId,
    kind: 'issue_assigned',
    teamId,
    subjectType: 'issue',
    subjectId: newId(),
    subjectKey: 'ENG-12',
    subjectTitle: 'Ship the inbox',
    eventKey: String(SETTLED),
    createdAt: SETTLED,
    ...overrides,
  })

  const sweep = (mailer: Mailer | null, logger = silentLogger()) =>
    runNotificationEmailSweep({ db: database.db, mailer, publicUrl: PUBLIC_URL, logger, now: NOW })

  const unsent = async () =>
    await database.db
      .selectFrom('notification')
      .select(['subject_id', 'email_sent_at'])
      .where('recipient_id', '=', recipientId)
      .where('email_sent_at', 'is', null)
      .execute()

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'Delivery WS' })
      .execute()
    await database.db
      .insertInto('team')
      .values([
        { id: teamId, workspace_id: workspaceId, name: 'Delivery', key: `D${Date.now() % 10000}` },
        {
          id: otherTeamId,
          workspace_id: workspaceId,
          name: 'Other',
          key: `O${Date.now() % 10000}`,
        },
      ])
      .execute()
    await database.db
      .insertInto('user')
      .values([
        { id: actorId, name: 'Ada', email: `${actorId}@example.com`, emailVerified: true },
        {
          id: recipientId,
          name: 'Bee',
          email: `${recipientId}@example.com`,
          emailVerified: true,
        },
      ])
      .execute()
    teamMembershipId = newId()
    await database.db
      .insertInto('team_membership')
      .values({ id: teamMembershipId, team_id: teamId, user_id: recipientId })
      .execute()
  }, 30_000)

  afterEach(async () => {
    await database.db.deleteFrom('notification').where('recipient_id', '=', recipientId).execute()
    await database.db.deleteFrom('user_preference').where('user_id', '=', recipientId).execute()
    await database.db
      .insertInto('team_membership')
      .values({ id: teamMembershipId, team_id: teamId, user_id: recipientId })
      .onConflict((oc) => oc.columns(['team_id', 'user_id']).doNothing())
      .execute()
  })

  afterAll(async () => {
    if (!database) return
    await database.db.deleteFrom('notification').where('recipient_id', '=', recipientId).execute()
    await database.db.deleteFrom('user_preference').where('user_id', '=', recipientId).execute()
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.db.deleteFrom('user').where('id', 'in', [actorId, recipientId]).execute()
    await database.close()
  })

  it('stamps nothing and sends nothing when no mailer is configured', async () => {
    await recordNotifications(database.db, [event()])

    const result = await runNotificationEmailSweep({
      db: database.db,
      mailer: null,
      publicUrl: PUBLIC_URL,
      logger: silentLogger(),
      now: NOW,
    })

    expect(result).toEqual({ recipients: 0, notifications: 0, failures: 0 })
    expect(await unsent()).toHaveLength(1)
  })

  it('collapses several notifications for one recipient into one message', async () => {
    const { mailer, sent } = recordingMailer()
    await recordNotifications(database.db, [
      event({ eventKey: 'a', subjectKey: 'ENG-12' }),
      event({ eventKey: 'b', subjectKey: 'ENG-13' }),
      event({ eventKey: 'c', subjectKey: 'ENG-14' }),
    ])

    const result = await sweep(mailer)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toEqual([`${recipientId}@example.com`])
    expect(sent[0]?.message.subject).toContain('2 more')
    expect(sent[0]?.message.text).toContain('ENG-14')
    expect(result).toEqual({ recipients: 1, notifications: 3, failures: 0 })
    expect(await unsent()).toHaveLength(0)
  })

  it('builds every link from the configured public URL', async () => {
    const { mailer, sent } = recordingMailer()
    await recordNotifications(database.db, [event()])

    await sweep(mailer)

    expect(sent[0]?.message.html).toContain(PUBLIC_URL)
    expect(sent[0]?.message.html).not.toContain('localhost')
  })

  it('excludes a recipient who lost team membership between the write and the sweep', async () => {
    const { mailer, sent } = recordingMailer()
    await recordNotifications(database.db, [event()])
    await database.db
      .deleteFrom('team_membership')
      .where('id', '=', teamMembershipId)
      .executeTakeFirst()

    const result = await sweep(mailer)

    expect(sent).toHaveLength(0)
    expect(result.recipients).toBe(0)
    expect(await unsent()).toHaveLength(1)
  })

  it('excludes a notification already read in-app', async () => {
    const { mailer, sent } = recordingMailer()
    await recordNotifications(database.db, [event()])
    await database.db
      .updateTable('notification')
      .set({ read_at: new Date(NOW) })
      .where('recipient_id', '=', recipientId)
      .execute()

    await sweep(mailer)

    expect(sent).toHaveLength(0)
  })

  it('excludes a notification still inside the debounce, and one older than the window', async () => {
    const { mailer, sent } = recordingMailer()
    await recordNotifications(database.db, [
      event({ eventKey: 'fresh', createdAt: NOW - 1_000 }),
      event({ eventKey: 'stale', createdAt: NOW - NOTIFICATION_EMAIL_MAX_AGE_MS - 60_000 }),
    ])

    await sweep(mailer)

    expect(sent).toHaveLength(0)
    expect(await unsent()).toHaveLength(2)
  })

  it('honours the recipient preference: none sends nothing, all sends ambient kinds too', async () => {
    await database.db
      .insertInto('user_preference')
      .values({ id: newId(), user_id: recipientId, email_notifications: 'none' })
      .execute()
    await recordNotifications(database.db, [event()])

    const off = recordingMailer()
    await sweep(off.mailer)
    expect(off.sent).toHaveLength(0)

    await database.db
      .updateTable('user_preference')
      .set({ email_notifications: 'assigned_only' })
      .where('user_id', '=', recipientId)
      .execute()
    await recordNotifications(database.db, [event({ eventKey: 'chat', kind: 'issue_commented' })])

    const actionable = recordingMailer()
    await sweep(actionable.mailer)
    expect(actionable.sent).toHaveLength(1)
    expect(actionable.sent[0]?.message.text).not.toContain('commented')

    await database.db
      .updateTable('user_preference')
      .set({ email_notifications: 'all' })
      .where('user_id', '=', recipientId)
      .execute()

    const everything = recordingMailer()
    await sweep(everything.mailer)
    expect(everything.sent[0]?.message.text).toContain('commented')
  })

  it('leaves rows unstamped and does not throw when the transport fails', async () => {
    const logger = silentLogger()
    const { mailer, sent } = recordingMailer(() => Promise.reject(new Error('relay refused')))
    await recordNotifications(database.db, [event({ eventKey: 'a' }), event({ eventKey: 'b' })])

    const result = await sweep(mailer, logger)

    expect(sent).toHaveLength(1)
    expect(result).toEqual({ recipients: 0, notifications: 0, failures: 1 })
    expect(await unsent()).toHaveLength(2)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('never emails the same notification twice', async () => {
    const first = recordingMailer()
    await recordNotifications(database.db, [event()])

    await sweep(first.mailer)
    const second = recordingMailer()
    await sweep(second.mailer)

    expect(first.sent).toHaveLength(1)
    expect(second.sent).toHaveLength(0)
  })
})

// THE BATCH BUDGET BELONGS TO ROWS THAT CAN ACTUALLY BE EMAILED. Filtered in TypeScript AFTER the
// sweep's LIMIT, a recipient who has turned email off consumes the entire budget with rows that are
// then discarded — and, being discarded, never stamped, so they consume it again on the next tick
// and every tick after it. One such recipient starves everyone else for the whole recency window.
describe.skipIf(DATABASE_URL === undefined)('notification email batch budget (live db)', () => {
  let database: Database
  const workspaceId = newId()
  const teamId = newId()
  const actorId = `budget-actor-${newId()}`
  // Sorts BEFORE the quiet recipient, because the sweep orders by `recipient_id`: the noisy backlog
  // is therefore reached first, which is precisely the arrangement that starved the other one.
  const noisyId = `aaaa-budget-${newId()}`
  const quietId = `zzzz-budget-${newId()}`

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'Budget WS' })
      .execute()
    await database.db
      .insertInto('team')
      .values({
        id: teamId,
        workspace_id: workspaceId,
        name: 'Budget',
        key: `B${Date.now() % 10000}`,
      })
      .execute()
    await database.db
      .insertInto('user')
      .values([
        { id: actorId, name: 'Ada', email: `${actorId}@example.com`, emailVerified: true },
        { id: noisyId, name: 'Noisy', email: `${noisyId}@example.com`, emailVerified: true },
        { id: quietId, name: 'Quiet', email: `${quietId}@example.com`, emailVerified: true },
      ])
      .execute()
    await database.db
      .insertInto('team_membership')
      .values([
        { id: newId(), team_id: teamId, user_id: noisyId },
        { id: newId(), team_id: teamId, user_id: quietId },
      ])
      .execute()
    await database.db
      .insertInto('user_preference')
      .values({ id: newId(), user_id: noisyId, email_notifications: 'none' })
      .execute()
  }, 60_000)

  afterAll(async () => {
    if (!database) return
    await database.db
      .deleteFrom('notification')
      .where('recipient_id', 'in', [noisyId, quietId])
      .execute()
    await database.db.deleteFrom('user_preference').where('user_id', '=', noisyId).execute()
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.db.deleteFrom('user').where('id', 'in', [actorId, noisyId, quietId]).execute()
    await database.close()
  })

  it('still emails a recipient sitting behind a backlog larger than the whole batch', async () => {
    const { mailer, sent } = recordingMailer()
    await recordNotifications(database.db, [
      ...Array.from(
        { length: NOTIFICATION_EMAIL_BATCH_LIMIT + 1 },
        (_, index): NotificationEvent => ({
          recipientId: noisyId,
          actorId,
          kind: 'issue_assigned',
          teamId,
          subjectType: 'issue',
          subjectId: newId(),
          subjectKey: `ENG-${index}`,
          subjectTitle: 'Noise',
          eventKey: String(index),
          createdAt: SETTLED,
        }),
      ),
      {
        recipientId: quietId,
        actorId,
        kind: 'issue_assigned',
        teamId,
        subjectType: 'issue',
        subjectId: newId(),
        subjectKey: 'ENG-quiet',
        subjectTitle: 'Ship the inbox',
        eventKey: 'quiet',
        createdAt: SETTLED,
      },
    ])

    const result = await runNotificationEmailSweep({
      db: database.db,
      mailer,
      publicUrl: PUBLIC_URL,
      logger: silentLogger(),
      now: NOW,
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toEqual([`${quietId}@example.com`])
    expect(result.recipients).toBe(1)
  })
})

describe.skipIf(DATABASE_URL === undefined)('notification retention (live db)', () => {
  let database: Database
  const workspaceId = newId()
  const teamId = newId()
  const actorId = `retention-actor-${newId()}`
  const recipientId = `retention-recipient-${newId()}`

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'Retention WS' })
      .execute()
    await database.db
      .insertInto('team')
      .values({
        id: teamId,
        workspace_id: workspaceId,
        name: 'Retention',
        key: `R${Date.now() % 10000}`,
      })
      .execute()
  }, 30_000)

  afterAll(async () => {
    if (!database) return
    await database.db.deleteFrom('notification').where('recipient_id', '=', recipientId).execute()
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.close()
  })

  it('deletes past the retention window and keeps everything inside it', async () => {
    const day = 24 * 60 * 60 * 1000
    await recordNotifications(database.db, [
      {
        recipientId,
        actorId,
        kind: 'issue_assigned',
        teamId,
        subjectType: 'issue',
        subjectId: newId(),
        subjectKey: 'ENG-1',
        subjectTitle: 'Old',
        eventKey: 'old',
        createdAt: NOW - 40 * day,
      },
      {
        recipientId,
        actorId,
        kind: 'issue_assigned',
        teamId,
        subjectType: 'issue',
        subjectId: newId(),
        subjectKey: 'ENG-2',
        subjectTitle: 'Recent',
        eventKey: 'recent',
        createdAt: NOW - 2 * day,
      },
    ])

    const deleted = await runNotificationRetention({
      db: database.db,
      retentionDays: 30,
      logger: silentLogger(),
      now: NOW,
    })

    const remaining = await database.db
      .selectFrom('notification')
      .select('event_key')
      .where('recipient_id', '=', recipientId)
      .execute()

    expect(deleted).toBe(1)
    expect(remaining.map((row) => row.event_key)).toEqual(['recent'])
  })
})
