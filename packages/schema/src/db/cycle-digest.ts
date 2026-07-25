import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { CycleDigest, DB } from './types.js'

// The per-workspace running spend total the gateway's optional cap is checked against: the sum of
// every `ready` digest's ESTIMATED cost across the workspace's teams. Cheap read; the pre-compute
// job passes it as `spendSoFarUsd` so a run past the cap is refused (and written `ai_off`).
export async function getWorkspaceAiSpendUsd(db: Kysely<DB>, workspaceId: string): Promise<number> {
  const row = await db
    .selectFrom('cycle_digest')
    .innerJoin('team', 'team.id', 'cycle_digest.team_id')
    .select((eb) =>
      eb.fn.coalesce(eb.fn.sum('cycle_digest.estimated_cost_usd'), sql<number>`0`).as('total'),
    )
    .where('team.workspace_id', '=', workspaceId)
    .where('cycle_digest.status', '=', 'ready')
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
