import type { DB } from '@yapm/schema/db'
import { claimSsoProvider, hasUsableSsoProvider, listSsoProvidersRedacted } from '@yapm/schema/db'
import { APIError } from 'better-auth/api'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Kysely } from 'kysely'
import * as z from 'zod'
import type { AuthService } from '../auth.js'
import type { Logger } from '../logger.js'

export const SSO_API_BASE = '/api/v1/sso'

export interface SsoAdminRoutesOptions {
  auth: AuthService
  db: Kysely<DB>
  logger: Logger
}

interface AdminSession {
  userId: string
  workspaceId: string
}

declare module 'hono' {
  interface ContextVariableMap {
    ssoAdmin: AdminSession
  }
}

const oidcConfigBody = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  discoveryEndpoint: z.url().optional(),
  authorizationEndpoint: z.url().optional(),
  tokenEndpoint: z.url().optional(),
  userInfoEndpoint: z.url().optional(),
  jwksEndpoint: z.url().optional(),
  tokenEndpointAuthentication: z.enum(['client_secret_post', 'client_secret_basic']).optional(),
  scopes: z.array(z.string().min(1)).optional(),
  pkce: z.boolean().optional(),
  // Registration performs OIDC discovery against `issuer`/`discoveryEndpoint` unless this is set,
  // in which case the three endpoints below must be supplied by hand.
  skipDiscovery: z.boolean().optional(),
})

const registerBody = z.object({
  // The operator-chosen slug. It becomes a DNS LABEL during domain verification
  // (`_better-auth-token-<providerId>.<domain>`), and it is spliced into the redirect URI, so it is
  // constrained here rather than at the point where a bad one would produce a confusing DNS error.
  providerId: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/u),
  issuer: z.url(),
  // Comma-separated is the plugin's own multi-domain form; passed through verbatim.
  domain: z.string().min(1),
  oidcConfig: oidcConfigBody,
})

// Every field optional: an omission means "leave it as it is". A `clientSecret` here is how a
// rotation happens — it is write-only in both directions, entered and never read back.
const updateBody = z.object({
  issuer: z.url().optional(),
  domain: z.string().min(1).optional(),
  oidcConfig: oidcConfigBody.partial().optional(),
})

// The workspace's SSO configuration surface. SSO provider registration is the one configuration
// path in yapm that better-auth would otherwise leave open to any signed-in account, including one
// that belongs to no workspace — so the seven management paths are removed from better-auth's own
// router (`SSO_DISABLED_PATHS` in auth.ts) and this is the only door.
//
// Every route is admin-gated by ROUTE MIDDLEWARE, so authorization is decided before `:providerId`
// is even read: a member asking about a provider that does not exist and a member asking about one
// that does get the identical 403. No response here carries `clientSecret`, `privateKey` or
// `decryptionPvk`.
export function createSsoAdminRoutes(options: SsoAdminRoutesOptions): Hono {
  const { auth, db, logger } = options
  const app = new Hono()

  const requireAdmin = createMiddleware(async (c, next) => {
    const user = await auth.getSessionUser(c.req.raw.headers)
    if (user === undefined) return c.json({ error: 'unauthorized' }, 401)
    const member = await db
      .selectFrom('workspace_member')
      .select(['workspace_id', 'role'])
      .where('user_id', '=', user.id)
      .executeTakeFirst()
    if (member?.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
    c.set('ssoAdmin', { userId: user.id, workspaceId: member.workspace_id })
    await next()
  })

  const statusPayload = async () => ({
    configured: await hasUsableSsoProvider(db),
    providers: await listSsoProvidersRedacted(db),
  })

  // The plugin's `APIError` messages can name a provider the caller did not ask about (its access
  // check answers "You don't have access to this provider"), and its 403 would contradict the 403
  // this surface means. So the status is mapped and the message is replaced with a yapm-owned code —
  // never echoed verbatim.
  const failure = (error: unknown): { code: string; status: 400 | 404 | 409 | 502 | 500 } => {
    if (!(error instanceof APIError)) return { code: 'internal_server_error', status: 500 }
    switch (error.statusCode) {
      // 403 is the plugin's own ownership refusal, which `claimSsoProvider` has already made
      // unreachable. Folded into 404 rather than passed through, because a 403 from THIS surface
      // means "you are not a workspace admin" and must not come to mean two different things.
      case 403:
      case 404:
        return { code: 'provider_not_found', status: 404 }
      case 409:
        return { code: 'conflict', status: 409 }
      case 502:
        return { code: 'domain_verification_failed', status: 502 }
      case 400:
        return { code: 'invalid_provider_config', status: 400 }
      default:
        return { code: 'internal_server_error', status: 500 }
    }
  }

  const sso = new Hono()

  sso.get('/', requireAdmin, async (c) => c.json(await statusPayload()))

  sso.post('/providers', requireAdmin, async (c) => {
    const parsed = registerBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)

    try {
      const result = await auth.registerSsoProvider(c.req.raw.headers, parsed.data)
      logger.info({ providerId: result.providerId }, 'sso provider registered')
      return c.json({
        providerId: result.providerId,
        domain: result.domain,
        domainVerified: result.domainVerified,
        // The DNS TXT record's value. Intended to be published, so it is returned — but only to an
        // admin, and only for the provider they just created.
        domainVerificationToken: result.domainVerificationToken,
        redirectURI: result.redirectURI,
        ...(await statusPayload()),
      })
    } catch (error) {
      const { code, status } = failure(error)
      if (status === 500) logger.error({ err: error }, 'sso provider registration failed')
      // A duplicate `providerId` violates the table's unique constraint rather than raising an
      // `APIError`, so it would otherwise be a 500. Named here because it is the mistake an operator
      // following the docs actually makes.
      const duplicate =
        status === 500 && error instanceof Error && /duplicate key|unique/iu.test(error.message)
      return duplicate ? c.json({ error: 'provider_exists' }, 409) : c.json({ error: code }, status)
    }
  })

  // Ownership is transferred to the calling admin before every mutation (design §D4): the plugin
  // authorizes by `provider.userId === session.user.id`, and a provider is workspace configuration
  // rather than the registering admin's property. `claimSsoProvider` runs only after `requireAdmin`.
  const claim = async (providerId: string, userId: string): Promise<boolean> =>
    claimSsoProvider(db, providerId, userId)

  sso.post('/providers/:providerId', requireAdmin, async (c) => {
    const { userId } = c.get('ssoAdmin')
    const providerId = c.req.param('providerId')
    const parsed = updateBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
    if (!(await claim(providerId, userId))) return c.json({ error: 'provider_not_found' }, 404)

    try {
      await auth.updateSsoProvider(c.req.raw.headers, { providerId, ...parsed.data })
      logger.info({ providerId }, 'sso provider updated')
      return c.json(await statusPayload())
    } catch (error) {
      const { code, status } = failure(error)
      if (status === 500) logger.error({ err: error, providerId }, 'sso provider update failed')
      return c.json({ error: code }, status)
    }
  })

  sso.delete('/providers/:providerId', requireAdmin, async (c) => {
    const { userId } = c.get('ssoAdmin')
    const providerId = c.req.param('providerId')
    if (!(await claim(providerId, userId))) return c.json({ error: 'provider_not_found' }, 404)

    try {
      await auth.deleteSsoProvider(c.req.raw.headers, providerId)
      logger.info({ providerId }, 'sso provider deleted')
      return c.json(await statusPayload())
    } catch (error) {
      const { code, status } = failure(error)
      if (status === 500) logger.error({ err: error, providerId }, 'sso provider deletion failed')
      return c.json({ error: code }, status)
    }
  })

  sso.post('/providers/:providerId/domain-verification', requireAdmin, async (c) => {
    const { userId } = c.get('ssoAdmin')
    const providerId = c.req.param('providerId')
    if (!(await claim(providerId, userId))) return c.json({ error: 'provider_not_found' }, 404)

    try {
      const { domainVerificationToken } = await auth.requestSsoDomainVerification(
        c.req.raw.headers,
        providerId,
      )
      return c.json({ providerId, domainVerificationToken })
    } catch (error) {
      const { code, status } = failure(error)
      if (status === 500)
        logger.error({ err: error, providerId }, 'sso domain token request failed')
      return c.json({ error: code }, status)
    }
  })

  sso.post('/providers/:providerId/verify', requireAdmin, async (c) => {
    const { userId } = c.get('ssoAdmin')
    const providerId = c.req.param('providerId')
    if (!(await claim(providerId, userId))) return c.json({ error: 'provider_not_found' }, 404)

    try {
      await auth.verifySsoDomain(c.req.raw.headers, providerId)
      logger.info({ providerId }, 'sso provider domain verified')
      return c.json(await statusPayload())
    } catch (error) {
      const { code, status } = failure(error)
      if (status === 500) logger.error({ err: error, providerId }, 'sso domain verification failed')
      return c.json({ error: code }, status)
    }
  })

  app.route(SSO_API_BASE, sso)

  app.onError((error, c) => {
    logger.error({ err: error, path: c.req.path }, 'sso admin route error')
    return c.json({ error: 'internal_server_error' }, 500)
  })

  return app
}
