import { createBuilder, createSchema, number, string, table } from '@rocicorp/zero'

const workspace = table('workspace')
  .columns({
    id: string(),
    name: string(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

export const schema = createSchema({
  tables: [workspace],
  relationships: [],
  enableLegacyMutators: false,
  enableLegacyQueries: false,
})

export const zql = createBuilder(schema)

export type Schema = typeof schema

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: typeof schema
  }
}
