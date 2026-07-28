import { type Kysely, sql } from 'kysely'
import { AI_ARTIFACT_STATUS_CHECK } from '../zero/context.js'

// The team-scoped, Zero-synced cycle-digest artifact — the flagship consumer of the AI substrate.
// One row per cycle (unique on `cycle_id`), written server-side only by the pre-compute job over
// the Zero `Transaction` write path (never a client mutator), so a client can never forge a digest
// and the "numbers computed by yapm" guarantee holds. `content` is the typed sections/items blob
// (null until ready / when AI is off). `team_id` carries the two-hop `teamScoped` sync predicate so
// only the owning team reads it. The AI config/keys reuse the connector surface — this migration
// adds NO secret table and NO per-individual table.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('cycle_digest')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('cycle_id', 'uuid', (col) =>
      col.notNull().references('cycle.id').onDelete('cascade'),
    )
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('pending').check(sql.raw(AI_ARTIFACT_STATUS_CHECK)),
    )
    .addColumn('content', 'jsonb')
    .addColumn('provider', 'text')
    .addColumn('model', 'text')
    .addColumn('generated_at', 'timestamptz')
    .addColumn('input_token', 'integer')
    .addColumn('output_token', 'integer')
    .addColumn('estimated_cost_usd', sql`double precision`)
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('cycle_digest_cycle_key', ['cycle_id'])
    .execute()

  await db.schema
    .createIndex('cycle_digest_team_id_idx')
    .on('cycle_digest')
    .column('team_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('cycle_digest').ifExists().execute()
}
