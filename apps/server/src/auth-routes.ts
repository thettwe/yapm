import { newId } from '@yapm/schema'
import type { DB } from '@yapm/schema/db'
import {
  acceptInvite,
  bootstrapFirstAdmin,
  inviteEmailTarget,
  lookupWorkspaceRole,
  seedDemoContent,
} from '@yapm/schema/db'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { Kysely } from 'kysely'
import * as z from 'zod'
import type { AuthService, SessionUser } from './auth.js'
import type { Env } from './config/env.js'
import type { Logger } from './logger.js'
import { type Mailer, sendInviteEmail } from './mail/index.js'

export interface AuthRoutesOptions {
  auth: AuthService
  db: Kysely<DB>
  env: Env
  logger: Logger
  // Absent ⇒ email is off. Invite creation still succeeds and its link is still presented; the
  // send is simply skipped. Mirrors the `digest?:` optional-block shape used elsewhere.
  mail?: { mailer: Mailer; publicUrl: string }
}

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionUser
  }
}

const acceptInviteBody = z.object({ token: z.string().min(1) })
const sendInviteBody = z.object({ inviteId: z.string().min(1) })

export function createAuthRoutes(options: AuthRoutesOptions): Hono {
  const { auth, db, env, logger, mail } = options
  const app = new Hono()

  // CORS must be registered before the auth routes it protects. In production the SPA is
  // same-origin; in dev it is served by Vite (WEB_ORIGIN) and proxied here.
  const allowedOrigins = [env.WEB_ORIGIN, env.BETTER_AUTH_URL]
  app.use('/api/auth/*', async (c, next) => {
    const origin = c.req.header('origin')
    if (origin !== undefined && allowedOrigins.includes(origin)) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Access-Control-Allow-Credentials', 'true')
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      c.header('Vary', 'Origin')
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    await next()
  })

  // The login UI reflects only configured methods (an unconfigured provider is absent, not
  // paywalled). Report the enabled set from env so the client has a single source of truth.
  // SSO is always available (the plugin is enabled and free); email/password is always on.
  app.get('/api/auth-methods', (c) =>
    c.json({
      emailPassword: true,
      github: env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_SECRET !== undefined,
      sso: true,
    }),
  )

  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  const requireSession = createMiddleware(async (c, next) => {
    const user = await auth.getSessionUser(c.req.raw.headers)
    if (user === undefined) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    c.set('user', user)
    await next()
  })

  // The web client fetches its Zero sync JWT here right after sign-in. This is also the
  // first authenticated call, so it is where first-admin bootstrap runs.
  app.get('/api/zero/token', requireSession, async (c) => {
    const user = c.get('user')

    const promoted = await bootstrapFirstAdmin(db, {
      id: newId(),
      userId: user.id,
      userEmail: user.email,
      ...(env.YAPM_BOOTSTRAP_ADMIN_EMAIL === undefined
        ? {}
        : { requiredEmail: env.YAPM_BOOTSTRAP_ADMIN_EMAIL }),
    })
    if (promoted) {
      logger.info({ userId: user.id }, 'bootstrapped first workspace admin')

      if (env.SEED_DEMO_CONTENT === 'true') {
        const demo = await seedDemoContent(db, { userId: user.id })
        if (demo) {
          logger.info(
            { teamId: demo.teamId, teamKey: demo.teamKey, issues: demo.issueCount },
            'seeded demo content',
          )
        }
      }
    }

    // Return the role alongside the token so the client can build its optimistic auth
    // context. The server still verifies the token and re-resolves the role per request,
    // so this value never grants authority on its own.
    const role = await lookupWorkspaceRole(db, user.id)
    // `expiresAt` (epoch seconds) lets the client re-mint before the credential dies instead
    // of after the socket breaks. Additive and optional: a client that ignores it falls back
    // to a fixed timer.
    const { token, expiresAt } = await auth.issueSyncToken(c.req.raw.headers)
    return c.json({ token, userID: user.id, role, expiresAt })
  })

  // Delivery only. The invite ROW is created by the shared `invite.create` mutator, which the
  // client awaits to its authoritative apply before calling this — so there is no race, and no
  // network call inside a sync transaction. Failing to send never invalidates the invite: the admin
  // already has the link, which is the guarantee the invitations spec makes.
  app.post('/api/invites/send', requireSession, async (c) => {
    const user = c.get('user')
    if ((await lookupWorkspaceRole(db, user.id)) !== 'admin') {
      return c.json({ error: 'forbidden' }, 403)
    }

    const parsed = sendInviteBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      throw new HTTPException(400, { message: 'a non-empty invite id is required' })
    }

    const invite = await inviteEmailTarget(db, parsed.data.inviteId)
    if (!invite) return c.json({ error: 'not_found' }, 404)
    if (invite.email === null) return c.json({ ok: true, sent: false, link: null })

    // A revoked or expired invite has nothing deliverable: `acceptInvite` already refuses both, so
    // mailing one would send a link that is dead on arrival. Answered as "nothing to send" rather
    // than 404 — the row plainly exists in the admin's own list, and claiming otherwise would lie.
    if (invite.revokedAt !== null || invite.expiresAt.getTime() <= Date.now()) {
      return c.json({ ok: true, sent: false, link: null })
    }

    try {
      const result = await sendInviteEmail({
        mailer: mail?.mailer ?? null,
        publicUrl: mail?.publicUrl ?? null,
        workspaceName: invite.workspaceName,
        inviterName: invite.inviterName,
        recipient: invite.email,
        token: invite.token,
      })
      if (result.sent) logger.info({ inviteId: invite.id }, 'invite email sent')
      return c.json({ ok: true, sent: result.sent, link: result.link })
    } catch (error) {
      logger.error({ err: error, inviteId: invite.id }, 'invite email delivery failed')
      return c.json({ ok: true, sent: false, link: null })
    }
  })

  app.post('/api/invites/accept', requireSession, async (c) => {
    const user = c.get('user')

    const parsed = acceptInviteBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      throw new HTTPException(400, { message: 'a non-empty invite token is required' })
    }

    const result = await acceptInvite(db, {
      token: parsed.data.token,
      userId: user.id,
      userEmail: user.email,
      memberId: newId(),
      teamMembershipId: newId(),
    })

    if (!result.ok) {
      const status =
        result.reason === 'not_found' ? 404 : result.reason === 'email_mismatch' ? 403 : 409
      return c.json({ error: result.reason }, status)
    }

    logger.info({ userId: user.id, workspaceId: result.workspaceId }, 'invite accepted')
    return c.json({
      ok: true,
      workspaceId: result.workspaceId,
      role: result.role,
      teamId: result.teamId,
    })
  })

  return app
}
