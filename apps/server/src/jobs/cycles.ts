import {
  type AuthContext,
  type CycleFacts,
  type CycleOrderRow,
  DEFAULT_RETRO_FORMAT,
  initialRanks,
  newId,
  nextCycleId,
  RETRO_FORMAT_COLUMNS,
  RETRO_PRESENCE_STALE_MS,
} from '@yapm/schema'
import { cycleFactsForTeam, type DB } from '@yapm/schema/db'
import type { createServerMutators } from '@yapm/schema/server'
import { type Kysely, type SqlBool, sql } from 'kysely'
import type { ZeroDatabase } from '../zero/db-provider.js'

// Rollover runs as the workspace itself: an admin system principal so `canWrite` passes and
// the team-scoped write gate is bypassed for every team. No user is impersonated.
const SYSTEM_CTX: AuthContext = { userID: 'system', role: 'admin' }

type ServerMutators = ReturnType<typeof createServerMutators>

export interface CycleMaintenanceResult {
  activated: string[]
  completed: string[]
  retrosOpened: string[]
  presencePruned: number
}

export interface CycleMaintenanceOptions {
  // Invoked once per cycle at close, with the facts captured BEFORE rollover re-points its
  // unfinished issues (so the carried set is accurate). The digest scheduler uses this to enqueue
  // the pre-compute job off the hot path. Absent ⇒ no facts are computed and nothing is enqueued.
  onCycleClosing?: (facts: CycleFacts) => Promise<void>
}

// The retro's id and its column ids are minted HERE, at the job's own call site, because a mutator
// re-runs on rebase and an id minted inside one changes between runs. The job is a call site like
// any other: the Cycles view's Complete-cycle action mints exactly the same shape. Columns come
// from the named format's template, which `retro.openForCycle` re-validates server-side.
function openRetroArgs(
  cycleId: string,
  nextCycle: string | null,
  at: number,
): Parameters<ServerMutators['retro']['openForCycle']['fn']>[0]['args'] {
  const template = RETRO_FORMAT_COLUMNS[DEFAULT_RETRO_FORMAT]
  const ranks = initialRanks(template.length)
  return {
    id: newId(),
    cycleId,
    nextCycleId: nextCycle,
    format: DEFAULT_RETRO_FORMAT,
    columns: template.map((column, index) => ({
      id: newId(),
      key: column.key,
      title: column.title,
      accentToken: column.accentToken,
      rank: ranks[index] ?? '',
    })),
    createdAt: at,
    updatedAt: at,
  }
}

// Deterministic, idempotent maintenance pass: promote every upcoming cycle whose start has
// passed to active, then complete every active cycle whose end has passed (which rolls its
// unfinished issues into the next cycle via the shared `cycle.complete` mutator). Each cycle
// is driven through the same mutator the UI calls, inside one ZQL transaction, so the status
// guard in `cycle.complete` makes a re-run — the scheduler racing a manual action, or a
// retried job — a no-op.
//
// The same pass opens each completed cycle's retrospective and prunes stale retro presence. Both
// ride the existing job: no new job type, no new scheduler, no new container, no new env var.
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
  const retrosOpened: string[] = []

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
    .select(['id', 'team_id', 'status', 'number', 'start_date'])
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
    const successor = await resolveNextCycleId(db, cycle)
    await dbProvider.transaction((tx) =>
      mutators.cycle.complete.fn({ tx, args: { id: cycle.id, updatedAt: now }, ctx: SYSTEM_CTX }),
    )
    completed.push(cycle.id)
    if (facts && options.onCycleClosing) await options.onCycleClosing(facts)

    // A completed cycle opens its retrospective. `retro.openForCycle` is a no-op when the cycle
    // already has one, so this pass racing the deliberate Complete-cycle action — or a retried job
    // — still yields exactly one retro, with the unique index on `retro.cycle_id` as the backstop.
    const args = openRetroArgs(cycle.id, successor, now)
    await dbProvider.transaction((tx) =>
      mutators.retro.openForCycle.fn({ tx, args, ctx: SYSTEM_CTX }),
    )
    const opened = await db
      .selectFrom('retro')
      .select('id')
      .where('cycle_id', '=', cycle.id)
      .executeTakeFirst()
    if (opened?.id === args.id) retrosOpened.push(args.id)
  }

  // "Who's here" stays accurate without a heartbeat-expiry job: the rows a departed participant
  // stopped refreshing are swept here, in the pass that already runs.
  // `last_seen_at` is a DB-defaulted (`Generated<Timestamp>`) column, whose operand typing does not
  // accept a plain `Date` under this project's TS config; a raw predicate compares it cleanly.
  const pruned = await db
    .deleteFrom('retro_presence')
    .where(
      sql<SqlBool>`${sql.ref('retro_presence.last_seen_at')} < ${new Date(now - RETRO_PRESENCE_STALE_MS)}`,
    )
    .executeTakeFirst()

  return {
    activated,
    completed,
    retrosOpened,
    presencePruned: Number(pruned?.numDeletedRows ?? 0n),
  }
}

// The retro's `next_cycle_id` — the default target for its action items — resolved by the SAME
// deterministic successor rule the rollover uses, so an action lands where the cycle's unfinished
// work did. Read from Postgres rather than passed in because the pass may have just activated a
// cycle that changes the answer.
async function resolveNextCycleId(
  db: Kysely<DB>,
  source: CompletingCycleRow,
): Promise<string | null> {
  const rows = await db
    .selectFrom('cycle')
    .select(['id', 'status', 'number', 'start_date'])
    .where('team_id', '=', source.team_id)
    .execute()
  return nextCycleId(rows.map(toCycleOrderRow), toCycleOrderRow(source))
}

interface CompletingCycleRow {
  readonly id: string
  readonly team_id: string
  readonly status: CycleOrderRow['status']
  readonly number: number | null
  readonly start_date: Date
}

function toCycleOrderRow(row: {
  id: string
  status: CycleOrderRow['status']
  number: number | null
  start_date: Date
}): CycleOrderRow {
  return {
    id: row.id,
    status: row.status,
    number: row.number,
    startDate: row.start_date.getTime(),
  }
}
