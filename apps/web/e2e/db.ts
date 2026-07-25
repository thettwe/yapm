import { type DigestContent, newId } from '@yapm/schema'
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
