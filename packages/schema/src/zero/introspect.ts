import { schema } from './schema.js'

export interface ColumnShape {
  key: string
  serverName: string
  type: string
  optional: boolean
}

export interface TableShape {
  name: string
  serverName: string
  columns: ColumnShape[]
  primaryKey: string[]
}

interface RawColumn {
  type: string
  optional: boolean
  serverName?: string
}

interface RawTable {
  name: string
  serverName?: string
  columns: Record<string, RawColumn>
  primaryKey: readonly string[]
}

// createSchema types `serverName` as present only on columns that used `.from()`, so a
// structural walk is the only way to read "database name = serverName ?? key" uniformly.
export function tableShapes(): TableShape[] {
  const tables = Object.values(schema.tables) as unknown as RawTable[]

  return tables.map((table) => {
    const columns = Object.entries(table.columns).map(([key, column]) => ({
      key,
      serverName: column.serverName ?? key,
      type: column.type,
      optional: column.optional,
    }))
    const byKey = new Map(columns.map((column) => [column.key, column]))

    return {
      name: table.name,
      serverName: table.serverName ?? table.name,
      columns,
      primaryKey: table.primaryKey.map((key) => byKey.get(key)?.serverName ?? key),
    }
  })
}
