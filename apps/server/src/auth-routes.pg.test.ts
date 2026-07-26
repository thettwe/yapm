import { newId } from '@yapm/schema'
import type { Database } from '@yapm/schema/db'
import { createDatabase, migrateToLatest } from '@yapm/schema/db'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthService, SessionUser } from './auth.js'
import { createAuthRoutes } from './auth-routes.js'
import { type Env, envSchema } from './config/env.js'
import type { Mailer, OutboundMessage } from './mail/index.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the invite email route test must not be skipped')
}

const PUBLIC_URL = 'https://yapm.example.com'
const silent = pino({ level: 'silent' })

function recordingMailer(): { mailer: Mailer; sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = []
  return {
    sent,
    mailer: {
      transport: 'resend',
      send: (message) => {
        sent.push(message)
        return Promise.resolve()
      },
    },
  }
}

describe.skipIf(DATABASE_URL === undefined)('POST /api/invites/send (live db)', () => {
  let database: Database
  const workspaceId = newId()
  const adminId = `invite-admin-${newId()}`
  const memberId = `invite-member-${newId()}`
  const emailInviteId = newId()
  const linkInviteId = newId()
  const revokedInviteId = newId()
  const expiredInviteId = newId()
  const token = `token-${newId()}`

  let sessionUser: SessionUser

  const auth = {
    getSessionUser: () => Promise.resolve(sessionUser),
  } as unknown as AuthService

  // `describe.skipIf` still runs this factory at collection time, so nothing env-dependent may be
  // evaluated here: parsing the real env schema with no DATABASE_URL would fail the whole file
  // instead of skipping it. Built in `beforeAll`, which only runs when the suite is not skipped.
  let env: Env

  const routes = (mail?: { mailer: Mailer; publicUrl: string }) =>
    createAuthRoutes({ auth, db: database.db, env, logger: silent, ...(mail ? { mail } : {}) })

  const send = (app: ReturnType<typeof routes>, inviteId: string) =>
    app.request('/api/invites/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId }),
    })

  beforeAll(async () => {
    const parsedEnv = envSchema.parse({ DATABASE_URL })
    env = { ...parsedEnv, WEB_DIST_DIR: parsedEnv.WEB_DIST_DIR ?? '' }

    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    await database.db.insertInto('workspace').values({ id: workspaceId, name: 'Acme' }).execute()
    await database.db
      .insertInto('user')
      .values([
        { id: adminId, name: 'Ada', email: `${adminId}@example.com`, emailVerified: true },
        { id: memberId, name: 'Mel', email: `${memberId}@example.com`, emailVerified: true },
      ])
      .execute()
    await database.db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: adminId, role: 'admin' },
        { id: newId(), workspace_id: workspaceId, user_id: memberId, role: 'member' },
      ])
      .execute()
    await database.db
      .insertInto('invite')
      .values([
        {
          id: emailInviteId,
          workspace_id: workspaceId,
          token,
          role: 'member',
          email: 'bee@example.com',
          created_by: adminId,
          expires_at: new Date(Date.now() + 86_400_000),
        },
        {
          id: linkInviteId,
          workspace_id: workspaceId,
          token: `${token}-link`,
          role: 'member',
          email: null,
          created_by: adminId,
          expires_at: new Date(Date.now() + 86_400_000),
        },
        {
          id: revokedInviteId,
          workspace_id: workspaceId,
          token: `${token}-revoked`,
          role: 'member',
          email: 'revoked@example.com',
          created_by: adminId,
          expires_at: new Date(Date.now() + 86_400_000),
          revoked_at: new Date(Date.now() - 1000),
        },
        {
          id: expiredInviteId,
          workspace_id: workspaceId,
          token: `${token}-expired`,
          role: 'member',
          email: 'expired@example.com',
          created_by: adminId,
          expires_at: new Date(Date.now() - 1000),
        },
      ])
      .execute()
    sessionUser = { id: adminId, email: `${adminId}@example.com` } as SessionUser
  }, 30_000)

  afterAll(async () => {
    if (!database) return
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.db.deleteFrom('user').where('id', 'in', [adminId, memberId]).execute()
    await database.close()
  })

  it('sends nothing and still answers with the invite unsent when email is off', async () => {
    sessionUser = { id: adminId, email: `${adminId}@example.com` } as SessionUser

    const response = await send(routes(), emailInviteId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, sent: false, link: null })
  })

  it('hands the rendered invite to the transport when a mailer exists', async () => {
    sessionUser = { id: adminId, email: `${adminId}@example.com` } as SessionUser
    const { mailer, sent } = recordingMailer()

    const response = await send(routes({ mailer, publicUrl: PUBLIC_URL }), emailInviteId)
    const body = (await response.json()) as { sent: boolean; link: string }

    expect(body.sent).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toEqual(['bee@example.com'])
    expect(sent[0]?.message.subject).toBe('You have been invited to Acme on yapm')
    expect(sent[0]?.message.html).toContain(body.link)
    expect(body.link).toContain(PUBLIC_URL)
  })

  it('sends nothing for a shareable link, which has nobody to mail', async () => {
    sessionUser = { id: adminId, email: `${adminId}@example.com` } as SessionUser
    const { mailer, sent } = recordingMailer()

    const response = await send(routes({ mailer, publicUrl: PUBLIC_URL }), linkInviteId)

    await expect(response.json()).resolves.toEqual({ ok: true, sent: false, link: null })
    expect(sent).toHaveLength(0)
  })

  it('sends nothing for a revoked invite, whose link is already dead', async () => {
    sessionUser = { id: adminId, email: `${adminId}@example.com` } as SessionUser
    const { mailer, sent } = recordingMailer()

    const response = await send(routes({ mailer, publicUrl: PUBLIC_URL }), revokedInviteId)

    await expect(response.json()).resolves.toEqual({ ok: true, sent: false, link: null })
    expect(sent).toHaveLength(0)
  })

  it('sends nothing for an expired invite, whose link is already dead', async () => {
    sessionUser = { id: adminId, email: `${adminId}@example.com` } as SessionUser
    const { mailer, sent } = recordingMailer()

    const response = await send(routes({ mailer, publicUrl: PUBLIC_URL }), expiredInviteId)

    await expect(response.json()).resolves.toEqual({ ok: true, sent: false, link: null })
    expect(sent).toHaveLength(0)
  })

  it('refuses a non-admin before reading the invite', async () => {
    sessionUser = { id: memberId, email: `${memberId}@example.com` } as SessionUser
    const { mailer, sent } = recordingMailer()

    const response = await send(routes({ mailer, publicUrl: PUBLIC_URL }), emailInviteId)

    expect(response.status).toBe(403)
    expect(sent).toHaveLength(0)
  })

  it('answers 404 for an unknown invite', async () => {
    sessionUser = { id: adminId, email: `${adminId}@example.com` } as SessionUser

    const { mailer } = recordingMailer()

    const response = await send(routes({ mailer, publicUrl: PUBLIC_URL }), newId())

    expect(response.status).toBe(404)
  })

  it('reports the invite unsent rather than failing when the transport throws', async () => {
    sessionUser = { id: adminId, email: `${adminId}@example.com` } as SessionUser
    const mailer: Mailer = {
      transport: 'smtp',
      send: () => Promise.reject(new Error('relay refused')),
    }

    const response = await send(routes({ mailer, publicUrl: PUBLIC_URL }), emailInviteId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, sent: false, link: null })
  })
})
