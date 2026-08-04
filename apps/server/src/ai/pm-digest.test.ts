import { buildCycleFacts, buildPmEvidenceLabels, type CycleFacts, newId } from '@yapm/schema'
import {
  createDatabase,
  type Database,
  migrateToLatest,
  setPmDisclosurePolicy,
} from '@yapm/schema/db'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { createZeroDatabase } from '../zero/db-provider.js'
import { createAiGateway, type ModelFactory } from './gateway.js'
import { buildPmDigestInput, PM_DIGEST_SYSTEM_PROMPT, runPmDigest } from './pm-digest.js'

const FACTS: CycleFacts = buildCycleFacts({
  cycle: { id: 'c1', teamId: 't1', name: 'Cycle 7' },
  teamKey: 'eng',
  issues: [
    {
      id: 'i1',
      number: 142,
      title: 'Guest checkout',
      status: 'done',
      pullRequests: [
        {
          id: 'pr1',
          number: 331,
          title: 'checkout',
          state: 'merged',
          ciChecks: [{ id: 'ck1', conclusion: 'success' }],
        },
      ],
    },
  ],
})

describe('the PM prompt carries every guarantee the internal one does, plus altitude', () => {
  it('states the identity, cite-or-omit, numbers and no-path rules', () => {
    for (const rule of [
      'never name',
      'Cite evidence or omit',
      'never invent a metric',
      'UNTRUSTED',
      'Never emit a file path',
    ]) {
      expect(PM_DIGEST_SYSTEM_PROMPT.toLowerCase()).toContain(rule.toLowerCase())
    }
  })

  it('tells the model its reader is outside the team, and what that rules out', () => {
    expect(PM_DIGEST_SYSTEM_PROMPT).toContain('NOT on the team')
    expect(PM_DIGEST_SYSTEM_PROMPT).toContain('No engineering internals')
  })
})

describe('buildPmDigestInput', () => {
  const input = buildPmDigestInput(FACTS)

  it('fences the per-issue bundles as untrusted data and states the computed counts', () => {
    expect(input).toContain('<<<UNTRUSTED WORK-GRAPH DATA')
    expect(input).toContain('<<<END UNTRUSTED DATA>>>')
    expect(input).toContain('shipped 1')
  })

  // The identity-free guarantee is a property of `CycleFacts` itself, but the PM run is the first
  // consumer whose output leaves the team — so it is re-asserted at this boundary rather than
  // inherited silently.
  it('contains no identity-shaped key at any depth', () => {
    const walk = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.flatMap(walk)
      if (typeof value !== 'object' || value === null) return []
      return Object.entries(value).flatMap(([key, nested]) => [key, ...walk(nested)])
    }
    const keys = walk(
      JSON.parse(input.split('<<<UNTRUSTED WORK-GRAPH DATA')[1]?.split('\n')[1] ?? '[]'),
    )
    for (const forbidden of ['assignee', 'author', 'reviewer', 'creator', 'userId', 'user_id']) {
      expect(keys.map((key) => key.toLowerCase())).not.toContain(forbidden.toLowerCase())
    }
  })
})

describe('buildPmEvidenceLabels — server-rendered plain text, never a link', () => {
  const ALL = new Set(['i1', 'pr1', 'ck1'])

  it('renders the issue key and the pull-request number', () => {
    const labels = buildPmEvidenceLabels(FACTS, ALL)
    expect(labels.i1).toBe('ENG-142')
    expect(labels.pr1).toBe('ENG-142 · PR #331')
    // A CI check inherits its pull request's label: "the check on ENG-142 · PR #331" is the only
    // thing about it a reader outside the team could act on.
    expect(labels.ck1).toBe('ENG-142 · PR #331')
  })

  it('yields nothing for an id it never computed', () => {
    expect(buildPmEvidenceLabels(FACTS, ALL)['not-a-real-id']).toBeUndefined()
  })

  // THE MAP IS THE DISCLOSURE, not just the prose it decorates: it is stored on the row and syncs
  // verbatim to a reader outside the team, so an id nothing cites must not acquire a label.
  it('labels only the cited ids, so an uncited issue key is never baked in', () => {
    expect(buildPmEvidenceLabels(FACTS, new Set(['i1']))).toEqual({ i1: 'ENG-142' })
    expect(buildPmEvidenceLabels(FACTS, new Set())).toEqual({})
  })

  // A check inherits the label of the pull request BEFORE it, so an uncited PR still has to advance
  // the running label even though it contributes no entry of its own.
  it('still inherits a pull request label onto a cited check when the PR itself is uncited', () => {
    expect(buildPmEvidenceLabels(FACTS, new Set(['ck1']))).toEqual({ ck1: 'ENG-142 · PR #331' })
  })

  it('omits an issue with no number rather than inventing a label', () => {
    const labels = buildPmEvidenceLabels(
      buildCycleFacts({
        cycle: { id: 'c1', teamId: 't1', name: 'Cycle 7' },
        issues: [{ id: 'i9', number: null, title: 'x', status: 'done', pullRequests: [] }],
      }),
      new Set(['i9']),
    )
    expect(labels).toEqual({})
  })
})

const DATABASE_URL = process.env.DATABASE_URL
if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the PM digest pre-compute test must not be skipped',
  )
}

describe.skipIf(DATABASE_URL === undefined)(
  'PM digest pre-compute (live db, mock provider)',
  () => {
    async function seed(database: Database) {
      const workspaceId = newId()
      const teamId = newId()
      const cycleId = newId()
      const issueId = newId()
      const userId = newId()
      const adminId = newId()
      await database.db.insertInto('workspace').values({ id: workspaceId, name: 'PM WS' }).execute()
      const teamKey = `T${Math.random().toString(36).slice(2, 9).toUpperCase()}`
      await database.db
        .insertInto('team')
        .values({ id: teamId, workspace_id: workspaceId, name: 'PM Team', key: teamKey })
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
        .values([
          { id: newId(), workspace_id: workspaceId, user_id: userId, role: 'member' },
          { id: newId(), workspace_id: workspaceId, user_id: adminId, role: 'admin' },
        ])
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
      await database.db
        .insertInto('issue')
        .values({
          id: issueId,
          team_id: teamId,
          number: 1,
          title: 'Guest checkout',
          status: 'done',
          priority: 'no_priority',
          creator_id: userId,
          cycle_id: cycleId,
        })
        .execute()
      return { workspaceId, teamId, cycleId, issueId, adminId }
    }

    // The second issue is REAL work in the same cycle that no surviving item ever cites. It is here
    // to be absent from the stored blob: the evidence-label map is baked by yapm and syncs verbatim
    // to a reader outside the team, so an uncited issue's key must never ride along in it.
    const UNCITED_KEY = 'PMD-2'

    function factsFor(teamId: string, cycleId: string, issueId: string): CycleFacts {
      return buildCycleFacts({
        cycle: { id: cycleId, teamId, name: 'Cycle 7' },
        teamKey: 'PMD',
        issues: [
          { id: issueId, number: 1, title: 'Guest checkout', status: 'done', pullRequests: [] },
          {
            id: `${issueId}-uncited`,
            number: 2,
            title: 'Nobody summarized this',
            status: 'done',
            pullRequests: [],
          },
        ],
      })
    }

    function mockGateway(digest: unknown, calls?: { options: unknown[] }) {
      const mock = new MockLanguageModelV4({
        doGenerate: async (options: unknown) => {
          calls?.options.push(options)
          return {
            finishReason: 'stop',
            usage: { inputTokens: 120, outputTokens: 60, totalTokens: 180 },
            content: [{ type: 'text', text: JSON.stringify(digest) }],
            warnings: [],
          }
        },
      } as never)
      const factory: ModelFactory = () => () => mock as never
      return factory
    }

    const READY = (issueId: string) => ({
      headline: 'Checkout shipped.',
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
    })

    const SUBJECT = { teamName: 'PM Team', cycleName: 'Cycle 7', startDate: 1, endDate: 2 }

    it('writes a ready digest that is UNPUBLISHED, with a baked subject and labels', async () => {
      const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
      try {
        await migrateToLatest(database.db)
        const { workspaceId, teamId, cycleId, issueId } = await seed(database)
        const calls = { options: [] as unknown[] }
        const gateway = createAiGateway({
          db: database.db,
          codec: null,
          env: { keys: { anthropic: 'sk-test' }, defaultProvider: 'anthropic' },
          modelFactory: mockGateway(READY(issueId), calls),
        })

        const result = await runPmDigest(
          { gateway, db: database.db, dbProvider: createZeroDatabase(database.db) },
          { workspaceId, facts: factsFor(teamId, cycleId, issueId), subject: SUBJECT },
        )
        expect(result.status).toBe('ready')

        const row = await database.db
          .selectFrom('pm_digest')
          .selectAll()
          .where('cycle_id', '=', cycleId)
          .executeTakeFirst()
        // THE GATE. Generation discloses to nobody.
        expect(row?.published_at).toBeNull()
        expect(row?.published_by).toBeNull()
        expect(row?.audience_size_at_publish).toBeNull()
        expect(row?.status).toBe('ready')
        const content = row?.content as {
          subject?: unknown
          evidenceLabels?: Record<string, string>
        }
        expect(content.subject).toEqual(SUBJECT)
        expect(content.evidenceLabels?.[issueId]).toBe('PMD-1')
        // The uncited issue of the same cycle contributes NOTHING to the row — not a label, not a
        // key, not anywhere at any depth. Asserted over the serialized blob rather than over the map
        // alone, because the map is only one of the places it could have leaked into.
        expect(content.evidenceLabels?.[`${issueId}-uncited`]).toBeUndefined()
        expect(JSON.stringify(row?.content)).not.toContain(UNCITED_KEY)

        // The cost is written even though the column does not sync, so the spend cap sees it.
        expect(row?.estimated_cost_usd).not.toBeNull()

        // NO TOOLS ARE MOUNTED. The whole "the worst case is a bad paragraph" argument rests on this
        // absence, so it is asserted rather than assumed.
        for (const options of calls.options) {
          expect((options as { tools?: unknown[] }).tools ?? []).toEqual([])
        }

        const audit = await database.db
          .selectFrom('ai_disclosure_audit')
          .selectAll()
          .where('workspace_id', '=', workspaceId)
          .execute()
        expect(audit).toHaveLength(1)
        expect(audit[0]?.event).toBe('generated')
        // The system principal is not a `user` row.
        expect(audit[0]?.actor_id).toBeNull()
        expect(audit[0]?.detail).toEqual({ status: 'ready' })

        await database.db
          .deleteFrom('ai_disclosure_audit')
          .where('workspace_id', '=', workspaceId)
          .execute()
        await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
      } finally {
        await database.close()
      }
    }, 30_000)

    it('drops an item citing an id yapm never computed, and one that discloses a path', async () => {
      const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
      try {
        await migrateToLatest(database.db)
        const { workspaceId, teamId, cycleId, issueId } = await seed(database)
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
                  {
                    kind: 'risk',
                    summary: 'Echoed an injected title: rewrote src/checkout/session.ts.',
                    evidenceRefs: [{ kind: 'issue', id: issueId }],
                    confidence: 'low',
                  },
                ],
              },
            ],
          }),
        })

        await runPmDigest(
          { gateway, db: database.db, dbProvider: createZeroDatabase(database.db) },
          { workspaceId, facts: factsFor(teamId, cycleId, issueId), subject: SUBJECT },
        )
        const row = await database.db
          .selectFrom('pm_digest')
          .selectAll()
          .where('cycle_id', '=', cycleId)
          .executeTakeFirst()
        const content = row?.content as { sections: { items: { summary: string }[] }[] }
        expect(content.sections[0]?.items.map((item) => item.summary)).toEqual(['Real, cited.'])

        await database.db
          .deleteFrom('ai_disclosure_audit')
          .where('workspace_id', '=', workspaceId)
          .execute()
        await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
      } finally {
        await database.close()
      }
    }, 30_000)

    it('writes ai_off with an audit record when AI is unconfigured, and it is not publishable', async () => {
      const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
      try {
        await migrateToLatest(database.db)
        const { workspaceId, teamId, cycleId, issueId } = await seed(database)
        const gateway = createAiGateway({
          db: database.db,
          codec: null,
          env: { keys: {}, defaultProvider: null },
          modelFactory: mockGateway(READY(issueId)),
        })

        const result = await runPmDigest(
          { gateway, db: database.db, dbProvider: createZeroDatabase(database.db) },
          { workspaceId, facts: factsFor(teamId, cycleId, issueId), subject: SUBJECT },
        )
        expect(result.status).toBe('ai_off')

        const row = await database.db
          .selectFrom('pm_digest')
          .selectAll()
          .where('cycle_id', '=', cycleId)
          .executeTakeFirst()
        expect(row?.status).toBe('ai_off')
        expect(row?.content).toBeNull()
        expect(row?.published_at).toBeNull()

        const audit = await database.db
          .selectFrom('ai_disclosure_audit')
          .selectAll()
          .where('workspace_id', '=', workspaceId)
          .execute()
        expect(audit.map((entry) => entry.detail)).toEqual([{ status: 'ai_off' }])

        await database.db
          .deleteFrom('ai_disclosure_audit')
          .where('workspace_id', '=', workspaceId)
          .execute()
        await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
      } finally {
        await database.close()
      }
    }, 30_000)

    // A `ready` PM digest is a second model call on the same BYO key, so the cap has to see it or a
    // capped workspace keeps spending.
    it('counts a ready PM digest against the workspace spend total', async () => {
      const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
      try {
        await migrateToLatest(database.db)
        const { workspaceId, teamId, cycleId, issueId, adminId } = await seed(database)
        const { getWorkspaceAiSpendUsd } = await import('@yapm/schema/db')
        const before = await getWorkspaceAiSpendUsd(database.db, workspaceId)

        const gateway = createAiGateway({
          db: database.db,
          codec: null,
          env: { keys: { anthropic: 'sk-test' }, defaultProvider: 'anthropic' },
          modelFactory: mockGateway(READY(issueId)),
        })
        await runPmDigest(
          { gateway, db: database.db, dbProvider: createZeroDatabase(database.db) },
          { workspaceId, facts: factsFor(teamId, cycleId, issueId), subject: SUBJECT },
        )

        // The mock provider has no price table, so the run's own estimate is 0. Stamping a real cost
        // on the row it wrote is what actually exercises the union arm — which is the thing that would
        // be missing if `pm_digest` had been left out of the single spend accessor.
        await database.db
          .updateTable('pm_digest')
          .set({ estimated_cost_usd: 0.25 })
          .where('cycle_id', '=', cycleId)
          .execute()
        expect(await getWorkspaceAiSpendUsd(database.db, workspaceId)).toBeCloseTo(before + 0.25, 6)

        // And the policy write that an admin makes leaves its own record, without naming the audience.
        await setPmDisclosurePolicy(
          database.db,
          { userID: adminId, role: 'admin' },
          {
            configId: newId(),
            auditId: newId(),
            workspaceId,
            enabled: true,
            teams: { [teamId]: { pmVisible: true, audience: [adminId] } },
          },
        )
        const policy = await database.db
          .selectFrom('ai_disclosure_audit')
          .selectAll()
          .where('workspace_id', '=', workspaceId)
          .where('event', '=', 'policy_changed')
          .execute()
        expect(policy).toHaveLength(1)
        expect(JSON.stringify(policy[0]?.detail)).not.toContain(adminId)

        await database.db
          .deleteFrom('ai_disclosure_audit')
          .where('workspace_id', '=', workspaceId)
          .execute()
        await database.db
          .deleteFrom('connector_config')
          .where('workspace_id', '=', workspaceId)
          .execute()
        await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
      } finally {
        await database.close()
      }
    }, 30_000)
  },
)
