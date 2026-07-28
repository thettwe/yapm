import { type Kysely, sql } from 'kysely'
import { AI_ARTIFACT_STATUS_CHECK } from '../zero/context.js'

const RETRO_PROPOSAL_CATEGORY_CHECK = sql`category in ('win', 'loss', 'improvement')`
const RETRO_PROPOSAL_CONFIDENCE_CHECK = sql`confidence in ('high', 'medium', 'low')`

// The second AI artifact: a team-scoped, Zero-synced draft of a just-closed cycle's retro, written
// server-side only. `team.ai_retro_draft_since` is the per-team opt-in — null is off, mirroring
// `auto_status_since` and `archived_at`, so the feature is absent for a team that never consented.
//
// One draft per retro (unique on `retro_id`) so a re-run of the authoritative phase-advance mutator
// upserts rather than duplicates. Proposals are ROWS rather than a `content` jsonb because change 19
// keys reactions and provenance on a stable proposal id and needs a real FK target.
//
// `claimed_at` is job scheduling state, not artifact state: it exists here and is DELIBERATELY
// absent from the Zero schema (the drift test asserts that asymmetry) so job internals never sync
// to a client.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('team').addColumn('ai_retro_draft_since', 'timestamptz').execute()

  await db.schema
    .createTable('retro_ai_draft')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('pending').check(sql.raw(AI_ARTIFACT_STATUS_CHECK)),
    )
    .addColumn('claimed_at', 'timestamptz')
    .addColumn('provider', 'text')
    .addColumn('model', 'text')
    .addColumn('input_token', 'integer')
    .addColumn('output_token', 'integer')
    .addColumn('estimated_cost_usd', sql`double precision`)
    .addColumn('generated_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('retro_ai_draft_retro_key', ['retro_id'])
    .execute()

  await db.schema
    .createIndex('retro_ai_draft_team_id_idx')
    .on('retro_ai_draft')
    .column('team_id')
    .execute()

  await db.schema
    .createTable('retro_ai_proposal')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('draft_id', 'uuid', (col) =>
      col.notNull().references('retro_ai_draft.id').onDelete('cascade'),
    )
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('category', 'text', (col) => col.notNull().check(RETRO_PROPOSAL_CATEGORY_CHECK))
    .addColumn('summary', 'text', (col) => col.notNull())
    .addColumn('confidence', 'text', (col) => col.notNull().check(RETRO_PROPOSAL_CONFIDENCE_CHECK))
    .addColumn('refs', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('rank', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('retro_ai_proposal_retro_id_idx')
    .on('retro_ai_proposal')
    .column('retro_id')
    .execute()

  await db.schema
    .createIndex('retro_ai_proposal_team_id_idx')
    .on('retro_ai_proposal')
    .column('team_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('retro_ai_proposal').ifExists().execute()
  await db.schema.dropTable('retro_ai_draft').ifExists().execute()
  await db.schema.alterTable('team').dropColumn('ai_retro_draft_since').execute()
}
