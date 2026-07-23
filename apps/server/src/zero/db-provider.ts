import { zeroKysely } from '@rocicorp/zero/server/adapters/kysely'
import { schema } from '@yapm/schema'
import type { DB } from '@yapm/schema/db'
import type { Kysely } from 'kysely'

export function createZeroDatabase(db: Kysely<DB>) {
  return zeroKysely(schema, db)
}

export type ZeroDatabase = ReturnType<typeof createZeroDatabase>
