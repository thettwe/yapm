import { newId } from '@yapm/schema'
import {
  createDatabase,
  createSecretCodec,
  type Database,
  getAiProviderKey,
  migrateToLatest,
  type SecretCodec,
} from '@yapm/schema/db'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthService, SessionUser } from '../auth.js'
import type { AiEnv } from '../config/env.js'
import { createAiAdminRoutes } from './admin-routes.js'

const DATABASE_URL = process.env.DATABASE_URL
if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the ai admin route test must not skip')
}

const silent = pino({ level: 'silent' })

// A base64 32-byte test key for the shared secrets codec (never a real key).
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

function fakeAuth(): AuthService {
  return {
    handler: () => Promise.resolve(new Response(null)),
    getSessionUser: (headers: Headers): Promise<SessionUser | undefined> => {
      const id = headers.get('x-test-user')
      return Promise.resolve(id ? { id, email: `${id}@example.test` } : undefined)
    },
    migrateAuth: () => Promise.resolve({ created: [], altered: [] }),
    issueSyncToken: () => Promise.resolve({ token: 'token', expiresAt: null }),
    verifySyncToken: () => Promise.resolve(undefined),
  }
}

const noEnv: AiEnv = { keys: {}, defaultProvider: null }

describe('createAiAdminRoutes — auth gating (no db)', () => {
  it('rejects an anonymous caller with 401 before touching the surface', async () => {
    const app = createAiAdminRoutes({
      auth: fakeAuth(),
      db: {} as never,
      logger: silent,
      codec: null,
      env: noEnv,
    })
    const response = await app.request('/api/v1/ai')
    expect(response.status).toBe(401)
  })
})

describe.skipIf(DATABASE_URL === undefined)('createAiAdminRoutes — admin surface (db)', () => {
  let database: Database
  let codec: SecretCodec

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    codec = createSecretCodec(TEST_ENCRYPTION_KEY)
  }, 30_000)

  afterAll(async () => {
    await database.close()
  })

  async function freshWorkspace() {
    const workspaceId = newId()
    const adminId = newId()
    const memberId = newId()
    const viewerId = newId()
    await database.db.insertInto('workspace').values({ id: workspaceId, name: 'ai' }).execute()
    await database.db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: adminId, role: 'admin' },
        { id: newId(), workspace_id: workspaceId, user_id: memberId, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: viewerId, role: 'viewer' },
      ])
      .execute()
    return { workspaceId, adminId, memberId, viewerId }
  }

  function routes(withCodec = true) {
    return createAiAdminRoutes({
      auth: fakeAuth(),
      db: database.db,
      logger: silent,
      codec: withCodec ? codec : null,
      env: noEnv,
    })
  }

  it('forbids a non-admin member and viewer with 403', async () => {
    const { memberId, viewerId } = await freshWorkspace()
    for (const user of [memberId, viewerId]) {
      const response = await routes().request('/api/v1/ai', { headers: { 'x-test-user': user } })
      expect(response.status).toBe(403)
    }
  })

  it('lets an admin toggle AI on and choose a model, and reflects it in redacted status', async () => {
    const { adminId } = await freshWorkspace()
    const response = await routes().request('/api/v1/ai', {
      method: 'POST',
      headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        defaultProvider: 'anthropic',
        models: { anthropic: 'claude-x' },
      }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: {
        enabled: boolean
        defaultProvider: string | null
        models: Record<string, string>
      } | null
    }
    expect(body.status?.enabled).toBe(true)
    expect(body.status?.defaultProvider).toBe('anthropic')
    expect(body.status?.models.anthropic).toBe('claude-x')
  })

  it('stores a provider key encrypted, decryptable only server-side, and never returns key material', async () => {
    const { workspaceId, adminId } = await freshWorkspace()
    const secret = 'sk-ant-super-secret-value'
    const put = await routes().request('/api/v1/ai/keys/anthropic', {
      method: 'PUT',
      headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
      body: JSON.stringify({ value: secret }),
    })
    expect(put.status).toBe(200)
    const putText = await put.text()
    // The response (redacted status) NAMES the provider but never leaks the key.
    expect(putText).not.toContain(secret)
    const putBody = JSON.parse(putText) as { status: { configuredProviders: string[] } | null }
    expect(putBody.status?.configuredProviders).toContain('anthropic')

    // GET status likewise never carries the key.
    const get = await routes().request('/api/v1/ai', { headers: { 'x-test-user': adminId } })
    expect(await get.text()).not.toContain(secret)

    // The server can still decrypt it for a gateway call — it is stored, just server-only.
    const decrypted = await getAiProviderKey(database.db, codec, workspaceId, 'anthropic')
    expect(decrypted).toBe(secret)

    // Persisted at rest as ciphertext, not plaintext.
    const row = await database.db
      .selectFrom('connector_secret')
      .innerJoin('connector_config', 'connector_config.id', 'connector_secret.connector_config_id')
      .select('connector_secret.ciphertext')
      .where('connector_config.workspace_id', '=', workspaceId)
      .where('connector_config.provider', '=', 'ai')
      .where('connector_secret.key', '=', 'anthropic')
      .executeTakeFirst()
    expect(row?.ciphertext).toBeDefined()
    expect(row?.ciphertext).not.toContain(secret)
  })

  it('round-trips the ordered area map and leaves it intact when only the spend cap changes', async () => {
    const { adminId } = await freshWorkspace()
    const areas = [
      { prefix: 'apps/server/src/billing/', area: 'Billing', sensitive: true },
      { prefix: 'apps/server/', area: 'Backend' },
      { prefix: 'packages/config/', area: 'Tooling', internal: true },
    ]
    const post = await routes().request('/api/v1/ai', {
      method: 'POST',
      headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, areas }),
    })
    expect(post.status).toBe(200)
    const posted = (await post.json()) as { status: { areas: unknown[] } | null }
    // Order is semantic (first match wins), so the array must come back in the order it went in.
    expect(posted.status?.areas).toEqual(areas)

    // An unrelated update — the spend cap — must not clobber the map.
    const capped = await routes().request('/api/v1/ai', {
      method: 'POST',
      headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
      body: JSON.stringify({ spendCapUsd: 12.5 }),
    })
    const cappedBody = (await capped.json()) as {
      status: { areas: unknown[]; spendCapUsd: number | null } | null
    }
    expect(cappedBody.status?.spendCapUsd).toBe(12.5)
    expect(cappedBody.status?.areas).toEqual(areas)

    // And a GET reflects the same ordered map.
    const get = await routes().request('/api/v1/ai', { headers: { 'x-test-user': adminId } })
    const gotten = (await get.json()) as { status: { areas: unknown[] } | null }
    expect(gotten.status?.areas).toEqual(areas)
  })

  it('rejects a non-admin reading or writing the area map, before the map is touched', async () => {
    const { adminId, memberId, viewerId } = await freshWorkspace()
    await routes().request('/api/v1/ai', {
      method: 'POST',
      headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
      body: JSON.stringify({ areas: [{ prefix: 'apps/server/src/billing/', area: 'Billing' }] }),
    })
    for (const user of [memberId, viewerId]) {
      const get = await routes().request('/api/v1/ai', { headers: { 'x-test-user': user } })
      expect(get.status).toBe(403)
      expect(await get.text()).not.toContain('Billing')

      const post = await routes().request('/api/v1/ai', {
        method: 'POST',
        headers: { 'x-test-user': user, 'content-type': 'application/json' },
        body: JSON.stringify({ areas: [] }),
      })
      expect(post.status).toBe(403)
    }
    // The map an admin wrote is still there — the refused writes changed nothing.
    const get = await routes().request('/api/v1/ai', { headers: { 'x-test-user': adminId } })
    const body = (await get.json()) as { status: { areas: unknown[] } | null }
    expect(body.status?.areas).toHaveLength(1)
  })

  it('refuses a malformed area rule with 400 and stores nothing', async () => {
    const { adminId } = await freshWorkspace()
    for (const areas of [[{ prefix: '', area: 'Billing' }], [{ prefix: 'a/' }], 'not-an-array']) {
      const response = await routes().request('/api/v1/ai', {
        method: 'POST',
        headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
        body: JSON.stringify({ areas }),
      })
      expect(response.status).toBe(400)
    }
    const get = await routes().request('/api/v1/ai', { headers: { 'x-test-user': adminId } })
    const body = (await get.json()) as { status: { areas: unknown[] } | null }
    expect(body.status ?? { areas: [] }).toMatchObject({ areas: [] })
  })

  it('refuses to store a key when the encryption codec is unavailable', async () => {
    const { adminId } = await freshWorkspace()
    const response = await routes(false).request('/api/v1/ai/keys/anthropic', {
      method: 'PUT',
      headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'sk-x' }),
    })
    expect(response.status).toBe(400)
  })
})
