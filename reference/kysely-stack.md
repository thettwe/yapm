# Kysely data layer — Verified API Reference (kysely 0.29.4)

> **Purpose**: ground-truth API reference for coding agents whose training data predates these versions.
> **Kysely 0.29 is a breaking release** (2026-05-08): ESM-only, `Migrator` moved to a subpath, minimum TypeScript 5.4.
> If you write Kysely migration code from memory you will produce a hard compile error. Copy from this file.
>
> **Verification method** — every signature and snippet below came from one of:
> 1. The installed `.d.ts` / `.js` files of the exact versions in §0 (`npm install` into a scratch dir, read the real files).
> 2. **Executed against a live PostgreSQL 14.23 database** (schema created, migrated, queried, introspected). Marked ✅ *executed*.
> 3. Official docs / release notes fetched 2026-07-23 (URLs per section).
>
> Anything not verified is explicitly marked `UNVERIFIED`.
>
> **Companion files — read these first, this file complements them, it does not repeat them:**
> - `reference/zero.md` — Zero 1.8 schema/queries/mutators. §6 (`dbProvider`) and §5 (mutators) are prerequisites for §6 here.
> - `reference/server-stack.md` — better-auth 1.6 (§4), pg-boss 12 (§6), Hono (§5), Zod (§7). Written for a Drizzle stack; §1–§3 of that file (Drizzle/drizzle-kit/drizzle-zero) are **replaced** by this file. Everything else there still applies.

---

## 0. Verified versions (`npm view <pkg> version`, 2026-07-23)

| Package | Latest | Notes |
|---|---|---|
| `kysely` | **0.29.4** | released 2026-07-17. ESM-only. `engines.node >= 22.0.0` |
| `kysely-codegen` | **0.20.0** | CJS. peer `kysely >=0.27.0 <1.0.0`, `pg >=8.8.0 <9.0.0` |
| `pg` | **8.22.0** | |
| `better-auth` | **1.6.24** | deps `kysely: ^0.28.17 \|\| ^0.29.0` ✅ compatible with 0.29.4 |
| `@better-auth/kysely-adapter` | **1.6.24** | dependency of `better-auth`; also directly installable |
| `pg-boss` | **12.26.2** | ESM-only, `engines.node >= 22.12.0`, dep `pg ^8.22.0` |
| `@rocicorp/zero` | **1.8.0** | peer `kysely: ^0.28.17` ← **does not list 0.29** (see §9) |
| `uuidv7` | **1.2.1** | |

```bash
npm install kysely pg uuidv7
npm install -D kysely-codegen @types/pg
```

### ⚠️ Version-pairing landmines discovered while verifying (details in §9)

1. **`@rocicorp/zero@1.8.0` peer-requires `kysely@^0.28.17`** → `npm install` of `kysely@0.29.4` alongside it **fails with `ERESOLVE`**. Runtime is fine (verified ✅ executed); the peer range is just stale. Requires `--legacy-peer-deps` / `overrides` / pnpm.
2. **`@rocicorp/zero@1.8.0` depends on `jose@^5.9.3`; `@better-auth/core@1.6.24` requires `jose@^6.1.0`.** npm hoists jose 5 to the root and better-auth crashes at import time with `SyntaxError: The requested module 'jose' does not provide an export named 'customFetch'`. **Reproduced ✅.**
3. **`kysely-codegen@0.20.0` is broken by `typescript@7.x`.** `overrides` and `customImports` silently stop working — the generated file omits the import and references an undefined type. **Reproduced ✅.**

---

## 1. Kysely core

Sources: `kysely@0.29.4` `dist/**/*.d.ts`; <https://kysely.dev/docs/getting-started>; <https://kysely.dev/docs/examples>; <https://github.com/kysely-org/kysely/releases/tag/v0.29.0>

### 1.1 What changed in 0.29 (verbatim from the release notes' "⚠️ Breaking Changes")

> * `Migrator`, `FileMigrationProvider` and other migration related things are now exported from `'kysely/migration'`. Importing from `'kysely'` will provide an informative error message at compilation time.
>
>   ```diff
>   -import { Migrator, FileMigrationProvider } from 'kysely'
>   +import { Migrator, FileMigrationProvider } from 'kysely/migration'
>   ```
> * Minimum TypeScript version is now 5.4. Versions 5.3 and older will get a very aggressive compilation error.
> * The library no longer ships CommonJS files. Use a Node.js version that supports `require(esm)`, or use dynamic imports. ES Modules files have moved from `/dist/esm/` to `/dist/`.
> * TypeScript build target was bumped to `'es2023'`.
> * `sql.value` and `sql.literal` were removed after spending a long time in deprecation. Use `sql.val` and `sql.lit` instead.
> * `db.executeQuery`'s `queryId` 2nd argument has been replaced with `options?: AbortableQueryOptions` after spending a long time in deprecation.
> * `QueryResult.numUpdatedOrDeletedRows` has been removed after spending a long time in deprecation. Dialects that use it need to be updated to use `QueryResult.numAffectedRows` instead.
> * `UniqueConstraintNode.columns` widened from `ReadonlyArray<ColumnNode>` to `ReadonlyArray<OperationNode>`.
> * `ExpressionBuilder.withSchema` has been removed after spending a long time in deprecation.

Also new in 0.29 and worth knowing: `$pickTables` / `$omitTables` / `$extendTables` (**`withTables` is now deprecated**), `ReadonlyKysely<DB>` from `kysely/readonly`, a built-in `PGliteDialect`, `SafeNullComparisonPlugin`, `AbortSignal`-based query cancellation, and `MigrateOptions.disableTransactions`.

Package facts (from the real `package.json`):

```jsonc
{
  "version": "0.29.4",
  "type": "module",
  "main": "dist/index.js",
  "engines": { "node": ">=22.0.0" },
  "typesVersions": { "<5.4": { "*": ["outdated-typescript.d.ts"] } },
  "exports": {
    ".":                  { "types@<5.4": "./outdated-typescript.d.ts", "default": "./dist/index.js" },
    "./helpers/mssql":    "./dist/helpers/mssql.js",
    "./helpers/mysql":    "./dist/helpers/mysql.js",
    "./helpers/postgres": "./dist/helpers/postgres.js",
    "./helpers/sqlite":   "./dist/helpers/sqlite.js",
    "./migration":        "./dist/migration/index.js",
    "./readonly":         "./dist/readonly/index.js"
  }
}
```

> There is **no `require` condition**. A CJS consumer needs Node's `require(esm)` support (Node ≥ 22.12 unflagged) or a dynamic `import()`.

### 1.2 The `Database` interface pattern

Verbatim from `dist/util/column-type.d.ts` (0.29.4):

```ts
export type ColumnType<SelectType, InsertType = SelectType, UpdateType = SelectType> = {
    readonly __select__: SelectType;
    readonly __insert__: InsertType;
    readonly __update__: UpdateType;
};

/** The update type is `S` instead of `S | undefined` because updates are always
 *  optional --> no need to specify optionality. */
export type Generated<S> = ColumnType<S, S | undefined, S>;

/** A shortcut for defining columns that are only database-generated
 *  (like postgres GENERATED ALWAYS AS IDENTITY). No insert/update is allowed. */
export type GeneratedAlways<S> = ColumnType<S, never, never>;

/** A shortcut for defining JSON columns, which are by default inserted/updated
 *  as stringified JSON strings. */
export type JSONColumnType<SelectType extends object | null, InsertType = string, UpdateType = string>
  = ColumnType<SelectType, InsertType, UpdateType>;

export type Selectable<R> = DrainOuterGeneric<{ [K in NonNeverSelectKeys<R>]: SelectType<R[K]> }>;
export type Insertable<R> = DrainOuterGeneric<object
  & { [K in NonNullableInsertKeys<R>]:  InsertType<R[K]> }
  & { [K in NullableInsertKeys<R>]?:    InsertType<R[K]> }>;
export type Updateable<R> = DrainOuterGeneric<{ [K in UpdateKeys<R>]?: UpdateType<R[K]> | undefined }>;

/** New in 0.29 — opt a column out of JSON-helper dehydration. */
export type NonDehydrateable<T> = /* … */;
```

Also exported: `SelectType<T>`, `InsertType<T>`, `UpdateType<T>` (single-column extractors).

Real file — this exact file type-checks under `tsc --strict` with `module: NodeNext` ✅:

```ts
// src/db/types.ts
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

/** timestamptz: read as Date, write as Date | string; omit on insert (DB default). */
export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>

export interface ProjectTable {
  id: string                        // client-supplied uuidv7 — NOT Generated, see §4
  name: string
  slug: string
  settings: Generated<Record<string, unknown>>
  created_at: Generated<Timestamp>
}

export interface TaskTable {
  id: string
  project_id: string
  title: string
  status: Generated<'todo' | 'doing' | 'done'>
  position: Generated<number>
  assignee_id: string | null        // nullable column -> `| null`, NOT `?`
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface DB {
  project: ProjectTable
  task: TaskTable
}

export type Project       = Selectable<ProjectTable>   // { id: string; ...; created_at: Date }
export type NewProject    = Insertable<ProjectTable>   // settings?/created_at? optional
export type ProjectUpdate = Updateable<ProjectTable>   // everything optional
```

Rules that trip agents up:

| Situation | Correct declaration |
|---|---|
| `uuid primary key` supplied by the app | `id: string` (**not** `Generated<string>`) |
| `bigserial` / `generated always as identity` | `Generated<number>` / `GeneratedAlways<number>` |
| `text not null default 'x'` | `Generated<string>` (default makes it optional on insert) |
| `text null` | `foo: string \| null` — a `?` here is wrong; `Insertable` derives optionality from the type |
| `jsonb` returned parsed by `pg` | `Generated<SomeObject>` or `ColumnType<Obj, string, string>` if you stringify yourself |
| Read-only computed column | `ColumnType<T, never, never>` = `GeneratedAlways<T>` |
| Multi-schema table | key the `DB` interface `'pgboss.job': PgbossJobTable` (this is what `kysely-codegen` emits, §3) |

### 1.3 Creating the instance — `PostgresDialect` + node-postgres `Pool`

`PostgresDialectConfig` verbatim from `dist/dialect/postgres/postgres-dialect-config.d.ts`:

```ts
export interface PostgresDialectConfig {
    /** A `pg` `Client` constructor, used outside of the `pool` to cancel queries
     *  on the database side. Defaults to the `Pool`'s undocumented `Client` member. */
    controlClient?: PostgresClientConstructor;
    cursor?: PostgresCursorConstructor;
    onCreateConnection?:  (connection: DatabaseConnection, options?: AbortableOperationOptions) => Promise<void>;
    onReserveConnection?: (connection: DatabaseConnection, options?: AbortableOperationOptions) => Promise<void>;
    /** A postgres `Pool` instance or a function that returns one.
     *  If a function is provided, it's called once when the first query is executed. */
    pool: PostgresPool | ((options?: AbortableOperationOptions) => Promise<PostgresPool>);
}
```

`KyselyConfig` verbatim from `dist/kysely.d.ts`:

```ts
export interface KyselyConfig {
    readonly dialect: Dialect;
    readonly plugins?: KyselyPlugin[];
    readonly log?: LogConfig;   // ['query' | 'error'] or (event) => void
}
export declare class Kysely<DB> extends QueryCreator<DB> implements QueryExecutorProvider, AsyncDisposable {
    constructor(args: KyselyConfig);
    constructor(args: KyselyProps);
    get schema(): SchemaModule;
    get dynamic(): DynamicModule<DB>;
    get introspection(): DatabaseIntrospector;
    transaction(): TransactionBuilder<DB>;
    startTransaction(): ControlledTransactionBuilder<DB>;
    connection(): ConnectionBuilder<DB>;
    executeQuery<R>(query: CompiledQuery<R> | Compilable<R>, options?: AbortableQueryOptions): Promise<QueryResult<R>>;
    withTables<T extends Record<string, Record<string, any>>>(): Kysely<DrainOuterGeneric<DB & T>>;  // deprecated in 0.29
    destroy(): Promise<void>;
    get isTransaction(): boolean;
}
```

The single app instance ✅ *executed*:

```ts
// src/db/index.ts
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { DB } from './types.ts'

// ONE pool for the whole process. Zero, better-auth and pg-boss all reuse it (§5–§7).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
})

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
})
```

Shutdown: `await db.destroy()` ends the pool. `Kysely` implements `AsyncDisposable`, so `await using db = new Kysely<DB>({...})` also works on Node ≥ 22.

### 1.4 Query API — every form below was executed against PostgreSQL 14 ✅

```ts
// ---------- SELECT ----------
const p = await db.selectFrom('project').selectAll().where('slug', '=', 'yapm').executeTakeFirstOrThrow()
//  .execute()                -> T[]
//  .executeTakeFirst()       -> T | undefined
//  .executeTakeFirstOrThrow()-> T   (throws NoResultError)
//  .stream()                 -> AsyncIterable<T>  (requires `cursor: Cursor` in PostgresDialect)

// ---------- JOIN ----------
const rows = await db
  .selectFrom('task')
  .innerJoin('project', 'project.id', 'task.project_id')
  .select(['task.id', 'task.title', 'task.status', 'project.name as projectName'])
  .where('task.project_id', '=', projectId)
  .orderBy('task.position', 'asc')      // or .orderBy('task.position asc')
  .limit(50)
  .execute()
// => [{ id, title, status, projectName }]

// left join + aggregate. NOTE: postgres `count()` comes back as a STRING.
const counts = await db
  .selectFrom('project')
  .leftJoin('task', 'task.project_id', 'project.id')
  .select((eb) => ['project.id', eb.fn.count('task.id').as('taskCount')])
  .groupBy('project.id')
  .having((eb) => eb.fn.count('task.id'), '>', 0)
  .execute()
// => [{ id: '019f8f92-…', taskCount: '2' }]     <-- string, not number

// callback join for multi-condition ON
db.selectFrom('task').leftJoin('project', (join) =>
  join.onRef('project.id', '=', 'task.project_id').on('project.slug', '!=', 'archived'),
)

// ---------- INSERT ----------
const project = await db
  .insertInto('project')
  .values({ id: uuidv7(), name: 'Yapm', slug: 'yapm' })
  .returningAll()
  .executeTakeFirstOrThrow()

// without RETURNING you get an InsertResult; the counts are BIGINT
const res = await db.insertInto('project').values({ /* … */ }).executeTakeFirst()
// InsertResult { insertId: undefined, numInsertedOrUpdatedRows: 1n }   <-- bigint

// multi-row
await db.insertInto('task').values([{ /* … */ }, { /* … */ }]).execute()

// ---------- ON CONFLICT ----------
// OnConflictBuilder: .column() | .columns([]) | .constraint(name) | .expression(expr)
//                    .where()/.clearWhere()  then  .doNothing() | .doUpdateSet(...)
const upserted = await db
  .insertInto('project')
  .values({ id: uuidv7(), name: 'Renamed', slug: 'yapm' })
  .onConflict((oc) =>
    oc.column('slug').doUpdateSet((eb) => ({ name: eb.ref('excluded.name') })),
  )
  .returningAll()
  .executeTakeFirstOrThrow()
// -> the EXISTING row's id is preserved; `name` becomes 'Renamed'  ✅ verified

// doNothing + returning gives `undefined` when the row already existed  ✅ verified
const maybe = await db
  .insertInto('project').values({ /* … */ })
  .onConflict((oc) => oc.column('slug').doNothing())
  .returningAll().executeTakeFirst()          // => undefined

// partial-index upsert
oc.columns(['project_id', 'position']).where('archived', '=', false).doNothing()

// ---------- UPDATE ----------
const updated = await db
  .updateTable('task')
  .set({ status: 'done', updated_at: sql<Timestamp>`now()` })
  .where('id', '=', taskId)
  .returning(['id', 'status'])
  .executeTakeFirst()
// UpdateResult { numUpdatedRows: 1n, numChangedRows: undefined }

// ---------- DELETE ----------
const del = await db.deleteFrom('task').where('project_id', '=', projectId).executeTakeFirst()
del.numDeletedRows            // 2n   <-- bigint

// ---------- expression builder ----------
db.selectFrom('task').where((eb) =>
  eb.or([
    eb('status', '=', 'todo'),
    eb.and([eb('status', '=', 'doing'), eb('assignee_id', 'is not', null)]),
    eb.exists(eb.selectFrom('project').select('id').whereRef('project.id', '=', 'task.project_id')),
  ]),
)
```

> ⚠️ **`sql<T>` inside `.set()` / `.values()` on a `ColumnType` column.** `sql<Date>\`now()\`` **fails to compile** against a `created_at: Generated<ColumnType<Date, …>>` column:
> `Type 'RawBuilder<Date>' is not assignable to type 'ValueExpression<DB, "task", Timestamp> | undefined'.`
> Either leave the tag un-parameterised (`` sql`now()` ``) or parameterise it with the **`ColumnType` alias itself** (`` sql<Timestamp>`now()` ``). Both compile ✅.

### 1.5 Transactions

```ts
export declare class TransactionBuilder<DB> {
    setAccessMode(accessMode: AccessMode): TransactionBuilder<DB>;         // 'read only' | 'read write'
    setIsolationLevel(isolationLevel: IsolationLevel): TransactionBuilder<DB>;
    execute<T>(callback: (trx: Transaction<DB>) => Promise<T>): Promise<T>;
}
export declare class Transaction<DB> extends Kysely<DB> {
    get isTransaction(): true;
    transaction(): never;    // @deprecated - not supported on a Transaction
    connection(): never;
    destroy(): never;
}
```

```ts
// commit on resolve, ROLLBACK on throw  ✅ verified (rollback confirmed empty)
const result = await db.transaction().execute(async (trx) => {
  await trx.insertInto('task').values({ id: a, project_id: p, title: 'first' }).execute()
  await trx.insertInto('task').values({ id: b, project_id: p, title: 'second' }).execute()
  return trx.selectFrom('task').selectAll().where('project_id', '=', p).execute()
})

await db.transaction().setIsolationLevel('serializable').setAccessMode('read write').execute(async (trx) => { … })
```

`Transaction<DB>` **is** a `Kysely<DB>`, so any function typed `(db: Kysely<DB>) => …` accepts a transaction. That is exactly how migrations (§2), pg-boss (§7) and Zero mutators (§6) compose.

Manual control (`ControlledTransaction`, savepoints):

```ts
const trx = await db.startTransaction().execute()
try {
  await trx.insertInto('task').values({ /* … */ }).execute()
  const sp = await trx.savepoint('sp1').execute()
  try { await sp.deleteFrom('task').where('id', '=', x).execute() }
  catch { await sp.rollbackToSavepoint('sp1').execute() }
  await trx.commit().execute()
} catch (e) {
  await trx.rollback().execute()
  throw e
}
```

### 1.6 The `sql` template tag

Full `Sql` interface from `dist/raw-builder/sql.d.ts`:

```ts
export interface Sql {
    <T = unknown>(sqlFragments: TemplateStringsArray, ...parameters: unknown[]): RawBuilder<T>;
    val<V>(value: V): RawBuilder<V>;                                 // bound parameter ($1)
    ref<R = unknown>(columnReference: string): RawBuilder<R>;        // "table"."column"
    table<T = unknown>(tableReference: string): RawBuilder<T>;       // "schema"."table"
    id<T = unknown>(...ids: readonly string[]): RawBuilder<T>;       // "a"."b"."c"
    lit<V>(value: V): RawBuilder<V>;                                 // INLINED literal — SQL INJECTION RISK
    raw<R = unknown>(anySql: string): RawBuilder<R>;                 // INLINED sql — SQL INJECTION RISK
    join<T = unknown>(array: readonly unknown[], separator?: RawBuilder<any>): RawBuilder<T>;
}
```

> `sql.value` and `sql.literal` were **removed in 0.29** — use `sql.val` / `sql.lit`.

Interpolated values are **always** bound parameters. Only `sql.lit` / `sql.raw` inline.

```ts
import { sql } from 'kysely'

// standalone execution against a Kysely (or Transaction) instance  ✅ verified
const { rows } = await sql<{ n: number }>`
  select count(*)::int as n from task where project_id = ${projectId}
`.execute(db)
// rows === [{ n: 2 }]

// as a fragment inside the builder
db.selectFrom('task')
  .select(sql<string>`coalesce(${sql.ref('title')}, '')`.as('t'))
  .where(sql<boolean>`${sql.ref('created_at')} > now() - interval '7 days'`)

// compile to inspect  ✅ verified
const c = db.selectFrom('task').select(sql`coalesce(${sql.ref('title')}, '')`.as('t')).limit(1).compile()
// c.sql        === `select coalesce("title", '') as "t" from "task" limit $1`
// c.parameters === [1]
```

`sql`…`` also has `.execute(db)`, `.compile(db)`, `.as(alias)`, `.$castTo<T>()`.

### 1.7 Postgres JSON helpers

```ts
import { jsonArrayFrom, jsonObjectFrom, jsonBuildObject } from 'kysely/helpers/postgres'

const projects = await db.selectFrom('project')
  .selectAll('project')
  .select((eb) => [
    jsonArrayFrom(
      eb.selectFrom('task').selectAll('task').whereRef('task.project_id', '=', 'project.id').limit(20),
    ).as('tasks'),
  ])
  .execute()
```

`UNVERIFIED`: the helper import path is confirmed from `package.json` exports (`./helpers/postgres`) but the query above was not executed.

---

## 2. Migrations

Sources: `kysely@0.29.4` `dist/migration/*.d.ts` + `dist/migration/*.js` + `dist/dialect/postgres/postgres-adapter.js`; <https://kysely.dev/docs/migrations>

### 2.1 The import path is `kysely/migration` (0.29 breaking change)

```ts
import { FileMigrationProvider, Migrator, NO_MIGRATIONS } from 'kysely/migration'
```

Importing any of them from `'kysely'` produces a `KyselyTypeError<"import from 'kysely/migration' instead">` at compile time. The root `dist/index.d.ts` literally declares:

```ts
/** @deprecated import from 'kysely/migration' instead. */
export declare const Migrator: KyselyTypeError<"import from 'kysely/migration' instead">;
```

Moved symbols: `Migrator`, `MigratorProps`, `MigrateOptions`, `Migration`, `MigrationInfo`, `MigrationProvider`, `MigrationResult`, `MigrationResultSet`, `NoMigrations`, `NO_MIGRATIONS`, `FileMigrationProvider`, `FileMigrationProviderFS`, `FileMigrationProviderPath`, `FileMigrationProviderProps`, `DEFAULT_MIGRATION_TABLE`, `DEFAULT_MIGRATION_LOCK_TABLE`, `DEFAULT_ALLOW_UNORDERED_MIGRATIONS`, `MIGRATION_LOCK_ID`.

### 2.2 Exact types

```ts
export interface Migration {
    up(db: Kysely<any>): Promise<void>;
    /** An optional down method. If you don't provide a down method,
     *  the migration is skipped when migrating down. */
    down?(db: Kysely<any>): Promise<void>;
}

export interface MigrationProvider {
    getMigrations(): Promise<Record<string, Migration>>;
}

export interface MigrateOptions {
    /** When `true`, don't run migrations in transactions even if the dialect
     *  supports transactional DDL. Default is `false`. */
    readonly disableTransactions?: boolean;
}

export interface MigratorProps extends MigrateOptions {
    readonly db: Kysely<any>;
    readonly provider: MigrationProvider;
    readonly migrationTableName?: string;        // default 'kysely_migration'
    readonly migrationLockTableName?: string;    // default 'kysely_migration_lock'
    readonly migrationTableSchema?: string;      // postgres + mssql only
    readonly allowUnorderedMigrations?: boolean; // default false
    readonly nameComparator?: (name0: string, name1: string) => number;  // default localeCompare
}

export declare class Migrator {
    constructor(props: MigratorProps);
    getMigrations(): Promise<ReadonlyArray<MigrationInfo>>;
    migrateToLatest(options?: MigrateOptions): Promise<MigrationResultSet>;
    migrateTo(targetMigrationName: string | NoMigrations, options?: MigrateOptions): Promise<MigrationResultSet>;
    migrateUp(options?: MigrateOptions): Promise<MigrationResultSet>;
    migrateDown(options?: MigrateOptions): Promise<MigrationResultSet>;
}

export interface MigrationResultSet {
    readonly error?: unknown;                 // set instead of throwing
    readonly results?: MigrationResult[];
}
export interface MigrationResult {
    readonly migrationName: string;
    readonly direction: 'Up' | 'Down';
    readonly status: 'Success' | 'Error' | 'NotExecuted';
}
export interface MigrationInfo { name: string; migration: Migration; executedAt?: Date }
```

> **The migrate methods never throw.** They return `{ error, results }`. A caller that does not inspect `error` will boot an app against an un-migrated database.

```ts
export declare class FileMigrationProvider implements MigrationProvider {
    constructor(props: FileMigrationProviderProps);
    getMigrations(): Promise<Record<string, Migration>>;
    protected hasExpectedExtension(fileName: string): boolean;
}
export interface FileMigrationProviderProps {
    fs: { readdir(path: string): Promise<string[]> };
    /** NEW in 0.29 — override the dynamic import. */
    import?(module: string): Promise<any>;
    migrationFolder: string;
    /** NEW in 0.29 */
    onFileIgnored?(fileName: string, reason: 'Extension' | 'NotMigration'): void;
    path: { join(...path: string[]): string };
}
```

Its real implementation (verbatim from `dist/migration/file-migration-provider.js`) — this is what determines the bundling behaviour:

```js
const filePath = this.#props.path.join(this.#props.migrationFolder, fileName);
const migration = this.#props.import
    ? await this.#props.import(filePath)
    : await import(/* webpackIgnore: true */ filePath);
const migrationKey = fileName.substring(0, fileName.lastIndexOf('.'));
if (isMigration(migration?.default))  migrations[migrationKey] = migration.default;
else if (isMigration(migration))      migrations[migrationKey] = migration;
else                                  this.#props.onFileIgnored?.(fileName, 'NotMigration');
```

Accepted extensions (from `hasExpectedExtension`): `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts` — excluding `.d.ts`/`.d.mts`/`.d.cts`. **Migration name = filename minus extension**, sorted with `localeCompare`.

### 2.3 Writing a migration (TypeScript)

```ts
// migrations/2026-07-23T00-00-00_init.ts
import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createType('task_status').asEnum(['todo', 'doing', 'done']).execute()

  await db.schema
    .createTable('project')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('settings', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('task')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('status', sql`task_status`, (col) => col.notNull().defaultTo('todo'))
    .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('assignee_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('task_project_id_position_idx')
    .on('task')
    .columns(['project_id', 'position'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('task').ifExists().execute()
  await db.schema.dropTable('project').ifExists().execute()
  await db.schema.dropType('task_status').ifExists().execute()
}
```

✅ *executed* — this exact migration ran against PostgreSQL 14.23 and returned:

```json
{ "results": [ { "migrationName": "2026-07-23T00-00-00_init", "direction": "Up", "status": "Success" } ] }
```

Notes:
- **Always type the parameter `Kysely<any>`, never `Kysely<DB>`.** `DB` describes today's schema; a migration must compile against the schema as it was then. `db.schema.*` is untyped anyway.
- A user-defined enum column type is expressed with `` sql`task_status` `` as the second `addColumn` argument.
- `createIndex(...).on(table).columns([...])`. In 0.29 `column`/`columns` also accept expressions (`expression()` is deprecated).

### 2.4 Running migrations programmatically at boot — full working code

The two facts that make this safe on Postgres, read out of `dist/dialect/postgres/postgres-adapter.js`:

```js
const LOCK_ID = BigInt('3853314791062309107');
const LOCK_TIMEOUT_MILLISECONDS = 60 * 60 * 1_000;
export class PostgresAdapter extends DialectAdapterBase {
    get supportsTransactionalDdl() { return true; }
    async acquireMigrationLock(db, _opt) {
        await sql`
    with set_timeout as (
      select set_config('lock_timeout', '${sql.lit(LOCK_TIMEOUT_MILLISECONDS)}', true) as config_val
    )
    select pg_advisory_lock(${sql.lit(LOCK_ID)})
    from set_timeout`.execute(db);
    }
    async releaseMigrationLock(db, _opt) {
        await sql`select pg_advisory_unlock(${sql.lit(LOCK_ID)})`.execute(db);
    }
}
```

→ **N app replicas can all call `migrateToLatest()` at boot.** They serialise on a session-level advisory lock (1 h `lock_timeout`), and because `supportsTransactionalDdl === true` the whole run is one transaction that rolls back on failure.

```ts
// src/db/migrate.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Kysely } from 'kysely'
import { FileMigrationProvider, Migrator } from 'kysely/migration'

/**
 * `import.meta.dirname` is Node ≥ 20.11 / 21.2 and is the ESM replacement for
 * `__dirname`. Pre-20.11, use:
 *   const __dirname = path.dirname(fileURLToPath(import.meta.url))
 * Both resolve relative to the *emitted* file, so after `tsc` this points at
 * `dist/db/`, and `../../migrations` resolves to `<pkgroot>/migrations`.
 */
function migrationFolder(): string {
  // env override wins — set MIGRATIONS_DIR in the Docker image to be explicit
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR)
  return path.resolve(import.meta.dirname, '../../migrations')
}

export async function migrateToLatest(db: Kysely<any>): Promise<void> {
  const folder = migrationFolder()

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: folder,
      // FileMigrationProvider calls `import(absolutePath)`. That works on POSIX
      // but throws ERR_UNSUPPORTED_ESM_URL_SCHEME on Windows. Always convert.
      import: (m) => import(/* @vite-ignore */ pathToFileURL(m).href),
      onFileIgnored: (file, reason) =>
        console.warn(`[migrate] ignored ${file} (${reason})`),
    }),
    // Pin these from day one. Kysely cannot rename them later.
    migrationTableName: 'kysely_migration',
    migrationLockTableName: 'kysely_migration_lock',
    allowUnorderedMigrations: false,
  })

  const { error, results } = await migrator.migrateToLatest()

  for (const it of results ?? []) {
    if (it.status === 'Success') console.log(`[migrate] ${it.migrationName} ${it.direction} ok`)
    else if (it.status === 'Error') console.error(`[migrate] ${it.migrationName} FAILED`)
    else console.warn(`[migrate] ${it.migrationName} not executed`)
  }

  // migrateToLatest NEVER throws. If you skip this, you boot on a stale schema.
  if (error) throw error instanceof Error ? error : new Error(String(error))
}
```

```ts
// src/index.ts — boot order
import { db } from './db/index.ts'
import { migrateToLatest } from './db/migrate.ts'
import { migrateAuth } from './auth.ts'     // §5

await migrateToLatest(db)   // 1. app schema
await migrateAuth()         // 2. better-auth tables (separate mechanism, §5.4)
await boss.start()          // 3. pg-boss installs its own `pgboss` schema (§7)
// … then start the HTTP server
```

#### The bundling problem, and the fix

`FileMigrationProvider` does `await import(filePath)` on a **runtime-computed absolute path**. Bundlers cannot follow it. Consequences:

| Build style | Works? | What you must do |
|---|---|---|
| `tsc` → `dist/`, migrations emitted as `dist/migrations/*.js` | ✅ | point `migrationFolder` at `dist/migrations` |
| Migrations kept as `.ts` next to source, run via `tsx`/`node --experimental-strip-types` | ✅ | `hasExpectedExtension` accepts `.ts` |
| esbuild/tsup/rollup **bundle to a single file** | ❌ | the `import()` is left as a runtime call; the folder is not in the bundle |
| Deployed in a Docker image where only `dist/` is copied | ❌ if you `COPY dist` only | also `COPY migrations` (or emit them into `dist`) |

**Bundler-safe alternative: a static `MigrationProvider`.** `MigrationProvider` is a one-method interface, so an object literal of statically imported modules is a valid provider — the bundler sees real `import` statements. ✅ *executed*:

```ts
// migrations/index.ts   (generate this file, or maintain it by hand)
import * as m0001 from './0001_init.ts'
import * as m0002 from './0002_add_labels.ts'
import type { Migration, MigrationProvider } from 'kysely/migration'

export const migrations: Record<string, Migration> = {
  '0001_init':       m0001,
  '0002_add_labels': m0002,
}

export const provider: MigrationProvider = {
  getMigrations: async () => migrations,
}
```

```ts
const migrator = new Migrator({ db, provider })
await migrator.migrateToLatest()
```

Because migration names come from the object keys (not filenames), **the keys are the contract** — never renumber them.

Other operations (all ✅ *executed*):

```ts
await migrator.getMigrations()
// [{ name: '0001_widget', migration: {…}, executedAt: 2026-07-23T15:26:47.210Z }]

await migrator.migrateTo('0002_add_labels')     // up or down to a specific migration
await migrator.migrateUp()                      // one step
await migrator.migrateDown()                    // one step
await migrator.migrateTo(NO_MIGRATIONS)         // all the way down
//   { results: [{ migrationName: '0001_widget', direction: 'Down', status: 'Success' }] }
```

For a migration containing something that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE … ADD VALUE` on older PG), pass `migrator.migrateToLatest({ disableTransactions: true })` — new in 0.29.

---

## 3. kysely-codegen 0.20.0

Sources: `kysely-codegen@0.20.0` tarball (`dist/cli/*.js`, `dist/config/config.js`); <https://github.com/RobinBlomberg/kysely-codegen>

### 3.1 Install and run

```bash
npm install -D kysely-codegen
# needs a real, migrated database to introspect
DATABASE_URL="postgres://user:pass@localhost:5432/yapm" npx kysely-codegen
```

### 3.2 Full CLI surface (verbatim from `kysely-codegen --help`)

```
kysely-codegen [options]

  --camel-case         Use the Kysely CamelCasePlugin.
  --config-file        Specify the path to the configuration file to use.
  --custom-imports     Specify custom type imports, in JSON format. Use # for named imports. (example: {"InstantRange":"./custom-types","MyType":"./types#OriginalType"})
  --date-parser        Specify which parser to use for PostgreSQL date values. (values: [string, timestamp], default: timestamp)
  --default-schema     Set the default schema(s) for the database connection.
  --dialect            Explicitly set the SQL dialect. (values: [postgres, mysql, sqlite, mssql, libsql, bun-sqlite, kysely-bun-sqlite, worker-bun-sqlite])
  --env-file           Specify the path to an environment file to use.
  --exclude-pattern    Exclude tables that match the specified glob pattern. (examples: users, *.table, secrets.*, *._*)
  --help, -h           Print this message.
  --include-pattern    Only include tables that match the specified glob pattern. (examples: users, *.table, secrets.*, *._*)
  --log-level          Set the terminal log level. (values: [debug, info, warn, error, silent], default: warn)
  --no-domains         Skip generating types for PostgreSQL domains.
  --numeric-parser     Specify which parser to use for PostgreSQL numeric values. (values: [string, number, number-or-string], default: string)
  --out-file           Set the file build path. (default: <pkg>/dist/db.d.ts)
  --overrides          Specify type overrides for specific table columns, in JSON format. (example: {"columns":{"table_name.column_name":"{foo:\"bar\"}"}})
  --partitions         Include partitions of PostgreSQL tables in the generated code.
  --print              Print the generated output to the terminal instead of a file.
  --runtime-enums      Generate runtime enums instead of string unions for PostgreSQL enums. (values: [pascal-case, screaming-snake-case], default: screaming-snake-case)
  --singularize        Singularize generated table names, e.g. `BlogPost` instead of `BlogPosts`.
  --type-mapping       Specify type mappings for database types, in JSON format. (example: {"timestamptz":"Temporal.Instant","tstzrange":"InstantRange"})
  --type-only-imports  Generate code using the TypeScript 3.8+ `import type` syntax. (default: true)
  --url                Set the database connection string URL. This may point to an environment variable. (default: env(DATABASE_URL))
  --verify             Verify that the generated types are up-to-date.
```

`--url` defaults to `env(DATABASE_URL)` — the literal string `env(X)` means "read env var X".

### 3.3 Config file

`loadConfig` uses **cosmiconfig** with module name `kysely-codegen` (verbatim from `dist/config/config.js`):

```js
const loadConfig = (config) => {
    const explorer = cosmiconfigSync('kysely-codegen');
    return config?.configFile ? explorer.load(config.configFile) : explorer.search();
};
```

So the discovered files are the cosmiconfig defaults: a `"kysely-codegen"` key in `package.json`, `.kysely-codegenrc[.json|.yaml|.yml|.js|.ts|.cjs|.mjs]`, `kysely-codegen.config.[js|ts|cjs|mjs]`, and the `.config/` variants. `defineConfig` is exported from the package for typed TS configs.

Working config ✅ *executed*:

```jsonc
// .kysely-codegenrc.json
{
  "camelCase": false,
  "dialect": "postgres",
  "outFile": "./src/db/generated.d.ts",
  "url": "env(DATABASE_URL)",
  "defaultSchema": "public",
  "excludePattern": "kysely_*",
  "typeMapping": { "timestamptz": "Date" },
  "overrides": { "columns": { "task.status": "'todo' | 'doing' | 'done'" } },
  "logLevel": "info"
}
```

Package scripts:

```jsonc
{
  "scripts": {
    "db:migrate":      "tsx src/db/migrate-cli.ts",
    "db:codegen":      "kysely-codegen",
    "db:codegen:check": "kysely-codegen --verify",
    "db:reset":        "npm run db:migrate && npm run db:codegen"
  }
}
```

`--verify` exits 0 and prints `✓ Generated types are up-to-date!` when in sync ✅ — that is the CI guard against "someone added a migration and forgot to regenerate".

### 3.4 What the generated file actually looks like

Real output for the §2.3 migration ✅ *executed*:

```ts
/**
 * This file was generated by kysely-codegen.
 * Please do not edit it manually.
 */

import type { ColumnType } from "kysely";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Json = JsonValue;
export type JsonArray = JsonValue[];
export type JsonObject = { [x: string]: JsonValue | undefined };
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export type TaskStatus = "doing" | "done" | "todo";

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface Project {
  created_at: Generated<Timestamp>;
  id: string;
  name: string;
  settings: Generated<Json>;
  slug: string;
}

export interface Task {
  assignee_id: string | null;
  created_at: Generated<Timestamp>;
  id: string;
  position: Generated<number>;
  project_id: string;
  status: Generated<TaskStatus>;
  title: string;
  updated_at: Generated<Timestamp>;
}

export interface DB {
  project: Project;
  task: Task;
}
```

Observations that matter:
- It **declares its own local `Generated<T>`** rather than importing Kysely's; only `ColumnType` is imported.
- Postgres enums become **sorted string unions**, named PascalCase after the type (`TaskStatus`). `--runtime-enums` swaps this for real `enum`s.
- `uuid` → `string`. `jsonb` → `Generated<Json>`. `integer` with a default → `Generated<number>`.
- Nullable → `| null`. Default → wrapped in `Generated<>`. Primary key **without** a default stays a bare `string` — exactly right for client-supplied UUIDv7.
- `--camel-case` renames the **properties** (`createdAt`) — you must then also register `new CamelCasePlugin()` on the `Kysely` instance.
- **Non-`public` schemas are emitted as quoted dotted keys** ✅:
  ```ts
  export interface DB {
    account: Account;              // better-auth
    jwks: Jwks;                    // better-auth jwt plugin
    "pgboss.job": PgbossJob;       // pg-boss
    "pgboss.queue": PgbossQueue;
    project: Project;
    task: Task;
    user: User;
  }
  ```
  In a stack that also runs better-auth (§5) and pg-boss (§7) in the same database, **you get all of their tables in `DB` unless you filter**. Use `"defaultSchema": "public"` plus `"excludePattern"`, or `"includePattern"`.

### 3.5 Generate vs hand-write

| | `kysely-codegen` | Hand-written `DB` interface |
|---|---|---|
| Source of truth | the live database | the TypeScript file |
| Needs a running DB to build | **yes** (CI must spin up Postgres) | no |
| Catches drift | yes, via `--verify` | no (add the §8 guard) |
| Branded / narrowed column types (`UserId`, `type Role = 'a'\|'b'`) | only via `overrides` + `customImports`, and those are **broken under TS 7** (§9.3) | trivial |
| `ColumnType` asymmetry tuned per column (e.g. insert `string`, select `Date`) | one global `Timestamp` alias | per column |
| Extra tables from better-auth / pg-boss | leak into `DB` unless filtered | never appear |
| Cost of a schema change | free (regenerate) | one manual edit |

**Recommendation for this stack: hand-write `DB`.** Reasons specific to yapm: the Zero schema is already hand-written (so `DB` and the Zero schema are edited together in one commit), the primary keys are client-supplied UUIDv7 which codegen cannot know is intentional, and better-auth/pg-boss tables would otherwise pollute `DB`. Then use **`kysely-codegen --verify` in CI purely as a drift detector** against a checked-in generated file, or the §8 introspection test, or both.

Use codegen as the source of truth if the database is owned by another team/service, has hundreds of tables, or is changed outside your migration pipeline.

---

## 4. UUIDv7 primary keys

Sources: `uuidv7@1.2.1` `dist/index.d.ts`; `nodejs/node@main` `doc/api/crypto.md` + `doc/api/webcrypto.md`; `oven-sh/bun@main` `packages/bun-types/bun.d.ts`

### 4.1 The `uuidv7` npm package (works in browser and server)

```jsonc
{ "version": "1.2.1", "type": "module",
  "exports": { "require": "./dist/index.cjs", "default": "./dist/index.js" } }
```

Exported surface (verbatim from `dist/index.d.ts`):

```ts
export declare const uuidv7:    () => string;   // "0189dcd5-5311-7d40-8db0-9496a2eef37b"
export declare const uuidv7obj: () => UUID;
export declare const uuidv4:    () => string;
export declare const uuidv4obj: () => UUID;

export declare class UUID {
  readonly bytes: Readonly<Uint8Array>;
  static ofInner(bytes: Readonly<Uint8Array>): UUID;
  static fromFieldsV7(unixTsMs: number, randA: number, randBHi: number, randBLo: number): UUID;
  static parse(uuid: string): UUID;      // accepts hyphenated, unhyphenated, braced, urn:uuid:
  toString(): string; toHex(): string; toJSON(): string;
  getVariant(): 'VAR_0'|'VAR_10'|'VAR_110'|'VAR_RESERVED'|'NIL'|'MAX';
  getVersion(): number | undefined;
  isNil(): boolean; isMax(): boolean; clone(): UUID;
  equals(other: UUID): boolean;
  compareTo(other: UUID): number;        // sortable
}

export declare class V7Generator {
  constructor(randomNumberGenerator?: { nextUint32(): number });
  setRollbackAllowance(rollbackAllowance: number): void;   // default 10_000 ms
  generate(): UUID;                       // monotonic; RESETS on significant clock rollback
  generateOrAbort(): UUID | undefined;    // monotonic; returns undefined on significant rollback
  generateOrResetWithTs(unixTsMs: number): UUID;
  generateOrAbortWithTs(unixTsMs: number): UUID | undefined;
}
```

Key property, verbatim from the JSDoc of `V7Generator.generate()`:

> This method returns a monotonically increasing UUID by reusing the previous timestamp even if the up-to-date timestamp is smaller than the immediately preceding UUID's. However, when such a clock rollback is considered significant (by default, more than ten seconds), this method resets the generator and returns a new UUID based on the given timestamp, breaking the increasing order of UUIDs.

`uuidv7()` uses a module-global `V7Generator`, so **IDs minted in the same process are monotonically increasing** — which is what makes them good B-tree keys and good `orderBy` tiebreakers.

Usage is identical in both environments (isomorphic; uses `crypto.getRandomValues`) ✅ *executed on Node*:

```ts
// shared/id.ts — import this from the browser AND the server
import { uuidv7 } from 'uuidv7'
export const newId = uuidv7
// uuidv7() -> '019f8f92-6a1b-78d0-a10b-9b059412946a'
```

`UNVERIFIED`: browser execution was not performed here; the package is dependency-free, `"type": "module"` with a CJS fallback, and uses only `crypto.getRandomValues`.

### 4.2 `crypto.randomUUIDv7()` — availability, precisely

Verbatim from `nodejs/node` `doc/api/crypto.md`:

```
### `crypto.randomUUIDv7([options])`

<!-- YAML
added:
 - v26.1.0
 - v24.16.0
-->

* `options` {Object}
  * `disableEntropyCache` {boolean} ... **Default:** `false`.
* Returns: {string}

Generates a random [RFC 9562][] version 7 UUID. The UUID contains a millisecond
precision Unix timestamp in the most significant 48 bits, followed by
cryptographically secure random bits for the remaining fields, making it
suitable for use as a database key with time-based sorting. The embedded
timestamp relies on a non-monotonic clock and is not guaranteed to be strictly
increasing.
```

Three consequences that agents get wrong:

1. **It lives on the `node:crypto` module, not on the global `crypto`.** The Web Crypto `Crypto` class documented in `doc/api/webcrypto.md` exposes only `crypto.randomUUID()` (added v16.7.0). ✅ Confirmed at runtime on Node v26.0.0: both `globalThis.crypto.randomUUIDv7` and `require('node:crypto').randomUUIDv7` are `undefined` there (26.0.0 < 26.1.0), and `Object.keys(require('node:crypto')).filter(/uuid/i)` returns exactly `['randomUUID']`.
   ```ts
   import { randomUUIDv7 } from 'node:crypto'   // ✅ correct — Node ≥ 24.16 / ≥ 26.1
   // crypto.randomUUIDv7()                     // ❌ not on globalThis.crypto in Node
   ```
2. **Not monotonic.** "not guaranteed to be strictly increasing" — two calls in the same millisecond can come back out of order, and so can calls across a clock adjustment. The `uuidv7` package *is* monotonic within a process.
3. **Server only.** There is no browser equivalent. A client-generated primary key (which is the whole point in a Zero app — the client mints the id so the optimistic row and the authoritative row are the same row) must use the npm package. In **Bun** the equivalent is `Bun.randomUUIDv7(encoding?, timestamp?)` from `bun.d.ts`.

**Therefore: use `uuidv7` from npm everywhere.** Reach for `node:crypto`'s `randomUUIDv7` only in server-only code where you want zero dependencies and do not care about intra-millisecond ordering.

### 4.3 Declaring a client-supplied uuid primary key in the `Database` interface

```ts
import type { ColumnType, Generated } from 'kysely'

export interface TaskTable {
  // Client-supplied UUIDv7. NOT `Generated<string>` — Generated<T> = ColumnType<T, T|undefined, T>
  // would make `id` optional on insert, which silently hides a missing id until
  // Postgres raises `null value in column "id" violates not-null constraint`.
  id: string

  project_id: string
  // …
}
```

| Declaration | Insert | Meaning |
|---|---|---|
| `id: string` | **required** | app mints the id — **correct for UUIDv7** |
| `id: Generated<string>` | optional | DB has `default gen_random_uuid()` |
| `id: GeneratedAlways<string>` | forbidden | `generated always as identity` |
| `id: ColumnType<string, string, never>` | required, un-updatable | belt-and-braces: PK can never be updated |

Matching DDL — **no `DEFAULT`**, so a forgotten id fails loudly:

```ts
.addColumn('id', 'uuid', (col) => col.primaryKey())
```

Zero-side pairing (see `reference/zero.md` §3): the Zero column is `id: string()` and the row is created client-side with the same `uuidv7()` value passed as a mutator arg, so the optimistic row and the server row share a primary key.

---

## 5. better-auth 1.6.24 on its native Kysely layer

Sources: `better-auth@1.6.24` + `@better-auth/core@1.6.24` + `@better-auth/kysely-adapter@1.6.24` tarballs; <https://www.better-auth.com/docs/adapters/postgresql>; <https://www.better-auth.com/docs/adapters/other-relational-databases>; <https://www.better-auth.com/docs/concepts/database>
**Read `reference/server-stack.md` §4 first** — package layout, CLI (`npx auth@latest`), Hono mount, GitHub gotchas, JWT plugin options, organization plugin, SSO/OIDC packages. This section only covers what changes when the adapter is **Kysely instead of Drizzle**.

### 5.1 What `database:` actually accepts (this is the question everyone gets wrong)

Verbatim from `@better-auth/core@1.6.24` `dist/types/init-options.d.mts`:

```ts
import { Dialect, Kysely, MysqlPool, PostgresPool, SqliteDatabase } from "kysely";
type KyselyDatabaseType = "postgres" | "mysql" | "sqlite" | "mssql";

  /**
   * Database configuration
   */
  database?: (PostgresPool | MysqlPool | SqliteDatabase | Dialect | DBAdapterInstance | Database | DatabaseSync | D1Database | {
    dialect: Dialect;
    type: KyselyDatabaseType;
    /** casing for table names @default "camel" */
    casing?: "snake" | "camel";
    /** Enable debug logs for the adapter @default false */
    debugLogs?: DBAdapterDebugLogOption;
    /** Whether to execute multiple operations in a transaction. @default false */
    transaction?: boolean;
  } | {
    /** Kysely instance */
    db: Kysely<any>;
    /** Database type between postgres, mysql and sqlite */
    type: KyselyDatabaseType;
    casing?: "snake" | "camel";
    debugLogs?: DBAdapterDebugLogOption;
    transaction?: boolean;
  }) | undefined;
```

So **all four** of these are valid, and the resolution logic is in `@better-auth/kysely-adapter` `dist/index.mjs` (verbatim):

```js
const createKyselyAdapter = async (config) => {
	const db = config.database;
	if (!db) return { kysely: null, databaseType: null, transaction: void 0 };
	if ("db" in db)      return { kysely: db.db,                          databaseType: db.type, transaction: db.transaction };
	if ("dialect" in db) return { kysely: new Kysely({dialect: db.dialect}), databaseType: db.type, transaction: db.transaction };
	let dialect = void 0;
	const databaseType = getKyselyDatabaseType(db);
	if ("createDriver" in db)   dialect = db;                                  // a raw Kysely Dialect
	if ("getConnection" in db)  dialect = new MysqlDialect(db);
	if ("connect" in db)        dialect = new PostgresDialect({ pool: db });   // a pg Pool
	// … bun:sqlite / node:sqlite / D1 branches …
	return { kysely: dialect ? new Kysely({ dialect }) : null, databaseType, transaction: void 0 };
};
```

| Form | Result | Use when |
|---|---|---|
| `database: pool` (a `pg.Pool`) | better-auth builds its **own** `new Kysely({dialect: new PostgresDialect({pool})})` | you only share the connection pool. This is the **only form in the docs**. |
| `database: new PostgresDialect({ pool })` | same, from your dialect | you need dialect options (`cursor`, `onCreateConnection`, …) |
| `database: { dialect, type: 'postgres', transaction: true }` | own `Kysely`, but you control `type`/`transaction` | you want `transaction: true` |
| `database: { db, type: 'postgres' }` | **reuses your existing `Kysely<DB>` instance verbatim** | ← **use this.** One instance, one query log, one plugin chain. |
| `database: drizzleAdapter(…)` / `kyselyAdapter(…)` | a `DBAdapterInstance` | ORM adapters |

**Recommended for this stack** ✅ *executed and type-checked*:

```ts
// src/auth.ts
import { betterAuth } from 'better-auth'
import { bearer, jwt } from 'better-auth/plugins'
import { db } from './db/index.ts'          // the app's Kysely<DB>

export const authOptions = {
  baseURL: process.env.BETTER_AUTH_URL!,     // e.g. http://localhost:3000
  // secret: read from BETTER_AUTH_SECRET / BETTER_AUTH_SECRETS
  database: { db, type: 'postgres' as const },   // ← reuse the app's Kysely instance
  emailAndPassword: { enabled: true },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  plugins: [
    bearer(),                                    // session token via Authorization: Bearer
    jwt({ jwt: { expirationTime: '1h' } }),      // JWTs for zero-cache (§5.5)
  ],
}

export const auth = betterAuth(authOptions)
```

> `type: 'postgres'` is **mandatory** in the `{db, …}` and `{dialect, …}` forms — `createKyselyAdapter` takes `databaseType` straight from `db.type` and does not sniff it. Get it wrong and you get MySQL/MSSQL SQL against Postgres.

> ⚠️ **`casing` is a no-op in 1.6.24.** The string `"casing"` appears only in `@better-auth/core/dist/types/init-options.d.mts` (the type declaration) and `@better-auth/core/src/types/init-options.ts`. **No runtime file in `better-auth/dist` or `@better-auth/*/dist` reads it** ✅ (verified by `grep -rl casing`). Setting `casing: 'snake'` and regenerating produced byte-identical camelCase DDL ✅ *executed*. Do not plan a snake_case auth schema around it.

> **There is no `better-auth/adapters/kysely` export.** The 1.6.24 export map has `./adapters/{prisma,drizzle,mongodb,memory}` and `./adapters`, but no `kysely` — the Kysely path is built in, or explicit via `import { kyselyAdapter } from '@better-auth/kysely-adapter'`.

`kyselyAdapter` (verbatim, `@better-auth/kysely-adapter/dist/index.d.mts`) if you do want it explicit — it is the only way to get `usePlural`:

```ts
declare const kyselyAdapter: (db: Kysely<any>, config?: KyselyAdapterConfig | undefined)
  => (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>;

interface KyselyAdapterConfig {
  type?: KyselyDatabaseType | undefined;
  debugLogs?: DBAdapterDebugLogOption | undefined;
  usePlural?: boolean | undefined;      // @default false
  transaction?: boolean | undefined;    // @default false
}
declare function getKyselyDatabaseType(db: BetterAuthOptions["database"]): KyselyDatabaseType | null;
declare const createKyselyAdapter: (config: BetterAuthOptions) => Promise<{ kysely; databaseType; transaction }>;
```

### 5.2 Sharing the pool with everything else

```
        ┌──────────── pg.Pool (max: 20) ────────────┐
        │                                            │
  Kysely<DB> (app) ──┬── zeroKysely(schema, db)  → Zero /mutate  (§6)
                     ├── { db, type:'postgres' } → better-auth   (§5)
                     └── fromKysely(db)          → pg-boss       (§7)
```

All three verified against one pool and one `Kysely` instance ✅.

### 5.3 Hono mount

Identical to the Drizzle case — see `reference/server-stack.md` §4.3 for the verbatim CORS + `app.on(["POST","GET"], "/api/auth/*", …)` snippet and the typed session middleware. Nothing about the mount changes with a Kysely database. The one thing worth restating, since it is the #1 mistake:

```ts
app.use('/api/auth/*', cors({ /* … */ credentials: true }))   // MUST be registered BEFORE the route
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))
```

`auth.handler` is a `(req: Request) => Promise<Response>`; `auth.api.*` are the server-side callable endpoints; `auth.options` echoes your config; `auth.$Infer.Session` gives the session/user types. ✅ (`Object.keys(auth)` === `['handler','api','options','$context','$ERROR_CODES']`.)

### 5.4 `getMigrations()` — auth tables at boot

Verbatim signature from `better-auth/dist/db/get-migration.d.mts`:

```ts
declare function getMigrations(config: BetterAuthOptions): Promise<{
  toBeCreated: { table: string; fields: Record<string, DBFieldAttribute>; order: number }[];
  toBeAdded:   { table: string; fields: Record<string, DBFieldAttribute>; order: number }[];
  runMigrations: () => Promise<void>;
  compileMigrations: () => Promise<string>;
}>;
```

The import path is **`better-auth/db/migration`** (which the export map maps to `./dist/db/get-migration.mjs`).

Docs, verbatim (<https://www.better-auth.com/docs/concepts/database#programmatic-migrations>):

> In environments where the CLI isn't available (e.g. Cloudflare Workers, serverless functions), you can run migrations programmatically using `getMigrations` from `better-auth/db/migration`.
>
> ```typescript
> import { getMigrations } from "better-auth/db/migration";
> import { auth } from "./auth";
> const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
> await runMigrations();
> ```
>
> `getMigrations` only works with the built-in Kysely adapter (SQLite/D1, PostgreSQL, MySQL, MSSQL). It does **not** work with Prisma or Drizzle ORM adapters — use CLI migrations with those ORMs instead.

That warning is the whole reason to prefer the native Kysely layer over `drizzleAdapter` here: **with Kysely you can migrate the auth tables from application code at boot**, with no separate CLI step and no checked-in auth DDL.

Boot integration ✅ *executed and type-checked*:

```ts
// src/auth.ts (continued)
import { getMigrations } from 'better-auth/db/migration'

export async function migrateAuth(): Promise<void> {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions)
  if (toBeCreated.length === 0 && toBeAdded.length === 0) return
  console.log('[auth-migrate] create:', toBeCreated.map((t) => t.table))
  console.log('[auth-migrate] alter:',  toBeAdded.map((t) => t.table))
  await runMigrations()
}
```

Implementation detail worth knowing (verbatim from `dist/db/get-migration.mjs`) — these are plain Kysely builders, **not** wrapped in a transaction and **not** guarded by an advisory lock:

```js
async function runMigrations() {
    for (const migration of migrations) await migration.execute();
}
async function compileMigrations() {
    return migrations.map((m) => m.compile().sql).join(";\n\n") + ";";
}
```

> ⚠️ Two consequences. (a) Unlike Kysely's own `Migrator` (§2.4), **concurrent replicas calling `migrateAuth()` at boot can race** — run it from a single migration job/leader, or accept the "relation already exists" failure on the losers, or wrap it yourself. (b) A partial failure leaves the auth schema half-created. `compileMigrations()` gives you the SQL to review/commit if you'd rather feed it through your own Kysely `Migrator`.

Real output ✅ *executed* against PostgreSQL 14 with `emailAndPassword`, `github`, `bearer()`, `jwt()`:

```
toBeCreated tables: [ 'user', 'session', 'account', 'verification', 'jwks' ]
toBeAdded  tables: []
```
```sql
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "jwks" ("id" text not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" timestamptz not null, "expiresAt" timestamptz);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");
```

Facts to carry into your own `DB` interface and Zero schema:
- Table names are **singular and unquoted-lowercase**; `"user"` is a reserved word in Postgres and is always quoted.
- Columns are **camelCase** (`emailVerified`, `createdAt`, `userId`) — the one place in the schema that is not snake_case. In a Zero schema you'd write `userId: string()` with no `.from()`.
- Primary keys are `text`, not `uuid`. better-auth generates its own ids.
- `session.userId` and `account.userId` are `on delete cascade` to `"user"`.

Non-default schema (e.g. put auth in an `auth` schema) is driven by `search_path`, not by an option — docs verbatim:

```ts
database: new Pool({
  connectionString: "postgres://user:password@localhost:5432/database?options=-c search_path=auth",
})
```
> "The Better Auth CLI migration system automatically detects your configured `search_path`."
> Prereqs from the docs: `CREATE SCHEMA IF NOT EXISTS auth;` and `GRANT ALL PRIVILEGES ON SCHEMA auth TO your_user;`.

### 5.5 JWT for the sync engine

`reference/server-stack.md` §4.5 has the complete `jwt()` option list, the JWKS verification recipe and the Zero handoff. Verified additions for 1.6.24:

The `jwt` plugin's server endpoint, verbatim from `dist/plugins/jwt/index.d.mts`:

```ts
getToken: import("better-call").StrictEndpoint<"/token", {
  method: "GET";
  requireHeaders: true;
  use: (…session middleware…)[];
  metadata: { openapi: { … } };
}, { token: string }>;
```

so, ✅ type-checked:

```ts
export async function issueSyncToken(headers: Headers): Promise<string> {
  const { token } = await auth.api.getToken({ headers })   // -> { token: string }
  return token
}
```

Hono route:

```ts
app.get('/api/zero/token', async (c) => {
  const { token } = await auth.api.getToken({ headers: c.req.raw.headers })
  return c.json({ token })
})
```

The plugin also exposes `signJWT` (`POST`, body `{ payload, overrideOptions? }` → `{ token }`) and `verifyJWT` (`POST`, body `{ token, issuer? }`).

**Token expiry.** Verbatim from `dist/plugins/jwt/sign.mjs`:

```js
const defaultExp = toExpJWT(options?.jwt?.expirationTime ?? "15m", iat ?? nowSeconds);
```

→ **the default is 15 minutes.** `expirationTime?: number | string | Date` (from `dist/plugins/jwt/types.d.mts`); a `number` is treated as an absolute `exp` in seconds, a `Date` is converted, a string goes through `sec()` (`'15m'`, `'1h'`, `'7d'`). The full `JwtOptions.jwt` surface in 1.6.24: `issuer`, `audience` (`string | string[]`), `expirationTime`, `definePayload`, `getSubject`, `sign`; plus `jwks: { remoteUrl, keyPairConfig, disablePrivateKeyEncryption, rotationInterval, gracePeriod, jwksPath }` and top-level `disableSettingJwtHeader`.

15 minutes is short for a long-lived WebSocket sync session. Either raise it (`expirationTime: '1h'`) **and** wire the refresh path, or keep it short and refresh aggressively — Zero moves to `needs-auth` on a 401/403 from `/query` or `/mutate` and requires an explicit `zero.connection.connect({ auth: newToken })` (see `reference/zero.md` §10.4).

`bearer()` is a **different** plugin: it makes the *session token* usable as `Authorization: Bearer` instead of a cookie, so `auth.api.getSession({ headers })` works for a token-based SPA. You generally want both `bearer()` and `jwt()` — `bearer()` for your own API, `jwt()` for zero-cache. ✅ both instantiate and type-check together.

### 5.6 GitHub OAuth + OIDC / SSO

Package layout at 1.6.24, verified from the export map and `npm view`:

| Need | Package / import | Version |
|---|---|---|
| GitHub sign-in | built in: `socialProviders.github` | — |
| Issue JWTs | `better-auth/plugins` → `jwt()` | 1.6.24 |
| Bearer session tokens | `better-auth/plugins` → `bearer()` | 1.6.24 |
| **Consume** external IdPs (OIDC / OAuth2 / **SAML 2.0**) | `@better-auth/sso` → `sso()`; client `@better-auth/sso/client` → `ssoClient()` | **1.6.24** |
| **Be** an IdP (legacy) | `better-auth/plugins/oidc-provider` → `oidcProvider()` | in-tree, docs say it "will soon be deprecated" |
| **Be** an IdP (preferred) | `@better-auth/oauth-provider` → `oauthProvider()` (OAuth 2.1 + OIDC) | **1.6.24** |
| CLI | `npx auth@latest generate` / `migrate` (npm package is literally `auth`) | **1.6.24** |

```ts
// GitHub — see reference/server-stack.md §4.4 for the GitHub-App-specific gotchas
socialProviders: {
  github: {
    clientId:     process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  },
}
// callback: http://localhost:3000/api/auth/callback/github
```

```ts
// Being an OIDC/OAuth provider, alongside jwt()
import { jwt } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'

export const auth = betterAuth({
  database: { db, type: 'postgres' },
  disabledPaths: ['/token'],                      // REQUIRED when combining with jwt()
  plugins: [
    jwt({ disableSettingJwtHeader: true }),       // REQUIRED
    oauthProvider({ loginPage: '/sign-in', consentPage: '/consent' }),
  ],
})
```

> ⚠️ Docs, verbatim: combining `jwt()` with an OAuth-compliant provider means you **MUST** disable the plugin's own `/token` endpoint (the OAuth equivalent is `/oauth2/token`) and disable setting the JWT header.

Every plugin you add changes the schema — after any plugin change, re-run `migrateAuth()` (§5.4) or `npx auth@latest migrate`. `jwt()` adds the `jwks` table (verified in §5.4's DDL); `sso()` and `oauthProvider()` add their own.

---

## 6. Zero 1.8 + Kysely

Sources: `@rocicorp/zero@1.8.0` `out/zero-server/src/adapters/kysely.{d.ts,js}`; `reference/zero.md` §5–§6
**Prerequisite**: `reference/zero.md` §5 (mutators, `ServerTransaction`, `DBTransaction`) and §6 (`dbProvider`, `ZQLDatabase`). Do not read this section standalone.

### 6.1 Exact module surface

```ts
// @rocicorp/zero/server/adapters/kysely   (out/zero-server/src/adapters/kysely.d.ts, verbatim)
import type { Kysely, Transaction as WrappedKyselyTransaction } from 'kysely';
import type { Schema } from '../../../zero-types/src/schema.ts';
import type { DBConnection, DBTransaction } from '../../../zql/src/mutate/custom.ts';
import { ZQLDatabase } from '../zql-database.ts';

export type { ZQLDatabase };

export type KyselyDatabase<TDatabase = unknown> = Kysely<TDatabase>;

/**
 * Helper type for the wrapped transaction used by Kysely.
 * @remarks Use with `ServerTransaction` as `ServerTransaction<Schema, KyselyTransaction<typeof db>>`.
 */
export type KyselyTransaction<TDbOrSchema = KyselyDatabase> =
  TDbOrSchema extends Kysely<infer TInferredDatabase>
    ? WrappedKyselyTransaction<TInferredDatabase>
    : WrappedKyselyTransaction<TDbOrSchema>;

export declare class KyselyConnection<TDatabase> implements DBConnection<WrappedKyselyTransaction<TDatabase>> {
    constructor(client: Kysely<TDatabase>);
    transaction<T>(fn: (tx: DBTransaction<WrappedKyselyTransaction<TDatabase>>) => Promise<T>): Promise<T>;
}

export declare function zeroKysely<TSchema extends Schema, TDatabase>(
  schema: TSchema,
  client: Kysely<TDatabase>,
): ZQLDatabase<TSchema, WrappedKyselyTransaction<TDatabase>>;
```

> **`WrappedKyselyTransaction` is just Kysely's own `Transaction<DB>` class**, re-aliased on import. Inside a mutator, `tx.dbTransaction.wrappedTransaction` is a full `Transaction<DB>` — i.e. a `Kysely<DB>` — so **the entire query API of §1 is available**, typed against your `DB` interface.

The 60-line implementation (verbatim, `out/zero-server/src/adapters/kysely.js`):

```js
import { executePostgresQuery } from "../pg-query-executor.js";
import { ZQLDatabase } from "../zql-database.js";
import { CompiledQuery } from "kysely";

var KyselyConnection = class {
	#client;
	constructor(client) { this.#client = client; }
	transaction(fn) {
		return this.#client.transaction().execute((kyselyTx) => fn(new KyselyInternalTransaction(kyselyTx)));
	}
};
var KyselyInternalTransaction = class {
	wrappedTransaction;
	constructor(kyselyTx) { this.wrappedTransaction = kyselyTx; }
	runQuery(ast, format, schema, serverSchema) {
		return executePostgresQuery(this, ast, format, schema, serverSchema);
	}
	async query(sql, params) {
		return (await this.wrappedTransaction.executeQuery(CompiledQuery.raw(sql, params))).rows;
	}
};
function zeroKysely(schema, client) {
	return new ZQLDatabase(new KyselyConnection(client), schema);
}
export { KyselyConnection, zeroKysely };
```

Everything therefore runs inside **one** `db.transaction().execute(...)`: ZQL reads, `tx.mutate.*` writes, your raw Kysely queries, and any pg-boss enqueue you do with `fromKysely(wrappedTransaction)` (§7.4). One rollback boundary.

### 6.2 Wiring it up

✅ *type-checked* under `tsc --strict`, `module: NodeNext`:

```ts
// src/zero/db-provider.ts
import { zeroKysely, type KyselyTransaction } from '@rocicorp/zero/server/adapters/kysely'
import type { ServerTransaction } from '@rocicorp/zero'
import { db } from '../db/index.ts'          // Kysely<DB>
import { schema } from './schema.ts'         // the hand-written Zero schema

export const dbProvider = zeroKysely(schema, db)
//    ZQLDatabase<typeof schema, Transaction<DB>>

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema:     typeof schema
    context:    { userID: string } | undefined
    dbProvider: typeof dbProvider          // <- makes `tx` in every mutator know it's Kysely
  }
}

// Handy aliases
export type AppTx       = KyselyTransaction<typeof db>              // = Transaction<DB>
export type AppServerTx = ServerTransaction<typeof schema, AppTx>
```

Registering `dbProvider` in `DefaultTypes` is what gives `tx.dbTransaction.wrappedTransaction` its `Transaction<DB>` type inside `defineMutator`, with no manual annotation. Without it you'd write `defineMutatorWithType<Schema, Ctx, AppTx>()`.

`handleMutateRequest({ dbProvider, handler, request, userID })` is unchanged — see `reference/zero.md` §5.6.

### 6.3 Inside a mutator — what `tx` gives you

Runtime values ✅ *executed* inside `dbProvider.transaction(...)`:

```
tx.location                                  === 'server'
tx.reason                                    === 'authoritative'
Object.keys(tx.dbTransaction)                === ['wrappedTransaction']
tx.dbTransaction.wrappedTransaction.constructor.name === 'Transaction'
tx.dbTransaction.wrappedTransaction.isTransaction    === true
```

All four access paths in one mutator ✅ *executed*:

```ts
import { defineMutator, defineMutators } from '@rocicorp/zero'
import { fromKysely } from 'pg-boss'
import * as z from 'zod'
import { boss } from '../jobs/boss.ts'
import { zql } from './schema.ts'
import type { AppTx } from './db-provider.ts'

export const mutators = defineMutators({
  task: {
    create: defineMutator(
      z.object({ id: z.string(), projectID: z.string(), title: z.string() }),
      async ({ tx, args, ctx }) => {
        if (!ctx) throw new Error('unauthenticated')

        // (1) Zero CRUD — runs on client AND server, drives optimistic state
        await tx.mutate.task.insert({
          id: args.id,
          projectID: args.projectID,
          title: args.title,
          status: 'todo',
          position: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })

        if (tx.location === 'server') {
          // tx is narrowed to ServerTransaction here.
          const kysely: AppTx = tx.dbTransaction.wrappedTransaction

          // (2) Full typed Kysely inside the SAME transaction
          await kysely
            .updateTable('project')
            .set({ name: args.title })
            .where('id', '=', args.projectID)
            .execute()

          // (3) Raw parameterised SQL (CompiledQuery.raw under the hood)
          const rows = await tx.dbTransaction.query(
            'select count(*)::int as n from task where project_id = $1',
            [args.projectID],
          )
          // rows === [{ n: 1 }]                                     ✅ verified

          // (4) Transactional job enqueue — rolls back with the mutation
          await boss.send('task-created', { id: args.id }, { db: fromKysely(kysely) })
        }

        // ZQL read-back in the same tx (server: sees everything; client: only synced rows)
        const created = await tx.run(zql.task.where('id', args.id).one())
      },
    ),
  },
})
```

Verified read-back through ZQL after a raw Kysely insert in the same transaction ✅:

```js
{ id: '42ee5d45-…', projectID: '2e3a758d-…', title: 'from-kysely',
  status: 'todo', position: 0,
  createdAt: 1784820335919.307, updatedAt: 1784820335919.307 }
```

> Note `createdAt: 1784820335919.307` — Zero maps `timestamptz` to `number` **epoch milliseconds as a float**, preserving Postgres's sub-millisecond precision. Do not assume an integer. (`reference/zero.md` §9.1 has the full type map.)

> The column mapping worked because the Zero schema used `.from('project_id')` / `.from('created_at')` while the Kysely `DB` interface uses the raw snake_case names. **Both files describe the same table and must be edited together** — that is what §8 guards.

### 6.4 Running ZQL / mutators outside an HTTP request

`ZQLDatabase` is usable directly (cron, backfill, admin script):

```ts
await dbProvider.transaction(async (tx) => {
  await mutators.task.create.fn({ tx, args: {...}, ctx: { userID: 'system' } })
  const open = await tx.run(zql.task.where('status', '!=', 'done'))
})
```

Carry over from `reference/zero.md` §6: **`ZQLDatabase` reads your Postgres schema before every transaction** (bug 3799). With a Kysely pool this is one extra round trip per mutation batch.

---

## 7. pg-boss 12 + Kysely

Sources: `pg-boss@12.26.2` `dist/adapters/kysely.{d.ts,js}` + `dist/types.d.ts`; <https://github.com/timgit/pg-boss/blob/master/docs/api/adapters.md>
**`reference/server-stack.md` §6 already covers pg-boss in full** — constructor options, `send`/`work` overloads, retries/expiration/retention, `key_strict_fifo` semantics, `groupConcurrency`, cron. This section covers only the Kysely wiring, plus what re-verification confirmed.

### 7.1 `fromKysely` — exact signature

```ts
// pg-boss/dist/adapters/kysely.d.ts (verbatim)
import type { IDatabase } from '../types.ts';
export interface KyselyTransactionLike {
    executeQuery<R>(query: {
        readonly sql: string;
        readonly parameters: ReadonlyArray<unknown>;
        readonly query: any;
        readonly queryId: { readonly queryId: string };
    }, queryId?: unknown): Promise<{ readonly rows: R[] }>;
}
export declare function fromKysely(trx: KyselyTransactionLike): IDatabase;
```

```js
// pg-boss/dist/adapters/kysely.js (verbatim)
export function fromKysely(trx) {
    return {
        async executeSql(text, values) {
            const result = await trx.executeQuery({
                sql: text,
                parameters: values ?? [],
                query: { kind: 'RawNode' },
                queryId: { queryId: 'pgboss' }
            });
            return { rows: [...result.rows] };
        }
    };
}
```

> **Structural typing gotcha, in your favour**: `KyselyTransactionLike` only requires `executeQuery`, and **`Kysely<DB>` has `executeQuery` too** (`dist/kysely.d.ts:472`). So `fromKysely` accepts *both* a `Transaction<DB>` (for transactional enqueue) **and** the plain `Kysely<DB>` instance (as pg-boss's own connection). ✅ Both verified at runtime.

### 7.2 Initialisation sharing the app's Kysely instance / Pool

✅ *executed*:

```ts
// src/jobs/boss.ts
import { PgBoss, fromKysely } from 'pg-boss'
import { db } from '../db/index.ts'

// `db: <IDatabase>` bypasses ALL of pg-boss's own connection config
// (connectionString/host/max/…). It uses your Kysely instance, hence your Pool.
export const boss = new PgBoss({
  db: fromKysely(db),
  schema: 'pgboss',
})

boss.on('error', (err) => console.error('[pg-boss]', err))
```

> `reference/server-stack.md` §6.2 marks the hand-written `{ executeSql: (text, values) => pool.query(text, values) }` shim `UNVERIFIED`. **`fromKysely(db)` replaces it and is verified** — prefer it.

Boot ✅ *executed*:

```ts
await boss.start()
await boss.isInstalled()   // true
await boss.schemaVersion() // e.g. 26
```

`start()` installs/upgrades the `pgboss` schema itself (`migrate` / `createSchema` in `MaintenanceOptions` control this). It is **independent of Kysely's `Migrator`** — do not try to put pg-boss DDL in your own migrations.

> ⚠️ `useListenNotify` needs a dedicated, session-pinned connection. `IDatabase.listen?()` is optional and **`fromKysely` does not implement it**, so `useListenNotify` is unavailable through this adapter — pg-boss falls back to polling. If you need LISTEN/NOTIFY, give pg-boss its own `connectionString` instead of `db`.

### 7.3 Queue creation + send/work + per-key serialisation

The Kysely path changes nothing about the queue API. ✅ *executed* end-to-end through `fromKysely(db)`:

```ts
await boss.createQueue('webhook-dlq')
await boss.createQueue('webhook', {
  policy: 'key_strict_fifo',
  retryLimit: 3,
  retryDelay: 1,
  retryBackoff: true,
  deadLetter: 'webhook-dlq',
})

await boss.send('webhook', { n: 1 }, { singletonKey: 'install-42' })
await boss.send('webhook', { n: 2 }, { singletonKey: 'install-42' })

await boss.work('webhook', { batchSize: 1, pollingIntervalSeconds: 0.5 }, async ([job]) => {
  await ingest(job.data)
})
// processed order: [1, 2, 3]        <-- strict FIFO per singletonKey  ✅ verified
await boss.getBlockedKeys('webhook') // []
```

`getQueue('webhook')` really returns ✅:

```js
{ name: 'webhook', policy: 'key_strict_fifo', retryLimit: 3, retryDelay: 1, retryBackoff: true,
  retryDelayMax: null, expireInSeconds: 900, retentionSeconds: 1209600, deleteAfterSeconds: 604800,
  partition: false, heartbeatSeconds: null, notify: false, deadLetter: 'webhook-dlq',
  deferredCount: 0, warningQueueSize: 0, queuedCount: 0, readyCount: 0, activeCount: 0,
  failedCount: 0, totalCount: 0, singletonsActive: null, table: 'job_common',
  createdOn: …, updatedOn: … }
```

`QueuePolicy` (verbatim from `dist/types.d.ts`) — full semantics in `reference/server-stack.md` §6.4:

```ts
/**
 * - `standard` supports all standard features such as deferral, priority, and throttling.
 * - `short` only allows 1 job to be queued, unlimited active. Can be extended with `singletonKey`.
 * - `singleton` only allows 1 job to be active, unlimited queued. Can be extended with `singletonKey`.
 * - `stately` offers a combination of `short` and `singleton`; only allows 1 job per state, queued and/or active.
 * - `exclusive` only allows 1 job to be queued or active. Can be extended with singletonKey`.
 * - `key_strict_fifo` ensures strict FIFO ordering per `singletonKey`. Requires `singletonKey` on every job.
 *   Blocks processing of jobs with the same key while any job with that key is active, in retry, or failed.
 */
export type QueuePolicy = 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive' | 'key_strict_fifo' | (string & {});
```

Group concurrency (softer, N-per-key, no FIFO guarantee, no blocked-key operational burden):

```ts
export interface WorkConcurrencyOptions {
    /** Number of workers to spawn for this queue (per-node). */
    localConcurrency?: number;
    /** Limit concurrent jobs per group within this node (in-memory). No database overhead.
     *  Does not coordinate across nodes. */
    localGroupConcurrency?: number | GroupConcurrencyConfig;
    /** Limit concurrent jobs per group globally across all nodes (database tracking). */
    groupConcurrency?: number | GroupConcurrencyConfig;
}
```
```ts
await boss.send('process-data', data, { group: { id: 'tenant-123', tier: 'enterprise' } })
await boss.work('process-data', { localConcurrency: 10, groupConcurrency: { default: 1, tiers: { enterprise: 5, pro: 2 } } }, handler)
```

### 7.4 Transactional enqueue (the reason `fromKysely` exists)

Docs verbatim (<https://github.com/timgit/pg-boss/blob/master/docs/api/adapters.md>):

```ts
import { fromKysely } from 'pg-boss'

await db.transaction().execute(async (trx) => {
  await trx.insertInto('orders').values({ item: 'widget', qty: 1 }).execute()

  await boss.send('order-processing', { item: 'widget' }, { db: fromKysely(trx) })
})
```
> "When the ORM transaction is rolled back (either explicitly or by throwing an error), all pg-boss operations executed through the adapter are rolled back as well. This is the primary reason to use these adapters — to guarantee atomicity between your application writes and job scheduling."

Any pg-boss method taking `ConnectionOptions` accepts `{ db }` — `send`, `insert`, `fetch`, `complete`, `fail`, … ✅ verified with `send`.

Inside a **Zero mutator**, `tx.dbTransaction.wrappedTransaction` *is* that `trx` (§6.1), so the job and the mutation commit or roll back together ✅ *executed*:

```ts
await boss.send('task-created', { id }, { db: fromKysely(tx.dbTransaction.wrappedTransaction) })
```

---

## 8. Schema-drift guard

Sources: `kysely@0.29.4` `dist/dialect/database-introspector.d.ts`; live PostgreSQL 14.23 output

Because the Zero schema (`reference/zero.md` §3) is hand-written and the Kysely `DB` interface is hand-written (§3.5), nothing structurally forces either to match the database. This is the CI test that does.

### 8.1 `db.introspection` — exact API and return shape

Verbatim from `dist/dialect/database-introspector.d.ts`:

```ts
export interface DatabaseIntrospector {
    getSchemas(): Promise<SchemaMetadata[]>;
    getTables(options?: DatabaseMetadataOptions): Promise<TableMetadata[]>;
}
export interface DatabaseMetadataOptions {
    /** If this is true, the metadata contains the internal kysely tables
     *  such as the migration tables. */
    withInternalKyselyTables: boolean;
}
export interface SchemaMetadata { readonly name: string }
export interface TableMetadata {
    readonly name: string;
    readonly isView: boolean;
    readonly isForeign: boolean;        // foreign tables — added in 0.29
    readonly columns: ColumnMetadata[];
    readonly schema?: string;
}
export interface ColumnMetadata {
    readonly name: string;
    /** The data type of the column as reported by the database.
     *  NOTE: This value is whatever the database engine returns and it will be
     *        different on different dialects even if you run the same migrations.
     *        For example `integer` datatype in a migration will produce `int4`
     *        on PostgreSQL, `INTEGER` on SQLite and `int` on MySQL. */
    readonly dataType: string;
    /** The schema this column's data type was created in. */
    readonly dataTypeSchema?: string;
    readonly isAutoIncrementing: boolean;
    readonly isNullable: boolean;
    readonly hasDefaultValue: boolean;
    readonly comment?: string;
}
```

Real output ✅ *executed* (`await db.introspection.getTables()`), abridged to the `task` table:

```json
{
  "name": "task",
  "schema": "public",
  "isView": false,
  "isForeign": false,
  "columns": [
    { "name": "id",          "dataType": "uuid",        "dataTypeSchema": "pg_catalog", "isNullable": false, "hasDefaultValue": false, "isAutoIncrementing": false },
    { "name": "project_id",  "dataType": "uuid",        "dataTypeSchema": "pg_catalog", "isNullable": false, "hasDefaultValue": false, "isAutoIncrementing": false },
    { "name": "title",       "dataType": "text",        "dataTypeSchema": "pg_catalog", "isNullable": false, "hasDefaultValue": false, "isAutoIncrementing": false },
    { "name": "status",      "dataType": "task_status", "dataTypeSchema": "public",     "isNullable": false, "hasDefaultValue": true,  "isAutoIncrementing": false },
    { "name": "position",    "dataType": "int4",        "dataTypeSchema": "pg_catalog", "isNullable": false, "hasDefaultValue": true,  "isAutoIncrementing": false },
    { "name": "assignee_id", "dataType": "uuid",        "dataTypeSchema": "pg_catalog", "isNullable": true,  "hasDefaultValue": false, "isAutoIncrementing": false },
    { "name": "created_at",  "dataType": "timestamptz", "dataTypeSchema": "pg_catalog", "isNullable": false, "hasDefaultValue": true,  "isAutoIncrementing": false },
    { "name": "updated_at",  "dataType": "timestamptz", "dataTypeSchema": "pg_catalog", "isNullable": false, "hasDefaultValue": true,  "isAutoIncrementing": false }
  ]
}
```

Behaviour confirmed at runtime ✅:
- `getTables()` **excludes** `kysely_migration` / `kysely_migration_lock`; `getTables({ withInternalKyselyTables: true })` returns `['kysely_migration','kysely_migration_lock','project','task']`.
- Views **are** included with `isView: true` — filter them out.
- Non-`public` schemas are included; each row carries `schema`.
- `dataType` is the **pg internal name**: `int4` not `integer`, `timestamptz` not `timestamp with time zone`, and a user enum reports its own type name (`task_status`) with `dataTypeSchema: 'public'`.
- `comment` was absent (undefined) on PG 14 for uncommented columns.
- `getSchemas()` returns `[{name:'pg_toast'},{name:'pg_catalog'},{name:'public'},{name:'information_schema'}]`.

> ⚠️ **`getTables()` reports columns only.** No primary keys, no foreign keys, no indexes, no unique constraints, no enum values. For those you must query `pg_catalog` yourself.

Verified catalog queries ✅ *executed* (note the `::text` casts — `array_agg(a.attname)` yields `name[]`, which node-postgres does **not** parse, giving you the string `"{id}"` instead of `['id']`):

```ts
import { sql } from 'kysely'

const pkRows = await sql<{ table_name: string; columns: string[] }>`
  select c.relname as table_name,
         array_agg(a.attname::text order by k.ord) as columns
  from pg_index i
  join pg_class c     on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
  where i.indisprimary and n.nspname = 'public'
  group by c.relname`.execute(db)
// [{ table_name: 'task', columns: ['id'] }, …]

const enumRows = await sql<{ name: string; values: string[] }>`
  select t.typname as name,
         array_agg(e.enumlabel::text order by e.enumsortorder) as values
  from pg_type t
  join pg_enum e      on e.enumtypid  = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname`.execute(db)
// [{ name: 'task_status', values: ['todo','doing','done'] }]
```

### 8.2 The Zero schema's runtime shape

`createSchema(...).tables` is a plain object you can walk ✅ *executed*:

```json
{
  "task": {
    "name": "task",
    "columns": {
      "id":        { "type": "string", "optional": false, "customType": null },
      "projectID": { "type": "string", "optional": false, "customType": null, "serverName": "project_id" },
      "title":     { "type": "string", "optional": false, "customType": null },
      "status":    { "type": "string", "optional": false, "customType": null },
      "position":  { "type": "number", "optional": false, "customType": null },
      "createdAt": { "type": "number", "optional": false, "customType": null, "serverName": "created_at" }
    },
    "primaryKey": ["id"]
  }
}
```

`serverName` is present on a column **only** when `.from()` was used; likewise `tableSchema.serverName` for `table('x').from('y')`. So the database name is always `serverName ?? key`.

### 8.3 The CI test

✅ *executed* — prints `schema in sync` against the real database, and correctly reports both drift directions when the schema is perturbed:

```
task.extra: missing in database
task.assignee_id: in database but not in Zero schema
```

```ts
// test/schema-drift.test.ts   (vitest; any runner works)
import { sql } from 'kysely'
import { expect, test } from 'vitest'
import { db } from '../src/db/index.ts'
import { schema } from '../src/zero/schema.ts'

test('Zero schema matches the live Postgres schema', async () => {
  // ---- expected, derived from the hand-written Zero schema ----
  const expected = new Map(
    Object.values(schema.tables).map((t) => [
      t.serverName ?? t.name,
      {
        columns: new Map(
          Object.entries(t.columns).map(([k, c]) => [c.serverName ?? k, { optional: c.optional }]),
        ),
        primaryKey: t.primaryKey.map((k) => t.columns[k].serverName ?? k),
      },
    ]),
  )

  // ---- actual ----
  const tables = await db.introspection.getTables()
  const pkRows = await sql<{ table_name: string; columns: string[] }>`
    select c.relname as table_name,
           array_agg(a.attname::text order by k.ord) as columns
    from pg_index i
    join pg_class c     on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    where i.indisprimary and n.nspname = 'public'
    group by c.relname`.execute(db)
  const pkByTable = new Map(pkRows.rows.map((r) => [r.table_name, r.columns]))

  const problems: string[] = []
  for (const [name, want] of expected) {
    const got = tables.find((t) => t.name === name && t.schema === 'public' && !t.isView)
    if (!got) { problems.push(`missing table: ${name}`); continue }

    const gotCols = new Map(got.columns.map((c) => [c.name, c]))
    for (const [col, spec] of want.columns) {
      const g = gotCols.get(col)
      if (!g) { problems.push(`${name}.${col}: missing in database`); continue }
      if (g.isNullable !== spec.optional) {
        problems.push(
          `${name}.${col}: nullable mismatch (zero optional=${spec.optional}, pg isNullable=${g.isNullable})`,
        )
      }
    }
    for (const col of gotCols.keys()) {
      if (!want.columns.has(col)) problems.push(`${name}.${col}: in database but not in Zero schema`)
    }

    const pk = pkByTable.get(name) ?? []
    if (JSON.stringify(pk) !== JSON.stringify(want.primaryKey)) {
      problems.push(`${name}: primary key mismatch (zero=${JSON.stringify(want.primaryKey)}, pg=${JSON.stringify(pk)})`)
    }
  }

  expect(problems, problems.join('\n')).toEqual([])
})
```

Deliberate design choices:
- **Only tables named in the Zero schema are checked.** better-auth's `user`/`session`/`account`/`verification`/`jwks` and pg-boss's `pgboss.*` are ignored unless you sync them. (If you *do* sync `user` into Zero, it will be checked like any other table.)
- **Extra columns in the database are reported**, because Zero replicates the whole row — a column Zero doesn't know about still ends up in the replica and will surface as an unexpected field.
- `isNullable` ↔ Zero `optional` is the one cheap semantic check. **Do not** compare `dataType` to the Zero `type` naively — the Postgres→Zero map is many-to-one (`timestamptz`/`date`/`time`/`numeric`/`int8` all → `number`; `uuid`/`text`/`varchar`/enums → `string`; `json`/`jsonb`/arrays → `json`). See `reference/zero.md` §9.1 for the full table before hard-coding a mapping.

CI ordering:

```yaml
- run: npm run db:migrate        # Kysely Migrator against a fresh Postgres service
- run: npm run db:codegen:check  # kysely-codegen --verify  (only if you generate DB)
- run: npm test -- schema-drift  # this test
```

Run `db:migrate` first — the guard compares against a **migrated** database, so it also proves the migrations themselves produce the schema everyone assumes.

---

## 9. Version-pairing issues discovered while verifying

### 9.1 `@rocicorp/zero@1.8.0` peer-requires `kysely@^0.28.17` — npm refuses `kysely@0.29.x`

```
npm error ERESOLVE unable to resolve dependency tree
npm error Found: kysely@0.29.4
npm error Could not resolve dependency:
npm error peerOptional kysely@"^0.28.17" from @rocicorp/zero@1.8.0
```

Full peer list of `@rocicorp/zero@1.8.0` (all `peerOptional`):
`pg ^8.16.3 | react ^19.2.6 | kysely ^0.28.17 | solid-js ^1.9.4 | drizzle-orm ^0.45.2 | expo-sqlite >=15 | @op-engineering/op-sqlite >=15`

**Runtime is fine.** The adapter only uses `Kysely`, `Transaction`, `CompiledQuery.raw` and `executeQuery`, all unchanged in 0.29. The full path (`zeroKysely` → `dbProvider.transaction` → `tx.run` ZQL → `tx.mutate` → `wrappedTransaction.insertInto(...)` → `tx.dbTransaction.query`) was **executed against PostgreSQL 14 on kysely 0.29.4** ✅.

Choose one:

```jsonc
// package.json — npm/yarn: force a single kysely
{ "overrides":   { "kysely": "0.29.4" } }      // npm
{ "resolutions": { "kysely": "0.29.4" } }      // yarn
```
```yaml
# pnpm-workspace.yaml
peerDependencyRules:
  allowedVersions:
    "@rocicorp/zero>kysely": "0.29"
```
…or install with `--legacy-peer-deps`, …or **stay on `kysely@0.28.17`** until Zero widens the range. 0.28.17 keeps the CJS build and the root-level `Migrator` export, which means §2's `kysely/migration` import must become `from 'kysely'`. **If you pin 0.28, invert every migration import in §2.**

### 9.2 `jose` v5 vs v6 — Zero and better-auth collide, and better-auth loses

```
@rocicorp/zero@1.8.0      -> jose ^5.9.3
better-auth@1.6.24        -> jose ^6.2.4  (nested, fine)
@better-auth/core@1.6.24  -> jose ^6.1.0  (NO nested copy -> resolves the hoisted v5)
```

npm hoists `jose@5.10.0` to the root and `@better-auth/core` picks it up. Importing `better-auth` then throws at module-init **✅ reproduced**:

```
file://…/@better-auth/core/dist/oauth2/validate-authorization-code.mjs:4
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
                             ^^^^^^^^^^^
SyntaxError: The requested module 'jose' does not provide an export named 'customFetch'
```

`npm ls jose` names it explicitly: `jose@5.10.0 deduped invalid: "^6.1.0" from node_modules/@better-auth/core`.

Fixes:
- **pnpm** (strict, non-flat `node_modules`) — each package gets its own `jose`. This is the cleanest answer for this stack.
- npm `overrides` forcing `jose` to `^6` **only if** Zero tolerates it (Zero uses `jose` for JWT verification; `UNVERIFIED` whether v6 is drop-in for Zero's usage — test before shipping).
- Otherwise ensure `@better-auth/core` gets a nested `jose@6` (what was done to verify: copying `better-auth/node_modules/jose` into `@better-auth/core/node_modules/`, after which everything worked ✅).

**Always `npm ls jose` after installing both packages.**

### 9.3 `kysely-codegen@0.20.0` is broken by `typescript@7.x`

TypeScript 7's `package.json` is:

```jsonc
{ "version": "7.0.2", "type": "module",
  "exports": { ".": "./lib/version.cjs", "./unstable/sync": "…", "./unstable/ast": "…", … } }
```

`require('typescript')` now yields **`{ version, versionMajorMinor }`** and nothing else ✅ — the classic compiler API moved to `typescript/unstable/*`.

`kysely-codegen@0.20.0` `dist/generator/parser/type-expression-parser.js` still does `require('typescript')` and reads `ts.ScriptTarget.Latest`, so with TS 7 installed:

```
Failed to parse type expression: TaskStatus TypeError: Cannot read properties of undefined (reading 'Latest')
```

It logs the error, **exits 0**, and writes a file. Consequences, both ✅ reproduced by generating the same schema under TS 5.9.3 and TS 7.0.2:

| | typescript 5.9.3 | typescript 7.0.2 |
|---|---|---|
| `overrides: {"task.status": "'todo'\|'doing'\|'done'"}` | `status: "todo" \| "doing" \| "done";` | `status: 'todo' \| 'doing' \| 'done';` (raw passthrough — still compiles) |
| `customImports: {"TaskStatus": "./enums"}` + override `TaskStatus` | `import type { TaskStatus } from "./enums";` emitted | **import missing** → generated file references an undefined type → **build fails** |

Mitigations: pin `typescript@^5` in the dev toolchain, or avoid `overrides`/`customImports` (which is one more argument for hand-writing `DB`, §3.5), or drop kysely-codegen entirely.
`UNVERIFIED`: whether a later kysely-codegen release fixes this — recheck `npm view kysely-codegen version` before relying on it.

### 9.4 Smaller ones

- **`kysely@0.29` requires Node ≥ 22 and TypeScript ≥ 5.4.** `typesVersions` redirects `<5.4` to `outdated-typescript.d.ts`, which produces a deliberately loud error. `pg-boss@12` requires Node ≥ 22.12; `@rocicorp/zero` requires Node ≥ 22. **Node 22.12+ is the floor for this stack**, and 24.16+/26.1+ if you want `node:crypto`'s `randomUUIDv7` (§4.2).
- **`kysely@0.29` ships no CommonJS.** Anything in your build that `require()`s `kysely` needs `require(esm)` (Node ≥ 22.12) or a dynamic import. `pg-boss@12` is also ESM-only with no default export (`import { PgBoss, fromKysely } from 'pg-boss'`).
- **`kysely-codegen@0.20.0` peers `pg >=8.8.0 <9.0.0`** — `pg@8.22.0` ✅. Its `kysely` peer is `>=0.27.0 <1.0.0`, so 0.29.4 ✅.
- **`better-auth@1.6.24` deps `kysely: ^0.28.17 || ^0.29.0`** — the only package in the stack that already declares 0.29 support ✅.
- **`pg-boss@12.26.2` deps `pg: ^8.22.0`** — matches the app's `pg@8.22.0`, so a single `pg` copy is hoisted and the `Pool` really is shared.
- **Postgres arrays from `pg_catalog`**: `array_agg(x)` over a `name` column returns `name[]`, which node-postgres has no parser for and hands back as the raw string `"{id}"`. Always `::text`-cast (§8.1).
