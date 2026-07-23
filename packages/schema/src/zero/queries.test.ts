import { mustGetQuery } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { tableShapes } from './introspect.js'
import { queries, WORKSPACE_CURRENT_QUERY_NAME } from './queries.js'
import { schema } from './schema.js'

describe('the synced query registry', () => {
  it('names the workspace query the way the server resolves it', () => {
    expect(queries.workspace.current.queryName).toBe(WORKSPACE_CURRENT_QUERY_NAME)
    expect(mustGetQuery(queries, WORKSPACE_CURRENT_QUERY_NAME)).toBe(queries.workspace.current)
  })

  it('has no entry a client could reach outside the registry', () => {
    expect(() => mustGetQuery(queries, 'workspace.all')).toThrow()
  })
})

describe('the Zero schema', () => {
  it('maps the workspace table onto the snake_case Postgres columns', () => {
    const workspace = tableShapes().find((table) => table.name === 'workspace')

    expect(workspace?.serverName).toBe('workspace')
    expect(workspace?.primaryKey).toEqual(['id'])
    expect(
      Object.fromEntries(
        (workspace?.columns ?? []).map((column) => [
          column.key,
          { type: column.type, serverName: column.serverName, optional: column.optional },
        ]),
      ),
    ).toEqual({
      id: { type: 'string', serverName: 'id', optional: false },
      name: { type: 'string', serverName: 'name', optional: false },
      createdAt: { type: 'number', serverName: 'created_at', optional: false },
      updatedAt: { type: 'number', serverName: 'updated_at', optional: false },
    })
  })

  it('keeps the legacy client CRUD and query paths off', () => {
    expect(schema.enableLegacyMutators).toBe(false)
    expect(schema.enableLegacyQueries).toBe(false)
  })
})
