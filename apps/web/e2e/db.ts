import {
  type DigestContent,
  newId,
  type RetroSeedRef,
  type StoredPmDigestContent,
} from '@yapm/schema'
import {
  createDatabase,
  type Database,
  upsertConnectorConfig,
  upsertConnectorInstallation,
} from '@yapm/schema/db'

// A direct-to-Postgres seeder for the work-graph tables. The connector is disabled in e2e (no
// GitHub App env), so there is no ingest path — but the five work-graph tables ARE Zero-synced,
// so rows inserted here replicate to the signed-in admin's client and light up the reality
// strip exactly as a real ingest would. Zero maps the `timestamptz` columns to epoch-ms numbers
// on the client, so plain Date values are correct. The server-only connector tables are seeded
// through their admin accessors to satisfy the pull_request → connector_installation FK.
const SEED_ADMIN = { userID: 'e2e-seed', role: 'admin' as const }

export function openDb(): Database {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required to seed work-graph rows')
  return createDatabase({ connectionString })
}

export async function workspaceId(db: Database): Promise<string> {
  const row = await db.db
    .selectFrom('workspace')
    .select('id')
    .orderBy('created_at')
    .executeTakeFirstOrThrow()
  return row.id
}

// Find the issue the admin just created by title (its team-scoped id + team_id + number).
export async function findIssue(
  db: Database,
  title: string,
): Promise<{ id: string; teamId: string; number: number | null }> {
  const row = await db.db
    .selectFrom('issue')
    .select(['id', 'team_id', 'number'])
    .where('title', '=', title)
    .executeTakeFirstOrThrow()
  return { id: row.id, teamId: row.team_id, number: row.number }
}

export interface SeedLinkedPrOptions {
  teamId: string
  issueId: string
  repo?: string
  prNumber?: number
  prState?: 'draft' | 'open' | 'merged' | 'closed'
  ciConclusion?: 'success' | 'failure' | 'pending'
}

// Seed a connector installation plus a pull request linked to the issue, with one CI check.
// Returns the pull_request id so a follow-up can advance its state.
export async function seedLinkedPr(
  db: Database,
  options: SeedLinkedPrOptions,
): Promise<{ pullRequestId: string; installationId: string }> {
  const wsId = await workspaceId(db)
  const config = await upsertConnectorConfig(db.db, SEED_ADMIN, {
    id: newId(),
    workspaceId: wsId,
    provider: 'github',
    enabled: true,
  })
  const installation = await upsertConnectorInstallation(db.db, {
    id: newId(),
    configId: config.id,
    externalInstallationId: `e2e-${Date.now()}`,
    accountLogin: 'acme',
  })

  const pullRequestId = newId()
  const now = new Date()
  const openedAt = new Date(now.getTime() - 3_600_000)
  const state = options.prState ?? 'merged'
  const repo = options.repo ?? 'acme/app'
  await db.db
    .insertInto('pull_request')
    .values({
      id: pullRequestId,
      team_id: options.teamId,
      installation_id: installation.id,
      provider: 'github',
      repo,
      number: options.prNumber ?? 7,
      external_id: `pr-${pullRequestId}`,
      title: 'Fix the reconnect path',
      state,
      url: `https://github.com/${repo}/pull/${options.prNumber ?? 7}`,
      head_sha: 'deadbeef',
      opened_at: openedAt,
      merged_at: state === 'merged' ? now : null,
    })
    .execute()

  await db.db
    .insertInto('ci_check')
    .values({
      id: newId(),
      team_id: options.teamId,
      pull_request_id: pullRequestId,
      provider: 'github',
      external_id: `check-${pullRequestId}`,
      name: 'build',
      conclusion: options.ciConclusion ?? 'failure',
      head_sha: 'deadbeef',
    })
    .execute()

  await db.db
    .insertInto('issue_link')
    .values({
      issue_id: options.issueId,
      pull_request_id: pullRequestId,
      team_id: options.teamId,
      source: 'body',
    })
    .execute()

  return { pullRequestId, installationId: installation.id }
}

// Find the cycle the admin just created by name (its id + team_id).
export async function findCycle(
  db: Database,
  name: string,
): Promise<{ id: string; teamId: string }> {
  const row = await db.db
    .selectFrom('cycle')
    .select(['id', 'team_id'])
    .where('name', '=', name)
    .executeTakeFirstOrThrow()
  return { id: row.id, teamId: row.team_id }
}

export interface SeedCycleDigestOptions {
  teamId: string
  cycleId: string
  status?: 'ready' | 'ai_off' | 'failed' | 'pending'
  content?: DigestContent | null
  provider?: string | null
  model?: string | null
  estimatedCostUsd?: number | null
}

// Seed a `cycle_digest` row directly. The row is Zero-synced, so it replicates to the signed-in
// member's client and renders on the cycle view exactly as the server-side pre-compute job's output
// would — mirroring how the work-graph rows are seeded (the job path itself is covered by the
// server integration tests, which run the pre-compute with the SDK mock provider).
export async function seedCycleDigest(
  db: Database,
  options: SeedCycleDigestOptions,
): Promise<void> {
  const now = new Date()
  const status = options.status ?? 'ready'
  const content = options.content ?? null
  await db.db
    .insertInto('cycle_digest')
    .values({
      id: newId(),
      team_id: options.teamId,
      cycle_id: options.cycleId,
      status,
      content: (content === null ? null : JSON.stringify(content)) as never,
      provider: options.provider ?? null,
      model: options.model ?? null,
      generated_at: status === 'ready' ? now : null,
      input_token: null,
      output_token: null,
      estimated_cost_usd: options.estimatedCostUsd ?? null,
      created_at: now,
      updated_at: now,
    })
    .execute()
}

// The AI retro artifact, read straight from Postgres. The row is written by the phase-advance
// mutator and completed by the background tail, so a spec that wants to see the resolved state has
// to read the source of truth rather than the DOM — the whole point of the `ai_off` case is that the
// DOM shows nothing either way.
export async function readRetroAiDraft(
  db: Database,
  retroId: string,
): Promise<{ status: string; proposals: number } | null> {
  const draft = await db.db
    .selectFrom('retro_ai_draft')
    .select(['id', 'status'])
    .where('retro_id', '=', retroId)
    .executeTakeFirst()
  if (draft === undefined) return null
  const proposals = await db.db
    .selectFrom('retro_ai_proposal')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('retro_id', '=', retroId)
    .executeTakeFirstOrThrow()
  return { status: draft.status, proposals: Number(proposals.count) }
}

export interface SeedRetroAiProposal {
  category: 'win' | 'loss' | 'improvement' | 'follow_up'
  summary: string
  confidence?: 'high' | 'medium' | 'low'
  // Evidence the CLIENT can name from its own rows: a work-graph id or a computed seed metric key.
  // A ref the client cannot resolve renders no chip at all, which is the point of citing real ones.
  refs?: readonly RetroSeedRef[]
}

export interface SeedRetroAiDraftOptions {
  retroId: string
  teamId: string
  status?: 'ready' | 'ai_off' | 'failed' | 'pending'
  proposals?: readonly SeedRetroAiProposal[]
}

// Seed the AI retro artifact directly, mirroring `seedCycleDigest`: both rows are Zero-synced, so
// they replicate to the signed-in member's client and render exactly as the background tail's output
// would. The tail itself needs a provider key and is covered headless by
// `apps/server/src/ai/retro-draft.pg.test.ts`; what only a browser can prove is the section on screen.
//
// The team's opt-in is stamped with the draft, because a draft can only exist for a team that
// consented — the surface is gated on that column and a seeded row without it would render nothing.
export async function seedRetroAiDraft(
  db: Database,
  options: SeedRetroAiDraftOptions,
): Promise<string> {
  const id = newId()
  const now = new Date()
  const status = options.status ?? 'ready'
  await db.db
    .updateTable('team')
    .set({ ai_retro_draft_since: now })
    .where('id', '=', options.teamId)
    .where('ai_retro_draft_since', 'is', null)
    .execute()

  await db.db
    .insertInto('retro_ai_draft')
    .values({
      id,
      retro_id: options.retroId,
      team_id: options.teamId,
      status,
      provider: status === 'ready' ? 'anthropic' : null,
      model: status === 'ready' ? 'mock-model-1' : null,
      estimated_cost_usd: status === 'ready' ? 0.01 : null,
      generated_at: status === 'ready' ? now : null,
      created_at: now,
      updated_at: now,
    })
    .execute()

  const proposals = options.proposals ?? []
  for (const [rank, proposal] of proposals.entries()) {
    await db.db
      .insertInto('retro_ai_proposal')
      .values({
        id: newId(),
        draft_id: id,
        retro_id: options.retroId,
        team_id: options.teamId,
        category: proposal.category,
        summary: proposal.summary,
        confidence: proposal.confidence ?? 'high',
        refs: JSON.stringify(proposal.refs ?? []) as never,
        rank,
        created_at: now,
      })
      .execute()
  }
  return id
}

export interface SeedPmDigestOptions {
  teamId: string
  cycleId: string
  status?: 'ready' | 'ai_off' | 'failed' | 'pending'
  content?: StoredPmDigestContent | null
  model?: string | null
}

// The PM disclosure artifact, seeded UNPUBLISHED — which is the only state generation can produce.
// The row is written the way `runPmDigest` writes it (`ready`, `published_at` null, the subject line
// and every evidence label already baked in by yapm), because the model call needs a provider key no
// e2e has and everything the browser has to prove happens downstream of the row: the gate that keeps
// it inside the team, the human release, and the reader who then reads it.
//
// `published_at` is deliberately not settable here. Publication is the permission event this change
// exists to gate, so the spec has to go through the shipped mutator to cause one.
export async function seedPmDigest(db: Database, options: SeedPmDigestOptions): Promise<string> {
  const id = newId()
  const now = new Date()
  const status = options.status ?? 'ready'
  await db.db
    .insertInto('pm_digest')
    .values({
      id,
      team_id: options.teamId,
      cycle_id: options.cycleId,
      status,
      content: (options.content == null ? null : JSON.stringify(options.content)) as never,
      provider: status === 'ready' ? 'anthropic' : null,
      model: status === 'ready' ? (options.model ?? 'mock-model-1') : null,
      input_token: null,
      output_token: null,
      estimated_cost_usd: status === 'ready' ? 0.02 : null,
      generated_at: status === 'ready' ? now : null,
      published_at: null,
      published_by: null,
      audience_size_at_publish: null,
      created_at: now,
      updated_at: now,
    })
    .execute()
  return id
}

export async function findPmDigest(
  db: Database,
  id: string,
): Promise<{ publishedAt: Date | null; publishedBy: string | null; audienceSize: number | null }> {
  const row = await db.db
    .selectFrom('pm_digest')
    .select(['published_at', 'published_by', 'audience_size_at_publish'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
  return {
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    audienceSize: row.audience_size_at_publish,
  }
}

// The disclosure record, read from Postgres because it is readable from nowhere else: the table is
// excluded from the Zero schema, so no query in the product can name it and no client holds a row.
export async function readDisclosureAudit(
  db: Database,
  pmDigestId: string,
): Promise<{ event: string; actorId: string | null; detail: unknown }[]> {
  const rows = await db.db
    .selectFrom('ai_disclosure_audit')
    .select(['event', 'actor_id', 'detail'])
    .where('pm_digest_id', '=', pmDigestId)
    .orderBy('created_at', 'asc')
    .execute()
  return rows.map((row) => ({ event: row.event, actorId: row.actor_id, detail: row.detail }))
}

export async function countPolicyAudit(db: Database): Promise<number> {
  const row = await db.db
    .selectFrom('ai_disclosure_audit')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('event', '=', 'policy_changed')
    .executeTakeFirstOrThrow()
  return Number(row.count)
}

// Every action born from one AI proposal, read straight from Postgres. The list on screen shows the
// body and nothing else, and the two claims worth proving about this path are columns no surface
// renders: that the proposal is recorded as the action's origin, and that NO owner was filled in —
// not by the panel's control and not by the palette's.
export async function readRetroActionsForProposal(
  db: Database,
  retroId: string,
  summary: string,
): Promise<{
  proposalId: string
  actions: { body: string; assigneeId: string | null }[]
}> {
  const proposal = await db.db
    .selectFrom('retro_ai_proposal')
    .select('id')
    .where('retro_id', '=', retroId)
    .where('summary', '=', summary)
    .executeTakeFirstOrThrow()
  const actions = await db.db
    .selectFrom('retro_action')
    .select(['body', 'assignee_id'])
    .where('retro_id', '=', retroId)
    .where('ai_proposal_id', '=', proposal.id)
    .execute()
  return {
    proposalId: proposal.id,
    actions: actions.map((row) => ({ body: row.body, assigneeId: row.assignee_id })),
  }
}

// A TipTap document holding one paragraph, which is the shape both `issue.description` and
// `comment.body` carry on the wire.
function richTextDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

// The attachment upload names its team by id, and the id never appears in the UI — the team is
// created through the real dialog and read back here by the name the test gave it.
export async function findTeamId(db: Database, name: string): Promise<string> {
  const row = await db.db
    .selectFrom('team')
    .select('id')
    .where('name', '=', name)
    .executeTakeFirstOrThrow()
  return row.id
}

export async function findUserId(db: Database, email: string): Promise<string> {
  const row = await db.db
    .selectFrom('user')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow()
  return row.id
}

export interface SeedSsoProviderOptions {
  providerId: string
  domain: string
  userId: string
}

// `ssoProvider` is better-auth's own table, created by its migrations at boot and deliberately
// absent from the sync schema. Seeded straight to Postgres because REGISTERING one performs OIDC
// discovery against a real issuer, and the e2e harness has no identity provider to discover — this
// is the only way the settings surface can be exercised in the state that matters, a provider whose
// domain is not yet proven.
//
// ALWAYS UNVERIFIED. A verified row would make `/api/auth-methods` report SSO available and put a
// "Continue with SSO" button on the login form for every other spec sharing this database.
export async function seedSsoProvider(
  db: Database,
  options: SeedSsoProviderOptions,
): Promise<void> {
  await db.db
    .insertInto('ssoProvider')
    .values({
      id: newId(),
      issuer: 'https://idp.example.test',
      providerId: options.providerId,
      domain: options.domain,
      userId: options.userId,
      domainVerified: false,
      oidcConfig: JSON.stringify({
        issuer: 'https://idp.example.test',
        clientId: 'e2e-client-id-4321',
        clientSecret: 'e2e-placeholder-not-a-real-secret',
        discoveryEndpoint: 'https://idp.example.test/.well-known/openid-configuration',
      }),
      samlConfig: null,
      organizationId: null,
    })
    .execute()
}

export async function deleteSsoProvider(db: Database, providerId: string): Promise<void> {
  await db.db.deleteFrom('ssoProvider').where('providerId', '=', providerId).execute()
}

// Write a description straight to Postgres. It replicates to the signed-in client through the same
// path a typed description takes, and the search change needs one that reached the replica WITHOUT
// the client having rendered the editor — the on-device pass reads the synced row, not the DOM.
export async function setIssueDescription(
  db: Database,
  issueId: string,
  text: string,
): Promise<void> {
  await db.db
    .updateTable('issue')
    .set({ description: richTextDoc(text) as never, updated_at: new Date() })
    .where('id', '=', issueId)
    .execute()
}

// Comments sync ONLY for the issue the caller has open (`queries.ts`), so a comment seeded on an
// issue nobody has opened is reachable from the server pass and from nowhere else. That is exactly
// what the "complete" half of search has to find.
export async function seedComment(
  db: Database,
  options: { teamId: string; issueId: string; authorId: string; body: string },
): Promise<string> {
  const id = newId()
  await db.db
    .insertInto('comment')
    .values({
      id,
      issue_id: options.issueId,
      team_id: options.teamId,
      author_id: options.authorId,
      body: richTextDoc(options.body) as never,
    })
    .execute()
  return id
}
