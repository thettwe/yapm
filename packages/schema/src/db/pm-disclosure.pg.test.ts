import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import type { AuthContext } from '../zero/context.js'
import { getAiConfig, upsertAiConfig } from './ai-config.js'
import { createDatabase, type Database } from './client.js'
import { ConnectorAuthorizationError } from './connector.js'
import { migrateToLatest } from './migrate.js'
import {
  audienceSize,
  pmTeamPolicy,
  recordDisclosureAudit,
  resolvePmAudienceTeamIds,
  setPmDisclosurePolicy,
} from './pm-disclosure.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the disclosure policy test must not be skipped')
}

// FOUR SWITCHES, ONE RESOLVER. Each of these asserts a different one of them collapsing to the same
// answer — an empty array — because a caller that could tell the four apart would have a probe for
// how a workspace is configured.
describe.skipIf(DATABASE_URL === undefined)('the PM disclosure policy', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })

  const workspaceId = newId()
  const teamA = newId()
  const teamB = newId()

  const ADMIN: AuthContext = { userID: `a-${newId()}`, role: 'admin' }
  const MEMBER: AuthContext = { userID: `m-${newId()}`, role: 'member' }
  const READER: AuthContext = { userID: `r-${newId()}`, role: 'viewer' }
  // Signed in, but in no workspace at all.
  const STRANGER = `s-${newId()}`

  async function policy(over: Parameters<typeof setPmDisclosurePolicy>[2]) {
    await setPmDisclosurePolicy(database.db, ADMIN, over)
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    const stamp = newId().slice(-6)
    await database.db.insertInto('workspace').values({ id: workspaceId, name: 'policy' }).execute()
    await database.db
      .insertInto('team')
      .values([
        { id: teamA, workspace_id: workspaceId, name: 'A', key: `PA${stamp}` },
        { id: teamB, workspace_id: workspaceId, name: 'B', key: `PB${stamp}` },
      ])
      .execute()
    await database.db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: ADMIN.userID, role: 'admin' },
        { id: newId(), workspace_id: workspaceId, user_id: MEMBER.userID, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: READER.userID, role: 'viewer' },
      ])
      .execute()
  }, 60_000)

  beforeEach(async () => {
    await sql`delete from ai_disclosure_audit where workspace_id = ${workspaceId}`.execute(
      database.db,
    )
    await sql`delete from connector_config where workspace_id = ${workspaceId}`.execute(database.db)
  })

  afterAll(async () => {
    await sql`delete from ai_disclosure_audit where workspace_id = ${workspaceId}`.execute(
      database.db,
    )
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  it('resolves nothing when there is no config row at all', async () => {
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual([])
    expect(await pmTeamPolicy(database.db, workspaceId, teamA)).toEqual({
      pmVisible: false,
      audience: [],
    })
  })

  // The legacy blob: a config written before this capability existed must PARSE to all-off, not
  // throw and not be treated as missing.
  it('reads a config blob that predates this capability as all-off', async () => {
    await database.db
      .insertInto('connector_config')
      .values({
        id: newId(),
        workspace_id: workspaceId,
        provider: 'ai',
        enabled: true,
        config: { models: { anthropic: 'claude-x' } },
      })
      .execute()
    const stored = await getAiConfig(database.db, workspaceId)
    expect(stored?.data.pmDisclosure).toEqual({ enabled: false, killed: false, teams: {} })
    expect(stored?.data.models).toEqual({ anthropic: 'claude-x' })
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual([])
  })

  it('needs the workspace switch, the team switch AND the name — each alone is nothing', async () => {
    // Named, team visible, workspace switch OFF.
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      teams: { [teamA]: { pmVisible: true, audience: [READER.userID] } },
    })
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual([])

    // Workspace switch on, team switch off.
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      enabled: true,
      teams: { [teamA]: { pmVisible: false } },
    })
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual([])

    // Both on, but the reader is not named.
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      teams: { [teamA]: { pmVisible: true, audience: [MEMBER.userID] } },
    })
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual([])

    // All three.
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      teams: { [teamA]: { audience: [MEMBER.userID, READER.userID] } },
    })
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual([teamA])
  })

  it('empties every audience while the kill switch is set, and restores on release', async () => {
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      enabled: true,
      teams: {
        [teamA]: { pmVisible: true, audience: [READER.userID] },
        [teamB]: { pmVisible: true, audience: [READER.userID] },
      },
    })
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual(
      [teamA, teamB].sort(),
    )

    await policy({ configId: newId(), auditId: newId(), workspaceId, killed: true })
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual([])
    expect(await pmTeamPolicy(database.db, workspaceId, teamA)).toEqual({
      pmVisible: false,
      audience: [],
    })

    await policy({ configId: newId(), auditId: newId(), workspaceId, killed: false })
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual(
      [teamA, teamB].sort(),
    )
  })

  it('gives a user who is in no workspace nothing', async () => {
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      enabled: true,
      teams: { [teamA]: { pmVisible: true, audience: [STRANGER] } },
    })
    expect(await resolvePmAudienceTeamIds(database.db, STRANGER)).toEqual([])
  })

  // A per-team write MERGES. Editing one team's audience must not silently clear another's, which is
  // the failure a wholesale replace produces and nobody notices until a reader stops receiving.
  it('merges per-team entries rather than replacing the map', async () => {
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      enabled: true,
      teams: {
        [teamA]: { pmVisible: true, audience: [READER.userID] },
        [teamB]: { pmVisible: true, audience: [READER.userID] },
      },
    })
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      teams: { [teamA]: { audience: [MEMBER.userID] } },
    })

    const stored = await getAiConfig(database.db, workspaceId)
    expect(stored?.data.pmDisclosure.teams[teamB]).toEqual({
      pmVisible: true,
      audience: [READER.userID],
    })
    // And the untouched half of A's entry survived the edit.
    expect(stored?.data.pmDisclosure.teams[teamA]).toEqual({
      pmVisible: true,
      audience: [MEMBER.userID],
    })
    expect(await resolvePmAudienceTeamIds(database.db, READER.userID)).toEqual([teamB])
  })

  it('never clobbers the rest of the AI settings blob', async () => {
    await upsertAiConfig(database.db, ADMIN, {
      id: newId(),
      workspaceId,
      enabled: true,
      config: {
        models: { anthropic: 'claude-x' },
        spendCapUsd: 20,
        areas: [{ prefix: 'apps/web/', area: 'Web' }],
        pmDisclosure: { enabled: false, killed: false, teams: {} },
      },
    })
    await policy({ configId: newId(), auditId: newId(), workspaceId, enabled: true })

    const stored = await getAiConfig(database.db, workspaceId)
    expect(stored?.data.models).toEqual({ anthropic: 'claude-x' })
    expect(stored?.data.spendCapUsd).toBe(20)
    expect(stored?.data.areas).toEqual([{ prefix: 'apps/web/', area: 'Web' }])
  })

  it('counts the audience for the publish stamp, deduplicated, and zero when the team is off', async () => {
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      enabled: true,
      teams: { [teamA]: { pmVisible: true, audience: [READER.userID, READER.userID] } },
    })
    expect(await audienceSize(database.db, workspaceId, teamA)).toBe(1)
    expect(await audienceSize(database.db, workspaceId, teamB)).toBe(0)
  })

  it('refuses a non-admin write, and writes no audit record when it refuses', async () => {
    for (const ctx of [MEMBER, READER, undefined]) {
      await expect(
        setPmDisclosurePolicy(database.db, ctx, {
          configId: newId(),
          auditId: newId(),
          workspaceId,
          enabled: true,
        }),
      ).rejects.toBeInstanceOf(ConnectorAuthorizationError)
    }
    expect(
      await database.db
        .selectFrom('ai_disclosure_audit')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .execute(),
    ).toEqual([])
  })

  it('records one policy_changed row per write, naming what changed and not who may read', async () => {
    await policy({
      configId: newId(),
      auditId: newId(),
      workspaceId,
      enabled: true,
      teams: { [teamA]: { pmVisible: true, audience: [READER.userID] } },
    })
    const rows = await database.db
      .selectFrom('ai_disclosure_audit')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.event).toBe('policy_changed')
    expect(rows[0]?.actor_id).toBe(ADMIN.userID)
    expect(rows[0]?.detail).toEqual({ enabled: true, killed: false, teamsChanged: [teamA] })
    // The record says WHICH team's entry changed and never WHO is now allowed to read it.
    expect(JSON.stringify(rows[0]?.detail)).not.toContain(READER.userID)
  })

  it('maps the system principal onto a null actor rather than a fake user id', async () => {
    await recordDisclosureAudit(database.db, {
      id: newId(),
      workspaceId,
      teamId: teamA,
      actorId: 'system',
      event: 'generated',
      detail: { status: 'ready' },
    })
    const rows = await database.db
      .selectFrom('ai_disclosure_audit')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute()
    expect(rows[0]?.actor_id).toBeNull()
  })
})
