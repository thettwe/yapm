import { type Kysely, sql } from 'kysely'
import type { DB } from '../../db/types.js'

// The server-only side of the anonymity boundary. `retro_card_author` is absent from the Zero schema,
// so these accessors are the ONLY way it is ever read or written — from the authoritative mutator
// pass, over the wrapped Kysely transaction. Nothing here returns an author to a client: the delete
// path compares against a caller-supplied id and answers yes/no.
//
// This module is imported only by `server-mutators.ts` (the `@yapm/schema/server` entry), so kysely
// never reaches the client bundle.

export interface RetroCardAuthorWrite {
  readonly cardId: string
  readonly retroId: string
  readonly authorId: string
}

// Idempotent by primary key, so re-running the publish pass writes each binding exactly once.
export async function recordRetroCardAuthor(
  db: Kysely<DB>,
  write: RetroCardAuthorWrite,
): Promise<void> {
  await sql`
    insert into retro_card_author (card_id, retro_id, author_id)
    values (${write.cardId}, ${write.retroId}, ${write.authorId})
    on conflict (card_id) do nothing
  `.execute(db)
}

// Answers "is this caller the author of this card?" without returning who the author is.
export async function isRetroCardAuthor(
  db: Kysely<DB>,
  cardId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await sql<{ match: boolean }>`
    select author_id = ${userId} as match from retro_card_author where card_id = ${cardId}
  `.execute(db)
  return rows[0]?.match === true
}

// Serializes the casts in one retro. The shared mutator counts the caller's own vote rows and then
// inserts; under READ COMMITTED two casts opened at the same moment both take the pre-insert count
// and both land, so a voter could spend past their budget — six dots against a budget of three,
// reproducibly. The lock is taken on the RETRO ROW, BEFORE the shared mutator runs its count, and is
// held to commit; READ COMMITTED takes a fresh snapshot per statement, so the count that follows
// sees the dot the previous holder committed.
//
// `for no key update` rather than `for update`: nine tables carry an FK to `retro.id`, so every
// insert of a card, draft, vote, group, action or presence heartbeat takes `for key share` on this
// same row. `for update` conflicts with that and would queue those writes behind every dot — and,
// worse, a mutator that clears a tally row before inserting a group (the auto-dissolve path) could
// then deadlock against a cast holding the retro row and waiting on that tally row. `for no key
// update` conflicts with itself and with the row's own updates, which is exactly the mutual
// exclusion the budget needs, and with nothing else.
//
// This lives on the authoritative path only. The optimistic client path never reaches it, so the dot
// and the remaining-budget readout stay instant; the server is the one that has to be right.
export async function lockRetroForVote(db: Kysely<DB>, retroId: string): Promise<void> {
  await db
    .selectFrom('retro')
    .select('id')
    .where('id', '=', retroId)
    .forNoKeyUpdate()
    .executeTakeFirst()
}

// The atomic tally write. A read-then-write count loses updates the moment a whole team votes at
// once, so the authoritative path increments the row in one statement — the same row-locked upsert
// the per-team sequence counters use.
export async function bumpRetroVoteTally(
  db: Kysely<DB>,
  tally: {
    readonly targetId: string
    readonly retroId: string
    readonly teamId: string
    readonly targetType: 'card' | 'group'
    readonly delta: 1 | -1
  },
): Promise<void> {
  await sql`
    insert into retro_vote_tally (target_id, retro_id, team_id, target_type, count, updated_at)
    values (
      ${tally.targetId}, ${tally.retroId}, ${tally.teamId}, ${tally.targetType},
      ${tally.delta > 0 ? 1 : 0}, now()
    )
    on conflict (target_id) do update
      set count = greatest(retro_vote_tally.count + ${tally.delta}, 0), updated_at = now()
  `.execute(db)
}
