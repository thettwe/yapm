// The two pure decisions inside the e2e reset, split out so a unit test can reach them.
//
// `apps/web/e2e` is outside `apps/web/tsconfig.json`'s `include` (design D11) and outside Vitest's
// `include`, and `reset.ts` itself needs a live Postgres to call at all — so until this file
// existed, the topological sort and the empty-set guard, the two things that decide whether the
// isolation gate works or silently inspects nothing, were checked by no gate in the repo.
//
// Nothing imported: `order.test.ts` runs under the web unit suite, which has no database and no
// `kysely`.

export interface ForeignKeyEdge {
  child: string
  parent: string
}

// Children before parents. A self-reference is not an edge — one whole-table delete satisfies it —
// and a genuine cycle between two tables cannot be ordered at all, so those tables are emitted
// together and Postgres names the constraint if the delete really is impossible. An edge naming a
// table outside the set (a preserved or ignored one) constrains nothing here and is dropped.
export function orderByDependency(
  tables: readonly string[],
  edges: readonly ForeignKeyEdge[],
): string[] {
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

// An empty set is the one way this whole gate could pass while doing nothing: a reset that clears no
// table and an assertion that counts no row are both vacuously green. It can only happen if the
// schema name is wrong or the migrations never ran, and both deserve a name rather than a suite that
// reports success for a database it never looked at.
export function deletionOrderFor(
  schema: string,
  tables: readonly string[],
  edges: readonly ForeignKeyEdge[],
): string[] {
  if (tables.length === 0) {
    throw new Error(
      `the e2e reset found no base tables in schema "${schema}". ` +
        'Either DATABASE_URL points somewhere the migrations have not run, or the schema moved.',
    )
  }
  return orderByDependency(tables, edges)
}
