import { type Kysely, sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tableShapes } from '../zero/introspect.js'
import { createDatabase } from './client.js'
import { migrateToLatest } from './migrate.js'
import type { DB } from './types.js'

// The Kysely `DB` interface and the Zero schema are both hand-written (kysely-codegen
// emits uncompilable output under TS7), so only this test forces them to agree with
// Postgres.
const KYSELY_DB: Record<string, Record<string, { nullable: boolean; hasDefault: boolean }>> = {
  workspace: {
    id: { nullable: false, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  workspace_member: {
    id: { nullable: false, hasDefault: false },
    workspace_id: { nullable: false, hasDefault: false },
    user_id: { nullable: false, hasDefault: false },
    role: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  team: {
    id: { nullable: false, hasDefault: false },
    workspace_id: { nullable: false, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    key: { nullable: false, hasDefault: false },
    archived_at: { nullable: true, hasDefault: false },
    auto_status_since: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  team_membership: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    user_id: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
  },
  invite: {
    id: { nullable: false, hasDefault: false },
    workspace_id: { nullable: false, hasDefault: false },
    team_id: { nullable: true, hasDefault: false },
    email: { nullable: true, hasDefault: false },
    role: { nullable: false, hasDefault: false },
    token: { nullable: false, hasDefault: false },
    created_by: { nullable: false, hasDefault: false },
    expires_at: { nullable: false, hasDefault: false },
    revoked_at: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
  },
  user_preference: {
    id: { nullable: false, hasDefault: false },
    user_id: { nullable: false, hasDefault: false },
    theme: { nullable: false, hasDefault: true },
    accent: { nullable: true, hasDefault: false },
    email_notifications: { nullable: false, hasDefault: true },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  issue: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    number: { nullable: true, hasDefault: false },
    title: { nullable: false, hasDefault: false },
    description: { nullable: true, hasDefault: false },
    status: { nullable: false, hasDefault: false },
    priority: { nullable: false, hasDefault: false },
    assignee_id: { nullable: true, hasDefault: false },
    creator_id: { nullable: false, hasDefault: false },
    rank: { nullable: true, hasDefault: false },
    cycle_id: { nullable: true, hasDefault: false },
    rolled_over_from_cycle_id: { nullable: true, hasDefault: false },
    project_id: { nullable: true, hasDefault: false },
    needs_triage: { nullable: false, hasDefault: true },
    carryover_count: { nullable: false, hasDefault: true },
    cycle_assigned_at: { nullable: true, hasDefault: false },
    last_human_status_at: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  cycle: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    number: { nullable: true, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    status: { nullable: false, hasDefault: false },
    start_date: { nullable: false, hasDefault: false },
    end_date: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  project: {
    id: { nullable: false, hasDefault: false },
    workspace_id: { nullable: false, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    lead_id: { nullable: true, hasDefault: false },
    status: { nullable: false, hasDefault: false },
    target_date: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  label: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    color: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  issue_label: {
    issue_id: { nullable: false, hasDefault: false },
    label_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
  },
  comment: {
    id: { nullable: false, hasDefault: false },
    issue_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    author_id: { nullable: false, hasDefault: false },
    body: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  saved_view: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    filter: { nullable: false, hasDefault: false },
    grouping: { nullable: false, hasDefault: false },
    sort: { nullable: false, hasDefault: false },
    created_by: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  // Server-only per-team counter: present in the Kysely DB interface and migrations, and
  // deliberately absent from the Zero schema (asserted below) so its churn never syncs.
  issue_sequence: {
    team_id: { nullable: false, hasDefault: false },
    next_number: { nullable: false, hasDefault: true },
  },
  // Server-only per-team cycle counter, mirroring issue_sequence: in the Kysely DB interface
  // and migrations, absent from the Zero schema (asserted below) so its churn never syncs.
  cycle_sequence: {
    team_id: { nullable: false, hasDefault: false },
    next_number: { nullable: false, hasDefault: true },
  },
  // Server-only connector surface: present in the Kysely DB interface and migrations,
  // deliberately absent from the Zero schema (asserted below) so config/secrets/installation
  // rows — especially the encrypted secret blobs — never replicate to a client.
  connector_config: {
    id: { nullable: false, hasDefault: false },
    workspace_id: { nullable: false, hasDefault: false },
    provider: { nullable: false, hasDefault: false },
    enabled: { nullable: false, hasDefault: true },
    config: { nullable: false, hasDefault: true },
    status: { nullable: false, hasDefault: true },
    last_synced_at: { nullable: true, hasDefault: false },
    last_error: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  connector_secret: {
    id: { nullable: false, hasDefault: false },
    connector_config_id: { nullable: false, hasDefault: false },
    key: { nullable: false, hasDefault: false },
    ciphertext: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  connector_installation: {
    id: { nullable: false, hasDefault: false },
    connector_config_id: { nullable: false, hasDefault: false },
    external_installation_id: { nullable: false, hasDefault: false },
    account_login: { nullable: true, hasDefault: false },
    repo_mapping: { nullable: false, hasDefault: true },
    etags: { nullable: false, hasDefault: true },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  // Team-scoped, Zero-synced work-graph entities (change 8, part B): present in BOTH the
  // Kysely DB interface and the Zero schema, so they must match Postgres on both axes.
  pull_request: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    installation_id: { nullable: false, hasDefault: false },
    provider: { nullable: false, hasDefault: false },
    repo: { nullable: false, hasDefault: false },
    number: { nullable: false, hasDefault: false },
    external_id: { nullable: false, hasDefault: false },
    title: { nullable: true, hasDefault: false },
    state: { nullable: false, hasDefault: false },
    url: { nullable: true, hasDefault: false },
    head_sha: { nullable: true, hasDefault: false },
    opened_at: { nullable: false, hasDefault: false },
    merged_at: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  ci_check: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    pull_request_id: { nullable: false, hasDefault: false },
    provider: { nullable: false, hasDefault: false },
    external_id: { nullable: false, hasDefault: false },
    name: { nullable: true, hasDefault: false },
    conclusion: { nullable: false, hasDefault: false },
    head_sha: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  review: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    pull_request_id: { nullable: false, hasDefault: false },
    provider: { nullable: false, hasDefault: false },
    external_id: { nullable: false, hasDefault: false },
    author: { nullable: true, hasDefault: false },
    state: { nullable: false, hasDefault: false },
    submitted_at: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  deployment: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    installation_id: { nullable: false, hasDefault: false },
    provider: { nullable: false, hasDefault: false },
    repo: { nullable: false, hasDefault: false },
    external_id: { nullable: false, hasDefault: false },
    ref: { nullable: true, hasDefault: false },
    environment: { nullable: true, hasDefault: false },
    state: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  issue_link: {
    issue_id: { nullable: false, hasDefault: false },
    pull_request_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    source: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
  },
  // Team-scoped, Zero-synced cycle-digest artifact (change 9): present in BOTH the Kysely DB
  // interface and the Zero schema. `status` is DB-defaulted ('pending'); `content` and the
  // model/token/cost columns are nullable (null until ready / when AI is off).
  cycle_digest: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    cycle_id: { nullable: false, hasDefault: false },
    status: { nullable: false, hasDefault: true },
    content: { nullable: true, hasDefault: false },
    provider: { nullable: true, hasDefault: false },
    model: { nullable: true, hasDefault: false },
    generated_at: { nullable: true, hasDefault: false },
    input_token: { nullable: true, hasDefault: false },
    output_token: { nullable: true, hasDefault: false },
    estimated_cost_usd: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  // The retro's nine team-scoped, Zero-synced tables: present in BOTH the Kysely DB interface and the
  // Zero schema, so they must match Postgres on both axes.
  retro: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    cycle_id: { nullable: true, hasDefault: false },
    next_cycle_id: { nullable: true, hasDefault: false },
    title: { nullable: false, hasDefault: false },
    format: { nullable: false, hasDefault: false },
    phase: { nullable: false, hasDefault: true },
    facilitator_id: { nullable: true, hasDefault: false },
    is_anonymous: { nullable: false, hasDefault: true },
    votes_per_participant: { nullable: false, hasDefault: true },
    timer_ends_at: { nullable: true, hasDefault: false },
    timer_duration_s: { nullable: true, hasDefault: false },
    created_by: { nullable: false, hasDefault: false },
    closed_at: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  retro_column: {
    id: { nullable: false, hasDefault: false },
    retro_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    key: { nullable: false, hasDefault: false },
    title: { nullable: false, hasDefault: false },
    accent_token: { nullable: false, hasDefault: false },
    rank: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  retro_draft: {
    id: { nullable: false, hasDefault: false },
    retro_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    column_id: { nullable: false, hasDefault: false },
    author_id: { nullable: false, hasDefault: false },
    body: { nullable: false, hasDefault: false },
    rank: { nullable: false, hasDefault: false },
    seed_ref: { nullable: true, hasDefault: false },
    published_at: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  retro_card: {
    id: { nullable: false, hasDefault: false },
    retro_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    column_id: { nullable: false, hasDefault: false },
    group_id: { nullable: true, hasDefault: false },
    body: { nullable: false, hasDefault: false },
    rank: { nullable: false, hasDefault: false },
    is_anonymous: { nullable: false, hasDefault: true },
    author_display_id: { nullable: true, hasDefault: false },
    seed_ref: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  retro_group: {
    id: { nullable: false, hasDefault: false },
    retro_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    column_id: { nullable: false, hasDefault: false },
    label: { nullable: true, hasDefault: false },
    rank: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  retro_vote: {
    id: { nullable: false, hasDefault: false },
    retro_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    target_type: { nullable: false, hasDefault: false },
    target_id: { nullable: false, hasDefault: false },
    voter_id: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
  },
  retro_vote_tally: {
    target_id: { nullable: false, hasDefault: false },
    retro_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    target_type: { nullable: false, hasDefault: false },
    count: { nullable: false, hasDefault: true },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  retro_action: {
    id: { nullable: false, hasDefault: false },
    retro_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    group_id: { nullable: true, hasDefault: false },
    card_id: { nullable: true, hasDefault: false },
    body: { nullable: false, hasDefault: false },
    assignee_id: { nullable: true, hasDefault: false },
    target_cycle_id: { nullable: true, hasDefault: false },
    issue_id: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  retro_presence: {
    retro_id: { nullable: false, hasDefault: false },
    user_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    focus_target: { nullable: true, hasDefault: false },
    last_seen_at: { nullable: false, hasDefault: true },
  },
  // THE ANONYMITY BOUNDARY. Server-only: in the Kysely DB interface and the migrations, and
  // deliberately absent from the Zero schema (asserted below), so an anonymous card's author is
  // unreachable by any synced query rather than merely unselected.
  retro_card_author: {
    card_id: { nullable: false, hasDefault: false },
    retro_id: { nullable: false, hasDefault: false },
    author_id: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
  },
  // better-auth owns this table; the drift test provisions it (see `createAuthUserTable`)
  // so the read-surface interface and Zero schema are still checked against its real shape
  // (reference/kysely-stack.md §5.4).
  notification: {
    recipient_id: { nullable: false, hasDefault: false },
    actor_id: { nullable: false, hasDefault: false },
    kind: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    subject_type: { nullable: false, hasDefault: false },
    subject_id: { nullable: false, hasDefault: false },
    subject_key: { nullable: true, hasDefault: false },
    subject_title: { nullable: false, hasDefault: false },
    event_key: { nullable: false, hasDefault: false },
    read_at: { nullable: true, hasDefault: false },
    email_sent_at: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
  },
  // The durable standing intent behind auto-subscribe: in BOTH the Kysely DB interface and the Zero
  // schema, so it is checked on both axes. `state`, `created_at` and `updated_at` are DB-defaulted.
  issue_subscription: {
    issue_id: { nullable: false, hasDefault: false },
    user_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    state: { nullable: false, hasDefault: true },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  // SERVER-ONLY, and the second table whose absence from the Zero schema is a guarantee rather
  // than an optimisation: it holds the plaintext of every indexed description and comment. Its
  // text columns are plain `text` — the weighted tsvector lives only inside the GIN index
  // expression — so nothing exotic reaches the replication path.
  search_document: {
    entity_type: { nullable: false, hasDefault: false },
    entity_id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    issue_id: { nullable: false, hasDefault: false },
    comment_id: { nullable: true, hasDefault: false },
    title: { nullable: false, hasDefault: true },
    body: { nullable: false, hasDefault: true },
    source_updated_at: { nullable: false, hasDefault: false },
    indexed_at: { nullable: false, hasDefault: true },
  },
  // Uploaded-file metadata. `issue_id`/`comment_id` are NULLABLE with no default because both are
  // `on delete set null` — a deleted comment orphans its files rather than cascading — and because
  // an image pasted into a not-yet-created issue has no edge for a while. `team_id` is the
  // permission anchor and is therefore the one edge that is never null.
  attachment: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    issue_id: { nullable: true, hasDefault: false },
    comment_id: { nullable: true, hasDefault: false },
    uploader_id: { nullable: false, hasDefault: false },
    filename: { nullable: false, hasDefault: false },
    content_type: { nullable: false, hasDefault: false },
    byte_size: { nullable: false, hasDefault: false },
    has_thumbnail: { nullable: false, hasDefault: true },
    created_at: { nullable: false, hasDefault: true },
  },
  user: {
    id: { nullable: false, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    email: { nullable: false, hasDefault: false },
    emailVerified: { nullable: false, hasDefault: false },
    image: { nullable: true, hasDefault: false },
    createdAt: { nullable: false, hasDefault: true },
    updatedAt: { nullable: false, hasDefault: true },
  },
}

// The `user` table is created at boot by better-auth's `getMigrations()`, not by our
// Kysely migrations. reference/kysely-stack.md §5.4 has the verified DDL it emits; we
// reproduce it here so the drift test can assert our read surface matches it without
// pulling in the server's better-auth config (packages never import apps).
async function createAuthUserTable(db: Kysely<DB>): Promise<void> {
  await sql`
    create table if not exists "user" (
      "id" text not null primary key,
      "name" text not null,
      "email" text not null unique,
      "emailVerified" boolean not null,
      "image" text,
      "createdAt" timestamptz default current_timestamp not null,
      "updatedAt" timestamptz default current_timestamp not null
    )
  `.execute(db)
}

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the schema drift test must not be skipped')
}

interface PrimaryKeyRow {
  table_name: string
  columns: string[]
}

interface CheckConstraintRow {
  definition: string
}

async function checkConstraints(db: Kysely<DB>, table: string): Promise<string[]> {
  const { rows } = await sql<CheckConstraintRow>`
    select pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'c' and n.nspname = 'public' and t.relname = ${table}
  `.execute(db)

  return rows.map((row) => row.definition)
}

async function primaryKeys(db: Kysely<DB>): Promise<Map<string, string[]>> {
  const { rows } = await sql<PrimaryKeyRow>`
    select c.relname as table_name,
           array_agg(a.attname::text order by k.ord) as columns
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    where i.indisprimary and n.nspname = 'public'
    group by c.relname
  `.execute(db)

  return new Map(rows.map((row) => [row.table_name, row.columns]))
}

describe('server-only tables are excluded from the Zero schema', () => {
  it('appear in the Kysely DB map but never in the Zero introspection', () => {
    const zeroTables = tableShapes().map((table) => table.serverName)
    for (const name of [
      'issue_sequence',
      'cycle_sequence',
      'connector_config',
      'connector_secret',
      'connector_installation',
      // The crux of the retro's anonymity guarantee: if this table ever appears in the Zero schema,
      // an anonymous card's author becomes syncable and the guarantee is a lie. Merge-blocking.
      'retro_card_author',
      // The searchable projection of every description and comment. If it ever appears in the Zero
      // schema, every client replicates the full text of every team it can read — and the
      // team-scoped predicate that guards the search route stops being the only way in.
      'search_document',
    ]) {
      expect(Object.keys(KYSELY_DB)).toContain(name)
      expect(zeroTables).not.toContain(name)
    }
  })

  it('keeps every author-shaped retro column out of the synced card and tally rows', () => {
    const synced = tableShapes()
    const card = synced.find((table) => table.serverName === 'retro_card')
    expect(card).toBeDefined()
    // `author_display_id` is the ONLY author-shaped column on a card, and it is null for an
    // anonymous retro. Any other author column here would ship the identity to every client.
    expect(
      card?.columns.map((column) => column.serverName).filter((name) => name.includes('author')),
    ).toEqual(['author_display_id'])

    const tally = synced.find((table) => table.serverName === 'retro_vote_tally')
    expect(tally).toBeDefined()
    expect(
      tally?.columns.filter(
        (column) => column.serverName.includes('user') || column.serverName.includes('voter'),
      ),
    ).toEqual([])
  })
})

describe.skipIf(DATABASE_URL === undefined)('schema drift', () => {
  const database = createDatabase({ connectionString: DATABASE_URL ?? '' })

  let tables: Awaited<ReturnType<typeof database.db.introspection.getTables>>
  let pkByTable: Map<string, string[]>

  beforeAll(async () => {
    await migrateToLatest(database.db)
    await createAuthUserTable(database.db)
    tables = (await database.db.introspection.getTables()).filter(
      (table) => table.schema === 'public' && !table.isView,
    )
    pkByTable = await primaryKeys(database.db)
  }, 30_000)

  afterAll(async () => {
    await database.close()
  })

  it('finds every table the hand-written interfaces describe', () => {
    const found = new Set(tables.map((table) => table.name))
    const zeroTables = tableShapes().map((table) => table.serverName)

    for (const name of [...Object.keys(KYSELY_DB), ...zeroTables]) {
      expect(found, `table ${name}`).toContain(name)
    }
  })

  it('matches the hand-written Kysely DB interface column for column', () => {
    const problems: string[] = []

    for (const [table, columns] of Object.entries(KYSELY_DB)) {
      const actual = tables.find((candidate) => candidate.name === table)
      if (!actual) {
        problems.push(`${table}: missing in database`)
        continue
      }

      const actualColumns = new Map(actual.columns.map((column) => [column.name, column]))

      for (const [column, expected] of Object.entries(columns)) {
        const got = actualColumns.get(column)
        if (!got) {
          problems.push(`${table}.${column}: declared in DB interface but missing in database`)
          continue
        }
        if (got.isNullable !== expected.nullable) {
          problems.push(
            `${table}.${column}: nullability mismatch (DB interface=${expected.nullable}, postgres=${got.isNullable})`,
          )
        }
        if (got.hasDefaultValue !== expected.hasDefault) {
          problems.push(
            `${table}.${column}: default mismatch (DB interface Generated<>=${expected.hasDefault}, postgres=${got.hasDefaultValue})`,
          )
        }
      }

      for (const column of actualColumns.keys()) {
        if (!(column in columns)) {
          problems.push(`${table}.${column}: in database but not in the DB interface`)
        }
      }
    }

    expect(problems, problems.join('\n')).toEqual([])
  })

  it('matches the hand-written Zero schema column for column', () => {
    const problems: string[] = []

    for (const table of tableShapes()) {
      const name = table.serverName
      const actual = tables.find((candidate) => candidate.name === name)
      if (!actual) {
        problems.push(`${name}: missing in database`)
        continue
      }

      const actualColumns = new Map(actual.columns.map((column) => [column.name, column]))
      const expected = new Map(table.columns.map((column) => [column.serverName, column]))

      for (const [column, spec] of expected) {
        const got = actualColumns.get(column)
        if (!got) {
          problems.push(`${name}.${column}: in the Zero schema but missing in database`)
          continue
        }
        if (got.isNullable !== spec.optional) {
          problems.push(
            `${name}.${column}: nullability mismatch (zero optional=${spec.optional}, postgres=${got.isNullable})`,
          )
        }
        const allowed = POSTGRES_TYPE_TO_ZERO[got.dataType]
        if (allowed === undefined) {
          problems.push(`${name}.${column}: unmapped Postgres type ${got.dataType}`)
        } else if (allowed !== spec.type) {
          problems.push(
            `${name}.${column}: type mismatch (zero=${spec.type}, postgres=${got.dataType} maps to ${allowed})`,
          )
        }
      }

      for (const column of actualColumns.keys()) {
        if (!expected.has(column)) {
          problems.push(`${name}.${column}: in database but not in the Zero schema`)
        }
      }

      const pk = pkByTable.get(name) ?? []
      if (JSON.stringify(pk) !== JSON.stringify(table.primaryKey)) {
        problems.push(
          `${name}: primary key mismatch (zero=${JSON.stringify(table.primaryKey)}, postgres=${JSON.stringify(pk)})`,
        )
      }
    }

    expect(problems, problems.join('\n')).toEqual([])
  })

  // The attachment table, column by column in BOTH directions, because it is the only table in the
  // repo whose read permission is enforced by a route rather than by a synced predicate alone: a
  // column that reached Postgres but not the Zero schema silently stops the Files list working,
  // and a column here that is not in Postgres is a 500 on the upload path.
  it('carries every attachment column in Postgres and in the Zero schema', () => {
    const actual = tables.find((candidate) => candidate.name === 'attachment')
    expect(actual, 'attachment is missing from Postgres').toBeDefined()
    const shape = tableShapes().find((candidate) => candidate.serverName === 'attachment')
    expect(shape, 'attachment is missing from the Zero schema').toBeDefined()

    const columns = Object.keys(KYSELY_DB.attachment ?? {})
    expect(columns.length).toBe(10)
    for (const column of columns) {
      expect(
        actual?.columns.map((candidate) => candidate.name),
        `attachment.${column} in Postgres`,
      ).toContain(column)
      expect(
        shape?.columns.map((candidate) => candidate.serverName),
        `attachment.${column} in the Zero schema`,
      ).toContain(column)
    }
  })

  // `bigint` is the one column type in this table not already on the replication path for some
  // other table, and it is the one whose JS representation is a trap: node-postgres hands `int8`
  // back as a STRING, so a column typed `number` here would silently produce `'1024'` where every
  // caller expects `1024`. `db/attachment.ts` converts at its boundary; this pins the Postgres side.
  it('stores attachment.byte_size as int8 and syncs it as a number', () => {
    const actual = tables.find((candidate) => candidate.name === 'attachment')
    const column = actual?.columns.find((candidate) => candidate.name === 'byte_size')
    expect(column?.dataType).toBe('int8')
    expect(column?.isNullable).toBe(false)

    const shape = tableShapes().find((candidate) => candidate.serverName === 'attachment')
    const synced = shape?.columns.find((candidate) => candidate.serverName === 'byte_size')
    expect(synced?.type).toBe('number')
  })

  // Status automation's entire storage footprint, called out by name for the same reason as the
  // natural keys below: the generic sweeps above would catch a drop, but not say what broke. Both
  // columns must be NULLABLE with no default — `team.auto_status_since` because null is the off
  // state AND the shipped default (a default would silently opt every existing team in), and
  // `issue.last_human_status_at` because a default would fabricate human intent on rows nobody
  // touched. Both must be `timestamptz`, because the guard ladder compares them against event
  // instants; an integer column here would compare wrong rather than fail.
  it.each([
    ['team', 'auto_status_since'],
    ['issue', 'last_human_status_at'],
  ])('carries %s.%s as a nullable timestamptz in Postgres', (table, column) => {
    const actual = tables.find((candidate) => candidate.name === table)
    const found = actual?.columns.find((candidate) => candidate.name === column)
    expect(found, `${table}.${column} is missing from Postgres`).toBeDefined()
    expect(found?.dataType).toBe('timestamptz')
    expect(found?.isNullable).toBe(true)
    expect(found?.hasDefaultValue).toBe(false)
  })

  // And the other side of the same fact: a column that reached Postgres but never reached the Zero
  // schema does not sync, so the settings toggle would write a value the client can never read back
  // and the guard ladder would see `undefined` on every issue.
  it.each([
    ['team', 'auto_status_since'],
    ['issue', 'last_human_status_at'],
  ])('exposes %s.%s through the Zero schema as an optional number', (table, column) => {
    const shape = tableShapes().find((candidate) => candidate.serverName === table)
    const found = shape?.columns.find((candidate) => candidate.serverName === column)
    expect(found, `${table}.${column} is missing from the Zero schema`).toBeDefined()
    expect(found?.type).toBe('number')
    expect(found?.optional).toBe(true)
  })

  // Called out on its own because the whole notification design rests on it: the natural key IS the
  // primary key, IN THIS ORDER, so nothing is minted, `on conflict do nothing` needs no separate
  // unique index, and a mutator re-run during rebase can neither duplicate nor alter a row. The
  // generic check above would also catch a change, but not explain why it matters.
  it('keeps the notification natural key as a four-column primary key, in order', () => {
    expect(pkByTable.get('notification')).toEqual([
      'recipient_id',
      'kind',
      'subject_id',
      'event_key',
    ])
  })

  // Same reasoning one table over, and one addition. The two-column natural key is what keeps the
  // subscription path from minting anything, and the `state` CHECK is the other half of the
  // anti-mail-trap mechanism: it is what stops a later change quietly reintroducing a third state
  // or replacing the sticky `unsubscribed` row with a DELETE.
  it('keeps the issue_subscription natural key as a two-column primary key, in order', () => {
    expect(pkByTable.get('issue_subscription')).toEqual(['issue_id', 'user_id'])
  })

  it('constrains issue_subscription.state in Postgres, unlike notification.kind', async () => {
    const definitions = await checkConstraints(database.db, 'issue_subscription')
    const normalized = definitions.map((definition) => definition.replaceAll(/\s+/gu, ' '))

    expect(normalized.some((definition) => definition.includes('state'))).toBe(true)
    for (const state of ['subscribed', 'unsubscribed']) {
      expect(normalized.join(' ')).toContain(`'${state}'`)
    }

    // The deliberate contrast, asserted rather than merely commented: `kind` must stay widenable
    // for the price of a TypeScript union member, so it carries no CHECK.
    expect(await checkConstraints(database.db, 'notification')).toEqual([])
  })

  // The natural key again, and for the same reason: the indexer's multi-row
  // `on conflict (entity_type, entity_id) do update` mints nothing, so re-running any pass is
  // idempotent by construction. Column ORDER matters — it is the conflict target.
  it('keeps the search_document natural key as a two-column primary key, in order', () => {
    expect(pkByTable.get('search_document')).toEqual(['entity_type', 'entity_id'])
  })

  // The allowlist is the security property, so it is enforced in Postgres rather than only in
  // TypeScript — the deliberate inversion of `notification.kind`'s no-CHECK precedent. The shape
  // CHECK is the other half: it makes the entity/FK invariant a database fact.
  it('enforces the entity-type allowlist and the entity shape in Postgres', async () => {
    const normalized = (await checkConstraints(database.db, 'search_document')).map((definition) =>
      definition.replaceAll(/\s+/gu, ' '),
    )

    const allowlist = normalized.find(
      (definition) => definition.includes('entity_type') && !definition.includes('comment_id'),
    )
    expect(allowlist).toBeDefined()
    for (const entityType of ['issue', 'comment']) {
      expect(allowlist).toContain(`'${entityType}'`)
    }
    // A denylist would let a new table in by omission. Nothing outside the two is nameable.
    for (const excluded of ['retro', 'retro_card', 'retro_draft', 'project', 'cycle']) {
      expect(allowlist).not.toContain(`'${excluded}'`)
    }

    const shape = normalized.find((definition) => definition.includes('comment_id'))
    expect(shape).toBeDefined()
    expect(shape).toContain('entity_id = issue_id')
    expect(shape).toContain('comment_id = entity_id')
  })

  // CHECK constraints are evaluated before the foreign-key triggers, so a rejection here is a
  // CHECK's and not the FK's — asserted by the SQLSTATE rather than by "it threw something".
  async function insertFailure(
    entityType: string,
    commentId: string | null,
  ): Promise<{ code?: string; constraint?: string } | undefined> {
    const sameId = '11111111-1111-4111-8111-111111111111'
    return await sql`
      insert into search_document
        (entity_type, entity_id, team_id, issue_id, comment_id, source_updated_at)
      values
        (${entityType}, ${sameId}, gen_random_uuid(), ${sameId}, ${commentId}, now())
    `
      .execute(database.db)
      .then(
        () => undefined,
        (error: unknown) => error as { code?: string; constraint?: string },
      )
  }

  it('rejects a row whose entity type is outside the allowlist', async () => {
    const failure = await insertFailure('retro_card', null)

    expect(failure?.code).toBe('23514')
    // An unknown entity type violates BOTH checks — the allowlist by name, the shape because
    // neither of its branches can hold — so Postgres reports whichever it evaluated first. What
    // matters is that the row cannot exist; which of the two refused it is not the property.
    expect(failure?.constraint).toMatch(/^search_document_entity_(type|shape)_check$/u)
  })

  it('rejects an allowlisted row whose entity/FK shape is wrong', async () => {
    const issueWithComment = await insertFailure('issue', '22222222-2222-4222-8222-222222222222')
    expect(issueWithComment?.code).toBe('23514')
    expect(issueWithComment?.constraint).toBe('search_document_entity_shape_check')

    const commentPointingElsewhere = await insertFailure(
      'comment',
      '22222222-2222-4222-8222-222222222222',
    )
    expect(commentPointingElsewhere?.code).toBe('23514')
    expect(commentPointingElsewhere?.constraint).toBe('search_document_entity_shape_check')
  })
})

// reference/zero.md §9.1 — the Postgres -> Zero type map, restricted to the types
// this schema actually uses. Add a row here when a migration introduces a new type.
const POSTGRES_TYPE_TO_ZERO: Record<string, string> = {
  bool: 'boolean',
  date: 'number',
  float4: 'number',
  float8: 'number',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  json: 'json',
  jsonb: 'json',
  numeric: 'number',
  text: 'string',
  time: 'number',
  timestamp: 'number',
  timestamptz: 'number',
  timetz: 'number',
  uuid: 'string',
  varchar: 'string',
}
