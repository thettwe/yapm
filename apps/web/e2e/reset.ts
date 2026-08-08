import type { Database } from '@yapm/schema/db'

// Everything here goes through `database.pool` rather than the Kysely handle: `kysely` is a
// dependency of `packages/schema`, not of `apps/web`, and the harness has no business adding one to
// name a table it read out of `information_schema`.
type Pool = Database['pool']

// The application schema, and the whole of the harness's reach. zero-cache keeps its own
// bookkeeping (`clients`, `mutations` — the `lastMutationID` per client) in `zero_*` schemas of this
// same database, and those own themselves: clearing them would make the server reject or replay
// every queued mutation. Restricting the sweep to `public` is what keeps this a fixture reset
// rather than a sync reset.
const APP_SCHEMA = 'public'

// Tables inside `public` that the reset never touches:
//
// - `kysely_migration` / `kysely_migration_lock` — migration bookkeeping. Emptying it makes the
//   next boot replay every migration against a schema that already holds the objects.
// - `jwks` — better-auth's JWT signing keys. `apps/server/src/auth.ts` verifies every Zero token
//   against a REMOTE JWKS set (`createRemoteJWKSet`, fetched over loopback) which `jose` caches
//   behind a refetch cooldown, so rotating the key per test would park verification behind that
//   cooldown rather than fail fast.
const IGNORED_TABLES = new Set(['kysely_migration', 'kysely_migration_lock', 'jwks'])

// The one row the server creates at boot and never recreates: `seedWorkspace` inserts
// `where not exists (select 1 from workspace)`, so a deleted workspace only comes back on a
// restart. Everything else the baseline needs — the bootstrap admin's user, credential and
// membership — is rebuilt by the product's own paths on the next sign-up, because
// `bootstrapFirstAdmin` promotes the caller when `workspace_member` is empty AND their address
// matches `YAPM_BOOTSTRAP_ADMIN_EMAIL`.
const PRESERVED_TABLES = new Set(['workspace'])

interface ForeignKeyEdge {
  child: string
  parent: string
}

// The order is derived from the live schema, not from a list a human maintains, and the schema
// cannot change while the suite runs — migrations are applied once, at boot. Computed once per
// worker process.
let deletionOrderMemo: string[] | undefined

// Identifiers reach SQL by interpolation because a table name cannot be a bind parameter. They come
// from `information_schema`, so the only way one could carry a quote is if a migration created it
// that way; refusing outright is cheaper than reasoning about it.
function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`refusing to reset a table whose name needs escaping: ${name}`)
  }
  return `"${name}"`
}

async function resettableTables(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = $1 and table_type = 'BASE TABLE'`,
    [APP_SCHEMA],
  )
  return rows
    .map((row) => row.table_name)
    .filter((name) => !IGNORED_TABLES.has(name) && !PRESERVED_TABLES.has(name))
    .sort()
}

async function foreignKeys(pool: Pool): Promise<ForeignKeyEdge[]> {
  const { rows } = await pool.query<ForeignKeyEdge>(
    `select child.relname as child, parent.relname as parent
       from pg_constraint c
       join pg_class child on child.oid = c.conrelid
       join pg_class parent on parent.oid = c.confrelid
       join pg_namespace cn on cn.oid = child.relnamespace
       join pg_namespace pn on pn.oid = parent.relnamespace
      where c.contype = 'f' and cn.nspname = $1 and pn.nspname = $1`,
    [APP_SCHEMA],
  )
  return rows
}

// Children before parents. A self-reference is not an edge — one whole-table delete satisfies it —
// and a genuine cycle between two tables cannot be ordered at all, so those tables are emitted
// together and Postgres names the constraint if the delete really is impossible.
function orderByDependency(tables: readonly string[], edges: readonly ForeignKeyEdge[]): string[] {
  const known = new Set(tables)
  const referencedBy = new Map<string, Set<string>>()
  for (const table of tables) referencedBy.set(table, new Set())
  for (const edge of edges) {
    if (edge.child === edge.parent) continue
    if (!known.has(edge.child) || !known.has(edge.parent)) continue
    referencedBy.get(edge.parent)?.add(edge.child)
  }

  const order: string[] = []
  const remaining = new Set(tables)
  while (remaining.size > 0) {
    const free = [...remaining].filter((table) =>
      [...(referencedBy.get(table) ?? [])].every((child) => !remaining.has(child)),
    )
    if (free.length === 0) {
      order.push(...remaining)
      break
    }
    for (const table of free) {
      order.push(table)
      remaining.delete(table)
    }
  }
  return order
}

async function deletionOrder(pool: Pool): Promise<string[]> {
  if (deletionOrderMemo !== undefined) return deletionOrderMemo
  const [tables, edges] = await Promise.all([resettableTables(pool), foreignKeys(pool)])
  deletionOrderMemo = orderByDependency(tables, edges)
  return deletionOrderMemo
}

// Restore the state the server leaves behind at boot: one workspace row and nothing else.
//
// Ordinary `DELETE`, never `TRUNCATE`: a row delete is unambiguously carried by logical
// replication, and a `Truncate` message is not something this harness should be teaching Zero's
// change streamer to handle. All of them travel as ONE multi-statement simple query, which Postgres
// runs as a single implicit transaction — so zero-cache sees one atomic disappearance rather than a
// schema-order stutter, the background search indexer never observes a half-cleared database, and
// the whole reset costs one round trip.
export async function resetToBaseline(database: Database): Promise<void> {
  const order = await deletionOrder(database.pool)
  const statements = order.map((table) => `delete from ${quoteIdentifier(table)}`)
  await database.pool.query(statements.join('; '))
}

// The contract, executed. Deliberately close to tautological against `resetToBaseline` — that is
// the point: it catches a reset that silently stopped covering a table, which is the failure mode a
// hand-maintained list has. Both sides read the same schema, so a table added by a later change
// joins both with no human step.
export async function assertBaseline(database: Database): Promise<void> {
  const tables = await deletionOrder(database.pool)
  const counts = tables.map(
    (table) => `select '${table}' as name, count(*)::int as rows from ${quoteIdentifier(table)}`,
  )
  const { rows } = await database.pool.query<{ name: string; rows: number }>(
    counts.join(' union all '),
  )

  const dirty = rows.filter((row) => row.rows > 0)
  if (dirty.length > 0) {
    const detail = dirty.map((row) => `${row.name}=${row.rows}`).join(', ')
    throw new Error(
      `the e2e baseline is dirty after the reset: ${detail}. ` +
        'Either the reset stopped covering a table, or something wrote rows while it ran.',
    )
  }

  const workspaces = await database.pool.query<{ rows: number }>(
    'select count(*)::int as rows from workspace',
  )
  if (workspaces.rows[0]?.rows !== 1) {
    throw new Error(
      `the e2e baseline expects exactly one workspace row, found ${workspaces.rows[0]?.rows ?? 0}. ` +
        'The workspace is seeded once at boot and never recreated — restart the server stack.',
    )
  }
}
