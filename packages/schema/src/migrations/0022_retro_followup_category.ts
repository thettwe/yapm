import { type Kysely, sql } from 'kysely'
import { RETRO_PROPOSAL_CATEGORY_CHECK } from '../zero/context.js'

// `follow_up` becomes a stored fourth category. Change 22 shipped it as a bucket DERIVED at read
// time — a proposal was a follow-up exactly when it cited a `retro_action` reference — because that
// change was scoped with no migration and 0018's CHECK admits three values. Its design §D3 recorded
// the stored enum as the cleaner answer and left this SQL as the spec for it; this migration is that
// paragraph executed.
//
// A constraint swap, not a column rewrite. `add constraint` validates every existing row, and every
// existing row already satisfies the wider check, so nothing can fail here. No backfill accompanies
// it: a row stored under one of the three old values keeps that value, because nothing stored
// recovers whether the model meant a follow-up or a win that happened to cite an action.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table retro_ai_proposal drop constraint retro_ai_proposal_category_check`.execute(
    db,
  )
  await sql`alter table retro_ai_proposal add constraint retro_ai_proposal_category_check check (${sql.raw(
    RETRO_PROPOSAL_CATEGORY_CHECK,
  )})`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table retro_ai_proposal drop constraint retro_ai_proposal_category_check`.execute(
    db,
  )
  await sql`alter table retro_ai_proposal add constraint retro_ai_proposal_category_check check (category in ('win', 'loss', 'improvement'))`.execute(
    db,
  )
}
