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

export interface VerifiedToken {
  sub: string
}

export interface SessionUser {
  id: string
  email: string
}

// Only the surface the routes need — deliberately not exposing the raw `Auth<Options>`
// instance, whose type is invariant in the concrete options and would leak everywhere.
export interface AuthService {
  handler: (request: Request) => Promise<Response>
  getSessionUser: (headers: Headers) => Promise<SessionUser | undefined>
  migrateAuth: () => Promise<{ created: string[]; altered: string[] }>
  issueSyncToken: (headers: Headers) => Promise<string>
  verifySyncToken: (token: string) => Promise<VerifiedToken | undefined>
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
      sso(),
    ],
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

    issueSyncToken: async (headers) => {
      const { token } = await auth.api.getToken({ headers })
      return token
    },

    // Local JWKS verification — no DB round-trip on the sync hot path.
    verifySyncToken: async (token) => {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: env.BETTER_AUTH_URL,
          audience: env.BETTER_AUTH_URL,
        })
        return typeof payload.sub === 'string' ? { sub: payload.sub } : undefined
      } catch {
        return undefined
      }
    },
  }
}
