import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import { createSecretCodec } from '../secrets/codec.js'
import type { AuthContext } from '../zero/context.js'
import { createDatabase, type Database } from './client.js'
import {
  ConnectorAuthorizationError,
  deleteConnectorSecret,
  getConnectorConfig,
  getConnectorSecret,
  getInstallationEtag,
  getRedactedConnectorStatus,
  recordConnectorSync,
  removeInstallationRepoTeam,
  resolveTeamForRepo,
  setConnectorSecret,
  setInstallationEtag,
  setInstallationRepoTeam,
  upsertConnectorConfig,
  upsertConnectorInstallation,
} from './connector.js'
import { migrateToLatest } from './migrate.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the connector surface test must not be skipped')
}

const admin: AuthContext = { userID: 'admin', role: 'admin' }
const member: AuthContext = { userID: 'member', role: 'member' }
const viewer: AuthContext = { userID: 'viewer', role: 'viewer' }
const codec = createSecretCodec(randomBytes(32).toString('base64'))

describe.skipIf(DATABASE_URL === undefined)('connector surface', () => {
  let database: Database
  let workspaceId: string
  let teamId: string

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
  }, 30_000)

  afterAll(async () => {
    await database.close()
  })

  beforeEach(async () => {
    workspaceId = newId()
    // The repo -> team mapping is a jsonb value with no FK, so a bare id suffices here.
    teamId = newId()
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'connector-test' })
      .execute()
  })

  async function seedConfig(): Promise<string> {
    const config = await upsertConnectorConfig(database.db, admin, {
      id: newId(),
      workspaceId,
      provider: 'github',
      enabled: true,
      config: { repoFilter: ['owner/*'] },
    })
    return config.id
  }

  it('upserts config and preserves the config blob when only toggling enabled', async () => {
    const configId = await seedConfig()
    const toggled = await upsertConnectorConfig(database.db, admin, {
      id: newId(),
      workspaceId,
      provider: 'github',
      enabled: false,
    })
    expect(toggled.id).toBe(configId)
    expect(toggled.enabled).toBe(false)
    expect(toggled.config).toEqual({ repoFilter: ['owner/*'] })
    expect(toggled.status).toBe('disabled')
  })

  it('gates config, secret, and mapping writes behind workspace admin', async () => {
    const configId = await seedConfig()
    for (const ctx of [member, viewer, undefined]) {
      await expect(
        upsertConnectorConfig(database.db, ctx, { id: newId(), workspaceId, provider: 'github' }),
      ).rejects.toBeInstanceOf(ConnectorAuthorizationError)
      await expect(
        setConnectorSecret(database.db, ctx, codec, {
          id: newId(),
          configId,
          key: 'webhook_secret',
          value: 'x',
        }),
      ).rejects.toBeInstanceOf(ConnectorAuthorizationError)
      await expect(
        getRedactedConnectorStatus(database.db, ctx, workspaceId, 'github'),
      ).rejects.toBeInstanceOf(ConnectorAuthorizationError)
    }
  })

  it('stores secrets encrypted at rest and round-trips them for the server', async () => {
    const configId = await seedConfig()
    await setConnectorSecret(database.db, admin, codec, {
      id: newId(),
      configId,
      key: 'app_private_key',
      value: 'PEM-BODY',
    })

    const stored = await database.db
      .selectFrom('connector_secret')
      .select('ciphertext')
      .where('connector_config_id', '=', configId)
      .where('key', '=', 'app_private_key')
      .executeTakeFirstOrThrow()
    expect(stored.ciphertext).not.toContain('PEM-BODY')
    expect(stored.ciphertext.startsWith('v1.')).toBe(true)

    expect(await getConnectorSecret(database.db, codec, configId, 'app_private_key')).toBe(
      'PEM-BODY',
    )

    await setConnectorSecret(database.db, admin, codec, {
      id: newId(),
      configId,
      key: 'app_private_key',
      value: 'ROTATED',
    })
    expect(await getConnectorSecret(database.db, codec, configId, 'app_private_key')).toBe(
      'ROTATED',
    )

    await deleteConnectorSecret(database.db, admin, configId, 'app_private_key')
    expect(await getConnectorSecret(database.db, codec, configId, 'app_private_key')).toBeNull()
  })

  it('records sync telemetry', async () => {
    const configId = await seedConfig()
    await recordConnectorSync(database.db, { configId, status: 'error', lastError: 'boom' })
    let config = await getConnectorConfig(database.db, workspaceId, 'github')
    expect(config?.status).toBe('error')
    expect(config?.last_error).toBe('boom')
    expect(config?.last_synced_at).toBeNull()

    await recordConnectorSync(database.db, { configId, status: 'connected' })
    config = await getConnectorConfig(database.db, workspaceId, 'github')
    expect(config?.status).toBe('connected')
    expect(config?.last_error).toBeNull()
    expect(config?.last_synced_at).toBeInstanceOf(Date)
  })

  it('maps repos to teams (admin) and resolves them, dropping unmapped repos', async () => {
    const configId = await seedConfig()
    const installation = await upsertConnectorInstallation(database.db, {
      id: newId(),
      configId,
      externalInstallationId: '42',
      accountLogin: 'acme',
    })

    expect(await resolveTeamForRepo(database.db, installation.id, 'acme/api')).toBeNull()

    await setInstallationRepoTeam(database.db, admin, {
      installationId: installation.id,
      repoFullName: 'acme/api',
      teamId,
    })
    expect(await resolveTeamForRepo(database.db, installation.id, 'acme/api')).toBe(teamId)
    expect(await resolveTeamForRepo(database.db, installation.id, 'acme/web')).toBeNull()

    await expect(
      setInstallationRepoTeam(database.db, viewer, {
        installationId: installation.id,
        repoFullName: 'acme/web',
        teamId,
      }),
    ).rejects.toBeInstanceOf(ConnectorAuthorizationError)

    await removeInstallationRepoTeam(database.db, admin, installation.id, 'acme/api')
    expect(await resolveTeamForRepo(database.db, installation.id, 'acme/api')).toBeNull()
  })

  it('stores and reads per-resource ETags without clobbering the repo mapping', async () => {
    const configId = await seedConfig()
    const installation = await upsertConnectorInstallation(database.db, {
      id: newId(),
      configId,
      externalInstallationId: '7',
    })
    await setInstallationRepoTeam(database.db, admin, {
      installationId: installation.id,
      repoFullName: 'acme/api',
      teamId,
    })
    await setInstallationEtag(database.db, installation.id, 'pulls', 'W/"abc"')

    expect(await getInstallationEtag(database.db, installation.id, 'pulls')).toBe('W/"abc"')
    expect(await getInstallationEtag(database.db, installation.id, 'missing')).toBeNull()
    expect(await resolveTeamForRepo(database.db, installation.id, 'acme/api')).toBe(teamId)

    // Re-upserting the installation (a lifecycle webhook) keeps mapping + etags intact.
    await upsertConnectorInstallation(database.db, {
      id: newId(),
      configId,
      externalInstallationId: '7',
      accountLogin: 'acme',
    })
    expect(await getInstallationEtag(database.db, installation.id, 'pulls')).toBe('W/"abc"')
    expect(await resolveTeamForRepo(database.db, installation.id, 'acme/api')).toBe(teamId)
  })

  it('returns a redacted status with secret names but no secret material', async () => {
    const configId = await seedConfig()
    await setConnectorSecret(database.db, admin, codec, {
      id: newId(),
      configId,
      key: 'webhook_secret',
      value: 'super-secret',
    })
    const installation = await upsertConnectorInstallation(database.db, {
      id: newId(),
      configId,
      externalInstallationId: '99',
      accountLogin: 'acme',
    })
    await setInstallationRepoTeam(database.db, admin, {
      installationId: installation.id,
      repoFullName: 'acme/api',
      teamId,
    })

    const status = await getRedactedConnectorStatus(database.db, admin, workspaceId, 'github')
    expect(status).not.toBeNull()
    expect(status?.enabled).toBe(true)
    expect(status?.secretKeys).toEqual(['webhook_secret'])
    expect(status?.installations).toEqual([
      { externalInstallationId: '99', accountLogin: 'acme', repoMapping: { 'acme/api': teamId } },
    ])
    expect(JSON.stringify(status)).not.toContain('super-secret')
    expect(JSON.stringify(status)).not.toContain('v1.')

    expect(await getRedactedConnectorStatus(database.db, admin, workspaceId, 'gitlab')).toBeNull()
  })
})
