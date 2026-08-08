import { describe, expect, it } from 'vitest'
import { deletionOrderFor, type ForeignKeyEdge, orderByDependency } from './order'

// The reset's two pure decisions, checked without a database. Everything else in `reset.ts` is a
// query; these are the parts that can be wrong in a way Postgres never reports — a bad order fails
// loudly on a foreign key, but a silently empty table set makes the whole isolation gate green while
// inspecting nothing.

function before(order: readonly string[], table: string): number {
  const at = order.indexOf(table)
  expect(at, `${table} is missing from ${order.join(', ')}`).toBeGreaterThanOrEqual(0)
  return at
}

describe('orderByDependency', () => {
  it('emits children before the parents they reference', () => {
    const tables = ['workspace_member', 'issue', 'team', 'comment']
    const edges: ForeignKeyEdge[] = [
      { child: 'issue', parent: 'team' },
      { child: 'comment', parent: 'issue' },
      { child: 'workspace_member', parent: 'team' },
    ]

    const order = orderByDependency(tables, edges)

    expect(order).toHaveLength(tables.length)
    expect(new Set(order)).toEqual(new Set(tables))
    expect(before(order, 'comment')).toBeLessThan(before(order, 'issue'))
    expect(before(order, 'issue')).toBeLessThan(before(order, 'team'))
    expect(before(order, 'workspace_member')).toBeLessThan(before(order, 'team'))
  })

  it('treats a self-reference as a non-edge — one whole-table delete satisfies it', () => {
    const order = orderByDependency(
      ['issue', 'team'],
      [
        { child: 'issue', parent: 'issue' },
        { child: 'issue', parent: 'team' },
      ],
    )

    expect(order).toEqual(['issue', 'team'])
  })

  it('emits both tables of a cycle rather than looping forever', () => {
    const order = orderByDependency(
      ['retro', 'retro_action'],
      [
        { child: 'retro', parent: 'retro_action' },
        { child: 'retro_action', parent: 'retro' },
      ],
    )

    expect(new Set(order)).toEqual(new Set(['retro', 'retro_action']))
    expect(order).toHaveLength(2)
  })

  it('ignores edges naming a table outside the set it was given', () => {
    // `workspace` is preserved and `jwks` is never touched, so every edge that names one constrains
    // nothing here — and must not stop the table at the other end from being emitted.
    const order = orderByDependency(
      ['team', 'invite'],
      [
        { child: 'team', parent: 'workspace' },
        { child: 'invite', parent: 'workspace' },
        { child: 'session', parent: 'jwks' },
      ],
    )

    expect(new Set(order)).toEqual(new Set(['team', 'invite']))
  })

  it('returns nothing for no tables — the guard, not the sort, is what refuses that', () => {
    expect(orderByDependency([], [])).toEqual([])
  })
})

describe('deletionOrderFor', () => {
  it('refuses an empty table set, naming the schema it looked in', () => {
    expect(() => deletionOrderFor('public', [], [])).toThrowError(/schema "public"/)
    expect(() => deletionOrderFor('public', [], [])).toThrowError(/migrations have not run/)
  })

  it('orders a non-empty set the way the sort does', () => {
    const tables = ['issue', 'team']
    const edges: ForeignKeyEdge[] = [{ child: 'issue', parent: 'team' }]

    expect(deletionOrderFor('public', tables, edges)).toEqual(orderByDependency(tables, edges))
  })
})
