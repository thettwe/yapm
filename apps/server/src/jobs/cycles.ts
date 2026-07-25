import type { AuthContext, CycleFacts } from '@yapm/schema'
import { cycleFactsForTeam, type DB } from '@yapm/schema/db'
import type { createServerMutators } from '@yapm/schema/server'
import type { Kysely } from 'kysely'
import type { ZeroDatabase } from '../zero/db-provider.js'

// Rollover runs as the workspace itself: an admin system principal so `canWrite` passes and
// the team-scoped write gate is bypassed for every team. No user is impersonated.
const SYSTEM_CTX: AuthContext = { userID: 'system', role: 'admin' }

type ServerMutators = ReturnType<typeof createServerMutators>

export interface CycleMaintenanceResult {
  activated: string[]
  completed: string[]
}

export interface CycleMaintenanceOptions {
  // Invoked once per cycle at close, with the facts captured BEFORE rollover re-points its
  // unfinished issues (so the carried set is accurate). The digest scheduler uses this to enqueue
  // the pre-compute job off the hot path. Absent ⇒ no facts are computed and nothing is enqueued.
  onCycleClosing?: (facts: CycleFacts) => Promise<void>
}

// Deterministic, idempotent maintenance pass: promote every upcoming cycle whose start has
// passed to active, then complete every active cycle whose end has passed (which rolls its
// unfinished issues into the next cycle via the shared `cycle.complete` mutator). Each cycle
// is driven through the same mutator the UI calls, inside one ZQL transaction, so the status
// guard in `cycle.complete` makes a re-run — the scheduler racing a manual action, or a
// retried job — a no-op.
export async function runCycleMaintenance(
  db: Kysely<DB>,
  dbProvider: ZeroDatabase,
  mutators: ServerMutators,
  now: number,
  options: CycleMaintenanceOptions = {},
): Promise<CycleMaintenanceResult> {
  const nowDate = new Date(now)
  const activated: string[] = []
  const completed: string[] = []

  const toActivate = await db
    .selectFrom('cycle')
    .select('id')
    .where('status', '=', 'upcoming')
    .where('start_date', '<=', nowDate)
    .orderBy('start_date', 'asc')
    .execute()
  for (const cycle of toActivate) {
    await dbProvider.transaction((tx) =>
      mutators.cycle.activate.fn({ tx, args: { id: cycle.id, updatedAt: now }, ctx: SYSTEM_CTX }),
    )
    activated.push(cycle.id)
  }

  const toComplete = await db
    .selectFrom('cycle')
    .select(['id', 'team_id'])
    .where('status', '=', 'active')
    .where('end_date', '<=', nowDate)
    .orderBy('end_date', 'asc')
    .execute()
  for (const cycle of toComplete) {
    // Capture the digest facts BEFORE completing: `cycle.complete` rolls unfinished issues into
    // the next cycle, so reading them afterwards would lose the carried set. The AI call itself is
    // deferred to the digest worker (off the hot path) — only these cheap reads run inline.
    const facts = options.onCycleClosing
      ? await cycleFactsForTeam(db, cycle.team_id, cycle.id)
      : null
    await dbProvider.transaction((tx) =>
      mutators.cycle.complete.fn({ tx, args: { id: cycle.id, updatedAt: now }, ctx: SYSTEM_CTX }),
    )
    completed.push(cycle.id)
    if (facts && options.onCycleClosing) await options.onCycleClosing(facts)
  }

  return { activated, completed }
}
