import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import { createDatabase, type Database } from './client.js'
import { pullRequestSourcesForCycleFacts } from './cycle-facts.js'
import { migrateToLatest } from './migrate.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the pull-request source read must not be skipped — it is the query the area enrichment depends on for team scoping',
  )
}

// `pullRequestSourcesForCycleFacts` is the one new SQL read this change adds. Two things about it
// need a live database: that it returns EXACTLY its explicit column list (so no identity-bearing
// column and no attacker-influenceable PR title can arrive by accident), and that its `team_id`
// filter really scopes — a cross-team PR id must come back with nothing.
describe.skipIf(DATABASE_URL === undefined)('pullRequestSourcesForCycleFacts', () => {
  let database: Database
  let teamA: string
  let teamB: string
  let prA: string
  let prA2: string
  let prB: string

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)

    const workspaceId = newId()
    const configId = newId()
    const installationId = newId()
    teamA = newId()
    teamB = newId()
    prA = newId()
    prA2 = newId()
    prB = newId()

    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'pr-source' })
      .execute()
    // team.key is globally unique, so derive a fresh random one (a uuidv7 prefix repeats within a ms).
    const key = () => `T${Math.random().toString(36).slice(2, 9).toUpperCase()}`
    await database.db
      .insertInto('team')
      .values([
        { id: teamA, workspace_id: workspaceId, name: 'Team A', key: key() },
        { id: teamB, workspace_id: workspaceId, name: 'Team B', key: key() },
      ])
      .execute()
    await database.db
      .insertInto('connector_config')
      .values({ id: configId, workspace_id: workspaceId, provider: 'github', enabled: true })
      .execute()
    await database.db
      .insertInto('connector_installation')
      .values({
        id: installationId,
        connector_config_id: configId,
        external_installation_id: '99887766',
        account_login: 'acme',
      })
      .execute()

    const openedAt = new Date()
    await database.db
      .insertInto('pull_request')
      .values([
        {
          id: prA,
          team_id: teamA,
          installation_id: installationId,
          provider: 'github',
          repo: 'acme/shop',
          number: 482,
          external_id: 'gh-482',
          title: 'Cut the refund window',
          state: 'merged',
          url: 'https://github.com/acme/shop/pull/482',
          head_sha: 'abc123',
          opened_at: openedAt,
        },
        {
          id: prA2,
          team_id: teamA,
          installation_id: installationId,
          provider: 'github',
          repo: 'acme/shop',
          number: 483,
          external_id: 'gh-483',
          title: 'Follow-up',
          state: 'merged',
          opened_at: openedAt,
        },
        {
          id: prB,
          team_id: teamB,
          installation_id: installationId,
          provider: 'github',
          repo: 'acme/other',
          number: 12,
          external_id: 'gh-12',
          title: "Another team's work",
          state: 'merged',
          opened_at: openedAt,
        },
      ])
      .execute()
  }, 30_000)

  afterAll(async () => {
    await database.db.deleteFrom('pull_request').where('id', 'in', [prA, prA2, prB]).execute()
    await database.close()
  })

  it('returns exactly the five projected fields — no title, no head_sha, no identity column', async () => {
    const rows = await pullRequestSourcesForCycleFacts(database.db, teamA, [prA])
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'externalInstallationId',
      'id',
      'installationId',
      'number',
      'repo',
    ])
    expect(rows[0]?.repo).toBe('acme/shop')
    expect(rows[0]?.number).toBe(482)
    expect(rows[0]?.externalInstallationId).toBe('99887766')
    const serialized = JSON.stringify(rows)
    for (const leaked of ['Cut the refund window', 'abc123', 'title', 'head_sha', 'url']) {
      expect(serialized, leaked).not.toContain(leaked)
    }
  })

  it('orders by id so a run truncated by the call cap is reproducible', async () => {
    const rows = await pullRequestSourcesForCycleFacts(database.db, teamA, [prA2, prA])
    expect(rows.map((row) => row.id)).toEqual([prA, prA2].sort())
  })

  it("returns nothing for another team's pull request id", async () => {
    expect(await pullRequestSourcesForCycleFacts(database.db, teamA, [prB])).toEqual([])
    // Mixed ids: the cross-team one is filtered out, the team's own survives.
    const mixed = await pullRequestSourcesForCycleFacts(database.db, teamA, [prA, prB])
    expect(mixed.map((row) => row.id)).toEqual([prA])
  })

  it('short-circuits on an empty id list without a query', async () => {
    expect(await pullRequestSourcesForCycleFacts(database.db, teamA, [])).toEqual([])
  })
})
