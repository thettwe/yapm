import type { Kysely } from 'kysely'
import { describe, expect, it } from 'vitest'
import { bootstrapFirstAdmin } from './seed.js'
import type { DB } from './types.js'

// Any property access throws, proving whether bootstrapFirstAdmin reached the database.
const throwingDb = new Proxy(
  {},
  {
    get() {
      throw new Error('bootstrapFirstAdmin touched the database')
    },
  },
) as unknown as Kysely<DB>

describe('bootstrapFirstAdmin required-email gate', () => {
  it('rejects a non-matching email before touching the database', async () => {
    const result = await bootstrapFirstAdmin(throwingDb, {
      id: 'member-1',
      userId: 'user-1',
      userEmail: 'other@example.com',
      requiredEmail: 'admin@example.com',
    })

    expect(result).toBeUndefined()
  })

  it('matches the required email case-insensitively and trimmed (proceeds to the database)', async () => {
    await expect(
      bootstrapFirstAdmin(throwingDb, {
        id: 'member-1',
        userId: 'user-1',
        userEmail: '  Admin@Example.com  ',
        requiredEmail: 'admin@example.com',
      }),
    ).rejects.toThrow('bootstrapFirstAdmin touched the database')
  })
})
