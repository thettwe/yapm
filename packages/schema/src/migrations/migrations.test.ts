import { describe, expect, it } from 'vitest'
import { migrationProvider, migrations } from './index.js'

describe('migrationProvider', () => {
  it('resolves migrations without touching the filesystem', async () => {
    const resolved = await migrationProvider.getMigrations()

    expect(Object.keys(resolved)).toEqual(Object.keys(migrations))
    expect(Object.keys(resolved).length).toBeGreaterThan(0)
    for (const [name, migration] of Object.entries(resolved)) {
      expect(migration.up, `${name}.up`).toBeTypeOf('function')
    }
  })

  it('names migrations so that alphabetical order is application order', () => {
    const names = Object.keys(migrations)

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    for (const name of names) {
      expect(name).toMatch(/^\d{4}_[a-z0-9_]+$/)
    }
  })
})
