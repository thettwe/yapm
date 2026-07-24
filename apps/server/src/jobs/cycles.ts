import type { AuthContext } from '@yapm/schema'
import type { DB } from '@yapm/schema/db'
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
    .select('id')
    .where('status', '=', 'active')
    .where('end_date', '<=', nowDate)
    .orderBy('end_date', 'asc')
    .execute()
  for (const cycle of toComplete) {
    await dbProvider.transaction((tx) =>
      mutators.cycle.complete.fn({ tx, args: { id: cycle.id, updatedAt: now }, ctx: SYSTEM_CTX }),
    )
    completed.push(cycle.id)
  }

  return { activated, completed }
}
