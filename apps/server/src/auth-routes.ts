import { newId } from '@yapm/schema'
import type { DB } from '@yapm/schema/db'
import { acceptInvite, bootstrapFirstAdmin, lookupWorkspaceRole } from '@yapm/schema/db'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { Kysely } from 'kysely'
import * as z from 'zod'
import type { AuthService, SessionUser } from './auth.js'
import type { Env } from './config/env.js'
import type { Logger } from './logger.js'

export interface AuthRoutesOptions {
  auth: AuthService
  db: Kysely<DB>
  env: Env
  logger: Logger
}

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionUser
  }
}

const acceptInviteBody = z.object({ token: z.string().min(1) })

export function createAuthRoutes(options: AuthRoutesOptions): Hono {
  const { auth, db, env, logger } = options
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
    }

    // Return the role alongside the token so the client can build its optimistic auth
    // context. The server still verifies the token and re-resolves the role per request,
    // so this value never grants authority on its own.
    const role = await lookupWorkspaceRole(db, user.id)
    const token = await auth.issueSyncToken(c.req.raw.headers)
    return c.json({ token, userID: user.id, role })
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
