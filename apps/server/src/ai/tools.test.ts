import { type AgentAuditEntry, type AuthContext, newId } from '@yapm/schema'
import { createDatabase, type Database, migrateToLatest } from '@yapm/schema/db'
import { createServerMutators } from '@yapm/schema/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createZeroDatabase } from '../zero/db-provider.js'
import { buildAgentTools } from './tools.js'

const DATABASE_URL = process.env.DATABASE_URL
if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the agent-as-actor test must not be skipped')
}

// The agent-as-actor safety story IS the architecture: tools call the SAME mutators the human UI
// calls, under an `AuthContext` derived from the invoking user, so the role ceiling is the primary
// injection defense; and writes are `needsApproval`-gated (HITL) rather than auto-applied.
describe.skipIf(DATABASE_URL === undefined)('agent-as-actor tool ceiling (live db)', () => {
  let database: Database
  const workspaceId = newId()
  const teamId = newId()
  const memberId = newId()
  const viewerId = newId()

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'Agent WS' })
      .execute()
    await database.db
      .insertInto('team')
      .values({ id: teamId, workspace_id: workspaceId, name: 'Agent Team', key: 'AGT' })
      .execute()
    await database.db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: memberId, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: viewerId, role: 'viewer' },
      ])
      .execute()
    await database.db
      .insertInto('team_membership')
      .values({ id: newId(), team_id: teamId, user_id: memberId })
      .execute()
  }, 30_000)

  afterAll(async () => {
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.close()
  })

  function toolsFor(ctx: AuthContext, onAudit?: (entry: AgentAuditEntry) => void) {
    return buildAgentTools({
      mutators: createServerMutators(),
      dbProvider: createZeroDatabase(database.db),
      ctx,
      onAudit,
    })
  }

  const createArgs = () => ({
    teamId,
    title: 'Agent-created issue',
    status: 'todo' as const,
    priority: 'medium' as const,
  })

  it('flags every write tool needsApproval (HITL, not auto-applied)', () => {
    const tools = toolsFor({ userID: memberId, role: 'member' })
    expect(tools['issue.create']?.needsApproval).toBe(true)
    expect(tools['issue.setStatus']?.needsApproval).toBe(true)
    expect(tools['member.changeRole']?.needsApproval).toBe(true)
  })

  it("rejects a write under a viewer's ctx — the mutator throws, nothing is written", async () => {
    const tools = toolsFor({ userID: viewerId, role: 'viewer' })
    const execute = tools['issue.create']?.execute
    expect(execute).toBeDefined()
    await expect(execute?.(createArgs(), {} as never)).rejects.toThrow()

    const rows = await database.db
      .selectFrom('issue')
      .select('id')
      .where('team_id', '=', teamId)
      .where('title', '=', 'Agent-created issue')
      .execute()
    expect(rows).toHaveLength(0)
  })

  it("applies a write under a member's ctx and audits it (actor = agent, on-behalf-of = user)", async () => {
    const audits: AgentAuditEntry[] = []
    const tools = toolsFor({ userID: memberId, role: 'member' }, (entry) => audits.push(entry))
    const result = await tools['issue.create']?.execute?.(createArgs(), {} as never)
    expect(result).toEqual({ ok: true, tool: 'issue.create' })

    const rows = await database.db
      .selectFrom('issue')
      .select(['id', 'creator_id'])
      .where('team_id', '=', teamId)
      .where('title', '=', 'Agent-created issue')
      .execute()
    expect(rows).toHaveLength(1)
    // Identity is taken from ctx, never model output.
    expect(rows[0]?.creator_id).toBe(memberId)
    expect(audits).toEqual([
      { actor: 'agent', onBehalfOf: memberId, tool: 'issue.create', kind: 'write' },
    ])
  })
})
