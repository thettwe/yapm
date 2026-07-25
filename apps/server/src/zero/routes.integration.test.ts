import { createServer } from 'node:net'
import { serve } from '@hono/node-server'
import { newId } from '@yapm/schema'
import {
  createDatabase,
  type Database,
  lookupWorkspaceRole,
  migrateToLatest,
} from '@yapm/schema/db'
import { sql } from 'kysely'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { type AuthService, createAuth } from '../auth.js'
import { createAuthRoutes } from '../auth-routes.js'
import { loadEnv } from '../config/env.js'
import { createSessionContextResolver } from './context.js'
import { createZeroDatabase } from './db-provider.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the Zero endpoint credential-protocol test must not be skipped',
  )
}

const silent = pino({ level: 'silent' })

const TEST_DATABASE = 'yapm_zero_protocol_test'

// `handleMutateRequest` parses `schema` and `appID` off the query string before it looks at
// anything else, and `schema` names the Postgres schema its bookkeeping lives in. Omitting
// them makes every `/mutate` request fail parsing and answer `200 PushFailed`, which silently
// satisfies a bare status assertion while never reaching a mutator.
const BOOKKEEPING_SCHEMA = 'zero_0'
const MUTATE_PATH = `/api/zero/mutate?schema=${BOOKKEEPING_SCHEMA}&appID=zero`

// CREATE/DROP DATABASE has to run from a connection that is not the target, so the
// bootstrap connection points at the server's default database.
function adminUrl(url: URL): string {
  const admin = new URL(url.toString())
  admin.pathname = '/postgres'
  return admin.toString()
}

// better-auth verifies its own JWTs over loopback against the port the server is listening
// on, so the port has to be known before the app is built.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

interface QueryResponseBody {
  kind?: string
  userID?: string | null
  queries?: unknown[]
  error?: string
}

interface MutateResponseBody {
  kind?: string
  userID?: string | null
  mutations?: { result: { error?: string; details?: unknown } }[]
  message?: string
  error?: string
}

describe.skipIf(DATABASE_URL === undefined)('the Zero endpoints (live db)', () => {
  let database: Database
  let auth: AuthService
  let origin: string
  let databaseUrl: string
  let close: () => Promise<void>
  const workspaceId = newId()
  const memberId = newId()
  let cookie: string
  let userId: string
  let token: string
  let tokenBody: { token: string; userID: string; role: string | null; expiresAt: number }

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  const queryBody = ['transform', [{ id: 'q1', name: 'workspace.current', args: [] }]]

  // A fresh client group per call keeps every mutation the first one that client has sent,
  // so Zero's lastMutationID bookkeeping never rejects one as out of order.
  const mutateBody = (name: string, args: unknown[]) => ({
    clientGroupID: newId(),
    mutations: [{ type: 'custom', id: 1, clientID: newId(), name, args, timestamp: Date.now() }],
    pushVersion: 1,
    timestamp: Date.now(),
    requestID: newId(),
  })

  const renameTo = (name: string) =>
    mutateBody('workspace.rename', [{ id: workspaceId, name, updatedAt: Date.now() }])

  const workspaceName = async (): Promise<string> => {
    const row = await database.db
      .selectFrom('workspace')
      .select('name')
      .where('id', '=', workspaceId)
      .executeTakeFirstOrThrow()
    return row.name
  }

  beforeAll(async () => {
    const port = await freePort()
    origin = `http://127.0.0.1:${port}`

    // Everything this test touches — including better-auth's JWKS, whose private key is
    // encrypted with BETTER_AUTH_SECRET and outlives the process — lives in a throwaway
    // database. Sharing one would make the run depend on which secret last wrote a JWKS
    // there, and would leak a workspace row into whatever else uses it.
    const url = new URL(DATABASE_URL ?? '')
    const bootstrap = createDatabase({ connectionString: adminUrl(url) })
    await sql.raw(`drop database if exists ${TEST_DATABASE}`).execute(bootstrap.db)
    await sql.raw(`create database ${TEST_DATABASE}`).execute(bootstrap.db)
    await bootstrap.close()

    url.pathname = `/${TEST_DATABASE}`
    databaseUrl = url.toString()
    database = createDatabase({ connectionString: databaseUrl })
    await migrateToLatest(database.db)

    // Zero's server adapter upserts `<schema>.clients` and inserts `<schema>.mutations` on
    // every mutation, and zero-cache is what provisions them upstream. CI runs Vitest against
    // a bare Postgres with no zero-cache, so the test provisions them itself — otherwise the
    // first statement of every transaction fails and `/mutate` can never reach a mutator.
    // This mirrors zero-cache 1.8.0's own DDL; if Zero changes the shape, this test fails.
    await sql.raw(`create schema "${BOOKKEEPING_SCHEMA}"`).execute(database.db)
    await sql
      .raw(
        `create table "${BOOKKEEPING_SCHEMA}"."clients" (
          "clientGroupID" text not null,
          "clientID" text not null,
          "lastMutationID" bigint not null,
          "userID" text,
          primary key ("clientGroupID", "clientID")
        )`,
      )
      .execute(database.db)
    await sql
      .raw(
        `create table "${BOOKKEEPING_SCHEMA}"."mutations" (
          "clientGroupID" text not null,
          "clientID" text not null,
          "mutationID" bigint not null,
          "result" json not null,
          primary key ("clientGroupID", "clientID", "mutationID")
        )`,
      )
      .execute(database.db)

    const env = loadEnv({
      DATABASE_URL: databaseUrl,
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      CYCLE_MAINTENANCE: 'false',
      BETTER_AUTH_URL: origin,
      WEB_ORIGIN: origin,
    })

    auth = createAuth(database.db, env)
    await auth.migrateAuth()

    const app = createApp({
      logger: silent,
      readinessChecks: [],
      authRoutes: createAuthRoutes({ auth, db: database.db, env, logger: silent }),
      zero: {
        dbProvider: createZeroDatabase(database.db),
        resolveContext: createSessionContextResolver({
          verifyToken: auth.verifySyncToken,
          lookupRole: (id) => lookupWorkspaceRole(database.db, id),
        }),
        logger: silent,
      },
    })

    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port })
    close = () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      })

    const signUp = await post('/api/auth/sign-up/email', {
      email: `zero-protocol-${newId()}@example.test`,
      password: 'integration-password-1234',
      name: 'Protocol Probe',
    })
    expect(signUp.status).toBe(200)
    cookie = (signUp.headers.getSetCookie() ?? []).map((value) => value.split(';')[0]).join('; ')

    const session = (await signUp.json()) as { user: { id: string } }
    userId = session.user.id

    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'Protocol WS' })
      .execute()
    await database.db
      .insertInto('workspace_member')
      .values({ id: memberId, workspace_id: workspaceId, user_id: userId, role: 'admin' })
      .execute()

    const minted = await fetch(`${origin}/api/zero/token`, { headers: { cookie } })
    expect(minted.status).toBe(200)
    tokenBody = (await minted.json()) as typeof tokenBody
    token = tokenBody.token
  }, 60_000)

  afterAll(async () => {
    await close()
    await database.close()
    const bootstrap = createDatabase({ connectionString: adminUrl(new URL(databaseUrl)) })
    await sql.raw(`drop database if exists ${TEST_DATABASE}`).execute(bootstrap.db)
    await bootstrap.close()
  })

  it('answers a presented-but-rejected credential with 401 and no QueryResponse', async () => {
    const response = await post('/api/zero/query', queryBody, {
      authorization: 'Bearer not.a.valid.jwt',
    })
    const body = (await response.json()) as QueryResponseBody

    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthorized')
    expect(body.kind).toBeUndefined()
    expect(body.userID).toBeUndefined()
  })

  it('answers an absent credential with 200 and a null userID', async () => {
    const response = await post('/api/zero/query', queryBody)
    const body = (await response.json()) as QueryResponseBody

    expect(response.status).toBe(200)
    expect(body.kind).toBe('QueryResponse')
    expect(body.userID).toBeNull()
  })

  it('answers a valid credential with 200 and the verified subject', async () => {
    const response = await post('/api/zero/query', queryBody, {
      authorization: `Bearer ${token}`,
    })
    const body = (await response.json()) as QueryResponseBody

    expect(response.status).toBe(200)
    expect(body.kind).toBe('QueryResponse')
    expect(body.userID).toBe(userId)
  })

  it('applies the same rejection protocol to the mutate endpoint', async () => {
    const original = await workspaceName()

    const rejected = await post(MUTATE_PATH, renameTo('Renamed by a rejected credential'), {
      authorization: 'Bearer not.a.valid.jwt',
    })
    expect(rejected.status).toBe(401)
    expect(((await rejected.json()) as MutateResponseBody).error).toBe('unauthorized')
    expect(await workspaceName()).toBe(original)

    // An absent credential is not a rejected one: it reaches Zero's handler, is reported as
    // the authoritative identity `null`, and is then denied by the mutator's own guard.
    const absent = await post(MUTATE_PATH, renameTo('Renamed by an absent credential'))
    const absentBody = (await absent.json()) as MutateResponseBody
    expect(absent.status).toBe(200)
    expect(absentBody.kind).toBe('MutateResponse')
    expect(absentBody.userID).toBeNull()
    expect(absentBody.mutations?.[0]?.result.error).toBeDefined()
    expect(await workspaceName()).toBe(original)

    const accepted = await post(MUTATE_PATH, renameTo('Renamed by protocol test'), {
      authorization: `Bearer ${token}`,
    })
    const acceptedBody = (await accepted.json()) as MutateResponseBody
    expect(accepted.status).toBe(200)
    expect(acceptedBody.kind).toBe('MutateResponse')
    expect(acceptedBody.userID).toBe(userId)
    expect(acceptedBody.mutations?.[0]?.result).toEqual({})
    expect(await workspaceName()).toBe('Renamed by protocol test')
  })

  it('keeps a non-auth resolver failure a server error, not a 401', async () => {
    const port = await freePort()
    const app = createApp({
      logger: silent,
      readinessChecks: [],
      zero: {
        dbProvider: createZeroDatabase(database.db),
        resolveContext: () => {
          throw new Error('role lookup unavailable')
        },
        logger: silent,
      },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port })
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/zero/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(queryBody),
      })
      expect(response.status).toBe(500)
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  })

  it('reports the minted credential expiry alongside the token', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)

    expect(tokenBody.userID).toBe(userId)
    expect(tokenBody.role).toBe('admin')
    expect(tokenBody.expiresAt).toBeGreaterThan(nowSeconds)
    // The configured sync-token lifetime is one hour; allow a generous window for the
    // round trip rather than asserting an exact second.
    expect(tokenBody.expiresAt).toBeGreaterThan(nowSeconds + 3_000)
    expect(tokenBody.expiresAt).toBeLessThanOrEqual(nowSeconds + 3_600)
  })
})
