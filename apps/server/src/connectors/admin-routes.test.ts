import { newId } from '@yapm/schema'
import {
  createDatabase,
  type Database,
  migrateToLatest,
  upsertConnectorConfig,
  upsertConnectorInstallation,
} from '@yapm/schema/db'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthService, SessionUser } from '../auth.js'
import { createConnectorAdminRoutes } from './admin-routes.js'

const DATABASE_URL = process.env.DATABASE_URL
if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the connector admin route test must not skip')
}

const silent = pino({ level: 'silent' })

// A minimal AuthService double: the caller's identity is carried in the `x-test-user` header,
// so a test can simulate an anonymous, member, or admin session. Role is resolved for real
// against the DB by the route (lookupWorkspaceRole), exactly as production does.
function fakeAuth(): AuthService {
  return {
    handler: () => Promise.resolve(new Response(null)),
    getSessionUser: (headers: Headers): Promise<SessionUser | undefined> => {
      const id = headers.get('x-test-user')
      return Promise.resolve(id ? { id, email: `${id}@example.test` } : undefined)
    },
    migrateAuth: () => Promise.resolve({ created: [], altered: [] }),
    issueSyncToken: () => Promise.resolve('token'),
    verifySyncToken: () => Promise.resolve(undefined),
  }
}

describe('createConnectorAdminRoutes — auth gating (no db)', () => {
  it('rejects an anonymous caller with 401 before touching the surface', async () => {
    const app = createConnectorAdminRoutes({
      auth: fakeAuth(),
      db: {} as never,
      logger: silent,
      githubConfigured: false,
      githubMissingEnv: ['GITHUB_APP_ID'],
    })
    const response = await app.request('/api/v1/connectors/github')
    expect(response.status).toBe(401)
  })
})

describe.skipIf(DATABASE_URL === undefined)(
  'createConnectorAdminRoutes — admin surface (db)',
  () => {
    let database: Database

    beforeAll(async () => {
      database = createDatabase({ connectionString: DATABASE_URL ?? '' })
      await migrateToLatest(database.db)
    }, 30_000)

    afterAll(async () => {
      await database.close()
    })

    // Each test gets its own workspace + admin + member so the shared database and file-parallel
    // execution never make one test depend on another's config rows.
    async function freshWorkspace() {
      const workspaceId = newId()
      const adminId = newId()
      const memberId = newId()
      await database.db.insertInto('workspace').values({ id: workspaceId, name: 'conn' }).execute()
      await database.db
        .insertInto('workspace_member')
        .values([
          { id: newId(), workspace_id: workspaceId, user_id: adminId, role: 'admin' },
          { id: newId(), workspace_id: workspaceId, user_id: memberId, role: 'member' },
        ])
        .execute()
      return { workspaceId, adminId, memberId }
    }

    function routes(configured: boolean) {
      return createConnectorAdminRoutes({
        auth: fakeAuth(),
        db: database.db,
        logger: silent,
        githubConfigured: configured,
        githubMissingEnv: configured ? [] : ['GITHUB_APP_ID', 'SECRETS_ENCRYPTION_KEY'],
      })
    }

    it('forbids a non-admin member with 403 and returns no status', async () => {
      const { memberId } = await freshWorkspace()
      const response = await routes(false).request('/api/v1/connectors/github', {
        headers: { 'x-test-user': memberId },
      })
      expect(response.status).toBe(403)
    })

    it('returns redacted status and missing env for an admin when not configured', async () => {
      const { adminId } = await freshWorkspace()
      const response = await routes(false).request('/api/v1/connectors/github', {
        headers: { 'x-test-user': adminId },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        provider: string
        configured: boolean
        missingEnv: string[]
        status: unknown
      }
      expect(body.provider).toBe('github')
      expect(body.configured).toBe(false)
      expect(body.missingEnv).toContain('GITHUB_APP_ID')
      expect(body.status).toBeNull()
    })

    it('enables the connector and maps a repo to a team, then unmaps it', async () => {
      const { workspaceId, adminId, memberId } = await freshWorkspace()
      const enable = await routes(true).request('/api/v1/connectors/github', {
        method: 'POST',
        headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })
      expect(enable.status).toBe(200)
      const enabled = (await enable.json()) as { status: { enabled: boolean } | null }
      expect(enabled.status?.enabled).toBe(true)

      // A member trying the same write is rejected.
      const memberWrite = await routes(true).request('/api/v1/connectors/github', {
        method: 'POST',
        headers: { 'x-test-user': memberId, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      expect(memberWrite.status).toBe(403)

      const teamId = newId()
      await database.db
        .insertInto('team')
        .values({
          id: teamId,
          workspace_id: workspaceId,
          name: 'Eng',
          key: `AD${Date.now().toString(36).toUpperCase()}`,
        })
        .execute()
      const config = await upsertConnectorConfig(
        database.db,
        { userID: adminId, role: 'admin' },
        { id: newId(), workspaceId, provider: 'github', enabled: true },
      )
      const externalId = newId()
      await upsertConnectorInstallation(database.db, {
        id: newId(),
        configId: config.id,
        externalInstallationId: externalId,
        accountLogin: 'acme',
      })

      const map = await routes(true).request(
        `/api/v1/connectors/github/installations/${externalId}/repos`,
        {
          method: 'PUT',
          headers: { 'x-test-user': adminId, 'content-type': 'application/json' },
          body: JSON.stringify({ repo: 'acme/app', teamId }),
        },
      )
      expect(map.status).toBe(200)

      const afterMap = await routes(true).request('/api/v1/connectors/github', {
        headers: { 'x-test-user': adminId },
      })
      const mapped = (await afterMap.json()) as {
        status: { installations: { repoMapping: Record<string, string> }[] } | null
      }
      const installation = mapped.status?.installations.find(
        (i) => i.repoMapping['acme/app'] === teamId,
      )
      expect(installation).toBeDefined()

      const unmap = await routes(true).request(
        `/api/v1/connectors/github/installations/${externalId}/repos?repo=${encodeURIComponent('acme/app')}`,
        { method: 'DELETE', headers: { 'x-test-user': adminId } },
      )
      expect(unmap.status).toBe(200)

      const afterUnmap = await routes(true).request('/api/v1/connectors/github', {
        headers: { 'x-test-user': adminId },
      })
      const unmapped = (await afterUnmap.json()) as {
        status: { installations: { repoMapping: Record<string, string> }[] } | null
      }
      const still = unmapped.status?.installations.find((i) => 'acme/app' in i.repoMapping)
      expect(still).toBeUndefined()
    }, 30_000)
  },
)
