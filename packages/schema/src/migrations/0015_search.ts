import { type Kysely, sql } from 'kysely'

// THE ALLOWLIST, ENFORCED IN POSTGRES. `0013_notifications` deliberately gave `notification.kind`
// no CHECK so that adding a kind costs a TypeScript union member rather than a migration in a
// different change. This inverts that on purpose, and the inversion is the point: here the closed
// set IS the security property. An index that grows to mean "every text column we have" is how the
// retrospective anonymity guarantee dies quietly, so making a new indexable entity type cost a
// forward-only migration and a reviewer's eye is friction this table wants. Every `retro_*` table
// is outside the set — stricter than the boundary needs, so "no search path names a retro table"
// is a grep rather than a judgement.
const ENTITY_TYPE_CHECK = sql`entity_type in ('issue', 'comment')`

// The second CHECK pins the entity/FK shape so the invariant is a database fact rather than a
// convention the indexer is trusted to keep: an issue document IS its issue and has no comment; a
// comment document IS its comment and hangs off the issue that carries it.
const ENTITY_SHAPE_CHECK = sql`
  (entity_type = 'issue' and comment_id is null and entity_id = issue_id)
  or (entity_type = 'comment' and comment_id = entity_id)
`

// The literal in the index expression, NOT the runtime setting. An expression index is built with a
// literal text-search configuration, so `SEARCH_TEXT_CONFIG` cannot reach in here — the reconcile
// job compares `pg_indexes.indexdef` against the configured value and rebuilds this one index when
// they differ. That is why changing the configuration is "rebuild one index" rather than a runbook.
const DEFAULT_TEXT_CONFIG = 'simple'

// A SERVER-ONLY sidecar carrying plaintext projections of the two allowlisted entity types.
// Present in Postgres and in the hand-written Kysely `DB`, ABSENT from the Zero schema (asserted by
// the drift test beside `retro_card_author`), so no synced query can name it.
//
// The weighted `tsvector` exists ONLY inside the GIN index expression; there is no tsvector column,
// generated or otherwise. zero-cache replicates this table whether or not Zero knows about it —
// `FOR TABLES IN SCHEMA public` — and `generated stored` columns DO sync on PG18, so a tsvector
// column would put an exotic type on the replication path toward the SQLite replica. Indexes are
// not logically replicated and `text` maps trivially, so plain text columns are a non-event.
// Excluding the table with a custom publication was the other option and is worse: an
// `ZERO_APP_PUBLICATIONS` change forces a full replica resync on every self-hosted upgrade.
//
// NO BACKFILL HERE. An upgraded instance must boot without building the index contents; the
// reconcile pass finds every row missing and converges in bounded batches while traffic is served.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('search_document')
    .addColumn('entity_type', 'text', (col) => col.notNull().check(ENTITY_TYPE_CHECK))
    .addColumn('entity_id', 'uuid', (col) => col.notNull())
    // Denormalised off the owning issue, and the column every read filters on. Sound ONLY because
    // an issue can never change team — the invariant `notifications` owns and `routeIssue`'s doc
    // comment refuses to break. A change that makes issues movable must move these rows too.
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('issue_id', 'uuid', (col) =>
      col.notNull().references('issue.id').onDelete('cascade'),
    )
    // The one deliberate write-path cost in this change: `comment.delete` exists, and a deleted
    // comment must stop being findable inside the deleting transaction rather than in five minutes'
    // time. One indexed row delete on a rare operation — not the every-title-edit amplification the
    // job design refused.
    .addColumn('comment_id', 'uuid', (col) => col.references('comment.id').onDelete('cascade'))
    // Weight A. Empty for a comment document: a comment indexes only its OWN text, so searching an
    // issue title returns the issue once rather than the issue plus every comment on it.
    .addColumn('title', 'text', (col) => col.notNull().defaultTo(''))
    // Weight B. The plaintext projection of the rich-text document, mention-aware.
    .addColumn('body', 'text', (col) => col.notNull().defaultTo(''))
    // The source row's `updated_at`, copied verbatim. Both the incremental watermark and the
    // reconcile's staleness diff are equality/ordering tests against this, so it must be the
    // source's value and never `now()`.
    .addColumn('source_updated_at', 'timestamptz', (col) => col.notNull())
    .addColumn('indexed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // The natural key is the primary key, so the indexer's multi-row
    // `insert … on conflict (entity_type, entity_id) do update` mints nothing and re-running any
    // pass is idempotent by construction rather than by care.
    .addPrimaryKeyConstraint('search_document_pkey', ['entity_type', 'entity_id'])
    .addCheckConstraint('search_document_entity_shape_check', ENTITY_SHAPE_CHECK)
    .execute()

  await sql`
    create index search_document_fts_idx on search_document using gin (
      (
        setweight(to_tsvector(${sql.lit(DEFAULT_TEXT_CONFIG)}, title), 'A') ||
        setweight(to_tsvector(${sql.lit(DEFAULT_TEXT_CONFIG)}, body), 'B')
      )
    )
  `.execute(db)

  // Every read filters `team_id = any($teams)` inside the indexed scan.
  await db.schema
    .createIndex('search_document_team_id_idx')
    .on('search_document')
    .column('team_id')
    .execute()

  // The watermark read: `max(source_updated_at)` per entity type, one index-only lookup.
  await db.schema
    .createIndex('search_document_watermark_idx')
    .on('search_document')
    .columns(['entity_type', 'source_updated_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('search_document').ifExists().execute()
}
