import { type Database, DEFAULT_WORKSPACE_NAME } from '@yapm/schema/db'
import { deletionOrderFor, type ForeignKeyEdge } from './order'

// Everything here goes through `database.pool` rather than the Kysely handle: `kysely` is a
// dependency of `packages/schema`, not of `apps/web`, and the harness has no business adding one to
// name a table it read out of `information_schema`.
type Pool = Database['pool']

// The application schema, and the whole of the harness's reach. zero-cache keeps its own
// bookkeeping (`clients`, `mutations` — the `lastMutationID` per client) in `zero_*` schemas of this
// same database, and those own themselves: clearing them would make the server reject or replay
// every queued mutation. pg-boss is installed into `pgboss` (`jobs/scheduler.ts`), so the job queue
// is out of reach here by construction rather than by an entry in the ignore set below.
// Restricting the sweep to `public` is what keeps this a fixture reset rather than a sync reset.
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
//
// Preserving the ROW is not the same as preserving its CONTENTS. `name` is the one column of it the
// product lets a test write, and a workspace renamed by one spec would otherwise be inherited by
// every spec after it — the last piece of mutable shared state a delete-everything sweep cannot
// reach. It is restored below, so "preserved" means "as the server left it at boot".
const PRESERVED_TABLES = new Set(['workspace'])

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

// Same reasoning one level down, for the one VALUE the reset writes. A multi-statement simple query
// takes no bind parameters at all — passing values would split the reset into several round trips
// and several implicit transactions — so the workspace name is interpolated. It is a repo-owned
// constant, not input, and this refuses rather than escapes if that ever stops being true.
function quoteLiteral(value: string): string {
  if (!/^[A-Za-z0-9 _-]+$/.test(value)) {
    throw new Error(`refusing to inline a workspace name that needs escaping: ${value}`)
  }
  return `'${value}'`
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

// The ordering itself, and the empty-set guard, live in `order.ts` — pure functions a unit test can
// call without a database.
async function deletionOrder(pool: Pool): Promise<string[]> {
  if (deletionOrderMemo !== undefined) return deletionOrderMemo
  const [tables, edges] = await Promise.all([resettableTables(pool), foreignKeys(pool)])
  deletionOrderMemo = deletionOrderFor(APP_SCHEMA, tables, edges)
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
  // The preserved row's contents, put back in the same query and therefore the same transaction: a
  // spec that renames the workspace must not hand that name to the next one.
  statements.push(`update "workspace" set name = ${quoteLiteral(DEFAULT_WORKSPACE_NAME)}`)
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

  // The row AND its contents: the name is read back here so the restore in `resetToBaseline` cannot
  // silently stop covering the one mutable column of the one preserved table.
  const workspaces = await database.pool.query<{ rows: number; name: string | null }>(
    'select count(*)::int as rows, min(name) as name from workspace',
  )
  const workspace = workspaces.rows[0]
  if (workspace?.rows !== 1) {
    throw new Error(
      `the e2e baseline expects exactly one workspace row, found ${workspace?.rows ?? 0}. ` +
        'The workspace is seeded once at boot and never recreated — restart the server stack.',
    )
  }
  if (workspace.name !== DEFAULT_WORKSPACE_NAME) {
    throw new Error(
      `the e2e baseline expects the workspace to be named "${DEFAULT_WORKSPACE_NAME}", found ` +
        `"${workspace.name}". The reset restores the name a spec may have changed; if this fails, ` +
        'that restore stopped running or stopped covering the column.',
    )
  }
}
