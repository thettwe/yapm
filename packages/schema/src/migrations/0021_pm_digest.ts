import { type Kysely, sql } from 'kysely'
import { AI_ARTIFACT_STATUS_CHECK, AI_DISCLOSURE_EVENT_CHECK } from '../zero/context.js'

// The first artifact in yapm whose reader is someone the producing team did not choose.
//
// `pm_digest` is a SEPARATE ROW rather than a widened read on `cycle_digest`, and that is forced
// rather than chosen: ZQL has no `select()` — a query always returns the whole row — so a query
// serving a PM over `cycle_digest` would hand them the team-internal `content` column. There is no
// column projection to hide behind.
//
// `published_at` is null until a human releases it, and it is the boundary: generation discloses to
// nobody. `published_by` and `audience_size_at_publish` are stamped server-side at that moment;
// `published_by` is DELIBERATELY absent from the Zero schema (the drift test asserts the asymmetry)
// because it is the one identity column on the row, and telling a PM which individual released a
// digest is accountability in the wrong direction — that belongs in the audit record.
//
// `ai_disclosure_audit` is server-only in the strongest sense available here: it is in this
// migration and in the Kysely `DB` interface and it is absent from the Zero schema entirely, the way
// `retro_card_author` is, so no client can name it in any query. It ships WITH the boundary rather
// than after it, because "auditable rather than ambient" is the load-bearing claim of the disclosure
// story and there is no audit table anywhere in migrations 0001–0019 to make it true today.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('pm_digest')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('cycle_id', 'uuid', (col) =>
      col.notNull().references('cycle.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('pending').check(sql.raw(AI_ARTIFACT_STATUS_CHECK)),
    )
    .addColumn('content', 'jsonb')
    .addColumn('provider', 'text')
    .addColumn('model', 'text')
    .addColumn('input_token', 'integer')
    .addColumn('output_token', 'integer')
    .addColumn('estimated_cost_usd', sql`double precision`)
    .addColumn('generated_at', 'timestamptz')
    .addColumn('published_at', 'timestamptz')
    // `text` and NO FK, like every other user-shaped column here (`issue.creator_id`,
    // `attachment.uploader_id`, `retro.facilitator_id`): `user` is better-auth's table, created by
    // ITS migrator at boot AFTER the Kysely migrator runs, so a reference to it fails outright on a
    // fresh instance. The record of who released a disclosure outlives the account either way.
    .addColumn('published_by', 'text')
    .addColumn('audience_size_at_publish', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('pm_digest_cycle_key', ['cycle_id'])
    .execute()

  await db.schema.createIndex('pm_digest_team_id_idx').on('pm_digest').column('team_id').execute()

  // The audience read is `team_id IN (...) AND published_at IS NOT NULL` ordered by `published_at`,
  // so the composite is the shape that query actually asks for.
  await db.schema
    .createIndex('pm_digest_team_published_idx')
    .on('pm_digest')
    .columns(['team_id', 'published_at'])
    .execute()

  await db.schema
    .createTable('ai_disclosure_audit')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspace.id').onDelete('cascade'),
    )
    // Null once the team is gone; the record of the disclosure outlives the team it was about.
    .addColumn('team_id', 'uuid', (col) => col.references('team.id').onDelete('set null'))
    // Null for a generation: the system principal is a reserved literal, not a `user` row. `text`
    // and no FK for the same reason `published_by` is — and here it matters twice over, since an
    // audit record whose actor vanished with the account is not much of an audit record.
    .addColumn('actor_id', 'text')
    .addColumn('event', 'text', (col) => col.notNull().check(sql.raw(AI_DISCLOSURE_EVENT_CHECK)))
    .addColumn('pm_digest_id', 'uuid', (col) => col.references('pm_digest.id').onDelete('set null'))
    // yapm-computed metadata ONLY: the resulting audience size, which switch changed, the run's
    // terminal status. Never content, never prose. A record that quotes the disclosure is a second
    // copy of the disclosure sitting outside the kill switch.
    .addColumn('detail', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('ai_disclosure_audit_workspace_idx')
    .on('ai_disclosure_audit')
    .columns(['workspace_id', 'created_at desc'])
    .execute()

  await db.schema
    .createIndex('ai_disclosure_audit_team_idx')
    .on('ai_disclosure_audit')
    .column('team_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ai_disclosure_audit').ifExists().execute()
  await db.schema.dropTable('pm_digest').ifExists().execute()
}
