import { newId } from '@yapm/schema'
import {
  createDatabase,
  createSecretCodec,
  type Database,
  getAiProviderKey,
  migrateToLatest,
  recordDisclosureAudit,
  type SecretCodec,
  setPmDisclosurePolicy,
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

  // The rejected-proposal log. It is one GET behind the same `requireAdmin` the rest of this surface
  // uses, and the two properties worth a test are that it refuses a non-admin BEFORE reading anything
  // and that what it hands an admin is team-level — no user id, in a workspace where a reaction
  // really exists.
  async function workspaceWithAVerdict() {
    const { workspaceId, adminId, memberId, viewerId } = await freshWorkspace()
    const teamId = newId()
    const cycleId = newId()
    const retroId = newId()
    const draftId = newId()
    const proposalId = newId()
    const reactorId = `reactor-${newId()}`
    await database.db
      .insertInto('team')
      .values({
        id: teamId,
        workspace_id: workspaceId,
        name: 'Verdicts',
        key: `V${teamId.replaceAll('-', '').slice(-8).toUpperCase()}`,
      })
      .execute()
    await database.db
      .insertInto('cycle')
      .values({
        id: cycleId,
        team_id: teamId,
        name: 'Cycle 6',
        status: 'completed',
        start_date: new Date(Date.now() - 100_000),
        end_date: new Date(Date.now() - 10_000),
      })
      .execute()
    await database.db
      .insertInto('retro')
      .values({
        id: retroId,
        team_id: teamId,
        cycle_id: cycleId,
        title: 'Cycle 6 retro',
        format: 'wentwell_didnt_action',
        created_by: adminId,
      })
      .execute()
    await database.db
      .insertInto('retro_ai_draft')
      .values({ id: draftId, team_id: teamId, retro_id: retroId, status: 'ready' })
      .execute()
    await database.db
      .insertInto('retro_ai_proposal')
      .values({
        id: proposalId,
        draft_id: draftId,
        retro_id: retroId,
        team_id: teamId,
        category: 'improvement',
        summary: 'Add a second reviewer to every pull request.',
        confidence: 'medium',
        rank: 0,
        verdict: 'rejected',
        agree_count: 0,
        disagree_count: 2,
        ratified_at: new Date(),
      })
      .execute()
    // A real reaction, so "the response carries no user id" cannot pass for want of one.
    await database.db
      .insertInto('retro_ai_reaction')
      .values({
        proposal_id: proposalId,
        user_id: reactorId,
        retro_id: retroId,
        team_id: teamId,
        value: 'disagree',
      })
      .execute()
    return { workspaceId, adminId, memberId, viewerId, teamId, reactorId }
  }

  it('gives an admin the per-team verdict totals and the proposals a team threw out', async () => {
    const { adminId, teamId, reactorId } = await workspaceWithAVerdict()

    const response = await routes().request('/api/v1/ai/verdicts', {
      headers: { 'x-test-user': adminId },
    })
    expect(response.status).toBe(200)
    const text = await response.text()
    const body = JSON.parse(text) as {
      totals: { teamId: string; rejected: number; undecided: number }[]
      recent: { summary: string; verdict: string; disagreeCount: number }[]
    }

    expect(body.totals.find((team) => team.teamId === teamId)?.rejected).toBe(1)
    expect(body.recent.map((row) => row.summary)).toEqual([
      'Add a second reviewer to every pull request.',
    ])
    expect(body.recent[0]?.verdict).toBe('rejected')
    expect(body.recent[0]?.disagreeCount).toBe(2)

    // TEAM-LEVEL, ALL THE WAY OUT: the member who disagreed is not in the response, and no key on it
    // is identity-shaped.
    expect(text).not.toContain(reactorId)
    expect(text).not.toMatch(/"(userId|user_id|assigneeId|reactions?)"/)
  })

  it('refuses a member and a viewer the verdict log, before a proposal is read', async () => {
    const { memberId, viewerId } = await workspaceWithAVerdict()

    for (const user of [memberId, viewerId]) {
      const response = await routes().request('/api/v1/ai/verdicts', {
        headers: { 'x-test-user': user },
      })
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('Add a second reviewer')
    }

    // And anonymously, with no session at all.
    const anonymous = await routes().request('/api/v1/ai/verdicts')
    expect(anonymous.status).toBe(401)
  })

  // The disclosure audit view. Three properties, each asserted rather than described.
  //
  // SEEDED THROUGH THE REAL WRITERS, not through a hand-written insert: `setPmDisclosurePolicy` is
  // the only thing that writes a `policy_changed` record and `recordDisclosureAudit` is the only
  // thing that writes any other, so a fixture that shaped the rows itself could assert a shape no
  // code path can produce — which is exactly how a per-team policy count came to be reported.
  async function workspaceWithADisclosure() {
    const { workspaceId, adminId, memberId, viewerId } = await freshWorkspace()
    const teamId = newId()
    const readerId = newId()
    await database.db
      .insertInto('team')
      .values({
        id: teamId,
        workspace_id: workspaceId,
        name: 'Platform',
        key: `AD${newId().slice(-6)}`,
      })
      .execute()
    await setPmDisclosurePolicy(
      database.db,
      { userID: adminId, role: 'admin' },
      {
        configId: newId(),
        auditId: newId(),
        workspaceId,
        enabled: true,
        teams: { [teamId]: { pmVisible: true, audience: [readerId] } },
      },
    )
    await recordDisclosureAudit(database.db, {
      id: newId(),
      workspaceId,
      teamId,
      actorId: memberId,
      event: 'published',
      detail: { audienceSize: 2 },
    })
    return { workspaceId, adminId, memberId, viewerId, teamId, readerId }
  }

  it('gives an admin the per-team disclosure totals and the recent events', async () => {
    const { adminId, teamId } = await workspaceWithADisclosure()

    const response = await routes().request('/api/v1/ai/disclosures', {
      headers: { 'x-test-user': adminId },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      totals: { teamId: string | null; published: number }[]
      recent: {
        event: string
        teamName: string | null
        teamsChangedNames: string[]
        detail: Record<string, unknown>
      }[]
    }

    const team = body.totals.find((entry) => entry.teamId === teamId)
    expect(team?.published).toBe(1)
    // A policy write belongs to no single team, so it is reported in the recent list — naming the
    // teams it touched — rather than totalled under one.
    expect(body.totals.every((entry) => !('policyChanged' in entry))).toBe(true)
    expect(body.recent.map((event) => event.event).sort()).toEqual(['policy_changed', 'published'])
    expect(body.recent.find((event) => event.event === 'published')?.detail).toEqual({
      audienceSize: 2,
    })
    const policy = body.recent.find((event) => event.event === 'policy_changed')
    expect(policy?.teamName).toBeNull()
    expect(policy?.teamsChangedNames).toEqual(['Platform'])
  })

  // VISION #8, asserted structurally: the response carries no reader identity, no read event and no
  // audience list — because nothing in the schema records a read and the policy record stores only
  // WHICH team ids a write touched.
  it('surfaces no per-person reading data of any kind', async () => {
    const { adminId, teamId, readerId } = await workspaceWithADisclosure()

    const response = await routes().request('/api/v1/ai/disclosures', {
      headers: { 'x-test-user': adminId },
    })
    const text = await response.text()

    expect(text).not.toContain(readerId)
    expect(text).not.toMatch(/"(audience|readers|readBy|readAt|viewedBy|recipients)"/)
    expect(text).not.toContain('"read"')
    // `teamsChanged` carries team IDS, which is the one id-shaped field, and it is a team.
    expect(text).toContain(teamId)
  })

  // The `search`/`attachments` non-oracle discipline: refused BEFORE any read, and the refusal is
  // byte-identical in a workspace that has used disclosure and one that never has.
  it('refuses a member and a viewer before any read, with no permission oracle', async () => {
    const { memberId, viewerId } = await workspaceWithADisclosure()
    const bare = await freshWorkspace()

    const bodies: string[] = []
    for (const user of [memberId, viewerId]) {
      const response = await routes().request('/api/v1/ai/disclosures', {
        headers: { 'x-test-user': user },
      })
      expect(response.status).toBe(403)
      bodies.push(await response.text())
    }

    const never = await routes().request('/api/v1/ai/disclosures', {
      headers: { 'x-test-user': bare.memberId },
    })
    expect(never.status).toBe(403)
    const neverBody = await never.text()
    // Identical bytes: nothing in the refusal distinguishes "not allowed" from "nothing there".
    for (const body of bodies) expect(body).toBe(neverBody)

    const anonymous = await routes().request('/api/v1/ai/disclosures')
    expect(anonymous.status).toBe(401)
  })

  // A team key here becomes a `detail.teamsChanged` entry, and that entry is later read back into a
  // `where team.id in (…)` against a uuid column. A non-uuid key accepted once would poison the
  // workspace's audit read permanently, so it is refused at the door and nothing is written.
  it('refuses a policy write whose team key is not a uuid, and stores nothing', async () => {
    const { workspaceId, adminId } = await freshWorkspace()
    const response = await routes().request('/api/v1/ai/pm-disclosure', {
      method: 'POST',
      headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, teams: { 'not-a-uuid': { pmVisible: true } } }),
    })
    expect(response.status).toBe(400)

    const rows = await database.db
      .selectFrom('ai_disclosure_audit')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .execute()
    expect(rows).toEqual([])
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
