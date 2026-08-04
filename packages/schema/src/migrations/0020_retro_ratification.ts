import { type Kysely, sql } from 'kysely'
import { RETRO_PROPOSAL_VERDICT_CHECK, RETRO_REACTION_VALUE_CHECK } from '../zero/context.js'

// The team's decision layer over change 18's proposals.
//
// THERE IS NO COUNTER COLUMN ANYWHERE, and its absence is the design rather than an omission. The
// verdict and the two counts are computed ONCE, server-side, at the `vote -> discuss` advance, so
// recording a reaction contends on nothing: it is a plain upsert on a key nobody else can address.
// That sidesteps both concurrency classes this repo already paid for — the lost-update class behind
// `bumpRetroVoteTally`'s single-statement increment, and the per-actor lock class behind
// `lockRetroForVote`'s `for no key update`. Adding a running total here would reintroduce both.
//
// `(proposal_id, user_id)` IS the primary key, so nothing is minted anywhere on the reaction path
// and "one member, one reaction, one proposal" is a storage property rather than a validation rule
// (the `retro_presence` / `notification` precedent). `user_id` carries NO foreign key for the same
// reason `retro_presence.user_id` does not: better-auth owns the `user` table.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('retro_ai_reaction')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.notNull().references('retro_ai_proposal.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('retro_id', 'uuid', (col) =>
      col.notNull().references('retro.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('value', 'text', (col) => col.notNull().check(sql.raw(RETRO_REACTION_VALUE_CHECK)))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('retro_ai_reaction_pkey', ['proposal_id', 'user_id'])
    .execute()

  // `retro_id` is the ratification read's whole access path — one query per advance, never one per
  // proposal. `team_id` serves membership cleanup.
  await db.schema
    .createIndex('retro_ai_reaction_retro_id_idx')
    .on('retro_ai_reaction')
    .column('retro_id')
    .execute()

  await db.schema
    .createIndex('retro_ai_reaction_team_id_idx')
    .on('retro_ai_reaction')
    .column('team_id')
    .execute()

  // Four written-once columns on the row that already exists, rather than a fifth retro table with a
  // fifth cascade and a fifth synced query. All nullable: a proposal drafted before this migration
  // keeps them null and renders exactly as it does today, and a step back to `vote` sets them back
  // to null so no stale verdict anchors a team that is still reacting.
  await db.schema
    .alterTable('retro_ai_proposal')
    .addColumn('verdict', 'text', (col) => col.check(sql.raw(RETRO_PROPOSAL_VERDICT_CHECK)))
    .execute()
  await db.schema.alterTable('retro_ai_proposal').addColumn('agree_count', 'integer').execute()
  await db.schema.alterTable('retro_ai_proposal').addColumn('disagree_count', 'integer').execute()
  await db.schema.alterTable('retro_ai_proposal').addColumn('ratified_at', 'timestamptz').execute()

  // ON DELETE SET NULL, NEVER CASCADE. Stepping the retro back to `brainstorm` discards the draft
  // and its proposals; cascading from there would delete a human's action item, which the human
  // wrote and owns. The provenance link is the expendable half.
  await db.schema
    .alterTable('retro_action')
    .addColumn('ai_proposal_id', 'uuid', (col) =>
      col.references('retro_ai_proposal.id').onDelete('set null'),
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('retro_action').dropColumn('ai_proposal_id').execute()
  await db.schema.alterTable('retro_ai_proposal').dropColumn('ratified_at').execute()
  await db.schema.alterTable('retro_ai_proposal').dropColumn('disagree_count').execute()
  await db.schema.alterTable('retro_ai_proposal').dropColumn('agree_count').execute()
  await db.schema.alterTable('retro_ai_proposal').dropColumn('verdict').execute()
  await db.schema.dropTable('retro_ai_reaction').ifExists().execute()
}
