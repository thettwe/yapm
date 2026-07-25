import type { Transaction } from '@rocicorp/zero'
import { type Kysely, type RawBuilder, sql } from 'kysely'
import type { DB } from '../../db/types.js'
import { tableShapes } from '../introspect.js'
import type {
  BuiltQuery,
  Condition,
  CorrelatedSubquery,
  CorrelatedSubqueryCondition,
  QueryAst,
  QueryFormat,
} from './query-ast.js'

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
//
// It also evaluates the SYNCED QUERIES, which is what the anonymity proof needs: `related`
// subqueries are fetched per parent row and shaped by the query's `format`, and a correlated
// `whereExists` — how `teamScoped` is written, and therefore how every read permission in this
// codebase is expressed — compiles to a correlated `exists (…)`. Without those two, the registry
// could not be evaluated at all, and the guarantee would rest on reading the queries rather than
// running them.

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

function column(table: TableMeta, tableName: string, key: string): ColumnMeta {
  const found = table.byKey.get(key)
  if (found === undefined) throw new Error(`${tableName}: unknown column ${key}`)
  return found
}

function mustTable(meta: PgSchemaMeta, tableName: string): TableMeta {
  const table = meta.get(tableName)
  if (table === undefined) {
    throw new Error(`unknown table ${tableName} — is it missing from the Zero schema?`)
  }
  return table
}

// Every statement the harness emits qualifies its column references, because a correlated subquery
// has to name a column of the row one level up. Aliases are allocated per statement from a single
// counter so a nested EXISTS can never shadow its parent.
interface AliasScope {
  next: number
}

function nextAlias(scope: AliasScope): string {
  const alias = `q${scope.next}`
  scope.next += 1
  return alias
}

function qualified(alias: string, meta: ColumnMeta): RawBuilder<unknown> {
  return sql.ref(`${alias}.${meta.serverName}`)
}

// `whereExists` compiles to a correlated `exists (…)` rather than a join, which is what makes
// `teamScoped` — the predicate every team query is wrapped in — evaluable here. Its own subquery may
// carry another one (team → members is two levels), so this recurses through `buildCondition`.
function buildExists(
  condition: CorrelatedSubqueryCondition,
  parentTable: TableMeta,
  parentTableName: string,
  parentAlias: string,
  meta: PgSchemaMeta,
  scope: AliasScope,
): RawBuilder<unknown> {
  if (condition.flip === true || condition.scalar === true) {
    throw new Error(`unsupported correlated subquery ${JSON.stringify({ op: condition.op })}`)
  }
  const sub = condition.related.subquery
  if (sub.limit !== undefined || sub.start !== undefined) {
    throw new Error(`${sub.table}: a bounded correlated subquery is not modelled by this harness`)
  }
  const childTable = mustTable(meta, sub.table)
  const childAlias = nextAlias(scope)
  const { parentField, childField } = condition.related.correlation
  if (parentField.length === 0 || parentField.length !== childField.length) {
    throw new Error(`${sub.table}: unsupported correlation ${JSON.stringify({ parentField })}`)
  }
  const links = parentField.map(
    (field, index) =>
      sql`${qualified(parentAlias, column(parentTable, parentTableName, field))} = ${qualified(
        childAlias,
        column(childTable, sub.table, childField[index] as string),
      )}`,
  )
  const inner =
    sub.where === undefined
      ? sql`true`
      : buildCondition(sub.where, childTable, sub.table, childAlias, meta, scope)
  const clause = sql`
    select 1 from ${sql.table(childTable.serverName)} as ${sql.ref(childAlias)}
    where ${sql.join([...links, inner], sql` and `)}
  `
  return condition.op === 'NOT EXISTS' ? sql`not exists (${clause})` : sql`exists (${clause})`
}

function buildCondition(
  condition: Condition,
  table: TableMeta,
  tableName: string,
  alias: string,
  meta: PgSchemaMeta,
  scope: AliasScope,
): RawBuilder<unknown> {
  if (condition.type === 'and' || condition.type === 'or') {
    if (condition.conditions.length === 0) {
      return condition.type === 'and' ? sql`true` : sql`false`
    }
    const parts = condition.conditions.map((child) =>
      buildCondition(child, table, tableName, alias, meta, scope),
    )
    const joiner = condition.type === 'and' ? sql` and ` : sql` or `
    return sql`(${sql.join(parts, joiner)})`
  }
  if (condition.type === 'correlatedSubquery') {
    return buildExists(condition, table, tableName, alias, meta, scope)
  }
  if (condition.type !== 'simple') {
    throw new Error(`unsupported condition ${JSON.stringify(condition)}`)
  }
  if (condition.left.type !== 'column' || condition.right.type !== 'literal') {
    throw new Error(`unsupported condition operands ${JSON.stringify(condition)}`)
  }

  const columnMeta = column(table, tableName, condition.left.name)
  const ref = qualified(alias, columnMeta)
  const value = condition.right.value

  switch (condition.op) {
    case 'IS':
      return value === null
        ? sql`${ref} is null`
        : sql`${ref} is not distinct from ${toPg(value, columnMeta)}`
    case 'IS NOT':
      return value === null
        ? sql`${ref} is not null`
        : sql`${ref} is distinct from ${toPg(value, columnMeta)}`
    case '=':
      return sql`${ref} = ${toPg(value, columnMeta)}`
    case '!=':
      return sql`${ref} <> ${toPg(value, columnMeta)}`
    case '<':
      return sql`${ref} < ${toPg(value, columnMeta)}`
    case '<=':
      return sql`${ref} <= ${toPg(value, columnMeta)}`
    case '>':
      return sql`${ref} > ${toPg(value, columnMeta)}`
    case '>=':
      return sql`${ref} >= ${toPg(value, columnMeta)}`
    case 'IN': {
      const values = value as readonly unknown[]
      if (values.length === 0) return sql`false`
      return sql`${ref} in (${sql.join(
        values.map((entry) => toPg(entry, columnMeta)),
        sql`, `,
      )})`
    }
    default:
      throw new Error(`unsupported operator ${condition.op}`)
  }
}

// Text ordering uses the byte-order collation the rank indexes use, so the harness sorts the way
// the fractional index (a plain JS string comparison) expects.
function orderExpression(
  alias: string,
  meta: ColumnMeta,
  direction: 'asc' | 'desc',
): RawBuilder<unknown> {
  const ref = qualified(alias, meta)
  const collatable = meta.pgType === 'text' || meta.pgType.startsWith('character')
  const ordered = collatable ? sql`${ref} collate "C"` : ref
  return direction === 'desc' ? sql`${ordered} desc` : sql`${ordered} asc`
}

interface Correlated {
  readonly key: string
  readonly value: unknown
}

// One SELECT per level, correlated by value rather than joined: a related subquery is re-run per
// parent row with that row's correlation values bound in. N+1 by construction, which is the right
// trade for a harness — the shape stays a direct reading of the AST, and the row counts are a test
// fixture's.
async function runQuery(
  db: Kysely<DB>,
  meta: PgSchemaMeta,
  ast: QueryAst,
  format: QueryFormat | undefined,
  correlated: readonly Correlated[] = [],
): Promise<Record<string, unknown>[]> {
  if (ast.start !== undefined) {
    throw new Error(`${ast.table}: cursors are not supported by the Postgres test harness`)
  }
  const table = mustTable(meta, ast.table)
  const scope: AliasScope = { next: 0 }
  const alias = nextAlias(scope)

  // A null correlation value matches nothing, exactly as `x = null` does — an issue with no
  // assignee has no related `assignee` row rather than every user.
  if (correlated.some((entry) => entry.value === null || entry.value === undefined)) return []

  const selection = sql.join(
    table.columns.map((entry) => sql`${qualified(alias, entry)} as ${sql.ref(entry.key)}`),
    sql`, `,
  )
  const predicates = [
    ...correlated.map((entry) => {
      const columnMeta = column(table, ast.table, entry.key)
      return sql`${qualified(alias, columnMeta)} = ${toPg(entry.value, columnMeta)}`
    }),
    ast.where === undefined
      ? sql`true`
      : buildCondition(ast.where, table, ast.table, alias, meta, scope),
  ]
  const ordering = sql.join(
    [
      ...(ast.orderBy ?? []).map(([key, direction]) =>
        orderExpression(alias, column(table, ast.table, key), direction),
      ),
      ...table.primaryKey.map((entry) => orderExpression(alias, entry, 'asc')),
    ],
    sql`, `,
  )
  const limit = ast.limit === undefined ? sql`` : sql` limit ${sql.lit(ast.limit)}`

  const { rows } = await sql<Record<string, unknown>>`
    select ${selection} from ${sql.table(table.serverName)} as ${sql.ref(alias)}
    where ${sql.join(predicates, sql` and `)} order by ${ordering}${limit}
  `.execute(db)

  const mapped = rows.map((row) => {
    const entry: Record<string, unknown> = {}
    for (const columnMeta of table.columns) {
      entry[columnMeta.key] = fromPg(row[columnMeta.key], columnMeta)
    }
    return entry
  })

  for (const sub of ast.related ?? []) {
    await attachRelated(db, meta, mapped, sub, format)
  }
  return mapped
}

async function attachRelated(
  db: Kysely<DB>,
  meta: PgSchemaMeta,
  rows: Record<string, unknown>[],
  sub: CorrelatedSubquery,
  format: QueryFormat | undefined,
): Promise<void> {
  const alias = sub.subquery.alias
  if (alias === undefined) {
    throw new Error(`${sub.subquery.table}: a related subquery with no alias is not modelled`)
  }
  const childFormat = format?.relationships?.[alias]
  // A junction hop is invisible in the result: its own related rows are hoisted under the same
  // alias, so the nested level is what the parent's format actually describes.
  const nestedFormat: QueryFormat | undefined =
    sub.hidden === true
      ? { singular: false, relationships: { [alias]: childFormat ?? {} } }
      : childFormat

  for (const row of rows) {
    const correlated = sub.correlation.parentField.map((field, index) => ({
      key: sub.correlation.childField[index] as string,
      value: row[field],
    }))
    const children = await runQuery(db, meta, sub.subquery, nestedFormat, correlated)
    if (sub.hidden === true) {
      row[alias] = children.flatMap((child) => {
        const hoisted = child[alias]
        return Array.isArray(hoisted) ? hoisted : hoisted === undefined ? [] : [hoisted]
      })
      continue
    }
    row[alias] = childFormat?.singular === true ? children[0] : children
  }
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
  const table = mustTable(meta, tableName)

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
      const { ast, format } = query as BuiltQuery
      const rows = await runQuery(db, meta, ast, format)
      return format?.singular === true ? rows[0] : rows
    },
    mutate: new Proxy({}, { get: (_target, table: string) => tableMutator(table) }),
  } as unknown as Transaction
}
