import type { Transaction } from '@rocicorp/zero'
import { type Kysely, type RawBuilder, sql } from 'kysely'
import type { DB } from '../../db/types.js'
import { tableShapes } from '../introspect.js'

// A real, authoritative `Transaction` backed by Postgres, for testing the shared mutators the way
// zero-cache runs them: every `tx.run` is a SELECT against the same open transaction, so a mutator
// READS ITS OWN WRITES and a test can observe an effect on rows it never stubbed.
//
// This exists because a hand-stubbed transaction — one whose `run()` replays a pre-seeded queue —
// cannot fail the class of bug that matters most here: a mutator that leaves the board internally
// inconsistent (a group emptied but not dissolved, dots charged against a vanished target). Those
// only appear when reads see the writes.
//
// It is deliberately strict. An unknown table, an unknown column or a query shape it cannot
// translate throws rather than degrading, so a mutator that grows a construct this harness does not
// model fails loudly instead of being silently under-tested.

interface ColumnMeta {
  readonly key: string
  readonly serverName: string
  readonly zeroType: string
  readonly pgType: string
}

interface TableMeta {
  readonly serverName: string
  readonly primaryKey: readonly ColumnMeta[]
  readonly columns: readonly ColumnMeta[]
  readonly byKey: ReadonlyMap<string, ColumnMeta>
}

export type PgSchemaMeta = ReadonlyMap<string, TableMeta>

// The Zero schema knows the column's logical type; only Postgres knows whether a `number()` column
// is an integer or a timestamptz, and that decides both directions of the value mapping.
export async function readPgSchemaMeta(db: Kysely<DB>): Promise<PgSchemaMeta> {
  const { rows } = await sql<{ table_name: string; column_name: string; data_type: string }>`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
  `.execute(db)

  const pgTypes = new Map<string, string>()
  for (const row of rows) {
    pgTypes.set(`${row.table_name}.${row.column_name}`, row.data_type)
  }

  const meta = new Map<string, TableMeta>()
  for (const shape of tableShapes()) {
    const columns = shape.columns.map((column) => ({
      key: column.key,
      serverName: column.serverName,
      zeroType: column.type,
      pgType: pgTypes.get(`${shape.serverName}.${column.serverName}`) ?? 'unknown',
    }))
    const byKey = new Map(columns.map((column) => [column.key, column]))
    const byServerName = new Map(columns.map((column) => [column.serverName, column]))
    const primaryKey = shape.primaryKey.map((serverName) => {
      const column = byServerName.get(serverName)
      if (column === undefined) {
        throw new Error(`${shape.name}: primary key column ${serverName} is not in the schema`)
      }
      return column
    })
    meta.set(shape.name, { serverName: shape.serverName, primaryKey, columns, byKey })
  }
  return meta
}

function isTimestamp(pgType: string): boolean {
  return pgType.startsWith('timestamp')
}

function fromPg(value: unknown, column: ColumnMeta): unknown {
  if (value === null || value === undefined) return null
  if (column.zeroType === 'number') {
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'string') return Number(value)
  }
  return value
}

// jsonb cannot take a bound JS object, and a `number()` column over timestamptz needs a Date, so
// every literal crosses through here on its way into SQL.
function toPg(value: unknown, column: ColumnMeta): RawBuilder<unknown> {
  if (value === null || value === undefined) return sql`null`
  if (column.zeroType === 'json') return sql`${JSON.stringify(value)}::jsonb`
  if (column.zeroType === 'number' && isTimestamp(column.pgType)) {
    return sql`${new Date(value as number)}`
  }
  return sql`${value}`
}

interface ColumnRef {
  readonly type: 'column'
  readonly name: string
}

interface LiteralRef {
  readonly type: 'literal'
  readonly value: unknown
}

interface SimpleCondition {
  readonly type: 'simple'
  readonly left: ColumnRef
  readonly right: LiteralRef
  readonly op: string
}

interface JunctionCondition {
  readonly type: 'and' | 'or'
  readonly conditions: readonly Condition[]
}

type Condition = SimpleCondition | JunctionCondition

interface QueryAst {
  readonly table: string
  readonly where?: Condition
  readonly limit?: number
  readonly orderBy?: readonly (readonly [string, 'asc' | 'desc'])[]
  readonly related?: readonly unknown[]
  readonly start?: unknown
}

function column(table: TableMeta, tableName: string, key: string): ColumnMeta {
  const found = table.byKey.get(key)
  if (found === undefined) throw new Error(`${tableName}: unknown column ${key}`)
  return found
}

function buildCondition(
  condition: Condition,
  table: TableMeta,
  tableName: string,
): RawBuilder<unknown> {
  if (condition.type === 'and' || condition.type === 'or') {
    if (condition.conditions.length === 0) return sql`true`
    const parts = condition.conditions.map((child) => buildCondition(child, table, tableName))
    const joiner = condition.type === 'and' ? sql` and ` : sql` or `
    return sql`(${sql.join(parts, joiner)})`
  }
  if (condition.type !== 'simple') {
    throw new Error(`unsupported condition ${JSON.stringify(condition)}`)
  }
  if (condition.left.type !== 'column' || condition.right.type !== 'literal') {
    throw new Error(`unsupported condition operands ${JSON.stringify(condition)}`)
  }

  const meta = column(table, tableName, condition.left.name)
  const ref = sql.ref(meta.serverName)
  const value = condition.right.value

  switch (condition.op) {
    case 'IS':
      return value === null
        ? sql`${ref} is null`
        : sql`${ref} is not distinct from ${toPg(value, meta)}`
    case 'IS NOT':
      return value === null
        ? sql`${ref} is not null`
        : sql`${ref} is distinct from ${toPg(value, meta)}`
    case '=':
      return sql`${ref} = ${toPg(value, meta)}`
    case '!=':
      return sql`${ref} <> ${toPg(value, meta)}`
    case '<':
      return sql`${ref} < ${toPg(value, meta)}`
    case '<=':
      return sql`${ref} <= ${toPg(value, meta)}`
    case '>':
      return sql`${ref} > ${toPg(value, meta)}`
    case '>=':
      return sql`${ref} >= ${toPg(value, meta)}`
    case 'IN': {
      const values = value as readonly unknown[]
      if (values.length === 0) return sql`false`
      return sql`${ref} in (${sql.join(
        values.map((entry) => toPg(entry, meta)),
        sql`, `,
      )})`
    }
    default:
      throw new Error(`unsupported operator ${condition.op}`)
  }
}

// Text ordering uses the byte-order collation the rank indexes use, so the harness sorts the way
// the fractional index (a plain JS string comparison) expects.
function orderExpression(meta: ColumnMeta, direction: 'asc' | 'desc'): RawBuilder<unknown> {
  const ref = sql.ref(meta.serverName)
  const collatable = meta.pgType === 'text' || meta.pgType.startsWith('character')
  const ordered = collatable ? sql`${ref} collate "C"` : ref
  return direction === 'desc' ? sql`${ordered} desc` : sql`${ordered} asc`
}

async function runQuery(db: Kysely<DB>, meta: PgSchemaMeta, ast: QueryAst): Promise<unknown[]> {
  if (ast.related !== undefined && ast.related.length > 0) {
    throw new Error(`${ast.table}: related queries are not supported by the Postgres test harness`)
  }
  if (ast.start !== undefined) {
    throw new Error(`${ast.table}: cursors are not supported by the Postgres test harness`)
  }
  const table = meta.get(ast.table)
  if (table === undefined) {
    throw new Error(`unknown table ${ast.table} — is it missing from the Zero schema?`)
  }

  const selection = sql.join(
    table.columns.map((entry) => sql`${sql.ref(entry.serverName)} as ${sql.ref(entry.key)}`),
    sql`, `,
  )
  const where = ast.where === undefined ? sql`true` : buildCondition(ast.where, table, ast.table)
  const ordering = sql.join(
    [
      ...(ast.orderBy ?? []).map(([key, direction]) =>
        orderExpression(column(table, ast.table, key), direction),
      ),
      ...table.primaryKey.map((entry) => orderExpression(entry, 'asc')),
    ],
    sql`, `,
  )
  const limit = ast.limit === undefined ? sql`` : sql` limit ${sql.lit(ast.limit)}`

  const { rows } = await sql<Record<string, unknown>>`
    select ${selection} from ${sql.table(table.serverName)}
    where ${where} order by ${ordering}${limit}
  `.execute(db)

  return rows.map((row) => {
    const mapped: Record<string, unknown> = {}
    for (const entry of table.columns) {
      mapped[entry.key] = fromPg(row[entry.key], entry)
    }
    return mapped
  })
}

interface WriteColumns {
  readonly names: RawBuilder<unknown>[]
  readonly values: RawBuilder<unknown>[]
  readonly assignments: RawBuilder<unknown>[]
}

function writeColumns(
  table: TableMeta,
  tableName: string,
  value: Record<string, unknown>,
  skipPrimaryKey: boolean,
): WriteColumns {
  const primaryKey = new Set(table.primaryKey.map((entry) => entry.key))
  const names: RawBuilder<unknown>[] = []
  const values: RawBuilder<unknown>[] = []
  const assignments: RawBuilder<unknown>[] = []
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue
    const meta = column(table, tableName, key)
    if (skipPrimaryKey && primaryKey.has(key)) continue
    names.push(sql`${sql.ref(meta.serverName)}`)
    values.push(toPg(raw, meta))
    assignments.push(sql`${sql.ref(meta.serverName)} = ${toPg(raw, meta)}`)
  }
  return { names, values, assignments }
}

function primaryKeyMatch(
  table: TableMeta,
  tableName: string,
  value: Record<string, unknown>,
): RawBuilder<unknown> {
  const parts = table.primaryKey.map((entry) => {
    const raw = value[entry.key]
    if (raw === undefined) {
      throw new Error(`${tableName}: write is missing primary key column ${entry.key}`)
    }
    return sql`${sql.ref(entry.serverName)} = ${toPg(raw, entry)}`
  })
  return sql`${sql.join(parts, sql` and `)}`
}

type Verb = 'insert' | 'update' | 'delete' | 'upsert'

async function applyWrite(
  db: Kysely<DB>,
  meta: PgSchemaMeta,
  tableName: string,
  verb: Verb,
  value: Record<string, unknown>,
): Promise<void> {
  const table = meta.get(tableName)
  if (table === undefined) {
    throw new Error(`unknown table ${tableName} — is it missing from the Zero schema?`)
  }

  if (verb === 'delete') {
    await sql`
      delete from ${sql.table(table.serverName)} where ${primaryKeyMatch(table, tableName, value)}
    `.execute(db)
    return
  }

  if (verb === 'update') {
    const { assignments } = writeColumns(table, tableName, value, true)
    if (assignments.length === 0) return
    await sql`
      update ${sql.table(table.serverName)} set ${sql.join(assignments, sql`, `)}
      where ${primaryKeyMatch(table, tableName, value)}
    `.execute(db)
    return
  }

  const { names, values } = writeColumns(table, tableName, value, false)
  const insert = sql`
    insert into ${sql.table(table.serverName)} (${sql.join(names, sql`, `)})
    values (${sql.join(values, sql`, `)})
  `
  if (verb === 'insert') {
    await insert.execute(db)
    return
  }

  const { assignments } = writeColumns(table, tableName, value, true)
  const conflict = sql.join(
    table.primaryKey.map((entry) => sql`${sql.ref(entry.serverName)}`),
    sql`, `,
  )
  const resolution =
    assignments.length === 0
      ? sql`do nothing`
      : sql`do update set ${sql.join(assignments, sql`, `)}`
  await sql`${insert} on conflict (${conflict}) ${resolution}`.execute(db)
}

// The wrapped Kysely transaction the server mutators reach through `serverDb(tx)` — the same shape
// zero-cache hands them, so the server-only writes (`retro_card_author`, the atomic tally bump) run
// against the very transaction the synced writes go to.
export function createPgServerTransaction(db: Kysely<DB>, meta: PgSchemaMeta): Transaction {
  const tableMutator = (tableName: string) => ({
    insert: (value: Record<string, unknown>) => applyWrite(db, meta, tableName, 'insert', value),
    update: (value: Record<string, unknown>) => applyWrite(db, meta, tableName, 'update', value),
    delete: (value: Record<string, unknown>) => applyWrite(db, meta, tableName, 'delete', value),
    upsert: (value: Record<string, unknown>) => applyWrite(db, meta, tableName, 'upsert', value),
  })

  return {
    location: 'server',
    reason: 'authoritative',
    dbTransaction: { wrappedTransaction: db },
    run: async (query: unknown) => {
      const { ast, format } = query as { ast: QueryAst; format?: { singular?: boolean } }
      const rows = await runQuery(db, meta, ast)
      return format?.singular === true ? rows[0] : rows
    },
    mutate: new Proxy({}, { get: (_target, table: string) => tableMutator(table) }),
  } as unknown as Transaction
}
