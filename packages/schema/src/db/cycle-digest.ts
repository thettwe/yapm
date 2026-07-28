import type { Kysely, SqlBool } from 'kysely'
import { sql } from 'kysely'
import type { CycleDigest, DB } from './types.js'

// The per-workspace running spend total the gateway's optional cap is checked against: the sum of
// every `ready` AI artifact's ESTIMATED cost across the workspace's teams. Cheap read; each
// pre-compute job passes it as `spendSoFarUsd` so a run past the cap is refused (and written
// `ai_off`).
//
// THERE IS EXACTLY ONE OF THESE, and it must name EVERY artifact table. A table missing from this
// union is invisible to the cap, so a capped workspace keeps spending someone's BYO key long past
// the limit — silently under-firing, the worst kind of cap. `scripts/check-boundaries.mjs` rule 4
// fails a second `sum('estimated_cost_usd')` anywhere else under `packages/schema/src`. Adding a
// third artifact table is one entry here; forgetting one is a billing surprise on someone else's key.
export async function getWorkspaceAiSpendUsd(db: Kysely<DB>, workspaceId: string): Promise<number> {
  const digests = db
    .selectFrom('cycle_digest')
    .innerJoin('team', 'team.id', 'cycle_digest.team_id')
    .select('cycle_digest.estimated_cost_usd as cost')
    .where('team.workspace_id', '=', workspaceId)
    .where('cycle_digest.status', '=', 'ready')

  const retroDrafts = db
    .selectFrom('retro_ai_draft')
    .innerJoin('team', 'team.id', 'retro_ai_draft.team_id')
    .select('retro_ai_draft.estimated_cost_usd as cost')
    .where('team.workspace_id', '=', workspaceId)
    .where('retro_ai_draft.status', '=', 'ready')

  const row = await db
    .selectFrom(digests.unionAll(retroDrafts).as('artifact'))
    .select((eb) => eb.fn.coalesce(eb.fn.sum('artifact.cost'), sql<number>`0`).as('total'))
    .executeTakeFirst()
  return Number(row?.total ?? 0)
}

// Server read of a cycle's digest row (the clients read it via the `digests` synced query; this is
// for the job/tests). Null when none has been produced yet.
export async function getCycleDigestByCycle(
  db: Kysely<DB>,
  cycleId: string,
): Promise<CycleDigest | null> {
  const row = await db
    .selectFrom('cycle_digest')
    .selectAll()
    .where('cycle_id', '=', cycleId)
    .executeTakeFirst()
  return row ?? null
}

export interface CycleNeedingDigest {
  readonly id: string
  readonly teamId: string
}

export interface CyclesNeedingDigestOptions {
  // Only sweep cycles completed at/after this instant — bounds the historical backlog so enabling
  // the digest on an existing instance does not enqueue a job (or spend) for every past cycle.
  readonly completedSince: Date
  // Cycles already handled this pass (the scheduler completed them and enqueued a digest with fresh
  // pre-rollover facts) — excluded so the sweep never double-enqueues them.
  readonly exclude?: readonly string[]
  readonly limit: number
}

// The manual-completion sweep's source query: completed cycles that have NO `cycle_digest` row yet
// (so the scheduler's `onCycleClosing` never ran for them — they were completed by hand through the
// shared `cycle.complete` mutator, which the pg-boss scheduler never re-selects). Bounded by a
// recency window and a hard limit so a first-enable never floods the digest queue. The unique
// `cycle_digest.cycle_id` row a swept cycle then gets acts as the idempotency guard for later passes.
export async function cyclesNeedingDigest(
  db: Kysely<DB>,
  options: CyclesNeedingDigestOptions,
): Promise<CycleNeedingDigest[]> {
  let query = db
    .selectFrom('cycle')
    .select(['cycle.id as id', 'cycle.team_id as teamId'])
    .where('cycle.status', '=', 'completed')
    // `updated_at` is a DB-defaulted (`Generated<Timestamp>`) column, whose operand typing does not
    // accept a plain `Date` under this project's TS config; a raw predicate compares it cleanly.
    .where(sql<SqlBool>`${sql.ref('cycle.updated_at')} >= ${options.completedSince}`)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('cycle_digest')
            .select('cycle_digest.id')
            .whereRef('cycle_digest.cycle_id', '=', 'cycle.id'),
        ),
      ),
    )
    .orderBy('cycle.updated_at', 'desc')
    .limit(options.limit)
  if (options.exclude && options.exclude.length > 0) {
    query = query.where('cycle.id', 'not in', options.exclude)
  }
  return query.execute()
}
