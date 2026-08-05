import { sso } from '@better-auth/sso'
import type { DB } from '@yapm/schema/db'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { bearer, jwt } from 'better-auth/plugins'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Kysely } from 'kysely'
import type { Env } from './config/env.js'

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24
// zero-cache holds one sync socket open for a long time; the plugin's 15-minute
// default is too short. The web client refreshes on a 401/403 from the sync endpoints.
const SYNC_TOKEN_EXPIRATION = '1h'

// Per-user cap the SSO plugin enforces at registration. Defence in depth only — registration is
// admin-gated at `/api/v1/sso` — but it must never be `0`: the plugin reads a falsy limit as
// "registration is disabled" and would refuse the admin surface too.
const SSO_PROVIDERS_LIMIT = 5

// The SSO plugin's provider-MANAGEMENT endpoints, removed from better-auth's router so the only way
// to reach them is the workspace-admin-gated `/api/v1/sso`. These are PATHS, matched exactly by
// better-auth's own `onRequest` after `normalizePathname` strips the query string and any trailing
// slash — there is no prefix semantics here, which is precisely why the list is safe.
//
// NO CALLBACK OR SIGN-IN PATH MAY EVER BE ADDED. `/sign-in/sso`, `/sso/callback`,
// `/sso/callback/:providerId` and every `/sso/saml2/*` path must stay reachable to an anonymous
// browser mid-flow; disabling one of them breaks sign-in for everyone rather than locking anything
// down. `auth.test.ts` asserts both halves of that.
export const SSO_DISABLED_PATHS = [
  '/sso/register',
  '/sso/update-provider',
  '/sso/delete-provider',
  '/sso/providers',
  '/sso/get-provider',
  '/sso/request-domain-verification',
  '/sso/verify-domain',
] as const

export interface VerifiedToken {
  sub: string
  // `exp` as epoch seconds when the JWT carries one. Absent is tolerated rather than
  // rejected: expiry is enforced by `jwtVerify`, and this value is only a refresh hint.
  expiresAt: number | null
}

export interface SyncToken {
  token: string
  expiresAt: number | null
}

export interface SessionUser {
  id: string
  email: string
}

export interface SsoOidcConfigInput {
  clientId?: string
  clientSecret?: string
  discoveryEndpoint?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  userInfoEndpoint?: string
  jwksEndpoint?: string
  tokenEndpointAuthentication?: 'client_secret_post' | 'client_secret_basic'
  scopes?: string[]
  pkce?: boolean
  skipDiscovery?: boolean
}

export interface SsoProviderRegistration {
  providerId: string
  issuer: string
  domain: string
  oidcConfig: SsoOidcConfigInput & { clientId: string; clientSecret: string }
}

export interface SsoProviderUpdate {
  providerId: string
  issuer?: string
  domain?: string
  oidcConfig?: SsoOidcConfigInput
}

// What the admin surface may learn about a provider it just registered. The plugin's own
// `/sso/register` response carries the WHOLE row back, `oidcConfig.clientSecret` included; this
// narrowing is where that stops, so no caller of `AuthService` is in a position to echo it.
export interface SsoRegistrationResult {
  providerId: string
  domain: string
  domainVerified: boolean
  domainVerificationToken: string | null
  redirectURI: string
}

// Only the surface the routes need — deliberately not exposing the raw `Auth<Options>`
// instance, whose type is invariant in the concrete options and would leak everywhere.
export interface AuthService {
  handler: (request: Request) => Promise<Response>
  getSessionUser: (headers: Headers) => Promise<SessionUser | undefined>
  migrateAuth: () => Promise<{ created: string[]; altered: string[] }>
  issueSyncToken: (headers: Headers) => Promise<SyncToken>
  verifySyncToken: (token: string) => Promise<VerifiedToken | undefined>
  // The five provider-management calls `SSO_DISABLED_PATHS` removed from the router. Each takes the
  // caller's headers because the plugin's own `sessionMiddleware` still runs inside them — the
  // workspace-admin check at `/api/v1/sso` is an ADDITIONAL gate, never a replacement for a session.
  registerSsoProvider: (
    headers: Headers,
    body: SsoProviderRegistration,
  ) => Promise<SsoRegistrationResult>
  updateSsoProvider: (headers: Headers, body: SsoProviderUpdate) => Promise<void>
  deleteSsoProvider: (headers: Headers, providerId: string) => Promise<void>
  requestSsoDomainVerification: (
    headers: Headers,
    providerId: string,
  ) => Promise<{ domainVerificationToken: string }>
  verifySsoDomain: (headers: Headers, providerId: string) => Promise<void>
}

// Not annotated `: BetterAuthOptions` — `satisfies` keeps the concrete plugin types so
// `betterAuth(...)` can infer the plugin endpoints (e.g. `api.getToken`) while still
// type-checking the shape and staying assignable to `getMigrations`' parameter.
export function buildAuthOptions(db: Kysely<DB>, env: Env) {
  const github =
    env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_SECRET !== undefined
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {}

  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Reuse the app's single Kysely instance/pool — no extra container, one query log.
    database: { db, type: 'postgres' },
    trustedOrigins: [env.BETTER_AUTH_URL, env.WEB_ORIGIN],
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    socialProviders: github,
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    plugins: [
      bearer(),
      jwt({
        jwt: {
          expirationTime: SYNC_TOKEN_EXPIRATION,
          issuer: env.BETTER_AUTH_URL,
          audience: env.BETTER_AUTH_URL,
        },
      }),
      // `domainVerification` makes the plugin refuse sign-in against a provider whose domain has
      // not been proven by a DNS TXT record — the claim "this instance may sign in @acme.com
      // employees" becomes a claim about acme.com rather than about whoever clicked Register. It
      // resolves the record with `node:dns` in this process, so it adds no container.
      sso({ providersLimit: SSO_PROVIDERS_LIMIT, domainVerification: { enabled: true } }),
    ],
    disabledPaths: [...SSO_DISABLED_PATHS],
  } satisfies BetterAuthOptions
}

export function createAuth(db: Kysely<DB>, env: Env): AuthService {
  const options = buildAuthOptions(db, env)
  const auth = betterAuth(options)
  // Fetch the JWKS over loopback rather than the public BETTER_AUTH_URL, so verification
  // never depends on the container being able to reach its own external URL. Tokens are
  // still verified against the BETTER_AUTH_URL issuer/audience below.
  const internalHost = env.HOST === '0.0.0.0' || env.HOST === '::' ? '127.0.0.1' : env.HOST
  const jwks = createRemoteJWKSet(new URL('/api/auth/jwks', `http://${internalHost}:${env.PORT}`))

  // Local JWKS verification — no DB round-trip on the sync hot path.
  const verify = async (token: string): Promise<VerifiedToken | undefined> => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: env.BETTER_AUTH_URL,
        audience: env.BETTER_AUTH_URL,
      })
      if (typeof payload.sub !== 'string') return undefined
      return { sub: payload.sub, expiresAt: typeof payload.exp === 'number' ? payload.exp : null }
    } catch {
      return undefined
    }
  }

  return {
    handler: (request) => auth.handler(request),

    getSessionUser: async (headers) => {
      const session = await auth.api.getSession({ headers })
      if (session === null) return undefined
      return { id: session.user.id, email: session.user.email }
    },

    // better-auth's getMigrations is NOT advisory-locked or transactional; run it from
    // the single boot path only (see index.ts), after the Kysely Migrator.
    migrateAuth: async () => {
      const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(options)
      const created = toBeCreated.map((table) => table.table)
      const altered = toBeAdded.map((table) => table.table)
      if (created.length > 0 || altered.length > 0) {
        await runMigrations()
      }
      return { created, altered }
    },

    // The expiry is read back off the minted JWT rather than derived from
    // SYNC_TOKEN_EXPIRATION, so the client's refresh schedule can never drift from what the
    // plugin actually signed.
    issueSyncToken: async (headers) => {
      const { token } = await auth.api.getToken({ headers })
      const verified = await verify(token)
      return { token, expiresAt: verified?.expiresAt ?? null }
    },

    verifySyncToken: verify,

    registerSsoProvider: async (headers, body) => {
      const result = await auth.api.registerSSOProvider({ headers, body })
      return {
        providerId: result.providerId,
        domain: result.domain,
        domainVerified: result.domainVerified ?? false,
        domainVerificationToken: result.domainVerificationToken ?? null,
        redirectURI: result.redirectURI,
      }
    },

    updateSsoProvider: async (headers, body) => {
      await auth.api.updateSSOProvider({ headers, body })
    },

    deleteSsoProvider: async (headers, providerId) => {
      await auth.api.deleteSSOProvider({ headers, body: { providerId } })
    },

    requestSsoDomainVerification: async (headers, providerId) => {
      const result = await auth.api.requestDomainVerification({ headers, body: { providerId } })
      return { domainVerificationToken: result.domainVerificationToken }
    },

    verifySsoDomain: async (headers, providerId) => {
      await auth.api.verifyDomain({ headers, body: { providerId } })
    },
  }
}
