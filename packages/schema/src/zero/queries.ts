import { defineQueries, defineQuery, type Query, type Schema } from '@rocicorp/zero'
import { canRead } from './context.js'
import { zql } from './schema.js'

export function denyAll<
  TTable extends keyof TSchema['tables'] & string,
  TSchema extends Schema,
  TReturn,
>(q: Query<TTable, TSchema, TReturn>): Query<TTable, TSchema, TReturn> {
  return q.where(({ or }) => or())
}

export const queries = defineQueries({
  workspace: {
    current: defineQuery(({ ctx }) => {
      const q = zql.workspace.orderBy('createdAt', 'asc')
      return (canRead(ctx) ? q : denyAll(q)).one()
    }),
  },
})

export const WORKSPACE_CURRENT_QUERY_NAME = 'workspace.current'
