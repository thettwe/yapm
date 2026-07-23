import { type Kysely, sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tableShapes } from '../zero/introspect.js'
import { createDatabase } from './client.js'
import { migrateToLatest } from './migrate.js'
import type { DB } from './types.js'

// The Kysely `DB` interface and the Zero schema are both hand-written (kysely-codegen
// emits uncompilable output under TS7), so only this test forces them to agree with
// Postgres.
const KYSELY_DB: Record<string, Record<string, { nullable: boolean; hasDefault: boolean }>> = {
  workspace: {
    id: { nullable: false, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  workspace_member: {
    id: { nullable: false, hasDefault: false },
    workspace_id: { nullable: false, hasDefault: false },
    user_id: { nullable: false, hasDefault: false },
    role: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  team: {
    id: { nullable: false, hasDefault: false },
    workspace_id: { nullable: false, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    key: { nullable: false, hasDefault: false },
    archived_at: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
    updated_at: { nullable: false, hasDefault: true },
  },
  team_membership: {
    id: { nullable: false, hasDefault: false },
    team_id: { nullable: false, hasDefault: false },
    user_id: { nullable: false, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
  },
  invite: {
    id: { nullable: false, hasDefault: false },
    workspace_id: { nullable: false, hasDefault: false },
    team_id: { nullable: true, hasDefault: false },
    email: { nullable: true, hasDefault: false },
    role: { nullable: false, hasDefault: false },
    token: { nullable: false, hasDefault: false },
    created_by: { nullable: false, hasDefault: false },
    expires_at: { nullable: false, hasDefault: false },
    revoked_at: { nullable: true, hasDefault: false },
    created_at: { nullable: false, hasDefault: true },
  },
  // better-auth owns this table; the drift test provisions it (see `createAuthUserTable`)
  // so the read-surface interface and Zero schema are still checked against its real shape
  // (reference/kysely-stack.md §5.4).
  user: {
    id: { nullable: false, hasDefault: false },
    name: { nullable: false, hasDefault: false },
    email: { nullable: false, hasDefault: false },
    emailVerified: { nullable: false, hasDefault: false },
    image: { nullable: true, hasDefault: false },
    createdAt: { nullable: false, hasDefault: true },
    updatedAt: { nullable: false, hasDefault: true },
  },
}

// The `user` table is created at boot by better-auth's `getMigrations()`, not by our
// Kysely migrations. reference/kysely-stack.md §5.4 has the verified DDL it emits; we
// reproduce it here so the drift test can assert our read surface matches it without
// pulling in the server's better-auth config (packages never import apps).
async function createAuthUserTable(db: Kysely<DB>): Promise<void> {
  await sql`
    create table if not exists "user" (
      "id" text not null primary key,
      "name" text not null,
      "email" text not null unique,
      "emailVerified" boolean not null,
      "image" text,
      "createdAt" timestamptz default current_timestamp not null,
      "updatedAt" timestamptz default current_timestamp not null
    )
  `.execute(db)
}

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the schema drift test must not be skipped')
}

interface PrimaryKeyRow {
  table_name: string
  columns: string[]
}

async function primaryKeys(db: Kysely<DB>): Promise<Map<string, string[]>> {
  const { rows } = await sql<PrimaryKeyRow>`
    select c.relname as table_name,
           array_agg(a.attname::text order by k.ord) as columns
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    where i.indisprimary and n.nspname = 'public'
    group by c.relname
  `.execute(db)

  return new Map(rows.map((row) => [row.table_name, row.columns]))
}

describe.skipIf(DATABASE_URL === undefined)('schema drift', () => {
  const database = createDatabase({ connectionString: DATABASE_URL ?? '' })

  let tables: Awaited<ReturnType<typeof database.db.introspection.getTables>>
  let pkByTable: Map<string, string[]>

  beforeAll(async () => {
    await migrateToLatest(database.db)
    await createAuthUserTable(database.db)
    tables = (await database.db.introspection.getTables()).filter(
      (table) => table.schema === 'public' && !table.isView,
    )
    pkByTable = await primaryKeys(database.db)
  }, 30_000)

  afterAll(async () => {
    await database.close()
  })

  it('finds every table the hand-written interfaces describe', () => {
    const found = new Set(tables.map((table) => table.name))
    const zeroTables = tableShapes().map((table) => table.serverName)

    for (const name of [...Object.keys(KYSELY_DB), ...zeroTables]) {
      expect(found, `table ${name}`).toContain(name)
    }
  })

  it('matches the hand-written Kysely DB interface column for column', () => {
    const problems: string[] = []

    for (const [table, columns] of Object.entries(KYSELY_DB)) {
      const actual = tables.find((candidate) => candidate.name === table)
      if (!actual) {
        problems.push(`${table}: missing in database`)
        continue
      }

      const actualColumns = new Map(actual.columns.map((column) => [column.name, column]))

      for (const [column, expected] of Object.entries(columns)) {
        const got = actualColumns.get(column)
        if (!got) {
          problems.push(`${table}.${column}: declared in DB interface but missing in database`)
          continue
        }
        if (got.isNullable !== expected.nullable) {
          problems.push(
            `${table}.${column}: nullability mismatch (DB interface=${expected.nullable}, postgres=${got.isNullable})`,
          )
        }
        if (got.hasDefaultValue !== expected.hasDefault) {
          problems.push(
            `${table}.${column}: default mismatch (DB interface Generated<>=${expected.hasDefault}, postgres=${got.hasDefaultValue})`,
          )
        }
      }

      for (const column of actualColumns.keys()) {
        if (!(column in columns)) {
          problems.push(`${table}.${column}: in database but not in the DB interface`)
        }
      }
    }

    expect(problems, problems.join('\n')).toEqual([])
  })

  it('matches the hand-written Zero schema column for column', () => {
    const problems: string[] = []

    for (const table of tableShapes()) {
      const name = table.serverName
      const actual = tables.find((candidate) => candidate.name === name)
      if (!actual) {
        problems.push(`${name}: missing in database`)
        continue
      }

      const actualColumns = new Map(actual.columns.map((column) => [column.name, column]))
      const expected = new Map(table.columns.map((column) => [column.serverName, column]))

      for (const [column, spec] of expected) {
        const got = actualColumns.get(column)
        if (!got) {
          problems.push(`${name}.${column}: in the Zero schema but missing in database`)
          continue
        }
        if (got.isNullable !== spec.optional) {
          problems.push(
            `${name}.${column}: nullability mismatch (zero optional=${spec.optional}, postgres=${got.isNullable})`,
          )
        }
        const allowed = POSTGRES_TYPE_TO_ZERO[got.dataType]
        if (allowed === undefined) {
          problems.push(`${name}.${column}: unmapped Postgres type ${got.dataType}`)
        } else if (allowed !== spec.type) {
          problems.push(
            `${name}.${column}: type mismatch (zero=${spec.type}, postgres=${got.dataType} maps to ${allowed})`,
          )
        }
      }

      for (const column of actualColumns.keys()) {
        if (!expected.has(column)) {
          problems.push(`${name}.${column}: in database but not in the Zero schema`)
        }
      }

      const pk = pkByTable.get(name) ?? []
      if (JSON.stringify(pk) !== JSON.stringify(table.primaryKey)) {
        problems.push(
          `${name}: primary key mismatch (zero=${JSON.stringify(table.primaryKey)}, postgres=${JSON.stringify(pk)})`,
        )
      }
    }

    expect(problems, problems.join('\n')).toEqual([])
  })
})

// reference/zero.md §9.1 — the Postgres -> Zero type map, restricted to the types
// this schema actually uses. Add a row here when a migration introduces a new type.
const POSTGRES_TYPE_TO_ZERO: Record<string, string> = {
  bool: 'boolean',
  date: 'number',
  float4: 'number',
  float8: 'number',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  json: 'json',
  jsonb: 'json',
  numeric: 'number',
  text: 'string',
  time: 'number',
  timestamp: 'number',
  timestamptz: 'number',
  timetz: 'number',
  uuid: 'string',
  varchar: 'string',
}
