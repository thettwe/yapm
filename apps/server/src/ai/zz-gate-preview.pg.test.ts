// THROWAWAY. Not committed. Renders exactly what the retro-draft model receives, for two realistic
// cycles — one connectors-rich, one cycles-only — so SCOPE-ai-features.md §9 item 1 can be judged.
import { appendFileSync, writeFileSync } from 'node:fs'
import {
  newId,
  retroDraftContentSchema,
  SYSTEM_AUTH_CONTEXT,
  sanitizeRetroDraft,
} from '@yapm/schema'
import type { RetroFacts } from '@yapm/schema/db'
import { createDatabase, type Database, migrateToLatest, retroFactsForCycle } from '@yapm/schema/db'
import { describe, it } from 'vitest'
import { createAiGateway } from './gateway.js'
import { buildRetroDraftInput, RETRO_DRAFT_SYSTEM_PROMPT } from './retro-draft.js'

const DATABASE_URL = process.env.DATABASE_URL

const key = () => `G${Math.random().toString(36).slice(2, 8).toUpperCase()}`
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

interface Ctx {
  db: Database['db']
  workspaceId: string
  teamId: string
  installationId: string | null
}

async function base(database: Database, teamName: string, withConnector: boolean): Promise<Ctx> {
  const db = database.db
  const workspaceId = newId()
  const teamId = newId()
  await db
    .insertInto('workspace')
    .values({ id: workspaceId, name: `${teamName} WS` })
    .execute()
  await db
    .insertInto('team')
    .values({ id: teamId, workspace_id: workspaceId, name: teamName, key: key() })
    .execute()

  const users = ['Rae Ostrowski', 'Kai Oyelaran', 'Nadia Fournier', 'Tom Berg'].map((name) => ({
    id: newId(),
    name,
    email: `${name.split(' ')[0]?.toLowerCase()}-${newId()}@example.test`,
    emailVerified: true,
  }))
  await db.insertInto('user').values(users).execute()
  await db
    .insertInto('workspace_member')
    .values(
      users.map((u) => ({
        id: newId(),
        workspace_id: workspaceId,
        user_id: u.id,
        role: 'member' as const,
      })),
    )
    .execute()
  await db
    .insertInto('team_membership')
    .values(users.map((u) => ({ id: newId(), team_id: teamId, user_id: u.id })))
    .execute()

  let installationId: string | null = null
  if (withConnector) {
    const configId = newId()
    installationId = newId()
    await db
      .insertInto('connector_config')
      .values({ id: configId, workspace_id: workspaceId, provider: 'github' })
      .execute()
    await db
      .insertInto('connector_installation')
      .values({
        id: installationId,
        connector_config_id: configId,
        external_installation_id: `inst-${newId()}`,
      })
      .execute()
  }
  return { db, workspaceId, teamId, installationId }
}

async function cycle(
  ctx: Ctx,
  number: number,
  name: string,
  startDaysAgo: number,
  endDaysAgo: number,
): Promise<string> {
  const id = newId()
  await ctx.db
    .insertInto('cycle')
    .values({
      id,
      team_id: ctx.teamId,
      number,
      name,
      status: 'completed',
      start_date: daysAgo(startDaysAgo),
      end_date: daysAgo(endDaysAgo),
    })
    .execute()
  return id
}

let issueNo = 0
async function issue(
  ctx: Ctx,
  title: string,
  status: 'backlog' | 'canceled' | 'done' | 'in_progress' | 'in_review' | 'todo',
  cycleId: string | null,
  opts: { rolledOverFrom?: string; carryover?: number } = {},
): Promise<string> {
  const id = newId()
  issueNo += 1
  await ctx.db
    .insertInto('issue')
    .values({
      id,
      team_id: ctx.teamId,
      number: issueNo,
      title,
      status,
      priority: 'medium',
      creator_id: newId(),
      cycle_id: cycleId,
      rolled_over_from_cycle_id: opts.rolledOverFrom ?? null,
      carryover_count: opts.carryover ?? 0,
      cycle_assigned_at: cycleId ? daysAgo(13) : null,
    })
    .execute()
  return id
}

let prNo = 0
async function pr(
  ctx: Ctx,
  issueId: string,
  title: string,
  state: 'closed' | 'draft' | 'merged' | 'open',
  opts: {
    openedDaysAgo: number
    mergedDaysAgo?: number
    ci?: 'success' | 'failure'
    reviewDaysAgo?: number
  },
): Promise<void> {
  if (ctx.installationId === null) return
  const id = newId()
  prNo += 1
  await ctx.db
    .insertInto('pull_request')
    .values({
      id,
      team_id: ctx.teamId,
      installation_id: ctx.installationId,
      provider: 'github',
      repo: 'acme/storefront',
      number: prNo,
      external_id: `pr-${id}`,
      title,
      state,
      opened_at: daysAgo(opts.openedDaysAgo),
      merged_at: opts.mergedDaysAgo ? daysAgo(opts.mergedDaysAgo) : null,
    })
    .execute()
  await ctx.db
    .insertInto('issue_link')
    .values({ issue_id: issueId, pull_request_id: id, team_id: ctx.teamId, source: 'branch' })
    .execute()
  if (opts.ci) {
    await ctx.db
      .insertInto('ci_check')
      .values({
        id: newId(),
        team_id: ctx.teamId,
        pull_request_id: id,
        provider: 'github',
        external_id: `check-${id}`,
        conclusion: opts.ci,
      })
      .execute()
  }
  if (opts.reviewDaysAgo !== undefined) {
    await ctx.db
      .insertInto('review')
      .values({
        id: newId(),
        team_id: ctx.teamId,
        pull_request_id: id,
        provider: 'github',
        external_id: `rev-${id}`,
        author: 'octocat',
        state: 'approved',
        submitted_at: daysAgo(opts.reviewDaysAgo),
      })
      .execute()
  }
}

const OUT = '/tmp/gate-preview.md'
function render(label: string, input: string | null): void {
  appendFileSync(
    OUT,
    `\n${'='.repeat(78)}\n${label}\n${'='.repeat(78)}\n${input ?? '(retroFactsForCycle returned null)'}\n`,
  )
}

async function maybeDraft(
  database: Database,
  workspaceId: string,
  facts: RetroFacts,
  label: string,
): Promise<void> {
  const provider = process.env.AI_DEFAULT_PROVIDER
  const keys: Record<string, string> = {}
  if (process.env.AI_ANTHROPIC_API_KEY) keys.anthropic = process.env.AI_ANTHROPIC_API_KEY
  if (process.env.AI_GOOGLE_API_KEY) keys.google = process.env.AI_GOOGLE_API_KEY
  if (process.env.AI_OPENAI_API_KEY) keys.openai = process.env.AI_OPENAI_API_KEY
  if (!provider || Object.keys(keys).length === 0) {
    appendFileSync(OUT, `\n--- ${label}: NO KEY SET, model not called ---\n`)
    return
  }
  const gateway = createAiGateway({
    db: database.db,
    codec: null,
    env: { keys, defaultProvider: provider } as never,
  })
  const result = await gateway.generateStructured(workspaceId, SYSTEM_AUTH_CONTEXT, {
    system: RETRO_DRAFT_SYSTEM_PROMPT,
    input: buildRetroDraftInput(facts),
    schema: retroDraftContentSchema,
  })
  if (result === null) {
    appendFileSync(OUT, `\n--- ${label}: gateway returned null (AI off / key not resolved) ---\n`)
    return
  }
  const roster = await database.db
    .selectFrom('workspace_member')
    .innerJoin('user', 'user.id', 'workspace_member.user_id')
    .select(['user.name as name', 'user.email as email'])
    .where('workspace_member.workspace_id', '=', workspaceId)
    .execute()
  const content = sanitizeRetroDraft(
    result.object,
    facts.citations,
    roster as never,
    facts.priorRetro,
  )
  appendFileSync(
    OUT,
    `\n${'*'.repeat(78)}\nREAL DRAFT — ${label}\n` +
      `model: ${result.provider}/${result.modelId}   est cost: $${result.estimatedCostUsd ?? '?'}\n` +
      `${'*'.repeat(78)}\n${JSON.stringify(content, null, 2)}\n`,
  )
}

describe.skipIf(DATABASE_URL === undefined)('§9 item 1 — the model input, rendered', () => {
  it('renders both scenarios', async () => {
    const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)

    writeFileSync(
      OUT,
      `${'#'.repeat(78)}\n# SYSTEM PROMPT (identical for both)\n${'#'.repeat(78)}\n${RETRO_DRAFT_SYSTEM_PROMPT}\n`,
    )

    // ── A. CONNECTORS-RICH ────────────────────────────────────────────────
    const a = await base(database, 'Storefront', true)
    for (const [i, n] of [42, 28, 14].entries()) {
      const c = await cycle(a, i + 1, `Cycle ${i + 1}`, n + 14, n)
      await issue(a, `Prior work ${i + 1}a`, 'done', c)
      await issue(a, `Prior work ${i + 1}b`, 'done', c)
      if (i === 2) await issue(a, `Prior work ${i + 1}c`, 'done', c)
    }
    const ac = await cycle(a, 4, 'Cycle 4', 14, 0)
    const i1 = await issue(a, 'Guest checkout without an account', 'done', ac)
    const i2 = await issue(a, 'Persist the cart across sessions', 'done', ac)
    const i3 = await issue(a, 'Address autocomplete on the shipping step', 'done', ac)
    const i4 = await issue(a, 'Apple Pay in the payment sheet', 'done', ac)
    const i5 = await issue(a, 'Reduce checkout bundle size', 'in_progress', null, {
      rolledOverFrom: ac,
      carryover: 2,
    })
    await issue(a, 'Refund flow for partial orders', 'in_progress', null, {
      rolledOverFrom: ac,
      carryover: 1,
    })
    await issue(a, 'Legacy coupon migration', 'canceled', ac)
    await pr(a, i1, 'feat(checkout): guest checkout', 'merged', {
      openedDaysAgo: 12,
      mergedDaysAgo: 11,
      ci: 'success',
      reviewDaysAgo: 11.5 as unknown as number,
    })
    await pr(a, i2, 'feat(cart): persist across sessions', 'merged', {
      openedDaysAgo: 11,
      mergedDaysAgo: 6,
      ci: 'failure',
      reviewDaysAgo: 8,
    })
    await pr(a, i3, 'feat(shipping): address autocomplete', 'merged', {
      openedDaysAgo: 9,
      mergedDaysAgo: 8,
      ci: 'success',
      reviewDaysAgo: 8.5 as unknown as number,
    })
    await pr(a, i4, 'feat(payments): Apple Pay', 'merged', {
      openedDaysAgo: 7,
      mergedDaysAgo: 2,
      ci: 'failure',
      reviewDaysAgo: 3,
    })
    await pr(a, i5, 'perf(checkout): split the bundle', 'open', {
      openedDaysAgo: 5,
      ci: 'failure',
    })
    const factsA = await retroFactsForCycle(database.db, a.teamId, ac)
    if (factsA === null) throw new Error('scenario A produced no facts')
    render('A. CONNECTORS-RICH', buildRetroDraftInput(factsA))
    await maybeDraft(database, a.workspaceId, factsA, 'A. CONNECTORS-RICH')

    // ── B. CYCLES-ONLY ────────────────────────────────────────────────────
    const b = await base(database, 'Platform', false)
    for (const [i, n] of [28, 14].entries()) {
      const c = await cycle(b, i + 1, `Cycle ${i + 1}`, n + 14, n)
      await issue(b, `Prior platform work ${i + 1}`, 'done', c)
      await issue(b, `Prior platform work ${i + 1}b`, 'done', c)
    }
    const bc = await cycle(b, 3, 'Cycle 3', 14, 0)
    await issue(b, 'Rotate the signing keys', 'done', bc)
    await issue(b, 'Upgrade the job runner', 'done', bc)
    await issue(b, 'Split the deploy pipeline', 'done', bc)
    await issue(b, 'Backfill the audit index', 'in_progress', null, {
      rolledOverFrom: bc,
      carryover: 3,
    })
    await issue(b, 'Retire the legacy cron', 'in_progress', null, {
      rolledOverFrom: bc,
      carryover: 1,
    })
    const factsB = await retroFactsForCycle(database.db, b.teamId, bc)
    if (factsB === null) throw new Error('scenario B produced no facts')
    render('B. CYCLES-ONLY (no connector)', buildRetroDraftInput(factsB))
    await maybeDraft(database, b.workspaceId, factsB, 'B. CYCLES-ONLY (no connector)')
  }, 120_000)
})
