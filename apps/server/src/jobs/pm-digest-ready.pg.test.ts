import { ACTIONABLE_NOTIFICATION_KINDS, newId } from '@yapm/schema'
import type { Database } from '@yapm/schema/db'
import {
  createDatabase,
  migrateToLatest,
  pendingNotificationEmails,
  pendingPmDigestReadyEmails,
  recordNotifications,
  setPmDisclosurePolicy,
} from '@yapm/schema/db'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Mailer, OutboundMessage } from '../mail/index.js'
import { runPmDigestReadyEmailSweep } from './disclosure.js'
import {
  NOTIFICATION_EMAIL_BATCH_LIMIT,
  NOTIFICATION_EMAIL_DEBOUNCE_MS,
  runNotificationEmailSweep,
} from './notifications.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the two-sweep disjointness test must not be skipped',
  )
}

const PUBLIC_URL = 'https://yapm.example.com'
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0)
const SETTLED = NOW - NOTIFICATION_EMAIL_DEBOUNCE_MS - 60_000

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() }
}

function recordingMailer(): { mailer: Mailer; sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = []
  return {
    sent,
    mailer: {
      transport: 'smtp',
      send: (message) => {
        sent.push(message)
        return Promise.resolve()
      },
    },
  }
}

// TWO delivery sweeps now exist. The duplication is chosen — `pendingNotificationEmails`' access
// predicate is team-membership-or-workspace-admin and a named PM reader is neither — and it is
// bounded by the two selections being PROVABLY DISJOINT. That is what this suite asserts, against
// seeded rows of both kinds, including the person who is both a workspace admin and a named reader
// and must therefore be mailed exactly once about each event.
describe.skipIf(DATABASE_URL === undefined)(
  'the two delivery sweeps are disjoint (live db)',
  () => {
    let database: Database
    const workspaceId = newId()
    const teamId = newId()
    const cycleId = newId()
    const digestId = newId()
    const actorId = `actor-${newId()}`
    // BOTH HATS: a workspace admin (so the shipped sweep's access predicate matches them) AND a named
    // PM reader (so the new sweep's entitlement resolves). Exactly the person a widened predicate
    // would have mailed twice.
    const bothHatsId = `both-${newId()}`
    const issueId = newId()

    const sweeps = async () => {
      const notificationMail = recordingMailer()
      const readyMail = recordingMailer()
      const notifications = await runNotificationEmailSweep({
        db: database.db,
        mailer: notificationMail.mailer,
        publicUrl: PUBLIC_URL,
        logger: silentLogger(),
        now: NOW,
      })
      const ready = await runPmDigestReadyEmailSweep({
        db: database.db,
        mailer: readyMail.mailer,
        publicUrl: PUBLIC_URL,
        logger: silentLogger(),
        now: NOW,
      })
      return { notifications, ready, notificationMail, readyMail }
    }

    beforeAll(async () => {
      database = createDatabase({ connectionString: DATABASE_URL ?? '' })
      await migrateToLatest(database.db)
      await database.db.insertInto('workspace').values({ id: workspaceId, name: 'Both' }).execute()
      await database.db
        .insertInto('team')
        .values({
          id: teamId,
          workspace_id: workspaceId,
          name: 'Platform',
          key: `B${Date.now() % 10000}`,
        })
        .execute()
      await database.db
        .insertInto('user')
        .values([
          { id: actorId, name: 'Ada', email: `${actorId}@example.com`, emailVerified: true },
          { id: bothHatsId, name: 'Bee', email: `${bothHatsId}@example.com`, emailVerified: true },
        ])
        .execute()
      await database.db
        .insertInto('workspace_member')
        .values({ id: newId(), workspace_id: workspaceId, user_id: bothHatsId, role: 'admin' })
        .execute()
      await database.db
        .insertInto('issue')
        .values({
          id: issueId,
          team_id: teamId,
          title: 'Ship the inbox',
          status: 'todo',
          priority: 'no_priority',
          creator_id: actorId,
        })
        .execute()
      await database.db
        .insertInto('cycle')
        .values({
          id: cycleId,
          team_id: teamId,
          name: 'Cycle 14',
          number: 14,
          start_date: new Date('2026-05-18'),
          end_date: new Date('2026-05-31'),
          status: 'completed',
        })
        .execute()
      await database.db
        .insertInto('pm_digest')
        .values({ id: digestId, cycle_id: cycleId, team_id: teamId, status: 'ready' })
        .execute()

      // All three switches on, and the both-hats user named as a reader.
      await setPmDisclosurePolicy(
        database.db,
        { userID: bothHatsId, role: 'admin' },
        {
          configId: newId(),
          auditId: newId(),
          workspaceId,
          enabled: true,
          teams: { [teamId]: { pmVisible: true, audience: [bothHatsId] } },
        },
      )
    }, 30_000)

    afterEach(async () => {
      await database.db.deleteFrom('notification').where('recipient_id', '=', bothHatsId).execute()
    })

    afterAll(async () => {
      if (!database) return
      await database.db.deleteFrom('notification').where('recipient_id', '=', bothHatsId).execute()
      await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
      await database.db.deleteFrom('user').where('id', 'in', [actorId, bothHatsId]).execute()
      await database.close()
    })

    async function seedBoth(): Promise<void> {
      await recordNotifications(database.db, [
        {
          recipientId: bothHatsId,
          actorId,
          kind: 'issue_assigned',
          teamId,
          subjectType: 'issue',
          subjectId: issueId,
          subjectKey: 'ENG-12',
          subjectTitle: 'Ship the inbox',
          eventKey: String(SETTLED),
          createdAt: SETTLED,
        },
        {
          recipientId: bothHatsId,
          actorId: 'system',
          kind: 'pm_digest_published',
          teamId,
          subjectType: 'pm_digest',
          subjectId: digestId,
          subjectKey: null,
          subjectTitle: 'Platform · Cycle 14',
          eventKey: String(SETTLED),
          createdAt: SETTLED,
        },
      ])
    }

    it('selects no pm_digest row into the shipped notification sweep', async () => {
      await seedBoth()
      const rows = await pendingNotificationEmails(database.db, {
        createdBefore: new Date(NOW - NOTIFICATION_EMAIL_DEBOUNCE_MS),
        createdAfter: new Date(NOW - 24 * 60 * 60 * 1000),
        actionableKinds: [...ACTIONABLE_NOTIFICATION_KINDS],
        limit: NOTIFICATION_EMAIL_BATCH_LIMIT,
      })
      const mine = rows.filter((row) => row.recipientId === bothHatsId)
      expect(mine.map((row) => row.subjectType)).toEqual(['issue'])
    })

    it('selects no issue row into the PM digest ready sweep', async () => {
      await seedBoth()
      const rows = await pendingPmDigestReadyEmails(database.db, {
        createdBefore: new Date(NOW - NOTIFICATION_EMAIL_DEBOUNCE_MS),
        createdAfter: new Date(NOW - 24 * 60 * 60 * 1000),
        limit: NOTIFICATION_EMAIL_BATCH_LIMIT,
      })
      const mine = rows.filter((row) => row.recipientId === bothHatsId)
      expect(mine.map((row) => row.subjectId)).toEqual([digestId])
    })

    // The whole point of the narrowing clause: a workspace admin who is ALSO a named reader gets one
    // message for the issue and one for the digest, never two for either.
    it('mails a workspace admin who is also a named reader exactly once per event', async () => {
      await seedBoth()
      const { notifications, ready, notificationMail, readyMail } = await sweeps()

      expect(notifications.notifications).toBe(1)
      expect(ready.sent).toBe(1)
      expect(notificationMail.sent).toHaveLength(1)
      expect(readyMail.sent).toHaveLength(1)

      // And the ready message really is a link with no digest content, end to end through the sweep.
      const message = readyMail.sent[0]
      expect(message?.message.text).toContain(`${PUBLIC_URL}/digests`)
      expect(message?.message.text).not.toContain('Ship the inbox')

      // Both rows stamped, so a second pass over the same window sends nothing.
      const second = await sweeps()
      expect(second.notifications.notifications).toBe(0)
      expect(second.ready.sent).toBe(0)
    })

    // Entitlement withdrawn between publish and sweep: the notice is withheld and left unstamped.
    it('withholds the notice when the kill switch is set before the sweep runs', async () => {
      await seedBoth()
      await setPmDisclosurePolicy(
        database.db,
        { userID: bothHatsId, role: 'admin' },
        {
          configId: newId(),
          auditId: newId(),
          workspaceId,
          killed: true,
        },
      )

      const { ready, readyMail } = await sweeps()
      expect(ready).toMatchObject({ sent: 0, withheld: 1 })
      expect(readyMail.sent).toEqual([])

      const unstamped = await database.db
        .selectFrom('notification')
        .select('subject_id')
        .where('recipient_id', '=', bothHatsId)
        .where('subject_type', '=', 'pm_digest')
        .where('email_sent_at', 'is', null)
        .execute()
      expect(unstamped).toHaveLength(1)

      await setPmDisclosurePolicy(
        database.db,
        { userID: bothHatsId, role: 'admin' },
        {
          configId: newId(),
          auditId: newId(),
          workspaceId,
          killed: false,
        },
      )
    })
  },
)
