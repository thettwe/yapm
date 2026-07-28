import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import type { AreaMap } from '../zero/areas.js'
import type { AuthContext } from '../zero/context.js'
import { getAiConfig, getRedactedAiStatus, upsertAiConfig } from './ai-config.js'
import { createDatabase, type Database } from './client.js'
import { ConnectorAuthorizationError } from './connector.js'
import { migrateToLatest } from './migrate.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the AI area-map persistence test must not be skipped',
  )
}

const admin: AuthContext = { userID: 'admin', role: 'admin' }
const member: AuthContext = { userID: 'member', role: 'member' }
const viewer: AuthContext = { userID: 'viewer', role: 'viewer' }

const areas: AreaMap = [
  { prefix: 'apps/server/src/billing/', area: 'Billing', sensitive: true },
  { prefix: 'apps/server/', area: 'Backend' },
  { prefix: 'packages/config/', area: 'Tooling', internal: true },
]

// The area map rides in the `ai` connector_config row's `config` jsonb — deliberately NOT in
// `repo_mapping`, whose `Record<string, string>` value shape is read by a live
// `repo_mapping ->> $repo` SQL expression that a nested value would break. These tests read the raw
// column to prove where the map actually lands, and that an unrelated write leaves it alone.
describe.skipIf(DATABASE_URL === undefined)('AI area map persistence', () => {
  let database: Database
  let workspaceId: string

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
  }, 30_000)

  afterAll(async () => {
    await database.close()
  })

  beforeEach(async () => {
    workspaceId = newId()
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'ai-areas' })
      .execute()
  })

  async function rawConfigRow() {
    return database.db
      .selectFrom('connector_config')
      .select(['config', 'provider'])
      .where('workspace_id', '=', workspaceId)
      .where('provider', '=', 'ai')
      .executeTakeFirst()
  }

  it('round-trips the ordered map through connector_config.config, order preserved', async () => {
    await upsertAiConfig(database.db, admin, {
      id: newId(),
      workspaceId,
      enabled: true,
      config: { models: {}, areas, spendCapUsd: 20 },
    })

    const stored = await getAiConfig(database.db, workspaceId)
    // Order is semantic — first match wins — so the array must survive as an array, in order.
    expect(stored?.data.areas).toEqual(areas)
    expect(stored?.enabled).toBe(true)

    const raw = (await rawConfigRow())?.config as { areas: unknown } | undefined
    expect(raw?.areas).toEqual(areas)

    // No installation row was created and no repo mapping was touched: the map is not there.
    const installations = await database.db
      .selectFrom('connector_installation')
      .innerJoin(
        'connector_config',
        'connector_config.id',
        'connector_installation.connector_config_id',
      )
      .select('connector_installation.repo_mapping')
      .where('connector_config.workspace_id', '=', workspaceId)
      .execute()
    expect(installations).toEqual([])
  })

  it('survives an unrelated update that omits the config blob', async () => {
    await upsertAiConfig(database.db, admin, {
      id: newId(),
      workspaceId,
      enabled: true,
      config: { models: {}, areas },
    })
    // Toggling `enabled` with no `config` must leave the stored blob — and the map — untouched.
    await upsertAiConfig(database.db, admin, { id: newId(), workspaceId, enabled: false })

    const stored = await getAiConfig(database.db, workspaceId)
    expect(stored?.enabled).toBe(false)
    expect(stored?.data.areas).toEqual(areas)
  })

  it('reads back as an empty map for a config written before this capability existed', async () => {
    // A legacy blob with no `areas` key at all — the parse must default, not throw.
    await upsertAiConfig(database.db, admin, {
      id: newId(),
      workspaceId,
      enabled: true,
      config: { models: { anthropic: 'claude-x' } } as never,
    })
    const stored = await getAiConfig(database.db, workspaceId)
    expect(stored?.data.areas).toEqual([])
    expect(stored?.data.models).toEqual({ anthropic: 'claude-x' })
  })

  it('refuses a non-admin write and a non-admin read of the map', async () => {
    await upsertAiConfig(database.db, admin, {
      id: newId(),
      workspaceId,
      enabled: true,
      config: { models: {}, areas },
    })
    for (const ctx of [member, viewer, undefined]) {
      await expect(
        upsertAiConfig(database.db, ctx, {
          id: newId(),
          workspaceId,
          config: { models: {}, areas: [] },
        }),
      ).rejects.toBeInstanceOf(ConnectorAuthorizationError)
      await expect(getRedactedAiStatus(database.db, ctx, workspaceId)).rejects.toBeInstanceOf(
        ConnectorAuthorizationError,
      )
    }
    // The refused writes changed nothing.
    expect((await getAiConfig(database.db, workspaceId))?.data.areas).toEqual(areas)
  })

  it('surfaces the map on the redacted admin status alongside no key material', async () => {
    await upsertAiConfig(database.db, admin, {
      id: newId(),
      workspaceId,
      enabled: true,
      config: { models: {}, areas },
    })
    const status = await getRedactedAiStatus(database.db, admin, workspaceId)
    expect(status?.areas).toEqual(areas)
    expect(status?.configuredProviders).toEqual([])
  })
})
