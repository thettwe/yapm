import { buildCycleFacts, type CycleFacts, newId } from '@yapm/schema'
import {
  createDatabase,
  type Database,
  getCycleDigestByCycle,
  migrateToLatest,
} from '@yapm/schema/db'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { createZeroDatabase } from '../zero/db-provider.js'
import { buildDigestInput, runCycleDigest } from './digest.js'
import { createAiGateway, type ModelFactory } from './gateway.js'

describe('buildDigestInput — delimits untrusted work-graph text, states computed counts', () => {
  const facts = buildCycleFacts({
    cycle: { id: 'c1', teamId: 't1', name: 'Cycle 7' },
    issues: [{ id: 'i1', number: 1, title: 'x', status: 'done', pullRequests: [] }],
  })
  const input = buildDigestInput(facts)

  it('fences the per-issue bundles as untrusted data', () => {
    expect(input).toContain('<<<UNTRUSTED WORK-GRAPH DATA')
    expect(input).toContain('<<<END UNTRUSTED DATA>>>')
  })

  it('states the yapm-computed counts for the model to narrate', () => {
    expect(input).toContain('shipped 1')
    expect(input).toContain('Cycle 7')
  })
})

const DATABASE_URL = process.env.DATABASE_URL
if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the digest pre-compute test must not be skipped')
}

describe.skipIf(DATABASE_URL === undefined)(
  'cycle digest pre-compute (live db, mock provider)',
  () => {
    async function seed(database: Database) {
      const workspaceId = newId()
      const teamId = newId()
      const cycleId = newId()
      const issueId = newId()
      const userId = newId()
      await database.db
        .insertInto('workspace')
        .values({ id: workspaceId, name: 'Digest WS' })
        .execute()
      // team.key is globally unique — derive a fresh random one per seed so tests never collide
      // (a uuidv7 prefix is timestamp-based, so it would repeat within a millisecond).
      const teamKey = `T${Math.random().toString(36).slice(2, 9).toUpperCase()}`
      await database.db
        .insertInto('team')
        .values({ id: teamId, workspace_id: workspaceId, name: 'Digest Team', key: teamKey })
        .execute()
      await database.db
        .insertInto('user')
        .values({
          id: userId,
          name: 'Casey Rivera',
          email: `casey-${userId}@example.test`,
          emailVerified: true,
        })
        .execute()
      await database.db
        .insertInto('workspace_member')
        .values({ id: newId(), workspace_id: workspaceId, user_id: userId, role: 'member' })
        .execute()
      await database.db
        .insertInto('cycle')
        .values({
          id: cycleId,
          team_id: teamId,
          name: 'Cycle 7',
          status: 'completed',
          start_date: new Date(Date.now() - 100_000),
          end_date: new Date(Date.now() - 10_000),
        })
        .execute()
      return { workspaceId, teamId, cycleId, issueId }
    }

    function factsFor(teamId: string, cycleId: string, issueId: string): CycleFacts {
      return buildCycleFacts({
        cycle: { id: cycleId, teamId, name: 'Cycle 7' },
        teamKey: 'DIG',
        issues: [
          { id: issueId, number: 1, title: 'Guest checkout', status: 'done', pullRequests: [] },
        ],
      })
    }

    function mockGateway(digest: unknown) {
      const mock = new MockLanguageModelV4({
        doGenerate: async () => ({
          finishReason: 'stop',
          usage: { inputTokens: 120, outputTokens: 60, totalTokens: 180 },
          content: [{ type: 'text', text: JSON.stringify(digest) }],
          warnings: [],
        }),
      } as never)
      const factory: ModelFactory = () => () => mock as never
      return factory
    }

    it('writes a team-scoped ready digest with content, model, and token usage', async () => {
      const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
      try {
        await migrateToLatest(database.db)
        const { workspaceId, teamId, cycleId, issueId } = await seed(database)
        const facts = factsFor(teamId, cycleId, issueId)

        const gateway = createAiGateway({
          db: database.db,
          codec: null,
          env: { keys: { anthropic: 'sk-test' }, defaultProvider: 'anthropic' },
          modelFactory: mockGateway({
            headline: 'Shipped guest checkout.',
            sections: [
              {
                title: 'What shipped',
                items: [
                  {
                    kind: 'shipped',
                    summary: 'Guest checkout went live.',
                    evidenceRefs: [{ kind: 'issue', id: issueId }],
                    confidence: 'high',
                  },
                ],
              },
            ],
          }),
        })

        const result = await runCycleDigest(
          { gateway, db: database.db, dbProvider: createZeroDatabase(database.db) },
          { workspaceId, facts },
        )
        expect(result.status).toBe('ready')

        const row = await getCycleDigestByCycle(database.db, cycleId)
        expect(row?.status).toBe('ready')
        expect(row?.team_id).toBe(teamId)
        expect(row?.provider).toBe('anthropic')
        expect(row?.model).toBeTruthy()
        // Token usage is persisted from the provider's normalized usage; the SDK mock does not
        // surface per-token counts (real providers do), so we only assert the columns exist.
        expect(row).toHaveProperty('input_token')
        expect(row).toHaveProperty('output_token')
        const content = row?.content as { sections: { items: unknown[] }[] } | null
        expect(content?.sections[0]?.items).toHaveLength(1)

        await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
      } finally {
        await database.close()
      }
    }, 30_000)

    it('drops an item whose evidence id is not a real yapm-computed id (cite-or-omit)', async () => {
      const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
      try {
        await migrateToLatest(database.db)
        const { workspaceId, teamId, cycleId, issueId } = await seed(database)
        const facts = factsFor(teamId, cycleId, issueId)

        const gateway = createAiGateway({
          db: database.db,
          codec: null,
          env: { keys: { anthropic: 'sk-test' }, defaultProvider: 'anthropic' },
          modelFactory: mockGateway({
            headline: 'Cycle summary.',
            sections: [
              {
                title: 'What shipped',
                items: [
                  {
                    kind: 'shipped',
                    summary: 'Real, cited.',
                    evidenceRefs: [{ kind: 'issue', id: issueId }],
                    confidence: 'high',
                  },
                  {
                    kind: 'risk',
                    summary: 'Invented, cites a hallucinated id.',
                    evidenceRefs: [{ kind: 'issue', id: 'not-a-real-id' }],
                    confidence: 'low',
                  },
                ],
              },
            ],
          }),
        })

        await runCycleDigest(
          { gateway, db: database.db, dbProvider: createZeroDatabase(database.db) },
          { workspaceId, facts },
        )
        const row = await getCycleDigestByCycle(database.db, cycleId)
        const content = row?.content as { sections: { items: { summary: string }[] }[] } | null
        expect(content?.sections[0]?.items).toHaveLength(1)
        expect(content?.sections[0]?.items[0]?.summary).toBe('Real, cited.')

        await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
      } finally {
        await database.close()
      }
    }, 30_000)

    it('writes an ai_off digest when AI is unconfigured for the workspace', async () => {
      const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
      try {
        await migrateToLatest(database.db)
        const { workspaceId, teamId, cycleId, issueId } = await seed(database)
        const facts = factsFor(teamId, cycleId, issueId)

        // No env keys, no codec, no DB config ⇒ resolveModel returns null ⇒ ai_off.
        const gateway = createAiGateway({
          db: database.db,
          codec: null,
          env: { keys: {}, defaultProvider: null },
          modelFactory: mockGateway({ headline: 'unused', sections: [] }),
        })

        const result = await runCycleDigest(
          { gateway, db: database.db, dbProvider: createZeroDatabase(database.db) },
          { workspaceId, facts },
        )
        expect(result.status).toBe('ai_off')
        const row = await getCycleDigestByCycle(database.db, cycleId)
        expect(row?.status).toBe('ai_off')
        expect(row?.content).toBeNull()

        await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
      } finally {
        await database.close()
      }
    }, 30_000)
  },
)
