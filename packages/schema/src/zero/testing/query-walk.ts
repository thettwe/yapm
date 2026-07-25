import type { QueryAst, QueryFormat } from './query-ast.js'

// Walks a synced query's RESULT against its AST, so every scalar a client would receive is reported
// with the table and field it came from.
//
// A plain deep walk for a user id cannot tell `user.id` (the workspace roster, public by design)
// from `retro_card.authorDisplayId` (the thing an anonymous retro must never carry). Provenance is
// what turns "this string appears somewhere" into a claim about the guarantee, and it is what makes
// the assertion fail closed: a column added to a synced table later is reported under its own name
// and has to be accounted for.

export interface VisitedValue {
  /** The Zero table the row came from. */
  readonly table: string
  /** The path to the scalar within that row — dotted through json columns. */
  readonly field: string
  readonly value: unknown
  readonly row: Readonly<Record<string, unknown>>
}

function hoistedSubquery(ast: QueryAst, alias: string): QueryAst {
  const inner = (ast.related ?? []).find((sub) => sub.subquery.alias === alias)
  if (inner === undefined) {
    throw new Error(`${ast.table}: a hidden junction has no ${alias} subquery to hoist`)
  }
  return inner.subquery
}

function visitScalars(
  table: string,
  row: Readonly<Record<string, unknown>>,
  path: string,
  value: unknown,
  out: VisitedValue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      visitScalars(table, row, `${path}[${index}]`, entry, out)
    })
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      visitScalars(table, row, `${path}.${key}`, nested, out)
    }
    return
  }
  out.push({ table, field: path, value, row })
}

function visitLevel(
  ast: QueryAst,
  format: QueryFormat | undefined,
  value: unknown,
  out: VisitedValue[],
): void {
  const rows = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
  const aliases = new Set(
    (ast.related ?? []).map((sub) => {
      const alias = sub.subquery.alias
      if (alias === undefined) {
        throw new Error(`${sub.subquery.table}: a related subquery with no alias is not modelled`)
      }
      return alias
    }),
  )

  for (const entry of rows) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${ast.table}: expected a row, received ${JSON.stringify(entry)}`)
    }
    const row = entry as Record<string, unknown>
    for (const [key, field] of Object.entries(row)) {
      if (aliases.has(key)) continue
      visitScalars(ast.table, row, key, field, out)
    }
    for (const sub of ast.related ?? []) {
      const alias = sub.subquery.alias as string
      const childFormat = format?.relationships?.[alias]
      const child = sub.hidden === true ? hoistedSubquery(sub.subquery, alias) : sub.subquery
      visitLevel(child, childFormat, row[alias], out)
    }
  }
}

export function walkQueryResult(
  ast: QueryAst,
  format: QueryFormat | undefined,
  result: unknown,
): VisitedValue[] {
  const out: VisitedValue[] = []
  visitLevel(ast, format, result, out)
  return out
}

export interface RegisteredQuery {
  readonly queryName: string
  readonly fn: (options: { args: unknown; ctx: unknown }) => unknown
}

function isRegisteredQuery(value: unknown): value is RegisteredQuery {
  return (
    typeof value === 'function' &&
    typeof (value as { queryName?: unknown }).queryName === 'string' &&
    typeof (value as { fn?: unknown }).fn === 'function'
  )
}

// Enumerates a `defineQueries` registry by walking it, so a query added by a later change is
// discovered rather than depending on someone remembering to list it.
export function registryQueries(registry: unknown): RegisteredQuery[] {
  const found: RegisteredQuery[] = []
  const walk = (node: unknown): void => {
    if (isRegisteredQuery(node)) {
      found.push(node)
      return
    }
    if (typeof node !== 'object' || node === null) return
    for (const [key, child] of Object.entries(node)) {
      if (key === '~') continue
      walk(child)
    }
  }
  walk(registry)
  return found.sort((left, right) => (left.queryName < right.queryName ? -1 : 1))
}
