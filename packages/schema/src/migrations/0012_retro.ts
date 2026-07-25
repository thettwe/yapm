import { type Kysely, sql } from 'kysely'

const PHASE_CHECK = sql`phase in ('brainstorm', 'group', 'vote', 'discuss', 'actions', 'closed')`
const FORMAT_CHECK = sql`format in ('wentwell_didnt_action', 'start_stop_continue', 'mad_sad_glad', '4ls')`
const BUDGET_CHECK = sql`votes_per_participant between 1 and 10`
const ACCENT_CHECK = sql`accent_token in ('positive', 'negative', 'caution', 'neutral', 'action')`
const VOTE_TARGET_CHECK = sql`target_type in ('card', 'group')`
const TALLY_TARGET_CHECK = sql`target_type in ('card', 'group')`

// The retrospective: nine team-scoped, Zero-synced tables plus ONE server-only table.
//
// `retro_card_author` is the crux. Zero syncs whole rows and has no column-level read permission,
// so an anonymous card's author cannot live on any synced row — it lives here, in a table that is
// absent from the Zero schema entirely (asserted by the drift test, exactly like `issue_sequence`).
// A client cannot name a table outside the Zero schema in any query, which makes the leak
// structurally impossible rather than merely unwritten.
//
// `retro_draft` is the private brainstorm surface: rows carry `author_id` and sync only to their
// author, so "hide other people's cards while writing" needs no author column on `retro_card`.
// Advancing out of `brainstorm` publishes drafts into cards REUSING THE DRAFT ID, so no id is
// minted inside a mutator and re-running the publish is idempotent.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('retro')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    // The cycle being reflected on. `on delete set null` keeps a retro's record alive if its cycle
    // is deleted; the unique index below is what makes "at most one retro per cycle" true.
    .addColumn('cycle_id', 'uuid', (col) => col.references('cycle.id').onDelete('set null'))
    // The default landing cycle for converted action items.
    .addColumn('next_cycle_id', 'uuid', (col) => col.references('cycle.id').onDelete('set null'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('format', 'text', (col) => col.notNull().check(FORMAT_CHECK))
    .addColumn('phase', 'text', (col) => col.notNull().defaultTo('brainstorm').check(PHASE_CHECK))
    .addColumn('facilitator_id', 'text')
    .addColumn('is_anonymous', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('votes_per_participant', 'integer', (col) =>
      col.notNull().defaultTo(3).check(BUDGET_CHECK),
    )
    .addColumn('timer_ends_at', 'timestamptz')
    .addColumn('timer_duration_s', 'integer')
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('closed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('retro_column')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('accent_token', 'text', (col) => col.notNull().check(ACCENT_CHECK))
    .addColumn('rank', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('retro_column_retro_key_key', ['retro_id', 'key'])
    .execute()

  // A group lives in one column; a card points at a group (or none). Created before `retro_card`
  // so the card's FK can reference it.
  await db.schema
    .createTable('retro_group')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('column_id', 'uuid', (col) =>
      col.notNull().references('retro_column.id').onDelete('cascade'),
    )
    .addColumn('label', 'text')
    .addColumn('rank', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // The private brainstorm row. Syncs ONLY to `author_id` (a bare ctx-driven filter, no
  // workspace-admin bypass). `rank` is minted at the call site and copied onto the published card,
  // so publish mints nothing. `published_at` makes publish idempotent.
  await db.schema
    .createTable('retro_draft')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('column_id', 'uuid', (col) =>
      col.notNull().references('retro_column.id').onDelete('cascade'),
    )
    .addColumn('author_id', 'text', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('rank', 'text', (col) => col.notNull())
    .addColumn('seed_ref', 'jsonb')
    .addColumn('published_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // The published card. `author_display_id` is written ONLY for a non-anonymous retro; for an
  // anonymous retro it stays null on the synced row, so there is nothing to strip.
  await db.schema
    .createTable('retro_card')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('column_id', 'uuid', (col) =>
      col.notNull().references('retro_column.id').onDelete('cascade'),
    )
    .addColumn('group_id', 'uuid', (col) => col.references('retro_group.id').onDelete('set null'))
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('rank', 'text', (col) => col.notNull())
    .addColumn('is_anonymous', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('author_display_id', 'text')
    .addColumn('seed_ref', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // SERVER-ONLY. The card -> author binding: the authorization, moderation and audit record, in a
  // table deliberately ABSENT from the Zero schema so no synced query can even name it.
  await db.schema
    .createTable('retro_card_author')
    .addColumn('card_id', 'uuid', (col) =>
      col.primaryKey().references('retro_card.id').onDelete('cascade'),
    )
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('author_id', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // One row per dot. Syncs only to its voter (bare ctx filter, no admin bypass); everyone else
  // reads the tally. `target_id` is polymorphic (card or group), so no FK — the mutator validates
  // the target against the retro instead.
  await db.schema
    .createTable('retro_vote')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('target_type', 'text', (col) => col.notNull().check(VOTE_TARGET_CHECK))
    .addColumn('target_id', 'uuid', (col) => col.notNull())
    .addColumn('voter_id', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // Zero has no aggregates and a client cannot count rows it cannot see, so the per-target count
  // is a real row. Its PRIMARY KEY is the target's own (already client-minted) id, so the vote
  // mutators upsert it without minting anything inside a mutator body.
  await db.schema
    .createTable('retro_vote_tally')
    .addColumn('target_id', 'uuid', (col) => col.primaryKey())
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('target_type', 'text', (col) => col.notNull().check(TALLY_TARGET_CHECK))
    .addColumn('count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('retro_action')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('group_id', 'uuid', (col) => col.references('retro_group.id').onDelete('set null'))
    .addColumn('card_id', 'uuid', (col) => col.references('retro_card.id').onDelete('set null'))
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('assignee_id', 'text')
    .addColumn('target_cycle_id', 'uuid', (col) => col.references('cycle.id').onDelete('set null'))
    // Set once the action becomes a tracked issue. `set null` keeps the action if the issue is
    // deleted, so converting again is possible rather than silently blocked.
    .addColumn('issue_id', 'uuid', (col) => col.references('issue.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // Coarse, throttled presence: one row per participant per retro, column-level focus only,
  // pruned by the existing cycle-maintenance pass (no new job type, no new container).
  await db.schema
    .createTable('retro_presence')
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('focus_target', 'text')
    .addColumn('last_seen_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('retro_presence_pkey', ['retro_id', 'user_id'])
    .execute()

  // Two facts an issue's cycle history cannot otherwise reconstruct, both feeding the Delivered
  // panel: how many times the rollover carried this issue, and when it was placed in its cycle.
  await db.schema
    .alterTable('issue')
    .addColumn('carryover_count', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
  await db.schema.alterTable('issue').addColumn('cycle_assigned_at', 'timestamptz').execute()

  // At most one retro per cycle: the backstop that makes the deliberate Complete-cycle action
  // racing the maintenance pass yield exactly one retro.
  await db.schema
    .createIndex('retro_cycle_id_key')
    .unique()
    .on('retro')
    .column('cycle_id')
    .where('cycle_id', 'is not', null)
    .execute()

  await db.schema.createIndex('retro_team_id_idx').on('retro').column('team_id').execute()
  await db.schema
    .createIndex('retro_column_retro_id_idx')
    .on('retro_column')
    .column('retro_id')
    .execute()
  await db.schema
    .createIndex('retro_group_retro_id_idx')
    .on('retro_group')
    .column('retro_id')
    .execute()
  await db.schema
    .createIndex('retro_draft_retro_author_idx')
    .on('retro_draft')
    .columns(['retro_id', 'author_id'])
    .execute()
  await db.schema
    .createIndex('retro_card_retro_id_idx')
    .on('retro_card')
    .column('retro_id')
    .execute()
  await db.schema
    .createIndex('retro_card_group_id_idx')
    .on('retro_card')
    .column('group_id')
    .execute()
  await db.schema
    .createIndex('retro_card_author_retro_id_idx')
    .on('retro_card_author')
    .column('retro_id')
    .execute()
  await db.schema
    .createIndex('retro_vote_retro_voter_idx')
    .on('retro_vote')
    .columns(['retro_id', 'voter_id'])
    .execute()
  await db.schema
    .createIndex('retro_vote_target_id_idx')
    .on('retro_vote')
    .column('target_id')
    .execute()
  await db.schema
    .createIndex('retro_vote_tally_retro_id_idx')
    .on('retro_vote_tally')
    .column('retro_id')
    .execute()
  await db.schema
    .createIndex('retro_action_retro_id_idx')
    .on('retro_action')
    .column('retro_id')
    .execute()
  await db.schema
    .createIndex('retro_presence_last_seen_at_idx')
    .on('retro_presence')
    .column('last_seen_at')
    .execute()

  // Byte-order collation on every rank column, so `ORDER BY rank COLLATE "C"` in Postgres matches
  // the JS string comparison the fractional index relies on (mirrors `issue.rank`).
  await sql`create index retro_column_rank_idx on retro_column (retro_id, rank collate "C")`.execute(
    db,
  )
  await sql`create index retro_card_rank_idx on retro_card (column_id, rank collate "C")`.execute(
    db,
  )
  await sql`create index retro_group_rank_idx on retro_group (column_id, rank collate "C")`.execute(
    db,
  )
  await sql`create index retro_draft_rank_idx on retro_draft (column_id, rank collate "C")`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issue').dropColumn('cycle_assigned_at').execute()
  await db.schema.alterTable('issue').dropColumn('carryover_count').execute()
  await db.schema.dropTable('retro_presence').ifExists().execute()
  await db.schema.dropTable('retro_action').ifExists().execute()
  await db.schema.dropTable('retro_vote_tally').ifExists().execute()
  await db.schema.dropTable('retro_vote').ifExists().execute()
  await db.schema.dropTable('retro_card_author').ifExists().execute()
  await db.schema.dropTable('retro_card').ifExists().execute()
  await db.schema.dropTable('retro_draft').ifExists().execute()
  await db.schema.dropTable('retro_group').ifExists().execute()
  await db.schema.dropTable('retro_column').ifExists().execute()
  await db.schema.dropTable('retro').ifExists().execute()
}
