import { type Kysely, sql } from 'kysely'

// Spend that really happened, on an artifact row that no longer exists.
//
// `getWorkspaceAiSpendUsd` sums the ESTIMATED cost of every live `ready` artifact, so the cap it
// feeds is only honest while the artifact outlives the run. A retro AI draft does not: a facilitator
// stepping back from `group` to `brainstorm` deletes the draft (the artifact SHALL NOT exist during
// `brainstorm`), and the next advance drafts again on the same BYO key. Without this column the
// first run's cost leaves the workspace total the moment the row goes, and the cap under-fires
// silently — the one failure mode `cycle-digest.ts` calls out by name.
//
// One monotonic accumulator per team, never decremented, deliberately NOT in the Zero schema: it is
// billing accounting, not team state, and syncing it would push a row update to every client every
// time somebody rewinds a retro.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('team')
    .addColumn('ai_retired_spend_usd', sql`double precision`, (col) =>
      col.notNull().defaultTo(sql`0`),
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('team').dropColumn('ai_retired_spend_usd').execute()
}
