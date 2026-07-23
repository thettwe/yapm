# Server Stack — Verified API Reference

Drizzle ORM · drizzle-kit · drizzle-zero · better-auth · Hono · pg-boss · Zod 4

> ## ⛔ SECTIONS 1–3 ARE SUPERSEDED — yapm uses **Kysely**, not Drizzle
>
> The data layer was changed to Kysely after this document was written. **Do not use
> §1 (Drizzle ORM), §2 (drizzle-kit), or §3 (drizzle-zero)** — see
> [`kysely-stack.md`](kysely-stack.md) instead, and use better-auth's **native Kysely**
> layer rather than the Drizzle adapter shown in §4.2.
>
> Still authoritative here: **§4 better-auth** (except the adapter choice), **§5 Hono**,
> **§6 pg-boss** (use `fromKysely`, not `fromDrizzle`), **§7 Zod 4**, and the UUIDv7
> findings in §1.6.

> **Purpose**: ground-truth API reference for coding agents whose training data predates these versions. Several of these packages changed **breaking** details recently (drizzle-orm relations v2 in the v1 beta, better-auth's Drizzle adapter moving to its own package, pg-boss v12 becoming ESM-only with array-batch handlers, Zod 4's error API). Do not write this code from memory.
>
> **Verification method** — every fact below came from one of:
> 1. `npm view <pkg> …` on 2026-07-23 (versions, peer deps, dist-tags)
> 2. The published npm tarball's `.d.ts` / `package.json` (ground truth for the exact version)
> 3. Official docs sites: orm.drizzle.team, better-auth.com, hono.dev, zod.dev, zero.rocicorp.dev, nodejs.org, postgresql.org
> 4. Official repo source: `github.com/rocicorp/drizzle-zero`, `github.com/better-auth/better-auth` (docs/content/docs/**), `github.com/timgit/pg-boss` (docs/api/**), `github.com/honojs/middleware`
>
> Anything unverified is explicitly marked `UNVERIFIED`.
>
> **Biggest trap in this document**: <https://orm.drizzle.team> now documents the **drizzle-orm v1 beta**, not 0.45.x. Its relations page (`defineRelations`), its `migrate(db)` call, and its dialect list are all wrong for 0.45.2 / 0.31.10. See §1.1 and §8.

---

## 0. Verified versions (npm, 2026-07-23)

| Package | Latest stable | Notes |
|---|---|---|
| `drizzle-orm` | **0.45.2** | `1.0.0-beta.*` exists on the `beta` tag — do not install |
| `drizzle-kit` | **0.31.10** | |
| `drizzle-zero` | **0.20.0** | `beta` tag = `1.0.0-beta.1`. Repo moved: **`github.com/rocicorp/drizzle-zero`** (no longer BriefHQ) |
| `better-auth` | **1.6.24** | |
| `@better-auth/drizzle-adapter` | **1.6.24** | new home of `drizzleAdapter` |
| `@better-auth/sso` | **1.6.24** | SSO (OIDC + SAML) is a separate package |
| `@better-auth/oauth-provider` | **1.6.24** | replaces the deprecated built-in `oidcProvider` |
| `auth` (CLI) | **1.6.24** | `npx auth@latest generate` — **`@better-auth/cli` is stale at 1.4.21** |
| `hono` | **4.12.31** | |
| `@hono/node-server` | **2.0.11** | v2 = perf-only major, public API unchanged |
| `@hono/zod-validator` | **0.9.0** | peers `hono >=4.11.2`, `zod ^3.25.0 \|\| ^4.0.0` |
| `@hono/zod-openapi` | **1.5.1** | peers `hono >=4.10.0`, **`zod ^4.0.0` only** |
| `pg-boss` | **12.26.2** | ESM-only, `engines.node >= 22.12.0`, Postgres ≥ 13 |
| `zod` | **4.4.3** | root import is v4; `zod/v3` + `zod/v4` subpaths still shipped |
| `uuidv7` | **1.2.1** | |
| `uuid` | **14.0.1** | has `v7` export |
| `@rocicorp/zero` | **1.8.0** | drizzle-zero 0.20.0 is dev-tested against exactly this |

---

## 1. Drizzle ORM 0.45.2 (PostgreSQL)

Sources: <https://orm.drizzle.team/docs/get-started-postgresql>, `/docs/column-types/pg`, `/docs/indexes-constraints`, `/docs/select`, `/docs/insert`, `/docs/transactions`; plus the `drizzle-orm@0.45.2` tarball `.d.ts`; plus `github.com/rocicorp/drizzle-zero/blob/main/db/drizzle/schema.ts` (a real 2000-line schema written against drizzle-orm ^0.45.2).

### 1.1 CRITICAL — the docs site documents the v1 beta, not 0.45.x

Verified by grepping the actual `drizzle-orm@0.45.2` tarball:

| Docs site shows (v1 beta) | Reality in 0.45.2 |
|---|---|
| `import { defineRelations } from 'drizzle-orm'` | **`defineRelations` does not exist.** `grep -rl defineRelations` over the whole published package returns nothing. Use `relations()`. |
| `drizzle(url, { relations })` | `DrizzleConfig` in 0.45.2 is `{ logger?, schema?, casing?, cache? }` — **no `relations` key** |
| `await migrate(db)` | `MigrationConfig.migrationsFolder` is **required**: `migrate(db, { migrationsFolder: './drizzle' })` |
| dialects incl. `mssql`, `cockroach` | drizzle-kit 0.31.10: `["postgresql","mysql","sqlite","turso","singlestore","gel"]` |

Exact 0.45.2 type signatures (from `dist/utils.d.ts`, `dist/relations.d.ts`, `dist/migrator.d.ts`):

```ts
export interface DrizzleConfig<TSchema extends Record<string, unknown> = Record<string, never>> {
    logger?: boolean | Logger;
    schema?: TSchema;
    casing?: Casing;
    cache?: Cache;
}

export declare function relations<TTableName extends string, TRelations extends Record<string, Relation<any>>>(
  table: AnyTable<{ name: TTableName }>,
  relations: (helpers: TableRelationsHelpers<TTableName>) => TRelations
): Relations<TTableName, TRelations>;

export interface MigrationConfig {
    migrationsFolder: string;
    migrationsTable?: string;
    migrationsSchema?: string;
}
```

### 1.2 Connection setup — node-postgres

Source: <https://orm.drizzle.team/docs/get-started-postgresql> (verbatim):

```javascript
import { drizzle } from 'drizzle-orm/node-postgres';

const db = drizzle(process.env.DATABASE_URL);
const result = await db.execute('select 1');
```

```javascript
import { drizzle } from 'drizzle-orm/node-postgres';

const db = drizzle({
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: true
  }
});
```

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle({ client: pool });
```

For yapm (shared pool with pg-boss, `snake_case` DB columns from camelCase TS fields, schema for relational queries):

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema, casing: 'snake_case' });
```

`casing: 'snake_case'` is verified present in `DrizzleConfig` (§1.1). It makes `createdAt` map to `created_at` without writing the DB name twice — **and drizzle-zero reads the same casing setting** (§3).

### 1.3 Column types (`drizzle-orm/pg-core`)

Source: <https://orm.drizzle.team/docs/column-types/pg> (verbatim):

```typescript
import { uuid, pgTable } from "drizzle-orm/pg-core";

export const table = pgTable('table', {
  uuid1: uuid(),
  uuid2: uuid().defaultRandom(),
  uuid3: uuid().default('a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11')
});
```

```typescript
import { text, pgTable } from "drizzle-orm/pg-core";

export const table = pgTable('table', {
  text: text(),
  textEnum: text({ enum: ["value1", "value2"] })
});
```

```typescript
import { sql } from "drizzle-orm";
import { timestamp, pgTable } from "drizzle-orm/pg-core";

export const table = pgTable('table', {
  timestamp1: timestamp(),
  timestamp2: timestamp({ precision: 6, withTimezone: true }),
  timestamp3: timestamp().defaultNow(),
  timestamp4: timestamp().default(sql`now()`),
  timestamp5: timestamp({ mode: "date" }),
  timestamp6: timestamp({ mode: "string" }),
  updatedAt: timestamp({ mode: 'date', precision: 3 }).$onUpdate(() => new Date())
});
```

```typescript
import { jsonb, pgTable } from "drizzle-orm/pg-core";

export const table = pgTable('table', {
  jsonb1: jsonb(),
  jsonbTyped: jsonb().$type<{ foo: string }>()
});
```

```typescript
import { pgEnum, pgTable } from "drizzle-orm/pg-core";

export const moodEnum = pgEnum('mood', ['sad', 'ok', 'happy']);

export const table = pgTable('table', {
  mood: moodEnum()
});
```

`boolean()`, `integer()`, `serial()`, `varchar({ length: 256 })`, `char({ length: 2 })`, `bigint({ mode: 'number' })`, `numeric()`, `real()`, `doublePrecision()`, `date()`, `time()`, `inet()`, `cidr()`, `macaddr()` are all present (all used in the drizzle-zero test schema against 0.45.2).

Real 0.45.2 shared-columns pattern, verbatim from `rocicorp/drizzle-zero/db/drizzle/schema.ts`:

```ts
const sharedColumns = {
  createdAt: timestamp('createdAt', {
    mode: 'string',
    precision: 3,
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updatedAt', {
    mode: 'string',
    precision: 3,
    withTimezone: true,
  })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
} as const;

export const user = pgTable('user', {
  ...sharedColumns,
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').$type<`${string}@${string}`>().notNull(),
  status: text('status', {enum: ['ASSIGNED', 'COMPLETED']}),
});
```

Builder methods verified present in `0.45.2/column-builder.d.ts`: `.$type<T>()`, `.$default(fn)` / `.$defaultFn(fn)` (aliases), `.$onUpdate(fn)`, `.default(v)`, `.notNull()`, `.primaryKey()`, `.unique()`, `.references(...)`.

### 1.4 Indexes, foreign keys, composite primary keys

Source: <https://orm.drizzle.team/docs/indexes-constraints> (verbatim). Third argument to `pgTable` is an **array** (the object/callback-returning-object form was removed before 0.45):

```typescript
import { serial, text, index, uniqueIndex, pgTable } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: serial().primaryKey(),
  name: text(),
  email: text(),
}, (table) => [
  index("name_idx").on(table.name),
  uniqueIndex("email_idx").on(table.email)
]);
```

```typescript
import { serial, text, integer, foreignKey, pgTable } from "drizzle-orm/pg-core";

export const book = pgTable("book", {
  id: serial("id"),
  name: text("name"),
  authorId: integer("author_id").references(() => user.id, { onDelete: "cascade" })
});

export const profile = pgTable("profile", {
  id: serial("id"),
  userId: integer("user_id"),
}, (table) => [
  foreignKey({
    columns: [table.userId],
    foreignColumns: [user.id],
    name: "profile_user_fk"
  }).onDelete("cascade")
]);
```

```typescript
import { serial, text, integer, primaryKey, pgTable } from "drizzle-orm/pg-core";

export const booksToAuthors = pgTable("books_to_authors", {
  authorId: integer("author_id"),
  bookId: integer("book_id"),
}, (table) => [
  primaryKey({ columns: [table.bookId, table.authorId] })
]);
```

### 1.5 Relations — the 0.45.2 API is `relations()`, not `defineRelations()`

Verbatim from `rocicorp/drizzle-zero/db/drizzle/schema.ts` (real code, drizzle-orm ^0.45.2):

```ts
import {relations, sql} from 'drizzle-orm';

export const userRelations = relations(user, ({many}) => ({
  messages: many(message),
}));

export const messageRelations = relations(message, ({one}) => ({
  medium: one(medium, {
    fields: [message.mediumId],
    references: [medium.id],
  }),
  sender: one(user, {
    fields: [message.senderId],
    references: [user.id],
  }),
}));
```

Disambiguating two FKs to the same table uses `relationName` on **both** sides — verbatim from better-auth's Drizzle adapter docs (also 0.45.x-targeted):

```ts
export const usersRelations = relations(users, ({ many }) => ({
  testsByUserId: many(tests, { relationName: "tests_userId" }),
  testsByManagerId: many(tests, { relationName: "tests_managerId" }),
}));

export const testsRelations = relations(tests, ({ one }) => ({
  user: one(users, {
    fields: [tests.userId],
    references: [users.id],
    relationName: "tests_userId",
  }),
  manager: one(users, {
    fields: [tests.managerId],
    references: [users.id],
    relationName: "tests_managerId",
  }),
}));
```

Relations reach the DB instance through `schema` (they are exported consts inside the schema module), i.e. `drizzle({ client: pool, schema })` → `db.query.users.findMany({ with: { posts: true } })`. There is **no** `relations` config key in 0.45.2.

### 1.6 Query API

Select (<https://orm.drizzle.team/docs/select>, verbatim):

```typescript
const result = await db.select().from(users);

const result = await db.select({
  field1: users.id,
  field2: users.name,
}).from(users);
```

```typescript
import { eq, lt, gte, ne, and, or } from 'drizzle-orm';

await db.select().from(users).where(eq(users.id, 42));
await db.select().from(users).where(and(eq(users.id, 42), eq(users.name, 'Dan')));
```

```typescript
import { asc, desc } from 'drizzle-orm';

await db.select().from(users)
  .orderBy(asc(users.name))
  .limit(10)
  .offset(10);
```

```typescript
import { count, sum, avg, max, min } from 'drizzle-orm';

await db.select({
  age: users.age,
  count: count(users.id),
}).from(users).groupBy(users.age);

const total = await db.$count(users);
```

Insert (<https://orm.drizzle.team/docs/insert>, verbatim):

```typescript
await db.insert(users).values({ name: 'Andrew' });
await db.insert(users).values([{ name: 'Andrew' }, { name: 'Dan' }]);

type NewUser = typeof users.$inferInsert;

await db.insert(users).values({ name: "Dan" }).returning();
await db.insert(users).values({ name: "Partial Dan" }).returning({ insertedId: users.id });

await db.insert(users)
  .values({ id: 1, name: 'John' })
  .onConflictDoNothing({ target: users.id });

await db.insert(users)
  .values({ id: 1, name: 'Dan' })
  .onConflictDoUpdate({ target: users.id, set: { name: 'John' } });

await db.insert(users)
  .values({ firstName: 'John', lastName: 'Doe' })
  .onConflictDoUpdate({
    target: [users.firstName, users.lastName],
    set: { firstName: 'John1' }
  });
```

Update / delete follow the same shape: `db.update(t).set({...}).where(...).returning()`, `db.delete(t).where(...)`. Row types: `typeof users.$inferSelect` / `typeof users.$inferInsert`.

### 1.7 Transactions

Source: <https://orm.drizzle.team/docs/transactions>. Shape: `db.transaction(async (tx) => { … })`; `tx` exposes the same `select/insert/update/delete/query` surface; `tx.rollback()` aborts; the callback's return value is the transaction's resolved value; nested `tx.transaction(...)` creates a savepoint. Second parameter (PostgreSQL) accepts:

```ts
{
  isolationLevel: "read uncommitted" | "read committed" | "repeatable read" | "serializable",
  accessMode: "read only" | "read write",
  deferrable: boolean
}
```

Enqueue a pg-boss job inside the same transaction — verbatim from `pg-boss@12.26.2/dist/adapters/drizzle.d.ts`:

```ts
import { sql } from 'drizzle-orm'
import { fromDrizzle } from 'pg-boss'

await db.transaction(async (tx) => {
  await boss.send('my-queue', data, { db: fromDrizzle(tx, sql) })
})
```

### 1.8 Client-generated UUIDv7 primary keys

Three generators exist. **Verified facts:**

**(a) Node has a native v7 generator — `crypto.randomUUIDv7()`, added in Node v24.16.0.** Verbatim from `https://nodejs.org/docs/latest-v24.x/api/crypto.json`:

> `crypto.randomUUIDv7([options])` — added in: `v24.16.0`
> "Generates a random RFC 9562 version 7 UUID. The UUID contains a millisecond precision Unix timestamp in the most significant 48 bits, followed by cryptographically secure random bits for the remaining fields, making it suitable for use as a database key with time-based sorting. **The embedded timestamp relies on a non-monotonic clock and is not guaranteed to be strictly increasing.**"
> options: `disableEntropyCache` (boolean, default `false`)

Notes:
- It is `crypto.randomUUID**v7**()`, **not** `crypto.randomUUID({ version: 7 })`. `crypto.randomUUID()` is documented as "Generates a random **RFC 4122 version 4** UUID" (added v15.6.0) and ignores/rejects a version option.
- It lives in **`node:crypto` module methods only** — verified absent from `https://nodejs.org/docs/latest-v24.x/api/webcrypto.html` (0 occurrences). So it is **not** available as `globalThis.crypto.randomUUIDv7()` and **not** available in the browser.
- Requires ≥ 24.16.0. On an older 24.x (or, in my local test, Node 26.0.0 which predates the backport), `require('crypto').randomUUIDv7` is `undefined`.

**(b) `uuidv7` npm package 1.2.1** — the recommended choice for yapm, because the ID is minted in the **browser** (optimistic mutations) and shared client/server code cannot use `node:crypto`. Verbatim from its README:

```javascript
import { uuidv7 } from "uuidv7";

const result = uuidv7(); // e.g., "017fe537-bb13-7c35-b52a-cb5490cce7be"
```

Exports (from `dist/index.d.ts`): `uuidv7()`, `uuidv7obj()`, `uuidv4()`, `uuidv4obj()`, `class UUID`, `class V7Generator`. Its key advantage over Node's built-in is **monotonicity**: it uses a 42-bit counter, so IDs generated within the same millisecond are strictly increasing, and it tolerates small clock rollbacks (≤10 s by default) instead of going backwards. Node's built-in explicitly does not guarantee that.

**(c) `uuid@14.0.1`** also ships v7: `import { v7 } from 'uuid'` (`declare function v7(options?: Version7Options, buf?, offset?): string`). Heavier and no monotonic-counter guarantee documented; prefer `uuidv7` unless you already depend on `uuid`.

**(d) Postgres-side default**: `uuidv7()` is a **PostgreSQL 18** built-in. Verified: <https://www.postgresql.org/docs/current/functions-uuid.html> documents `uuidv7()` ("Generates a version 7 (time-ordered) UUID… The optional parameter *shift* will shift the computed timestamp by the given `interval`"), while <https://www.postgresql.org/docs/17/functions-uuid.html> contains **no** occurrence of `uuidv7` (only `gen_random_uuid`). Since the yapm stack targets Postgres ≥ 15, a DB-side default is not portable — and a DB default is the wrong choice anyway (see §3: a column with a DB default becomes `optional` in the generated Zero schema and drizzle-zero warns about it).

Recommended column definition (client-minted, no DB default, so drizzle-zero emits a required column):

```ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

export const issue = pgTable('issue', {
  // no .defaultRandom() / .default(sql`...`): the client mints the id.
  // $defaultFn only fires for server-side inserts that omit `id`.
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});
```

Validate incoming client IDs with `z.uuidv7()` (Zod 4 has a dedicated v7 checker — §7).

---

## 2. drizzle-kit 0.31.10

Sources: <https://orm.drizzle.team/docs/drizzle-config-file>, `/docs/drizzle-kit-generate`, `/docs/drizzle-kit-migrate`, `/docs/migrations`; plus the `drizzle-kit@0.31.10` tarball (`api.d.ts`, `index.d.ts`).

### 2.1 Config file

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
  casing: "snake_case",
  migrations: { table: "__drizzle_migrations", schema: "drizzle" },
  verbose: true,
  strict: true,
});
```

Exact `Config` type in 0.31.10 (from `api.d.ts`) — note the dialect list and that `casing` exists at top level:

```ts
declare const dialects: readonly ["postgresql", "mysql", "sqlite", "turso", "singlestore", "gel"];

type Config = {
    dialect: Dialect;
    out?: string;
    breakpoints?: boolean;
    tablesFilter?: string | string[];
    extensionsFilters?: 'postgis'[];
    schemaFilter?: string | string[];
    schema?: string | string[];
    verbose?: boolean;
    strict?: boolean;
    casing?: 'camelCase' | 'snake_case';
    migrations?: { table?: string; schema?: string; prefix?: Prefix; };
    introspect?: { casing: 'camel' | 'preserve'; };
    entities?: { roles?: boolean | { provider?: 'supabase' | 'neon' | string & {}; exclude?: string[]; include?: string[]; }; };
} & ( … dialect-specific dbCredentials union … );

declare function defineConfig(config: Config): Config;
export { type Config, defineConfig };
```

Postgres `dbCredentials` is either `{ url: string }` or `{ host, port?, user?, password?, database, ssl? }`.

`drizzle-kit` also has a **minimal `Config` type export** (`import type { Config } from 'drizzle-kit'`) used with `satisfies` — verbatim from `rocicorp/drizzle-zero/db/drizzle.config.ts`:

```ts
import type {Config} from 'drizzle-kit';

export default {
  schema: './drizzle/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
} satisfies Config;
```

### 2.2 CLI

```bash
npx drizzle-kit generate                       # diff schema → SQL file + snapshot in ./drizzle
npx drizzle-kit migrate                        # apply pending SQL files
npx drizzle-kit migrate --config=drizzle-prod.config.ts
npx drizzle-kit push                           # dev only: sync schema without files
npx drizzle-kit pull                           # introspect existing DB
npx drizzle-kit export                         # emit SQL (Atlas etc.)
npx drizzle-kit studio
npx drizzle-kit check                          # detect collisions in migration history
```

Applied migrations are tracked in `__drizzle_migrations` inside the `drizzle` schema by default; both are configurable via `migrations: { table, schema }`.

### 2.3 Running migrations programmatically at boot ← the important one

**Import path**: `drizzle-orm/<driver>/migrator` — for node-postgres that is `drizzle-orm/node-postgres/migrator`. Exact 0.45.2 signature (`node-postgres/migrator.d.ts`):

```ts
import type { MigrationConfig } from "../migrator.js";
import type { NodePgDatabase } from "./driver.js";
export declare function migrate<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
  config: MigrationConfig
): Promise<void>;
```

with (`migrator.d.ts`):

```ts
export interface MigrationConfig {
    migrationsFolder: string;      // REQUIRED in 0.45.2
    migrationsTable?: string;
    migrationsSchema?: string;
}
```

⚠️ The docs page shows `await migrate(db)` with no second argument — that is the **v1 beta** signature. On 0.45.2 it is a type error and will not find any migrations.

Boot-time pattern for yapm (single container that must self-migrate on start):

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

// Runs inside a transaction per migration file; records into drizzle.__drizzle_migrations
await migrate(db, {
  migrationsFolder: './drizzle',
  migrationsTable: '__drizzle_migrations',
  migrationsSchema: 'drizzle',
});
```

The migration `.sql` files + `meta/_journal.json` must be **copied into the Docker image** — `migrate()` reads the folder from disk at runtime (`readMigrationFiles(config)` in `migrator.d.ts`).

`drizzle-kit`'s programmatic API (`drizzle-kit/api`) exposes `generateDrizzleJson`, `generateMigration`, `pushSchema`, `upPgSnapshot` etc. — that is for building tooling, **not** for applying migrations at boot. Use `migrate()`.

---

## 3. drizzle-zero 0.20.0

Sources: <https://github.com/rocicorp/drizzle-zero> (README, `db/drizzle/schema.ts`, `integration/drizzle-zero.config.ts`, `no-config-integration/zero-schema.gen.ts`), plus the `drizzle-zero@0.20.0` tarball (`package.json`, `dist/index.d.ts`, `dist/cli/index.js`).

### 3.1 Package facts

- Package name: **`drizzle-zero`**, latest **0.20.0**, `beta` dist-tag `1.0.0-beta.1`.
- **Canonical repo is now `github.com/rocicorp/drizzle-zero`** (Rocicorp took it over from BriefHQ; `bugs.url` is `https://bugs.rocicorp.dev`). Old BriefHQ links are stale.
- Type: ESM (`"type": "module"`), single export path `.`, bin `drizzle-zero`.
- Peer deps: `drizzle-orm >=0.36.0`, `@rocicorp/zero` (any), `pg` / `postgres` / `@types/pg` / `prettier >=3.0.0` all **optional**.
- Runtime deps: `ts-morph ^27.0.2`, `tsx ^4.23.0`, `commander ^14`, `camelcase`, `pluralize`, `jsonc-parser`.
- Dev-tested against: `@rocicorp/zero@1.8.0`, `drizzle-orm@^0.45.2`, `drizzle-kit@^0.31.10`, `typescript@^6.0.3`. **Exactly the yapm pinning** (except TS).
- TS7 note: `ts-morph` reaches TypeScript through `@ts-morph/common`, which **vendors its own `dist/typescript.js`** (verified in the 0.28.1 tarball). So drizzle-zero's codegen does not consume the `typescript` package's JS Compiler API and does not conflict with TypeScript 7's Go compiler. It still needs your `tsconfig.json` to *include* the schema file.

### 3.2 How conversion works

Zero-config path (recommended for large schemas): the CLI reads `drizzle.config.ts`, loads the Drizzle schema file named in it, and emits a static `zero-schema.gen.ts`.

```json
{
  "scripts": {
    "generate": "drizzle-zero generate --format",
    "postinstall": "npm generate"
  }
}
```

README constraints, verbatim:

> "This command will look for a Drizzle Kit config at `drizzle.config.ts` in the current directory and use the Drizzle schema defined in it. _This must be a single TS file and not a folder/glob for type resolution to work_. It will also use the casing defined in your drizzle config."
>
> "**Important:** the Drizzle schema **must be included in the tsconfig** for type resolution to work. If they are not included, there will be an error similar to `Failed to find type definitions`."

### 3.3 CLI flags (verbatim from `dist/cli/index.js`)

```
drizzle-zero generate
  -c, --config <input-file>              Path to the drizzle-zero.config.ts configuration file
  -s, --schema <input-file>              Path to the Drizzle schema file
  -k, --drizzle-kit-config <input-file>  Path to the Drizzle Kit config file   (default: drizzle.config.ts)
  -o, --output <output-file>             Path to the generated output file      (default: zero-schema.gen.ts)
  -t, --tsconfig <tsconfig-file>         Path to the custom tsconfig file
  -f, --format                           Format the generated schema (needs prettier)
  -d, --debug                            Enable debug mode
  -j, --js-file-extension                Add .js extensions to imports (auto-detected from tsconfig moduleResolution)
      --skip-types                       Skip generating table Row[] type exports
      --skip-builder                     Skip generating the builder export
      --skip-declare                     Skip module augmentation for default types in Zero
      --enable-legacy-mutators           Sets enableLegacyMutators: true
      --enable-legacy-queries            Sets enableLegacyQueries: true
      --suppress-defaults-warning        Hide warnings for columns with database default values
      --force                            Overwrite the output file even if manually modified
```

The generated file is **signed** (`// @generated drizzle-zero signature:sha256:…`); if you hand-edit it, the next run aborts with `has been manually modified. Use --force to overwrite.`

### 3.4 Optional `drizzle-zero.config.ts` (column/table subsetting + many-to-many)

Verbatim from the README:

```ts
import {drizzleZeroConfig} from 'drizzle-zero';
// directly glob import your original Drizzle schema w/ tables/relations
import * as drizzleSchema from './drizzle-schema';

export default drizzleZeroConfig(drizzleSchema, {
  tables: {
    users: {
      id: true,
      name: true,
      email: true,
    },
    posts: {
      id: true,
      content: true,
      // Use the JavaScript field name (authorId), not the DB column name (author_id)
      authorId: true,
    },
  },
  // casing: "snake_case",
});
```

> **Important (README):** "The config file currently struggles with types for large schemas. In those cases, stick with the default CLI behavior." And the config file itself must be in the tsconfig.

Many-to-many, simple and extended forms (verbatim):

```ts
export default drizzleZeroConfig(drizzleSchema, {
  tables: { user: {id: true, name: true}, usersToGroup: {userId: true, groupId: true}, group: {id: true, name: true} },
  manyToMany: {
    user: {
      // Simple format: [junction table, target table]
      groups: ['usersToGroup', 'group'],
    },
  },
});
```

```ts
  manyToMany: {
    user: {
      friends: [
        { sourceField: ['id'],          destTable: 'friendship', destField: ['requestingId'] },
        { sourceField: ['acceptingId'], destTable: 'user',       destField: ['id'] },
      ],
    },
  },
```

A real config from the repo's integration test uses `tables: { user: true, message: true, … }` (whole-table opt-in) plus `manyToMany`.

### 3.5 What the generated schema looks like

Head/tail of `no-config-integration/zero-schema.gen.ts` (verbatim, real output of 0.20.x against @rocicorp/zero 1.8):

```ts
// @generated drizzle-zero signature:sha256:eb4c…
// This file was automatically generated by drizzle-zero.
// You should NOT make any changes in this file as it will be overwritten.

import type {ReadonlyJSONValue, Row} from '@rocicorp/zero';
import {createBuilder} from '@rocicorp/zero';
import type {CustomType} from 'drizzle-zero';
import type * as drizzleSchema from '../db/schema';

const allTypesTable = {
  name: 'allTypes',
  columns: {
    createdAt: { type: 'number', optional: true,  customType: null as unknown as number },
    id:        { type: 'string', optional: false, customType: null as unknown as string },
    smallintField: { type: 'number', optional: false, customType: null as unknown as number, serverName: 'smallint' },
    optionalEnum:  { type: 'string', optional: true,  customType: null as unknown as 'active' | 'inactive' | 'pending', serverName: 'optional_enum' },
  },
  primaryKey: ['id'],
  serverName: 'all_types',
} as const;

const analyticsDashboardRelationships = {
  owner:   [{ sourceField: ['ownerId'], destField: ['id'],          destSchema: 'user',             cardinality: 'one'  }],
  widgets: [{ sourceField: ['id'],      destField: ['dashboardId'], destSchema: 'analyticsWidget',  cardinality: 'many' }],
} as const;

export const schema = {
  tables:        { allTypes: allTypesTable, /* … */ },
  relationships: { analyticsDashboard: analyticsDashboardRelationships, /* … */ },
} as const;

export type Schema = typeof schema;
export type User = Row<(typeof schema)['tables']['user']>;

export const zql = createBuilder(schema);
export const builder = zql;
```

So each run gives you: `schema`, `Schema`, one `Row`-derived type per table (unless `--skip-types`), and `zql` / `builder` (unless `--skip-builder`).

### 3.6 Type-support constraints (the part nobody documents)

Exact mapping tables from `dist/index.d.ts`:

```ts
declare const drizzleDataTypeToZeroType: {
    readonly number: "number";
    readonly bigint: "number";
    readonly boolean: "boolean";
    readonly date: "number";
};

declare const drizzleColumnTypeToZeroType: {
    readonly PgText: "string";      readonly PgChar: "string";
    readonly PgVarchar: "string";   readonly PgUUID: "string";
    readonly PgCidr: "string";      readonly PgInet: "string";
    readonly PgMacaddr: "string";   readonly PgMacaddr8: "string";
    readonly PgEnumColumn: "string";
    readonly PgJsonb: "json";       readonly PgJson: "json";
    readonly PgNumeric: "number";   readonly PgDateString: "number";
    readonly PgTime: "number";      readonly PgTimestampString: "number";
    readonly PgArray: "json";
};

type ZeroTypeToTypescriptType = { number: number; boolean: boolean; date: string; string: string; json: ReadonlyJSONValue; };
```

Consequences and hard errors (strings taken from `dist/cli/index.js`):

- **Postgres only**: `drizzle-zero: Unsupported table type: <name>. Only Postgres tables are supported.`
- **Unsupported column types are silently dropped with a warning**: `🚨 drizzle-zero: Unsupported column type: <col> - <columnType> (<dataType>). It will not be included in the output. Must be supported by Zero, e.g.: number | bigint | boolean | date | PgText | … | PgArray`
- **All timestamps/dates become Zero `number`** (epoch millis) — `date`, `PgTimestampString`, `PgDateString`, `PgTime` all map to `number`. Plan client code accordingly; don't expect `Date` objects on the Zero side.
- **`uuid` → `string`**, `jsonb`/`json`/arrays → `json` (`ReadonlyJSONValue`), `numeric`/`bigint` → `number` (precision caveat for big `bigint`s is yours to manage).
- **`.$type<T>()` is preserved** end-to-end via the `CustomType<typeof drizzleSchema, 'table', 'column'>` helper, including string-literal unions from `pgEnum` and `text({enum: [...]})`.
- **Columns with DB defaults become `optional: true`** in the Zero schema and trigger a warning by default: "drizzle-zero warns when columns use database defaults (`.default()` or `.defaultFn()`) since these won't be available on the Zero client" (silence with `--suppress-defaults-warning`). ← This is precisely why yapm mints UUIDv7 primary keys on the client instead of using `defaultRandom()`.
- Composite primary keys are emitted as `primaryKey: ['a','b']`; `serverName` carries the DB name when it differs from the JS key (so `casing: 'snake_case'` round-trips).
- `drizzleZeroConfig` config-file mode also exports the runtime helpers `createZeroTableBuilder`, `getDrizzleColumnKeyFromColumnName`, and the types `DrizzleToZeroSchema`, `ZeroColumns`, `ColumnsConfig`, `CustomType`, `ZeroCustomType`, `ZeroTableBuilder`, `ZeroTableCasing`.

`UNVERIFIED`: the README's feature list mentions "Custom ZQL database adapter for using Drizzle in the same `tx` as Zero mutators", but 0.20.0's `package.json` exposes only the `.` export and `dist/index.d.ts` contains no `zql`/`adapter` symbol. Either it is unexported in 0.20.0 or it landed on the `1.0.0-beta` line. Do not plan around it without re-checking.

---

## 4. better-auth 1.6.24

Sources: `github.com/better-auth/better-auth/docs/content/docs/**` at `main` (repo `packages/better-auth/package.json` reports version **1.6.24**, matching npm latest), plus the `better-auth@1.6.24` tarball export map, plus `npm view` for the sibling packages.

### 4.1 Package layout changes you must know

| Thing | 1.6.24 reality |
|---|---|
| Drizzle adapter | Docs now say **`@better-auth/drizzle-adapter`** (`import { drizzleAdapter } from "@better-auth/drizzle-adapter"`). The legacy path `better-auth/adapters/drizzle` **still exists** in the export map (→ `dist/adapters/drizzle-adapter/index.mjs`), so both work today; new code should use the package. |
| CLI | **`npx auth@latest generate` / `migrate`** — the npm package is literally named `auth` (1.6.24). `@better-auth/cli` is abandoned at 1.4.21. |
| SSO | separate package **`@better-auth/sso`** (server `sso()`, client `@better-auth/sso/client`) — OIDC + OAuth2 + **SAML 2.0** |
| OIDC provider | built-in `better-auth/plugins` → `oidcProvider()` still ships, but docs carry: "This plugin will soon be deprecated in favor of the OAuth Provider Plugin" (**`@better-auth/oauth-provider`**, OAuth 2.1 + OIDC-compatible) |
| Peer deps | `drizzle-orm: ^0.45.2`, `drizzle-kit: >=0.31.4`, `pg: ^8.0.0` — **better-auth 1.6 pins the same Drizzle line yapm uses; do not jump to the drizzle v1 beta** |
| Bundle | with an ORM adapter, docs suggest importing `betterAuth` from `better-auth/minimal` to cut bundle size |

### 4.2 Server instance + Drizzle adapter

```ts title="auth.ts"
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "./database.ts";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg", // or "mysql" | "sqlite"
  }),
  //... the rest of your config
});
```

Options: `provider`, `schema` (map better-auth models → your Drizzle tables/relations), `usePlural: true` for plural table names.

Env: `BETTER_AUTH_SECRET` (≥32 chars, `openssl rand -base64 32`; `BETTER_AUTH_SECRETS` plural for rotation) and `BETTER_AUTH_URL=http://localhost:3000`.

Schema workflow (verbatim from the adapter doc):

```bash
npx auth@latest generate   # writes/updates the Drizzle schema for core + enabled plugins
npx drizzle-kit generate   # generate the migration file
npx drizzle-kit migrate    # apply the migration
```

Experimental joins (2–3× fewer round trips on `/get-session`, `/get-full-organization`):

```ts title="auth.ts"
export const auth = betterAuth({
  experimental: { joins: true }
});
```
Requires Drizzle `relations()` defined **and passed through the adapter's `schema` object**, with matching `relationName` on both sides of any duplicated FK (see §1.5).

### 4.3 Hono integration (verbatim from `docs/integrations/hono.mdx`)

```ts
import { Hono } from "hono";
import { auth } from "./auth";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";

const app = new Hono();

app.use(
	"/api/auth/*", // or replace with "*" to enable cors for all routes
	cors({
		origin: "http://localhost:3001", // replace with your origin
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["POST", "GET", "OPTIONS"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
		credentials: true,
	}),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => {
	return auth.handler(c.req.raw);
});

serve(app);
```

> "**Important:** CORS middleware must be registered before your routes."

Typed session middleware (verbatim) — note `auth.$Infer.Session`:

```ts
const app = new Hono<{
	Variables: {
		user: typeof auth.$Infer.Session.user | null;
		session: typeof auth.$Infer.Session.session | null
	}
}>();

app.use("*", async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });

  	if (!session) {
    	c.set("user", null);
    	c.set("session", null);
    	await next();
        return;
  	}

  	c.set("user", session.user);
  	c.set("session", session.session);
  	await next();
});
```

```ts
app.get("/session", (c) => {
	const session = c.get("session")
	const user = c.get("user")
	if(!user) return c.body(null, 401);
  	return c.json({ session, user });
});
```

Cross-subdomain cookies (needed when `zero-cache` runs on `zero.example.com` and cookie-forwarding auth is used):

```ts title="auth.ts"
export const auth = createAuth({
  advanced: {
    crossSubDomainCookies: { enabled: true }
  }
})
```
(The doc's `createAuth` is a typo for `betterAuth`; the `advanced` shape is the real part.) `advanced.defaultCookieAttributes: { sameSite: "none", secure: true, partitioned: true }` exists for true cross-domain, and per-cookie overrides live in `advanced.cookies.sessionToken.attributes`.

### 4.4 Email/password + GitHub OAuth

```ts title="auth.ts"
export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    // requireEmailVerification: true,
    // onExistingUserSignUp: async ({ user }, request) => { … }
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
});
```

Client: `authClient.signIn.email({ email, password })`, `authClient.signIn.social({ provider: "github" })`.

GitHub gotchas from the doc, relevant because yapm uses a **GitHub App** (not an OAuth App):
- Redirect URL: `http://localhost:3000/api/auth/callback/github`.
- "For Github apps, you DO have to … go to *Permissions and Events* > *Account Permissions* > *Email Addresses* and select 'Read-Only'", otherwise you get `email_not_found`.
- "Github doesn't issue refresh tokens for OAuth apps."

### 4.5 JWT for a sync engine ← the important one

Plugin name is **`jwt`**, exported from `better-auth/plugins`; client counterpart `jwtClient` from `better-auth/client/plugins`.

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { jwt } from "better-auth/plugins"

export const auth = betterAuth({
    plugins: [
        jwt(),
    ]
})
```

Run `npx auth migrate` / `npx auth generate` afterwards — the plugin adds a **`jwks`** table (`id`, `publicKey`, `privateKey`, `createdAt`, `expiresAt`).

Three documented ways to obtain the token:

```ts
// 1. Client plugin (recommended)
const { data, error } = await authClient.token()
if (data) { const jwtToken = data.token }
```

```ts
// 2. GET /api/auth/token with the session (bearer plugin) token
await fetch("/api/auth/token", {
  headers: { "Authorization": `Bearer ${token}` },
})
```

```ts
// 3. set-auth-jwt response header on getSession
await authClient.getSession({
  fetchOptions: {
    onSuccess: (ctx)=>{
      const jwt = ctx.response.headers.get("set-auth-jwt")
    }
  }
})
```

Server-side, the endpoint is exposed on `auth.api` — verified in `dist/plugins/jwt/index.d.mts`:

```ts
getToken: import("better-call").StrictEndpoint<"/token", {
  method: "GET";
  requireHeaders: true;
  …
```

so from a Hono handler: `const { token } = await auth.api.getToken({ headers: c.req.raw.headers })`.

Verification by any third party (JWKS at `/api/auth/jwks`, `kid` in the JWT header, cacheable):

```ts
import { jwtVerify, createRemoteJWKSet } from 'jose'

async function validateToken(token: string) {
  try {
    const JWKS = createRemoteJWKSet(
      new URL('http://localhost:3000/api/auth/jwks')
    )
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: 'http://localhost:3000',   // Should match your JWT issuer, which is the BASE_URL
      audience: 'http://localhost:3000', // Should match your JWT audience, which is the BASE_URL by default
    })
    return payload
  } catch (error) {
    console.error('Token validation failed:', error)
    throw error
  }
}
```

Key options (all verbatim from the docs):

```ts
jwt({
  jwks: {
    keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },   // default; also ES256 | RS256(RSA256) | PS256 | ECDH-ES | ES512
    disablePrivateKeyEncryption: true,                  // default false (AES256-GCM at rest)
    rotationInterval: 60 * 60 * 24 * 30,                // seconds; default undefined (disabled)
    gracePeriod: 60 * 60 * 24 * 30,                     // default 30 days
    jwksPath: "/.well-known/jwks.json",                 // default "/jwks"; client must match
    remoteUrl: "https://example.com/.well-known/jwks.json",
  },
  jwt: {
    definePayload: ({user}) => ({ id: user.id, email: user.email, role: user.role }),
    issuer: "https://example.com",
    audience: "https://example.com",
    expirationTime: "1h",            // default 15m
    getSubject: (session) => session.user.email,   // default: user id
    sign: async (jwtPayload) => { /* custom / KMS signing */ },
  },
  adapter: { getJwks: async (ctx) => …, createJwk: async (ctx, webKey) => … },
})
```

> Docs callout: "This plugin is not meant as a replacement for the session. It's meant to be used for services that require JWT tokens."

**How this plugs into Zero 1.8** (<https://zero.rocicorp.dev/docs/auth>): Zero treats the token as **opaque**. You pass it to the client (`<ZeroProvider userID={userID} auth={token}>`), and "Zero will forward this token to your mutators and queries endpoints in an `Authorization: Bearer <token>` header." Your Hono `/api/zero/query` + `/api/zero/mutate` handlers verify it themselves (jose + the better-auth JWKS above), then build the Zero `Context`. Returning **401/403** from those endpoints flips Zero's connection state to `needs-auth`; the client refreshes with `zero.connection.connect({auth: newToken})`. Because better-auth JWTs default to a 15-minute lifetime, wire that refresh path or raise `expirationTime`. Zero's cookie alternative (`ZERO_QUERY_FORWARD_COOKIES` / `ZERO_MUTATE_FORWARD_COOKIES`) needs zero-cache on a subdomain + better-auth `crossSubDomainCookies` — the Zero docs name better-auth explicitly.

`bearer()` plugin (`better-auth/plugins`) is a **different** thing: it makes the *session token* usable as `Authorization: Bearer` instead of a cookie. Option: `requireSignature` (boolean, default `false`). Server side, `auth.api.getSession({ headers })` then works for bearer requests. Add it if the SPA stores the session token rather than relying on cookies.

### 4.6 Organization + teams

```ts title="auth.ts"
import { organization } from "better-auth/plugins"

export const auth = betterAuth({ plugins: [ organization() ] })
```

Teams are opt-in:

```ts
      teams: {
        enabled: true,
        maximumTeams: 10,             // Optional: limit teams per organization
        allowRemovingAllTeams: false, // Optional: prevent removing the last team
      },
```

Client: `organizationClient({ teams: { enabled: true } })` from `better-auth/client/plugins`. Endpoints live under `/organization/*` (e.g. `POST /organization/create` with `{ name, slug, logo?, metadata? }`). Lifecycle hooks exist as `organizationHooks: { beforeCreateTeam, afterCreateTeam, beforeUpdateTeam, … }`.

### 4.7 SSO / OIDC provider

Consuming external IdPs (SAML/OIDC) — **`@better-auth/sso`**:

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { sso } from "@better-auth/sso";

const auth = betterAuth({ plugins: [ sso() ] })
```
```ts title="auth-client.ts"
import { ssoClient } from "@better-auth/sso/client"
const authClient = createAuthClient({ plugins: [ ssoClient() ] })
```
Then `npx auth migrate` (or `generate`). Docs tag the plugin `OIDC / OAuth2 / SSO / SAML`.

Being an IdP yourself — prefer **`@better-auth/oauth-provider`** (OAuth 2.1, PKCE-required, `authorization_code` / `refresh_token` / `client_credentials`, dynamic client registration, introspection + revocation, OIDC via the `openid` scope):

```ts title="auth.ts"
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

const auth = betterAuth({
  disabledPaths: [ "/token" ],
  plugins: [
    jwt(),
    oauthProvider({ loginPage: "/sign-in", consentPage: "/consent", /* … */ }),
  ],
});
```

⚠️ Combining `jwt()` with any OAuth-compliant provider requires disabling the plugin's own `/token` route and header (docs, verbatim): "you **MUST** disable the `/token` endpoint (oAuth equivalent `/oauth2/token`) and disable setting the jwt header":

```ts
betterAuth({
  disabledPaths: [ "/token" ],
  plugins: [jwt({ disableSettingJwtHeader: true })]
})
```

The legacy built-in is `oidcProvider({ loginPage: "/sign-in" })` from `better-auth/plugins`, still exported but carrying both a deprecation notice and "This plugin is in active development and may not be suitable for production use."

---

## 5. Hono 4.12.31 + @hono/node-server 2.0.11

Sources: <https://hono.dev/docs/getting-started/nodejs>, `/docs/api/routing`, `/docs/guides/middleware`, `/docs/api/exception`; `github.com/honojs/middleware` READMEs; package tarballs.

### 5.1 Node entry point

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()
app.get('/', (c) => c.text('Hello Node.js!'))

serve(app)
```

```ts
serve({
  fetch: app.fetch,
  port: 8787,
})
```

Exact v2 signature (`dist/index.d.mts`): `declare const serve: (options: Options, listeningListener?: (info: AddressInfo) => void) => ServerType` — and `serve(app, cb)` is accepted (README example: ``serve(app, (info) => { console.log(`Listening on http://localhost:${info.port}`) })``). Also exported: `createAdaptorServer`, `getRequestListener`, `upgradeWebSocket`, `RequestError`, types `HttpBindings` / `Http2Bindings` / `ServerType`.

**v2 is a performance major**, not an API break — release notes: "The Node.js adapter is going through a major version bump to v2. That said, the public API stays the same." Requires Node > 20.x. Upgrade to ≥ 2.0.10 if you use `upgradeWebSocket` (GHSA-9mqv-5hh9-4cgg memory-leak DoS).

Raw Node objects:

```ts
import { serve, type HttpBindings } from '@hono/node-server'

type Bindings = HttpBindings

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.json({ remoteAddress: c.env.incoming.socket.remoteAddress })
})
```

HTTP/2:

```ts
import { createServer } from 'node:http2'
const server = serve({ fetch: app.fetch, createServer })
```

### 5.2 Routing

```ts
app.get('/', (c) => c.text('GET /'))
app.post('/', (c) => c.text('POST /'))
app.all('/hello', (c) => c.text('Any Method /hello'))

app.get('/user/:name', async (c) => { const name = c.req.param('name') })
app.get('/posts/:id/comment/:comment_id', async (c) => { const { id, comment_id } = c.req.param() })

app.get('/wild/*/card', (c) => c.text('GET /wild/*/card'))

const book = new Hono()
book.get('/', (c) => c.text('List Books'))
const app = new Hono()
app.route('/book', book)

const api = new Hono().basePath('/api')
api.get('/book', (c) => c.text('List Books')) // GET /api/book
```

"Handlers or middleware will be executed in registration order." Register middleware and specific routes before wildcards.

### 5.3 Middleware

```ts
app.use(async (c, next) => {
  console.log(`[${c.req.method}] ${c.req.url}`)
  await next()
})
```

```ts
import { createMiddleware } from 'hono/factory'

const logger = createMiddleware(async (c, next) => {
  console.log(`[${c.req.method}] ${c.req.url}`)
  await next()
})
```

```ts
const echoMiddleware = createMiddleware<{
  Variables: {
    echo: (str: string) => string
  }
}>(async (c, next) => {
  c.set('echo', (str) => str)
  await next()
})
```

```ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { basicAuth } from 'hono/basic-auth'
import { cors } from 'hono/cors'

const app = new Hono()
app.use(logger())
app.use(cors())
app.use('/auth/*', basicAuth({ username: 'hono', password: 'pass' }))
```

Rule: "Middleware — should `await next()` and return nothing to call the next Middleware, **or** return a `Response` to early-exit."

### 5.4 Static files (serving the built SPA)

```ts
import { serveStatic } from '@hono/node-server/serve-static'

app.use('/static/*', serveStatic({ root: './' }))
app.use('/favicon.ico', serveStatic({ path: './favicon.ico' }))
```

Exact options type (`dist/serve-static.d.mts`):

```ts
type ServeStaticOptions<E extends Env = Env> = {
  root?: string;          // relative to process CWD, NOT to the source file
  path?: string;
  index?: string;
  precompressed?: boolean;
  rewriteRequestPath?: (path: string, c: Context<E>) => string;
  onFound?: (path: string, c: Context<E>) => void | Promise<void>;
  onNotFound?: (path: string, c: Context<E>) => void | Promise<void>;
};
```

SPA history fallback for yapm (API routes first, then assets, then `index.html`):

```ts
app.route('/api', api)
app.use('/assets/*', serveStatic({ root: './public' }))
app.get('*', serveStatic({ root: './public', path: './public/index.html' }))
```
`UNVERIFIED`: that exact three-line fallback composition is assembled from the documented options, not copied from a doc example. The individual options are verified.

### 5.5 Validation — `@hono/zod-validator` 0.9.0

```ts
import * as z from 'zod'
import { zValidator } from '@hono/zod-validator'

const schema = z.object({
  name: z.string(),
  age: z.number(),
})

app.post('/author', zValidator('json', schema), (c) => {
  const data = c.req.valid('json')
  return c.json({ success: true, message: `${data.name} is ${data.age}` })
})
```

Hook + throw-instead-of-respond wrapper (verbatim):

```ts
// file: validator-wrapper.ts
import * as z from 'zod'
import type { ValidationTargets } from 'hono'
import { zValidator as zv } from '@hono/zod-validator'

export const zValidator = <T extends z.ZodSchema, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T
) =>
  zv(target, schema, (result, c) => {
    if (!result.success) {
      throw new HTTPException(400, { cause: result.error })
    }
  })
```

Validates with `.safeParseAsync` by default; override via the 4th arg `{ validationFunction: async (schema, value) => … }`. Targets: `'json' | 'form' | 'query' | 'param' | 'header' | 'cookie'`.

### 5.6 OpenAPI — `@hono/zod-openapi` 1.5.1 (Zod 4 only)

Import `z` **from the package**, not from `zod`, so `.openapi()` exists:

```ts
import { z } from '@hono/zod-openapi'

const ParamsSchema = z.object({
  id: z.string().min(3).openapi({ param: { name: 'id', in: 'path' }, example: '1212121' }),
})

const UserSchema = z
  .object({
    id: z.string().openapi({ example: '123' }),
    name: z.string().openapi({ example: 'John Doe' }),
    age: z.number().openapi({ example: 42 }),
  })
  .openapi('User')   // registers as #/components/schemas/User
```

```ts
import { createRoute } from '@hono/zod-openapi'

const route = createRoute({
  method: 'get',
  path: '/users/{id}',
  request: { params: ParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: UserSchema } },
      description: 'Retrieve the user',
    },
  },
})
```

```ts
import { OpenAPIHono } from '@hono/zod-openapi'

const app = new OpenAPIHono()

app.openapi(route, (c) => {
  const { id } = c.req.valid('param')
  return c.json({ id, age: 20, name: 'Ultra-man' }, 200) // status code is required
})

app.doc('/doc', { openapi: '3.0.0', info: { version: '1.0.0', title: 'My API' } })
```

App-wide validation error formatting:

```ts
const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ ok: false, errors: formatZodErrors(result), source: 'custom_error_handler' }, 422)
    }
  },
})
```
A per-route hook (3rd arg of `app.openapi`) overrides `defaultHook`.

OpenAPI 3.1: `app.doc31('/docs', { openapi: '3.1.0', info: { title: 'foo', version: '1' } })` and `app.getOpenAPI31Document(config, { unionPreferredType: 'oneOf' })`. Registry access: `app.openAPIRegistry`. Per-route middleware: `middleware: [prettyJSON(), cache({...})] as const`.

Gotchas from the README: request bodies are only validated when the request carries the right `Content-Type` — otherwise `c.req.valid('json')` is `{}`; force it with `request.body.required: true`.

### 5.7 Errors

```ts
import { HTTPException } from 'hono/http-exception'

throw new HTTPException(401, { message: 'Unauthorized' })

const errorResponse = new Response('Unauthorized', {
  status: 401,
  headers: { Authenticate: 'error="invalid_token"' }
})
throw new HTTPException(401, { res: errorResponse })

throw new HTTPException(401, { message, cause })
```

```ts
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse()
  }
  console.error(err)
  return c.text('Internal Server Error', 500)
})
```

`err.getResponse()` operates independently of `Context`, so re-apply any context headers yourself. `app.notFound((c) => …)` handles 404s.

---

## 6. pg-boss 12.26.2

Sources: `github.com/timgit/pg-boss` `docs/api/{constructor,jobs,queues,workers,scheduling,adapters}.md`, README, and the `pg-boss@12.26.2` tarball (`dist/index.d.ts`, `dist/types.d.ts`, `dist/adapters/*.d.ts`).

### 6.1 Shape of the module in v12 (breaking vs older memory)

- **ESM-only**, `"main": "./dist/index.js"`, **no default export**. `export class PgBoss extends EventEmitter`, plus `events`, `states`, `policies`, `getConstructionPlans`, `getMigrationPlans`, `getRollbackPlans`, and adapters `fromKnex`, `fromKysely`, `fromDrizzle`, `fromPrisma`, `fromPglite`.
  ```js
  const { PgBoss } = require('pg-boss')   // README (works via require(esm) on Node ≥22.12)
  import { PgBoss, fromDrizzle } from 'pg-boss'
  ```
- **Work handlers receive an array of jobs**, always: `WorkHandler<ReqData, ResData> = (job: Job<ReqData>[]) => Promise<ResData>`. Destructure `async ([job]) => …` for `batchSize: 1`.
- `engines.node >= 22.12.0`; PostgreSQL ≥ 13; deps `pg ^8.22.0`, `cron-parser ^5.6.2`.
- Queues must exist before use: `createQueue()` is not implicit.

### 6.2 Construction against an existing Postgres

```js
const boss = new PgBoss('postgres://user:pass@host:port/database?ssl=require');
```

Options (`ConstructorOptions extends DatabaseOptions, SchedulingOptions, MaintenanceOptions, BackendOptions`), the ones that matter:

| Option | Meaning |
|---|---|
| `connectionString` | parsed instead of host/port/user/password/database/ssl |
| `max` | pool size, default **10** |
| `schema` | default **`pgboss`** (alphanumeric/underscore, ≤50 chars) |
| `application_name` | default `pgboss` |
| `connectionTimeoutMillis` | default 10000 |
| `db` | **bring your own connection**: any object with `executeSql(text, values) → { rows }`. "Setting this option will bypass the above configuration." |
| `migrate` / `createSchema` | (MaintenanceOptions) control automatic schema install/upgrade at `start()` |
| `supervise` | default true; false disables flows/maintenance/monitoring on this instance |
| `schedule` | `false` disables cron on this instance |
| `useListenNotify` | opt into LISTEN/NOTIFY wakeups (holds one dedicated connection; **won't work through PgBouncer transaction pooling**) |

Sharing yapm's single `pg.Pool` (keeps the container count honest):

```ts
import { PgBoss } from 'pg-boss'
import { pool } from './db'

export const boss = new PgBoss({
  db: { executeSql: (text, values) => pool.query(text, values) },
  schema: 'pgboss',
})
boss.on('error', (err) => logger.error(err))
await boss.start()
```
`UNVERIFIED`: the exact `executeSql` one-liner above is my composition; the documented contract is verbatim —
```js
const text = "select $1 as input"
const values = ['arg1']
const { rows } = await executeSql(text, values)
assert(rows[0].input === 'arg1')
```

### 6.3 Queues, sending, working

```js
async function readme() {
  const { PgBoss } = require('pg-boss');
  const boss = new PgBoss('postgres://user:pass@host/database');

  boss.on('error', console.error)
  await boss.start()

  const queue = 'readme-queue'
  await boss.createQueue(queue)
  const id = await boss.send(queue, { arg1: 'read me' })

  await boss.work(queue, async ([ job ]) => {
    console.log(`received job ${job.id} with data ${JSON.stringify(job.data)}`)
  })
}
```

```js
// a queue with retry and dead letter configuration
// (the dead letter queue must exist before it can be referenced)
await boss.createQueue('order-processing-dlq')
await boss.createQueue('order-processing', {
  policy: 'singleton',
  retryLimit: 5,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'order-processing-dlq'
})
```

`send()` overloads (`dist/index.d.ts`):

```ts
send(request: Request): Promise<string | null>;
send(name: string, data?: object | null, options?: SendOptions): Promise<string | null>;
sendAfter(name, data, options, date | dateString | seconds): Promise<string | null>;
sendThrottled(name, data, options, seconds, key?): Promise<string | null>;
sendDebounced(name, data, options, seconds, key?): Promise<string | null>;
insert(name, jobs: JobInsert[], options?): Promise<string[] | null>;
flow(jobs: FlowJob[], options?): Promise<Record<string, string>>;
```
`send()` resolves **`null`** (not a rejection) when a unique/throttle rule suppressed the job.

`work()` overloads:

```ts
work<ReqData, ResData = any>(name: string, handler: WorkHandler<ReqData, ResData>): Promise<string>;
work<ReqData, ResData = any, const O extends WorkOptions = WorkOptions>(name: string, options: O, handler: WorkHandlerFor<O, ReqData, ResData>): Promise<string>;
offWork(name: string, options?: OffWorkOptions): Promise<void>;
```
Defaults: "1 job every 2 seconds". Useful `WorkOptions`: `batchSize`, `includeMetadata`, `perJobResults`, `priority`, `orderByCreatedOn`, `pollingIntervalSeconds` (≥0.5), `localConcurrency`, `localGroupConcurrency`, `groupConcurrency`, `heartbeatRefreshSeconds`.

### 6.4 Serialized / singleton processing per key ← the GitHub-installation requirement

Two mechanisms; **`key_strict_fifo` is the one that matches "serialize webhook processing per installation".**

**(a) Queue policy** — verbatim table from `docs/api/queues.md`:

| Policy | Description |
| - | - |
| `standard` | (Default) Supports all standard features such as deferral, priority, and throttling |
| `short` | Only allows 1 job to be queued, unlimited active. Can be extended with `singletonKey` |
| `singleton` | Only allows 1 job to be active, unlimited queued. Can be extended with `singletonKey` |
| `stately` | Combination of short and singleton: Only allows 1 job per state, queued and/or active. Can be extended with `singletonKey` |
| `exclusive` | Only allows 1 job to be queued or active. Can be extended with `singletonKey` |
| `key_strict_fifo` | Strict FIFO ordering per `singletonKey`. Requires `singletonKey` on every job. Blocks processing of jobs with the same key while any job with that key is active, in retry, or failed. |

> Docs note: "`key_strict_fifo` queues enforce strict FIFO ordering per `singletonKey`… The queue will block processing of subsequent jobs with the same `singletonKey` while any job with that key is: **active**, **retry**, **failed**… To unblock a key after a permanent failure, you can either delete the failed job using `deleteJob()` or retry it using `retry()`. Use `getBlockedKeys()` to discover which keys are currently blocked due to failed jobs."
>
> Warning on `stately`: "By definition, stately queues will not allow multiple jobs to occupy `retry` state. Once a job exists in `retry`, failing another `active` job will bypass the retry mechanism and force the job to `failed`."

yapm shape:

```ts
await boss.createQueue('github-webhook-dlq')
await boss.createQueue('github-webhook', {
  policy: 'key_strict_fifo',
  retryLimit: 5,
  retryDelay: 1,
  retryBackoff: true,
  retryDelayMax: 300,
  deadLetter: 'github-webhook-dlq',
})

await boss.send('github-webhook', payload, { singletonKey: `installation-${installationId}` })

await boss.work('github-webhook', { batchSize: 1 }, async ([job]) => {
  await ingestWebhook(job.data)
})
```
Operational duty this creates: a permanently failed job **keeps its key blocked**. Monitor with `boss.getBlockedKeys('github-webhook')` and clear via `retry()` / `deleteJob()`.
`UNVERIFIED`: the `github-webhook` snippet is composed from the verified API; the policy semantics quoted above are verbatim.

**(b) Group concurrency** — a softer, N-per-key limit enforced globally (DB-backed), verbatim:

```js
// Assign job to a tenant group
await boss.send('process-data', data, { group: { id: 'tenant-123' } })
// with a tier
await boss.send('process-data', data, { group: { id: 'tenant-456', tier: 'enterprise' } })
```

```js
// Limit each tenant to 2 concurrent jobs globally across all nodes
await boss.work('process-data', {
  localConcurrency: 10,
  groupConcurrency: 2
}, async ([job]) => {
  await processData(job.data)
})
```
```js
groupConcurrency: { default: 1, tiers: { enterprise: 5, pro: 2 } }
```
`groupConcurrency: 1` gives per-installation serialization **without** FIFO ordering guarantees, and without the failed-job-blocks-key behavior. Caveat from the docs: "due to the optimistic locking nature of job fetching, there may be brief moments where the limit is slightly exceeded during race conditions." `localGroupConcurrency` is the same idea but per-node only (no DB overhead).

**(c) Throttle / debounce** (not the same as serialization — these *drop* or *coalesce* sends):

```js
const jobId = await boss.sendThrottled('sync-profile', { userId: 123 }, null, 60, `user-${123}`)
await boss.sendDebounced('reindex-document', { docId: 'doc-1' }, null, 30, 'doc-1')
```
`singletonSeconds` + `singletonKey` = one job per key per time slot; `singletonNextSlot` pushes the suppressed job into the next slot (that's what `sendDebounced` sets).

### 6.5 Retries, expiration, retention

`QueueOptions` (inherited by every job in the queue unless overridden per-`send`), verbatim defaults from `dist/types.d.ts`:

| Option | Default | Meaning |
|---|---|---|
| `retryLimit` | **2** | retries before `failed` |
| `retryDelay` | 0 | seconds between retries |
| `retryBackoff` | false | exponential; sets initial `retryDelay` to 1 if unset |
| `retryDelayMax` | none | cap when `retryBackoff` |
| `expireInSeconds` | **900** (15 min) | max time in `active` before retry/fail |
| `retentionSeconds` | **1209600** (14 d) | max time in `created`/`retry` before deletion |
| `deleteAfterSeconds` | **604800** (7 d) | retention after completion; `0` = never delete |
| `heartbeatSeconds` | disabled | must be ≥10; worker auto-heartbeats via `work()` |

Backoff formula (docs, verbatim): `Math.min(retryDelayMax, retryDelay * (2 ** Math.Min(16, retryCount) / 2 + 2 ** Math.Min(16, retryCount) / 2 * Math.random()))`.

Dead letter + redrive: `deadLetter: 'q-dlq'` on the queue; failed jobs are copied with `sourceName`/`sourceId`/`sourceCreatedOn`/`sourceRetryCount`; `boss.redrive('q-dlq', { destination?, sourceName?, limit = 1000 })` moves them back.

### 6.6 Scheduling (cron)

```ts
schedule(name: string, cron: string, data?: object | null, options?: ScheduleOptions): Promise<void>;
unschedule(name: string, key?: string): Promise<void>;
getSchedules(name?: string, key?: string): Promise<Schedule[]>;
```
```ts
type ScheduleOptions = SendOptions & { tz?: string; key?: string }
```
```js
await boss.schedule('notification-abc', `0 3 * * *`, null, { tz: 'America/Chicago' })
```
Docs constraints: schedules are evaluated every 30 s, so **use the 5-field cron format** (`30 3 * * *`), not the 6-field seconds form (`30 30 3 * * *`). At least one running instance must have `schedule !== false`. Clock skew vs the DB is measured every 10 minutes and compensated; only one job is emitted even with multiple instances running.

### 6.7 Transactional enqueue + other ops

```ts
import { sql } from 'drizzle-orm'
import { fromDrizzle } from 'pg-boss'

await db.transaction(async (tx) => {
  await boss.send('my-queue', data, { db: fromDrizzle(tx, sql) })
})
```
Any method taking `ConnectionOptions` accepts `{ db }`. Other useful surface: `fetch()`, `complete()`, `fail()`, `touch()`, `cancel()`, `resume()`, `retry()`, `deleteJob()`, `findJobs()`, `getQueue()/getQueues()/getQueueStats()`, `updateQueue()`, `deleteQueue()`, `subscribe()/unsubscribe()/publish()` (pub-sub fan-out), `getWipData()`, `isInstalled()`, `schemaVersion()`, `detectSchemaDrift()`, `getSpy()` (test-only, requires `__test__enableSpies`). CLI for migrations without code; `@pg-boss/dashboard` and `@pg-boss/proxy` are separate packages.

---

## 7. Zod 4.4.3

Sources: <https://zod.dev/basics>, `/api`, `/error-formatting`, `/v4/changelog`; `zod@4.4.3` tarball export map.

### 7.1 Imports

The root package **is** v4:

```typescript
import * as z from "zod";
```
Namespace import is what the docs use in v4 (tree-shaking friendly, avoids the v3-era `import { z } from 'zod'` ambiguity — that still works). The tarball's export map is `.`, `./v3`, `./v4`, `./v4-mini`, `./v4/core`, `./mini`, `./locales`, `./v4/locales/*`. **Do not** write `import { z } from 'zod/v4'` in new code — that subpath exists only for projects still on the 3.25 compat shim. `zod/mini` is the tiny functional variant. No runtime dependencies.

### 7.2 Basics

```typescript
const Player = z.object({ username: z.string(), xp: z.number() });
const result = Player.safeParse({ username: 42, xp: "100" });
type Player = z.infer<typeof Player>;
```
`safeParse` returns a discriminated union (`{ success: true, data }` / `{ success: false, error }`); `.parse()` throws; `.parseAsync()` for async refinements. `z.infer` is unchanged from v3; use `z.input<typeof s>` / `z.output<typeof s>` when transforms are involved.

### 7.3 Differences from Zod 3 that actually bite server code

| Zod 3 | Zod 4 |
|---|---|
| `z.string({ required_error, invalid_type_error })`, `errorMap` | **All removed** — one unified `error` param. `message` still works but is deprecated. |
| `err.format()` | deprecated → **`z.treeifyError(err)`** |
| `err.flatten()` | deprecated → **`z.flattenError(err)`** |
| — | new **`z.prettifyError(err)`** for human-readable output |
| `z.string().email()`, `.uuid()`, `.url()` | moved to top-level **`z.email()`, `z.uuid()`, `z.url()`** — string formats are now subclasses of `ZodString`; old methods deprecated |
| `.default()` parsed the default | **`.default()` returns the value as-is** for `undefined` input; **`.prefault()`** restores the old parse-the-default behavior |
| defaults skipped inside optional objects | "Defaults inside your properties are applied, even within optional fields" |
| `ZodInvalidEnumValueIssue` etc. | issue types merged/renamed (`$ZodIssueInvalidValue`, new `$ZodIssueInvalidKey`, `$ZodIssueInvalidElement`) |

Error formatting, verbatim:

```javascript
const tree = z.treeifyError(result.error);
// {
//   errors: [ 'Unrecognized key: "extraKey"' ],
//   properties: {
//     username: { errors: [ 'Invalid input: expected string, received number' ] },
//     favoriteNumbers: { errors: [], items: [ undefined, { errors: [ 'Invalid input: expected number, received string' ] } ] }
//   }
// }

const flattened = z.flattenError(result.error);
// { formErrors: [...], fieldErrors: { username: [...], favoriteNumbers: [...] } }

const pretty = z.prettifyError(result.error);
// ✖ Unrecognized key: "extraKey"
// ✖ Invalid input: expected string, received number
//   → at username
// ✖ Invalid input: expected number, received string
//   → at favoriteNumbers[1]
```
`z.formatError()` exists but is deprecated in favour of `z.treeifyError()`. `error.issues` is the raw array (`code`, `path`, `expected`, `message`).

### 7.4 Constructs used by this stack

```javascript
const MyResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), data: z.string() }),
  z.object({ status: z.literal("failed"), error: z.string() }),
]);
```
Discriminated unions keep the `(discriminatorKey, options[])` signature; v4 additionally allows nesting a discriminated union inside another's options.

```javascript
const FishEnum = z.enum(["Salmon", "Tuna", "Trout"]);   // FishEnum.enum → { Salmon: "Salmon", … }

z.uuid();
z.uuid({ version: "v4" });
z.uuidv4();
z.uuidv7();          // ← validates client-minted UUIDv7 primary keys

const datetime = z.iso.datetime();        // z.iso.datetime({ offset: true } | { local: true } | { precision: 3 })

const DogWithBreed = Dog.extend({ breed: z.string() });
const JustTheTitle = Recipe.pick({ title: true });
```

---

## 8. Version-pairing gotchas discovered while verifying

1. **orm.drizzle.team documents the drizzle-orm v1 beta.** On the pinned 0.45.2 / 0.31.10 pair: `defineRelations` does not exist (use `relations()`), `drizzle()` has no `relations` config key, `migrate(db)` needs the `{ migrationsFolder }` argument, and the dialect list is `postgresql|mysql|sqlite|turso|singlestore|gel`. Treat every relations/migration code block on that site as suspect and cross-check against the tarball.
2. **better-auth 1.6.24 peer-depends on `drizzle-orm: ^0.45.2` and `drizzle-kit: >=0.31.4`.** It is aligned with the stable Drizzle line — installing the drizzle v1 beta would break its peer range. This is a second, independent reason not to jump.
3. **drizzle-zero 0.20.0 dev-tests against exactly `@rocicorp/zero@1.8.0` + `drizzle-orm@^0.45.2` + `drizzle-kit@^0.31.10`.** Its declared peer floor is only `drizzle-orm >=0.36.0`, but the tested combination is the yapm pinning. Its `1.0.0-beta.1` tag presumably tracks drizzle v1 — don't mix.
4. **better-auth's Drizzle adapter moved packages** (`@better-auth/drizzle-adapter`), the CLI moved to the `auth` package, and SSO/OAuth-provider are separate packages — all at 1.6.24 in lockstep with core. Pin them together.
5. **`@hono/zod-openapi@1.5.1` peers `zod ^4.0.0` only** while `@hono/zod-validator@0.9.0` still accepts `^3.25.0 || ^4.0.0`. With Zod 4.4.3 both are fine; a stray Zod 3 in the tree would break zod-openapi. Also note zod-openapi *depends on* `@hono/zod-validator ^0.9.0` — keep them on the same install.
6. **pg-boss 12 is ESM-only, needs Node ≥ 22.12, exports `PgBoss` as a named export, and hands work-handlers an array.** Code written against pg-boss ≤ 8 (`import PgBoss from 'pg-boss'`, `async job => …`) will not run.
7. **`crypto.randomUUIDv7()` requires Node ≥ 24.16.0** and is Node-only (absent from Web Crypto), non-monotonic. For an app whose *browser* mints IDs for optimistic mutations, the `uuidv7` npm package (monotonic counter, isomorphic) is the correct dependency; Node's built-in is a server-side convenience only.
8. **`uuidv7()` in SQL is PostgreSQL 18+** (verified absent from the PG 17 docs). With a PG ≥ 15 floor, don't put it in a column default — and drizzle-zero would mark such a column `optional` in the Zero schema anyway.
9. **drizzle-zero's codegen carries its own TypeScript compiler** (`ts-morph` → `@ts-morph/common` vendors `dist/typescript.js`), so it is compatible with TypeScript 7's Go compiler having no JS Compiler API. What it *does* require is that your `tsconfig.json` **includes** the Drizzle schema file (and the `drizzle-zero.config.ts` if used), and that the schema is a **single file**, not a folder/glob.
10. **better-auth JWTs default to a 15-minute `expirationTime`.** Zero forwards the token opaquely and only learns it is stale when your query/mutate endpoint returns 401/403. Either raise `expirationTime` or implement the `zero.connection.connect({auth: newToken})` refresh path — otherwise sync silently drops to `needs-auth` every 15 minutes.
11. **`jwt()` + any OAuth/OIDC provider plugin requires `disabledPaths: ["/token"]` and `jwt({ disableSettingJwtHeader: true })`** — the docs mark this **MUST**.
