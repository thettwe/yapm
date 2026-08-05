import { newId } from '@yapm/schema'
import type { Database } from '@yapm/schema/db'
import { claimSsoProvider, createDatabase, migrateToLatest } from '@yapm/schema/db'
import { Hono } from 'hono'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AuthService, createAuth } from '../auth.js'
import { createAuthRoutes } from '../auth-routes.js'
import { type Env, envSchema } from '../config/env.js'
import { createSsoAdminRoutes } from './admin-routes.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the SSO admin gating test must not be skipped — it is the ' +
      'regression guard for an open provider-registration endpoint',
  )
}

const silent = pino({ level: 'silent' })
const ORIGIN = 'http://localhost'

// Short enough that `_better-auth-token-<providerId>` stays inside the 63-character DNS label limit.
const suffix = newId().replaceAll('-', '').slice(0, 12)
const PROVIDER_ID = `acme-${suffix}`
const ABSENT_PROVIDER_ID = `ghost-${suffix}`
const DOMAIN = `${suffix}.example.test`
const NEW_DOMAIN = `alt-${suffix}.example.test`
const CLIENT_SECRET = `secret-${suffix}`

// `skipDiscovery` plus explicit endpoints: registration must not reach the network for a test to
// pass, and the IdP in this suite does not exist.
const providerBody = {
  providerId: PROVIDER_ID,
  issuer: 'https://idp.example.test',
  domain: DOMAIN,
  oidcConfig: {
    clientId: 'yapm-client-id-9876',
    clientSecret: CLIENT_SECRET,
    skipDiscovery: true,
    authorizationEndpoint: 'https://idp.example.test/authorize',
    tokenEndpoint: 'https://idp.example.test/token',
    jwksEndpoint: 'https://idp.example.test/jwks',
  },
}

describe.skipIf(DATABASE_URL === undefined)('SSO administration is workspace-admin only', () => {
  let database: Database
  let auth: AuthService
  let app: Hono
  let env: Env

  const workspaceId = newId()
  const cookies: Record<'admin' | 'admin2' | 'member' | 'viewer' | 'outsider', string> = {
    admin: '',
    admin2: '',
    member: '',
    viewer: '',
    outsider: '',
  }
  // The admin who did NOT register the provider. Every write below is made as this account, because
  // "a provider is workspace configuration, not the registering admin's property" is only proven by
  // a second admin succeeding at it.
  let admin2Id = ''
  let adminId = ''

  // Sign up through the real handler so every session in this file is one better-auth minted.
  const signUp = async (label: string): Promise<{ userId: string; cookie: string }> => {
    const email = `${label}-${suffix}@example.test`
    const response = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ name: label, email, password: `password-${suffix}` }),
    })
    expect(response.status, `sign-up for ${label}`).toBe(200)
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const user = await database.db
      .selectFrom('user')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirstOrThrow()
    return { userId: user.id, cookie }
  }

  // The docs page's `curl -c yapm-cookies.txt … /api/auth/sign-in/email` step. Registration below is
  // asserted through a cookie obtained THIS way, not through the one sign-up happened to return, so
  // the test covers the procedure an operator copy-pastes rather than only the handler behind it.
  const signIn = async (label: string): Promise<string> => {
    const response = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({
        email: `${label}-${suffix}@example.test`,
        password: `password-${suffix}`,
      }),
    })
    expect(response.status, `sign-in for ${label}`).toBe(200)
    return response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
  }

  const post = (path: string, cookie: string | null, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        ...(cookie === null ? {} : { cookie }),
      },
      body: JSON.stringify(body ?? {}),
    })

  const providerRows = async (providerId: string) =>
    database.db
      .selectFrom('ssoProvider')
      .select(['providerId', 'domain', 'domainVerified', 'userId'])
      .where('providerId', '=', providerId)
      .execute()

  beforeAll(async () => {
    const parsed = envSchema.parse({
      DATABASE_URL,
      BETTER_AUTH_URL: ORIGIN,
      WEB_ORIGIN: ORIGIN,
    })
    env = { ...parsed, WEB_DIST_DIR: parsed.WEB_DIST_DIR ?? '' }

    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    auth = createAuth(database.db, env)
    await auth.migrateAuth()

    // This file is the only one in the suite that writes `ssoProvider`, and the availability
    // assertions below are statements about an instance with no provider. Rows left by a previous
    // local run would make them lie, so the table starts empty.
    await database.db.deleteFrom('ssoProvider').execute()

    await database.db.insertInto('workspace').values({ id: workspaceId, name: 'Acme' }).execute()

    app = new Hono()
    app.route('/', createAuthRoutes({ auth, db: database.db, env, logger: silent }))
    app.route('/', createSsoAdminRoutes({ auth, db: database.db, logger: silent }))

    const admin = await signUp('admin')
    const admin2 = await signUp('admin2')
    const member = await signUp('member')
    const viewer = await signUp('viewer')
    // No `workspace_member` row at all — the account an AccessGate is showing right now.
    const outsider = await signUp('outsider')
    cookies.admin = admin.cookie
    cookies.admin2 = admin2.cookie
    cookies.member = member.cookie
    cookies.viewer = viewer.cookie
    cookies.outsider = outsider.cookie
    adminId = admin.userId
    admin2Id = admin2.userId

    await database.db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: admin.userId, role: 'admin' },
        { id: newId(), workspace_id: workspaceId, user_id: admin2.userId, role: 'admin' },
        { id: newId(), workspace_id: workspaceId, user_id: member.userId, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: viewer.userId, role: 'viewer' },
      ])
      .execute()
  }, 60_000)

  afterAll(async () => {
    await database.close()
  })

  it('reports SSO unavailable while no provider is registered', async () => {
    const response = await app.request('/api/auth-methods')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ emailPassword: true, sso: false })
  })

  it('refuses an anonymous registration with 401', async () => {
    const response = await post('/api/v1/sso/providers', null, providerBody)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(await providerRows(PROVIDER_ID)).toHaveLength(0)
  })

  it('lets a workspace admin register a provider by the documented procedure', async () => {
    const sessionCookie = await signIn('admin')
    const response = await post('/api/v1/sso/providers', sessionCookie, providerBody)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toContain(CLIENT_SECRET)
    const payload = JSON.parse(body) as {
      providerId: string
      domainVerified: boolean
      domainVerificationToken: string | null
      redirectURI: string
    }
    expect(payload.providerId).toBe(PROVIDER_ID)
    // Registration alone never makes SSO usable: the domain is unproven until DNS says otherwise.
    expect(payload.domainVerified).toBe(false)
    // Both facts the docs page tells an operator to act on: the TXT record's value, and the exact
    // redirect URI to paste into the IdP. Its shape is the plugin's, `<baseURL>/sso/callback/<id>`
    // with the base path included — documented as a literal, so asserted as one.
    expect(payload.domainVerificationToken).toEqual(expect.any(String))
    expect(payload.redirectURI).toBe(`${ORIGIN}/api/auth/sso/callback/${PROVIDER_ID}`)
    expect(await providerRows(PROVIDER_ID)).toHaveLength(1)
  })

  // The mistake an operator following the docs actually makes, and the one the published `/api/v1`
  // contract names. The plugin PRE-CHECKS the id and raises 422 rather than letting the table's
  // unique constraint fire, so an unmapped 422 answers this with a 500 that says nothing.
  it('answers a duplicate provider id with the documented 409, not a 500', async () => {
    const response = await post('/api/v1/sso/providers', cookies.admin, providerBody)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'provider_exists' })
    expect(await providerRows(PROVIDER_ID)).toHaveLength(1)
  })

  it('still reports SSO unavailable while the registered domain is unverified', async () => {
    const response = await app.request('/api/auth-methods')
    expect(await response.json()).toMatchObject({ sso: false })
  })

  it('never returns the client secret to the admin who set it', async () => {
    const response = await app.request('/api/v1/sso', { headers: { cookie: cookies.admin } })
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toContain(CLIENT_SECRET)
    expect(JSON.parse(body)).toMatchObject({
      providers: [{ providerId: PROVIDER_ID, domain: DOMAIN, clientIdLastFour: '9876' }],
    })
  })

  // The heart of it. Every non-admin session is refused, and the refusal is IDENTICAL for a
  // provider id that exists and one that does not — so the answer cannot be used to learn whether a
  // provider is registered, and no existence check runs before the authorization decision.
  for (const role of ['member', 'viewer', 'outsider'] as const) {
    for (const [label, providerId] of [
      ['an existing provider id', PROVIDER_ID],
      ['an absent provider id', ABSENT_PROVIDER_ID],
    ] as const) {
      it(`refuses a ${role} registering ${label} with 403`, async () => {
        const before = await providerRows(providerId)
        const response = await post('/api/v1/sso/providers', cookies[role], {
          ...providerBody,
          providerId,
        })
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: 'forbidden' })
        expect(await providerRows(providerId)).toHaveLength(before.length)
      })

      it(`refuses a ${role} mutating ${label} with 403`, async () => {
        for (const request of [
          post(`/api/v1/sso/providers/${providerId}`, cookies[role], { domain: 'stolen.test' }),
          post(`/api/v1/sso/providers/${providerId}/domain-verification`, cookies[role]),
          post(`/api/v1/sso/providers/${providerId}/verify`, cookies[role]),
          app.request(`/api/v1/sso/providers/${providerId}`, {
            method: 'DELETE',
            headers: { cookie: cookies[role], origin: ORIGIN },
          }),
          app.request('/api/v1/sso', { headers: { cookie: cookies[role] } }),
        ]) {
          expect((await request).status).toBe(403)
        }
      })
    }
  }

  // The plugin's own registration endpoint is off the network entirely — on main this same request
  // returns 200 and creates the row for ANY signed-in account, member or not.
  it('answers 404 on the ungated better-auth registration path', async () => {
    for (const cookie of [cookies.admin, cookies.outsider, null]) {
      const response = await post('/api/auth/sso/register', cookie, {
        ...providerBody,
        providerId: ABSENT_PROVIDER_ID,
      })
      expect(response.status).toBe(404)
    }
    expect(await providerRows(ABSENT_PROVIDER_ID)).toHaveLength(0)
  })

  it('answers 404 on every other better-auth provider-management path', async () => {
    for (const path of [
      '/api/auth/sso/update-provider',
      '/api/auth/sso/delete-provider',
      '/api/auth/sso/request-domain-verification',
      '/api/auth/sso/verify-domain',
    ]) {
      expect((await post(path, cookies.admin, { providerId: PROVIDER_ID })).status).toBe(404)
    }
    for (const path of ['/api/auth/sso/providers', '/api/auth/sso/get-provider']) {
      const response = await app.request(`${path}?providerId=${PROVIDER_ID}`, {
        headers: { cookie: cookies.admin },
      })
      expect(response.status).toBe(404)
    }
  })

  // LOCKING ADMINISTRATION DOES NOT LOCK SIGN-IN. This lives in the same file as the refusals above
  // so that a future tightening of the gate cannot silently take the sign-in path with it.
  it('still lets an anonymous caller start an SSO sign-in against a verified provider', async () => {
    await database.db
      .updateTable('ssoProvider')
      .set({ domainVerified: true })
      .where('providerId', '=', PROVIDER_ID)
      .execute()

    const methods = await app.request('/api/auth-methods')
    expect(await methods.json()).toMatchObject({ sso: true })

    const response = await post('/api/auth/sign-in/sso', null, {
      email: `someone@${DOMAIN}`,
      callbackURL: '/',
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { url: string; redirect: boolean }
    expect(payload.redirect).toBe(true)
    expect(payload.url.startsWith('https://idp.example.test/authorize')).toBe(true)
  })

  // A PROVIDER IS WORKSPACE CONFIGURATION. Every write below is made by the admin who did NOT
  // register it — the plugin would refuse all three (`provider.userId === session.user.id`), so
  // these pass only because `claimSsoProvider` moves the ownership pointer first. Without them the
  // spec's "an admin's departure never strands the workspace's SSO configuration" is unasserted.
  it('lets a second workspace admin update a provider they did not register', async () => {
    const response = await post(`/api/v1/sso/providers/${PROVIDER_ID}`, cookies.admin2, {
      domain: NEW_DOMAIN,
    })
    expect(response.status).toBe(200)

    const [row] = await providerRows(PROVIDER_ID)
    expect(row?.domain).toBe(NEW_DOMAIN)
    expect(row?.userId).toBe(admin2Id)
    // Changing the domain resets verification (the plugin does this, and the docs page warns about
    // it), which takes the SSO button back off the login form until the new domain is proven.
    expect(row?.domainVerified).toBe(false)
    const methods = await app.request('/api/auth-methods')
    expect(await methods.json()).toMatchObject({ sso: false })
  })

  it('lets that second admin mint the DNS token for the new domain', async () => {
    const response = await post(
      `/api/v1/sso/providers/${PROVIDER_ID}/domain-verification`,
      cookies.admin2,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      providerId: PROVIDER_ID,
      domainVerificationToken: expect.any(String),
    })
  })

  // The ownership transfer on its own, against the real table. Its return value is what every
  // mutating route turns into a 404, so "no such provider" must be `false` AND must write nothing —
  // a helper that reported success for an absent id would make each of those routes answer 200 for
  // a provider that does not exist.
  it('transfers ownership only for a provider that exists', async () => {
    expect(await claimSsoProvider(database.db, ABSENT_PROVIDER_ID, admin2Id)).toBe(false)
    expect(await providerRows(ABSENT_PROVIDER_ID)).toHaveLength(0)

    const [before] = await providerRows(PROVIDER_ID)
    expect(before?.userId).toBe(admin2Id)
    expect(await claimSsoProvider(database.db, PROVIDER_ID, adminId)).toBe(true)
    expect((await providerRows(PROVIDER_ID))[0]?.userId).toBe(adminId)
  })

  it('lets that second admin delete the provider, and reports SSO unavailable again', async () => {
    const response = await app.request(`/api/v1/sso/providers/${PROVIDER_ID}`, {
      method: 'DELETE',
      headers: { cookie: cookies.admin2, origin: ORIGIN },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ configured: false, providers: [] })
    expect(await providerRows(PROVIDER_ID)).toHaveLength(0)
  })
})
