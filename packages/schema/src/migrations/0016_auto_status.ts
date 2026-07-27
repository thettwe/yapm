import { type Kysely, sql } from 'kysely'

// Two nullable timestamps, no index, no constraint, no extension — the whole storage cost of
// opt-in status automation.
//
// `team.auto_status_since` is the setting AND its epoch, following `team.archived_at`'s
// nullable-timestamp-as-state convention: null is off, a timestamp is "on, since then". The epoch
// half is load-bearing rather than decorative — every transition compares the event's own instant
// against it, so turning automation on can never retroactively rewrite a board, and the first
// install's backfill of two hundred historical merged pull requests is inert by construction. A
// boolean column would have needed a second column to say the same thing.
//
// `issue.last_human_status_at` is the only fact the guard ladder cannot derive: `updated_at` moves
// for a title edit and for the automation's own write, so it cannot answer "did a person last
// decide this status, and when". Backfilled from `updated_at` in one statement because the
// alternative — leaving it null on every existing row — reads as "no human has ever set a status
// here" and would let the first delivery after an upgrade overwrite a status somebody set
// yesterday. `updated_at` is an upper bound on when that decision was made, and erring toward
// "a human touched this recently" errs toward not overwriting them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('team').addColumn('auto_status_since', 'timestamptz').execute()

  await db.schema.alterTable('issue').addColumn('last_human_status_at', 'timestamptz').execute()

  await sql`update issue set last_human_status_at = updated_at`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issue').dropColumn('last_human_status_at').execute()
  await db.schema.alterTable('team').dropColumn('auto_status_since').execute()
}
