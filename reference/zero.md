# Zero (Rocicorp) v1.8 — Verified API Reference

> **Purpose**: ground-truth API reference for coding agents. Models trained before June 2026 do **not** know Zero 1.x. The 1.x API (`defineQuery`/`defineQueries`/`defineMutator`/`defineMutators`, `createBuilder`, `handleQueryRequest`/`handleMutateRequest`) is **completely different** from the 0.x API you may remember (`createQuery`, `syncedQuery`, `PushProcessor`, `definePermissions`). Do not write Zero code from memory. Copy from this file.
>
> **Verification method** — every signature below came from one of:
> 1. `https://zero.rocicorp.dev/llms-full.txt` (complete official docs, fetched 2026-07-23)
> 2. The published `@rocicorp/zero@1.8.0` npm tarball's `.d.ts` files (ground truth for 1.8.0)
> 3. `github.com/rocicorp/mono` → `apps/zbugs` (Rocicorp's own bug tracker, built on Zero — same domain as yapm)
>
> Anything unverified is explicitly marked `UNVERIFIED`.
>
> **Caveat on zbugs**: `apps/zbugs` depends on `"@rocicorp/zero": "workspace:*"` (repo HEAD, ~1.10-head). Every zbugs API used below was cross-checked against the 1.8.0 `.d.ts` exports and is present in 1.8.0. Where zbugs uses something that may be newer, it is flagged.

---

## 1. Package, version, install

Source: `npm view @rocicorp/zero` (2026-07-23), <https://zero.rocicorp.dev/docs/install>

| Field | Value |
|---|---|
| Package | `@rocicorp/zero` |
| Latest stable | **`1.8.0`** |
| `canary` tag | `1.9.0-canary.0` |
| License | Apache-2.0 |
| Node engine | `>=22` |
| Repo | `github.com/rocicorp/mono`, dir `packages/zero` |
| Homepage | <https://zero.rocicorp.dev> |

```bash
npm install @rocicorp/zero zod
```

`zod` is not required — any [Standard Schema](https://standardschema.dev/) validator works (`@standard-schema/spec` is a real dependency). zbugs uses `zod/mini`.

### Package-manager gotcha: native module `@rocicorp/zero-sqlite3`

Zero ships a native SQLite build. Package managers that block postinstall scripts need explicit opt-in:

```bash
# pnpm — add to pnpm-workspace.yaml:
#   allowBuilds:
#     '@rocicorp/zero-sqlite3': true
pnpm add @rocicorp/zero zod
pnpm rebuild @rocicorp/zero-sqlite3

# bun
bun add @rocicorp/zero zod
bun pm trust @rocicorp/zero-sqlite3
# or package.json: "trustedDependencies": ["@rocicorp/zero-sqlite3"]

# yarn (modern) — package.json:
#   "dependenciesMeta": { "@rocicorp/zero-sqlite3": { "built": true } }
yarn add @rocicorp/zero zod
yarn rebuild @rocicorp/zero-sqlite3
```

### Entry points (exact, from package.json `exports`)

| Import specifier | Use |
|---|---|
| `@rocicorp/zero` | Core: `Zero`, schema builders, `defineQuery/Queries`, `defineMutator/Mutators`, ZQL types |
| `@rocicorp/zero/react` | `ZeroProvider`, `useQuery`, `useSuspenseQuery`, `useZero`, `useConnectionState` |
| `@rocicorp/zero/solid` | SolidJS equivalents |
| `@rocicorp/zero/server` | `handleQueryRequest`, `handleMutateRequest`, `ZQLDatabase`, `ApplicationError` |
| `@rocicorp/zero/server/adapters/pg` | `zeroNodePg` |
| `@rocicorp/zero/server/adapters/postgresjs` | `zeroPostgresJS` |
| `@rocicorp/zero/server/adapters/drizzle` | `zeroDrizzle` |
| `@rocicorp/zero/server/adapters/kysely` | `zeroKysely` |
| `@rocicorp/zero/server/adapters/prisma` | `zeroPrisma` |
| `@rocicorp/zero/analyze` | `runAnalyzeCLI` |
| `@rocicorp/zero/react-native`, `/expo-sqlite`, `/op-sqlite` | React Native / Expo storage |
| `@rocicorp/zero/pg`, `/sqlite`, `/zqlite`, `/bindings`, `/change-protocol/v0` | Lower-level |

### Bin scripts

`zero-cache`, `zero-cache-dev`, `zero-build-schema`, `zero-deploy-permissions`, `zero-out`, `analyze-query`, `transform-query`, `ast-to-zql`

### Peer dependencies (all optional; install only what you use)

```
pg ^8.16.3 | react ^19.2.6 | kysely ^0.28.17 | solid-js ^1.9.4
drizzle-orm ^0.45.2 | expo-sqlite >=15 | @op-engineering/op-sqlite >=15
```

---

## 2. Mental model (read this before writing any code)

Source: <https://zero.rocicorp.dev/llms.txt> (verbatim)

> - Clients do **NOT** send arbitrary queries to `zero-cache`.
> - You define Queries and Mutators in code (`defineQueries`, `defineMutators`).
> - The client runs its own ZQL optimistically against a local store (e.g. IDB), and `zero-cache` calls your server endpoints (`ZERO_QUERY_URL`) to resolve a name+args into ZQL/logic, where you also enforce permissions via `context`. `zero-cache` runs that returned ZQL against its SQLite replica, and returns the authoritative results to the client.
> - Mutators also run on the client optimistically first. Mutations are then sent to `zero-cache`, which calls your server's `ZERO_MUTATE_URL` endpoint, where they run directly against Postgres upstream.

Three deployables: **Postgres** (upstream truth) → **zero-cache** (SQLite replica + IVM + WebSocket sync) → **your API server** (`/query` + `/mutate` endpoints, where auth/permissions live) → **client**.

There is **no declarative permission system**. Permissions are plain TypeScript in your `/query` and `/mutate` handlers, driven by a `context` object your server derives from the session.

---

## 3. Schema definition

Source: <https://zero.rocicorp.dev/docs/schema>, `zero-schema/src/builder/table-builder.d.ts`, `.../schema-builder.d.ts`, `.../relationship-builder.d.ts` (1.8.0), and `apps/zbugs/shared/schema.ts`

### 3.1 Exact builder signatures (from 1.8.0 `.d.ts`)

```ts
// zero-schema/src/builder/table-builder.d.ts
export declare function table<TName extends string>(name: TName): TableBuilder<...>;

export declare function string<T extends string = string>(): ColumnBuilder<{type: "string"; optional: false; customType: T}>;
export declare function number<T extends number = number>(): ColumnBuilder<{type: "number"; optional: false; customType: T}>;
export declare function boolean<T extends boolean = boolean>(): ColumnBuilder<{type: "boolean"; optional: false; customType: T}>;
export declare function json<T extends ReadonlyJSONValue = ReadonlyJSONValue>(): ColumnBuilder<{type: "json"; optional: false; customType: T}>;
export declare function enumeration<T extends string>(): ColumnBuilder<{type: "string"; optional: false; customType: T}>;

declare class TableBuilder<TShape> {
  from<ServerName extends string>(serverName: ServerName): TableBuilder<TShape>;
  columns<const TColumns extends Record<string, ColumnBuilder<SchemaValue>>>(columns: TColumns): TableBuilderWithColumns<...>;
}
declare class TableBuilderWithColumns<TShape> {
  primaryKey<TPKColNames extends (keyof TShape['columns'])[]>(...pkColumnNames: TPKColNames): TableBuilderWithColumns<...>;
  get schema(): TShape;
  build(): TShape;
}
declare class ColumnBuilder<TShape> {
  from<ServerName extends string>(serverName: ServerName): ColumnBuilder<TShape & {serverName: string}>;
  optional(): ColumnBuilder<Omit<TShape, 'optional'> & {optional: true}>;
}
```

There are exactly **five** column helpers: `string()`, `number()`, `boolean()`, `json()`, `enumeration()`. There is no `date()`, `timestamp()`, `uuid()`, or `array()` helper — see the Postgres type mapping table in §9.1.

```ts
// zero-schema/src/builder/schema-builder.d.ts
export declare function createSchema<...>(options: {
  readonly tables: TTables;
  readonly relationships?: TRelationships | undefined;
  readonly enableLegacyQueries?: TEnableLegacyQueries | undefined;
  readonly enableLegacyMutators?: TEnableLegacyMutators | undefined;
}): {tables, relationships, enableLegacyQueries, enableLegacyMutators};
```

```ts
// zero-schema/src/builder/relationship-builder.d.ts
export declare function relationships<TSource extends TableSchema, TRelationships extends Record<string, Relationship>>(
  table: TableBuilderWithColumns<TSource>,
  cb: (connects: {many: ManyConnector<TSource>; one: OneConnector<TSource>}) => TRelationships,
): {name: TSource['name']; relationships: TRelationships};
```

`one()` and `many()` each accept **one** `ConnectArg` (direct) or **two** (junction / two-hop). Each `ConnectArg` is `{sourceField: string[], destField: string[], destSchema: TableBuilderWithColumns}`. Note `sourceField`/`destField` are **arrays** (compound-key capable), and `destSchema` is the **table builder object**, not a string.

### 3.2 Real production schema — `apps/zbugs/shared/schema.ts` (verbatim excerpt)

```ts
import {
  boolean,
  createBuilder,
  createSchema,
  enumeration,
  number,
  relationships,
  string,
  table,
} from '@rocicorp/zero';
import type {Role} from './auth.ts';

const user = table('user')
  .columns({
    id: string(),
    login: string(),
    name: string().optional(),
    avatar: string(),
    role: enumeration<Role>(),
  })
  .primaryKey('id');

const project = table('project')
  .columns({
    id: string(),
    name: string(),
    lowerCaseName: string(),
    issueCountEstimate: number().optional(),
    supportsSearch: boolean(),
    markURL: string().optional(),
    logoURL: string().optional(),
  })
  .primaryKey('id');

const issue = table('issue')
  .columns({
    id: string(),
    shortID: number().optional(),
    title: string(),
    open: boolean(),
    modified: number(),          // timestamps are `number()` — see §9.1
    created: number(),
    projectID: string(),
    creatorID: string(),
    assigneeID: string().optional(),
    description: string(),
    visibility: enumeration<'internal' | 'public'>(),
  })
  .primaryKey('id');

// Compound primary key:
const issueLabel = table('issueLabel')
  .columns({
    issueID: string(),
    labelID: string(),
    projectID: string(),
  })
  .primaryKey('labelID', 'issueID');

const viewState = table('viewState')
  .columns({issueID: string(), userID: string(), viewed: number()})
  .primaryKey('userID', 'issueID');
```

Relationships (verbatim from zbugs) — note the **junction / many-to-many** `labels` relationship using two hops:

```ts
const issueRelationships = relationships(issue, ({many, one}) => ({
  project: one({
    sourceField: ['projectID'],
    destField: ['id'],
    destSchema: project,
  }),
  issueLabels: many({
    sourceField: ['id'],
    destField: ['issueID'],
    destSchema: issueLabel,
  }),
  // many-to-many via junction table: two ConnectArgs
  labels: many(
    {
      sourceField: ['id'],
      destField: ['issueID'],
      destSchema: issueLabel,
    },
    {
      sourceField: ['labelID'],
      destField: ['id'],
      destSchema: label,
    },
  ),
  comments: many({
    sourceField: ['id'],
    destField: ['issueID'],
    destSchema: comment,
  }),
  creator: one({
    sourceField: ['creatorID'],
    destField: ['id'],
    destSchema: user,
  }),
  assignee: one({
    sourceField: ['assigneeID'],
    destField: ['id'],
    destSchema: user,
  }),
  notificationState: one({
    sourceField: ['id'],
    destField: ['issueID'],
    destSchema: issueNotifications,
  }),
}));
```

Schema assembly + builder + global type registration (verbatim from zbugs):

```ts
export const schema = createSchema({
  tables: [
    user, project, issue, comment, label,
    issueLabel, viewState, emoji, userPref, issueNotifications,
  ],
  relationships: [
    userRelationships, projectRelationships, issueRelationships,
    commentRelationships, issueLabelRelationships, labelRelationships,
    emojiRelationships,
  ],
  enableLegacyMutators: false,
  enableLegacyQueries: false,
});

export const builder = createBuilder(schema);   // docs often name this `zql`

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: typeof schema;
  }
}
```

> Set `enableLegacyMutators: false` and `enableLegacyQueries: false` for new apps (as zbugs does). This turns off the 0.x-era client CRUD path.

> `createBuilder(schema)` returns the ZQL query builder. Docs call the exported constant `zql`; zbugs calls it `builder`. `drizzle-zero` / `prisma-zero` generate it as `zql` automatically.

### 3.3 Name mapping, multi-schema, optional, enums, JSON, compound PK

Source: <https://zero.rocicorp.dev/docs/schema> (verbatim)

```ts
const userPref = table('userPref')
  .from('user_pref')                       // TS name -> DB table name
  .columns({
    id: string(),
    orgID: string().from('org_id'),        // TS name -> DB column name
  })

// Non-public Postgres schema:
const event = table('event').from('analytics.event')

// Optional (SQL nullable):
nickName: string().optional()

// Enum (pairs with a Postgres enum column):
mood: enumeration<'happy' | 'sad' | 'taco'>()

// Typed JSON:
settings: json<{theme: 'light' | 'dark'}>()

// Compound primary key:
.primaryKey('orgID', 'userID')

// Compound-key relationship:
sender: one({
  sourceField: ['senderOrgID', 'senderUserID'],
  destSchema: user,
  destField: ['orgID', 'userID'],
})
```

**null vs undefined semantics** (verbatim from docs):
- Reading: an `optional` column can return `null`. `undefined` is never returned by reads.
- Writing: `null` explicitly writes null. For `create`/`upsert`, `undefined` (or omitting) takes the backend default. For `update`, `undefined` on a non-PK field leaves the previous value unmodified.

**Only two levels of relationship chaining are supported** (bug 3454).

### 3.4 Generating schema from Drizzle / Prisma

```bash
# Drizzle
npm install -D drizzle-zero
npx drizzle-zero generate --output src/zero/schema.ts

# Prisma — add to prisma/schema.prisma:
#   generator zero { provider = "prisma-zero"  output = "../src/zero" }
npm install -D prisma-zero && npx prisma generate
```

---

## 4. Synced queries

Source: <https://zero.rocicorp.dev/docs/queries>, `zql/src/query/query-registry.d.ts` (1.8.0), `apps/zbugs/shared/queries.ts`

### 4.1 Exact signatures (from 1.8.0 `.d.ts`)

```ts
// zql/src/query/query-registry.d.ts

// Overload 1: no validator, no args
export declare function defineQuery<...>(
  queryFn: QueryDefinitionFunction<TTable, TInput, TReturn, TContext>,
): QueryDefinition<TTable, TInput, TInput, TReturn, TContext>;

// Overload 2: with Standard Schema validator
export declare function defineQuery<...>(
  validator: StandardSchemaV1<TInput, TOutput>,
  queryFn: QueryDefinitionFunction<TTable, TOutput, TReturn, TContext>,
): QueryDefinition<TTable, TInput, TOutput, TReturn, TContext>;

// The query function receives a SINGLE destructurable object:
export type QueryDefinitionFunction<TTable, TInput, TReturn, TContext> =
  (options: {args: TInput; ctx: TContext}) => Query<TTable, Schema, TReturn>;

// Registry
export declare function defineQueries<const QD, S>(defs: QD): QueryRegistry<QD, S>;
export declare function defineQueries<const TBase, const TOverrides, S>(
  base: QueryRegistry<TBase, S> | TBase,
  overrides: TOverrides,
): QueryRegistry<DeepMerge<TBase, TOverrides, AnyQueryDefinition>, S>;

export declare function mustGetQuery<QD, S>(queries: QueryRegistry<QD, S>, name: string): FromQueryTree<QD, S>;
export declare function getQuery<QD, S>(queries: QueryRegistry<QD, S>, name: string): FromQueryTree<QD, S> | undefined;

// Without global DefaultTypes:
export declare function defineQueryWithType<S extends Schema, C = unknown>(): TypedDefineQuery<S, C>;
export declare function defineQueriesWithType<TSchema extends Schema>(): TypedDefineQueries<TSchema>;
```

Each registry entry becomes a **callable** `CustomQuery`:

```ts
export type CustomQuery<...> = {
  readonly 'queryName': string;                        // e.g. "posts.byAuthor"
  readonly 'fn': QueryExecutionFunction<...>;          // validator-wrapped; call as fn({args, ctx})
  readonly '~': CustomQueryTypes<...>;
} & CustomQueryCallable<...>;                          // queries.posts.byAuthor({authorID}) -> QueryRequest
```

Calling `queries.a.b(args)` returns a `QueryRequest` (`{query, args}`) — it is **not** a ZQL `Query`. You pass `QueryRequest` to `useQuery` / `zero.run` / `zero.preload` / `zero.materialize`.

### 4.2 Minimal definition

```ts
// src/queries.ts
import {defineQueries, defineQuery} from '@rocicorp/zero'
import {z} from 'zod'
import {zql} from './schema.ts'

export const queries = defineQueries({
  postsByAuthor: defineQuery(
    z.object({authorID: z.string()}),
    ({args: {authorID}}) => zql.post.where('authorID', authorID),
  ),
})
```

Nesting is allowed; names become dot-paths:

```ts
export const queries = defineQueries({
  posts: {
    get: defineQuery(z.string(), ({args: id}) => zql.post.where('id', id)),
    byAuthor: defineQuery(
      z.object({authorID: z.string(), includeDrafts: z.boolean().optional()}),
      ({args: {authorID, includeDrafts}}) => {
        let q = zql.post.where('authorID', authorID)
        if (!includeDrafts) q = q.where('isDraft', false)
        return q
      },
    ),
  },
})

console.log(queries.posts.byAuthor.queryName)  // "posts.byAuthor"
```

> ⚠️ **Call `defineQueries` exactly once, at the top level of `queries.ts`.** It is what assigns the wire names. Compose sub-objects in other files as plain objects and merge them in the single top-level call.

**Validators are mandatory for queries with args** — on the server, args come from the untrusted client.

### 4.3 Auth context — `ctx`

Query args are client-supplied and therefore untrusted. Credentials must come from `ctx`, which your **server** derives from the session:

```ts
const myPostsQuery = defineQuery(({ctx: {userID}}) =>
  // User cannot control ctx.userID, so this safely restricts to their own posts.
  zql.post.where('authorID', userID),
)
```

Register the context type globally (zbugs `shared/auth.ts`, verbatim):

```ts
export type AuthData = Pick<JWTData, 'sub' | 'role'>;

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    context: AuthData | undefined;   // `| undefined` because zbugs allows guests
  }
}
```

Without global `DefaultTypes`:

```ts
import {defineQueriesWithType, defineQueryWithType} from '@rocicorp/zero'
const defineQuery = defineQueryWithType<Schema, ZeroContext>()
const defineQueries = defineQueriesWithType<Schema>()
```

### 4.4 The `/query` endpoint (`ZERO_QUERY_URL`)

```bash
export ZERO_QUERY_URL="http://localhost:3000/api/zero/query"
```

Exact signature (1.8.0 `zero-server/src/queries/process-queries.d.ts`):

```ts
export type QueryRequestHandler =
  (name: string, args: ReadonlyJSONValue | undefined) => AnyQuery;

export type HandleQueryRequestArgs<S extends Schema> = {
  handler: QueryRequestHandler;
  schema: S;
  userID: string | null | undefined;   // server-VERIFIED user id; see note below
  logLevel?: LogLevel | undefined;
} & (
  | {request: Request}                                   // Fetch Request
  | {query: URLSearchParams | Record<string,string>; body: ReadonlyJSONValue}  // pre-parsed
);

export declare function handleQueryRequest<S extends Schema>(
  input: HandleQueryRequestArgs<S>,
): Promise<QueryResponse>;
```

Next.js (docs, verbatim):

```ts
// app/api/zero/query/route.ts
import {handleQueryRequest} from '@rocicorp/zero/server'
import {mustGetQuery} from '@rocicorp/zero'
import {queries} from 'queries.ts'
import {schema} from 'schema.ts'

export async function POST(request: Request) {
  const session = await authenticate(request.headers.get('Cookie'))

  const result = await handleQueryRequest({
    handler: (name, args) => {
      const query = mustGetQuery(queries, name)
      return query.fn({args, ctx: session?.user})   // ctx comes from the SESSION, not the client
    },
    schema,
    request,
    userID: session?.user?.id,
  })

  return Response.json(result)
}
```

zbugs / Fastify (verbatim, `apps/zbugs/api/index.ts`) — uses the pre-parsed `query`+`body` form:

```ts
async function queryHandler(request, reply) {
  await withAuth(request, reply, async authData => {
    reply.send(
      await handleQueryRequest({
        handler: (name, args) => {
          const query = mustGetQuery(queries, name);
          return query.fn({args, ctx: authData});
        },
        schema,
        query: request.query,
        body: request.body,
        userID: authData?.sub,
        logLevel: 'info',
      }),
    );
  });
}
```

> **Why `userID` matters** (docs, verbatim): "Tabs in the same browser share synced data. This group of tabs is called a 'client group', keyed by `clientGroupID`... The `clientGroupID` is randomly-generated client-side and non-trivial for attackers to guess. However, it could be stolen with XSS or leaked in logs. Passing the server-verified `userID` to `handleMutateRequest` and `handleQueryRequest` lets Zero enforce that only tabs belonging to the same user can be in the same client group."
>
> Pass the **verified** user id. Pass `null` for public/unauthenticated apps.

### 4.5 Worked multi-tenant example — rows visible only to project/team members

This is the core pattern for yapm. It combines two mechanisms, both verified from zbugs:
1. A **role/visibility filter** applied server-side, unconditionally.
2. A **membership `exists` subquery** keyed off `ctx`, never off args.

zbugs' actual permission helper (verbatim, `shared/queries.ts`):

```ts
export function applyIssuePermissions<TQuery extends IssueQuery>(
  q: TQuery,
  role: Role | undefined,
): TQuery {
  return role === 'crew' ? q : (q.where('visibility', 'public') as TQuery);
}

// "match nothing" helper — a filter-based deny (verbatim from zbugs)
function alwaysFalse<TTable, TSchema, TReturn>(
  q: Query<TTable, TSchema, TReturn>,
): Query<TTable, TSchema, TReturn> {
  return q.where(({or}) => or());   // empty or() is always false
}
```

and its use inside a real synced query (verbatim, abbreviated):

```ts
issueDetail: defineQuery(
  z.object({
    idField: z.union([z.literal('shortID'), z.literal('id')]),
    id: z.union([z.string(), z.number()]),
  }),
  ({args: {idField, id}, ctx: auth}) =>
    applyIssuePermissions(
      builder.issue
        .where(idField, id)
        .related('project')
        .related('creator')
        .related('assignee')
        .related('labels')
        .related('notificationState', q =>
          auth?.sub ? q.where('userID', auth.sub) : alwaysFalse(q),
        )
        .related('viewState', viewState =>
          (auth?.sub ? viewState.where('userID', auth.sub) : alwaysFalse(viewState)).one(),
        )
        .related('comments', comments =>
          comments
            .related('creator')
            .related('emoji', emoji => emoji.related('creator'))
            .limit(50)
            .orderBy('created', 'desc')
            .orderBy('id', 'desc'),
        )
        .one(),
      auth?.role,
    ),
),
```

**Team/project membership pattern for yapm** — assuming `project`, `projectMember(projectID, userID, role)`, `task(projectID, ...)`:

```ts
// src/zero/queries.ts
import {defineQueries, defineQuery, type Query, type Schema} from '@rocicorp/zero'
import * as z from 'zod'
import {zql} from './schema.ts'

// Deny-by-empty-result. Read permissions in Zero are FILTER based:
// never throw to deny reads, return a query matching no rows.
function alwaysFalse<TTable extends keyof TSchema['tables'] & string, TSchema extends Schema, TReturn>(
  q: Query<TTable, TSchema, TReturn>,
): Query<TTable, TSchema, TReturn> {
  return q.where(({or}) => or())
}

export const queries = defineQueries({
  tasks: {
    // Only tasks in projects the CONTEXT user is a member of.
    byProject: defineQuery(
      z.object({projectID: z.string()}),
      ({args: {projectID}, ctx}) => {
        if (!ctx?.userID) return alwaysFalse(zql.task)

        return zql.task
          .where('projectID', projectID)
          // membership check is driven by ctx.userID, which the client cannot forge
          .whereExists('project', p =>
            p.whereExists('members', m => m.where('userID', ctx.userID)),
          )
          .related('assignee')
          .orderBy('created', 'desc')
          .limit(200)
      },
    ),

    // Every task across every project the user belongs to.
    myWorkspace: defineQuery(({ctx}) => {
      if (!ctx?.userID) return alwaysFalse(zql.task)
      return zql.task.whereExists('project', p =>
        p.whereExists('members', m => m.where('userID', ctx.userID)),
      )
    }),
  },

  projects: {
    // The project list is itself scoped by membership.
    mine: defineQuery(({ctx}) => {
      if (!ctx?.userID) return alwaysFalse(zql.project)
      return zql.project.whereExists('members', m => m.where('userID', ctx.userID))
    }),
  },
})
```

Because the **server-side** implementation is what `zero-cache` actually executes, a malicious client cannot widen this. If you want the client-side optimistic copy to be looser/simpler, use `defineQueries(baseQueries, serverOverrides)` on the server (same override mechanism as mutators, §5.7).

Docs' canonical permission recipes (verbatim, <https://zero.rocicorp.dev/docs/auth#permission-patterns>):

```ts
// Only owned rows
const myPosts = defineQuery(({ctx}) => zql.post.where('authorID', ctx.id))

// Owned or shared
const allowedPosts = defineQuery(({ctx}) =>
  zql.post.where(({cmp, exists, or}) =>
    or(cmp('authorID', ctx.id), exists('sharedWith', q => q.where('userID', ctx.id))),
  ),
)

// Owned, or all if admin
const allowedPosts = defineQuery(({ctx}) => {
  if (ctx.role === 'admin') return zql.post
  return zql.post.where('authorID', ctx.id)
})

// Deny by returning no rows (NOT by throwing)
const myPosts = defineQuery(({ctx}) => {
  if (!ctx?.id) return zql.post.where(({or}) => or())
  return zql.post.where('authorID', ctx.id)
})
```

### 4.6 Running queries

```ts
// React
const [posts] = useQuery(queries.posts.get('user123'))

// Solid (pass a thunk)
const [posts] = useQuery(() => queries.posts.get('user123'))

// Once, client-local data only (default)
const results = await zero.run(queries.issues.byPriority('high'))

// Once, wait for authoritative server results
const results = await zero.run(queries.issues.byPriority('high'), {type: 'complete'})

// Preload (does not materialize into JS objects — cheap for large sets)
zero.preload(queries.issues.inbox({sort: 'created', sortDirection: 'desc', limit: 1000}))

// Imperative live view
const view = zero.materialize(queries.posts.byAuthorID('user123'))
view.addListener((posts, resultType, error) => { /* ... */ })
view.destroy()
```

zbugs preload (verbatim, `src/zero-preload.ts`):

```ts
export function preload(z: Zero, projectName: string) {
  z.preload(queries.issuePreloadV2({projectName}), CACHE_PRELOAD);
  z.preload(queries.allUsers(), CACHE_PRELOAD);
  z.preload(queries.allLabels(), CACHE_PRELOAD);
  z.preload(queries.allProjects(), CACHE_PRELOAD);
}
// src/query-cache-policy.ts (verbatim)
export const CACHE_NONE = {ttl: '10s'} as const;
export const CACHE_NAV = {ttl: '10s'} as const;
export const CACHE_PRELOAD = CACHE_NAV;
```

### 4.7 Local-only (unsynced) queries

Pass a raw ZQL expression instead of a `QueryRequest` — it runs only against already-synced local data and registers nothing with the server. Ideal for typeahead:

```tsx
const [issues] = useQuery(zql.issue.orderBy('created', 'desc').limit(10))
```

### 4.8 TTL / query caching

Verified constants from 1.8.0 `zql/src/query/ttl.js`: `DEFAULT_TTL_MS = 1000*60*5` (5m), `MAX_TTL_MS = 1000*60*10` (10m).

```ts
export type TimeUnit = 's' | 'm' | 'h' | 'd' | 'y';
export type TTL = `${number}${TimeUnit}` | 'forever' | 'none' | number;
```

- Non-preload queries default to `5m`.
- `preload()` defaults to `ttl:'none'` — but since preloads are registered at startup and never deactivated, and *the TTL clock only ticks while Zero is running*, they effectively never expire.
- **Max supported TTL is `10m`.** Docs table lists only `none`, `%ds`, `%dm` as usable formats.

> ⚠️ Discrepancy to be aware of: the 1.8.0 `UseQueryOptions` JSDoc says "Default is 'never'" while the docs and `DEFAULT_TTL_MS` say 5 minutes. The **constant** (`5m`) is authoritative; treat the JSDoc string as stale.

```ts
const [user] = useQuery(queries.posts.byAuthorID('user123'), {ttl: '5m'})
zero.preload(queries.posts.byAuthorID('user123'), {ttl: '5m'})
await zero.run(queries.posts.byAuthorID('user123'), {type: 'unknown', ttl: '5m'})
```

### 4.9 Result states, missing data, errors

```ts
// zero-client/src/types/query-result.d.ts (1.8.0, verbatim)
export type QueryResultDetails =
  | {readonly type: 'complete'}
  | {readonly type: 'unknown'}
  | {
      readonly type: 'error';
      readonly retry: () => void;
      /** @deprecated Use `retry` instead */
      readonly refetch: () => void;
      readonly error:
        | {readonly type: 'app';   readonly message: string; readonly details?: ReadonlyJSONValue}
        | {readonly type: 'parse'; readonly message: string; readonly details?: ReadonlyJSONValue};
    };
```

**404 without flicker** (docs, verbatim) — only show "not found" when `type === 'complete'`:

```tsx
const [issue, issueResult] = useQuery(queries.issues.get('some-id'))

if (!issue && issueResult.type === 'complete') return <div>404 Not Found</div>
if (!issue) return null
return <div>{issue.title}</div>
```

Query errors:

```tsx
const [posts, postsResult] = useQuery(queries.posts.byAuthorID('user123'))
if (postsResult.type === 'error') {
  return <div>Error loading posts: {postsResult.error.message}</div>
}
```

Throw `ApplicationError` from a query/mutator to send structured details to the client:

```ts
// zero-protocol/src/application-error.d.ts (1.8.0)
export declare class ApplicationError<const T extends ReadonlyJSONValue | undefined = ...> extends Error {
  constructor(message: string, options?: {details?: T; cause?: unknown});
  get details(): T;
  get kind(): 'Application';
}
export declare function isApplicationError(error: unknown): error is ApplicationError;
```

zbugs subclasses it (verbatim, `shared/error.ts`):

```ts
import {ApplicationError} from '@rocicorp/zero';

export class MutationError<const T extends MutationErrorCode = MutationErrorCode>
  extends ApplicationError<{code: T; id: string | undefined}> {
  constructor(message: string, code: T, id?: string) {
    super(message, {details: {code, id}});
  }
}
```

### 4.10 Raw wire protocol for the `/query` endpoint (language-agnostic)

Docs, verbatim. POST body:

```ts
type QueriesRequestBody = {
  id: string
  name: string
  args: readonly ReadonlyJSONValue[]
}[]
```

Response:

```ts
type QueriesResponseBody = (
  | {id: string; name: string; ast: AST}   // see packages/zero-protocol/src/ast.ts
  | {error: 'app';  id: string; name: string; details: ReadonlyJSONValue}
  | {error: 'zero'; id: string; name: string; details: ReadonlyJSONValue}
  | {error: 'http'; id: string; name: string; status: number; details: ReadonlyJSONValue}
)[]
```

---

## 5. Custom mutators

Source: <https://zero.rocicorp.dev/docs/mutators>, `zql/src/mutate/mutator.d.ts`, `zero-server/src/process-mutations.d.ts` (1.8.0), `apps/zbugs/shared/mutators.ts` + `server/server-mutators.ts`

### 5.1 Exact signatures (from 1.8.0 `.d.ts`)

```ts
// zql/src/mutate/mutator.d.ts
export declare function defineMutator<TInput, TSchema, TContext, TWrappedTransaction>(
  mutator: MutatorDefinitionFunction<TInput, TContext, Transaction<TSchema, TWrappedTransaction>>,
): MutatorDefinition<TInput, TInput, TContext, TWrappedTransaction>;

export declare function defineMutator<TInput, TOutput, TSchema, TContext, TWrappedTransaction>(
  validator: StandardSchemaV1<TInput, TOutput>,
  mutator: MutatorDefinitionFunction<TOutput, TContext, Transaction<TSchema, TWrappedTransaction>>,
): MutatorDefinition<TInput, TOutput, TContext, TWrappedTransaction>;

// SINGLE destructurable object arg; MUST return Promise<void>
export type MutatorDefinitionFunction<TOutput, TContext, TTransaction> =
  (options: {args: TOutput; ctx: TContext; tx: TTransaction}) => Promise<void>;

export declare function defineMutatorWithType<TSchema, TContext = unknown, TWrappedTransaction = unknown>(): TypedDefineMutator<...>;
```

```ts
// zql/src/mutate/mutator-registry.d.ts (exported names, 1.8.0)
defineMutators, defineMutatorsWithType, getMutator, isMutatorRegistry, mustGetMutator
```

`defineMutators` has the same two overloads as `defineQueries` — `(defs)` and `(base, overrides)`.

Each registry entry is a callable `Mutator`:

```ts
export type Mutator<...> = {
  readonly 'mutatorName': string;   // e.g. "issue.update"
  readonly 'fn': MutatorExecutionFunction<...>;   // call as fn({tx, args, ctx})
  readonly '~': MutatorTypes<...>;
} & MutatorCallable<...>;           // mutators.issue.update({...}) -> MutateRequest
```

> ⚠️ **Mutators must return `Promise<void>`.** There is no way to return data from a mutator on success (docs: "There is not yet a way to return data from mutators in the success case.").

### 5.2 Transaction API inside a mutator

```ts
// zql/src/mutate/custom.d.ts (1.8.0, verbatim)
export type Location = 'client' | 'server';
export type TransactionReason = 'optimistic' | 'rebase' | 'authoritative';

export interface TransactionBase<S extends Schema> {
  readonly location: Location;
  readonly clientID: ClientID;
  readonly mutationID: number;
  readonly reason: TransactionReason;
  readonly mutate: TransactionMutate<S>;
  /** @deprecated Use createBuilder with tx.run(zql.table.where(...)) instead. */
  readonly query: ConditionalSchemaQuery<S>;
  run<TTable, TReturn>(query: Query<TTable, S, TReturn>, options?: RunOptions): Promise<HumanReadable<TReturn>>;
}

export type Transaction<S = DefaultSchema, TWrappedTransaction = DefaultWrappedTransaction> =
  | ServerTransaction<S, TWrappedTransaction>
  | ClientTransaction<S>;

export interface ServerTransaction<S, TWrappedTransaction> extends TransactionBase<S> {
  readonly location: 'server';
  readonly reason: 'authoritative';
  readonly dbTransaction: DBTransaction<TWrappedTransaction>;   // raw SQL escape hatch
}

export interface ClientTransaction<S> extends TransactionBase<S> {
  readonly location: 'client';
  readonly reason: 'optimistic' | 'rebase';
}

export interface DBTransaction<T> {
  readonly wrappedTransaction: T;      // the raw Drizzle/Kysely/pg/postgres.js tx
  query(query: string, args: unknown[]): Promise<Iterable<Row>>;
  runQuery<TReturn>(ast, format, schema, serverSchema): Promise<HumanReadable<TReturn>>;
}
```

**CRUD writes** — `tx.mutate.<table>.<method>()`. Exactly four methods:

```ts
tx.mutate.user.insert({id: 'user-123', username: 'sam', language: 'js'})
tx.mutate.user.upsert({id: samID, username: 'sam', language: 'ts'})
tx.mutate.user.update({id: samID, language: 'golang'})   // partial; no-op if PK missing
tx.mutate.user.delete({id: samID})                       // no-op if PK missing
```

> ⚠️ **Always `await` every write.** On the server `tx` goes over the network to Postgres; on the client it can hit IndexedDB/SQLite.

**Reads** — `tx.run(<ZQL>)`, full ZQL power:

```ts
const issue = await tx.run(zql.issue.where('id', id).one())
```

Reads and writes in a mutator are **transactional**; if the mutator throws, the whole mutation is rolled back.

> **Reading in mutators is always local** (docs, verbatim): "there is no `type` parameter that can be used to wait for server results inside mutators... When a mutator runs on the client (`tx.location === "client"`), ZQL reads only return data already cached on the client. When mutators run on the server (`tx.location === "server"`), ZQL reads always return all data."

That is the single most important mutator gotcha: **client-side, `tx.run` only sees rows an active query has already synced.**

### 5.3 Minimal definition

```ts
// src/mutators.ts
import {defineMutators, defineMutator} from '@rocicorp/zero'
import {z} from 'zod'

export const mutators = defineMutators({
  updateIssue: defineMutator(
    z.object({id: z.string(), title: z.string()}),
    async ({tx, args: {id, title}}) => {
      if (title.length > 100) throw new Error(`Title is too long`)
      await tx.mutate.issue.update({id, title})
    },
  ),
})

console.log(mutators.updateIssue.mutatorName)   // "updateIssue"
```

> ⚠️ **Call `defineMutators` exactly once at the top level of `mutators.ts`** — same naming rule as `defineQueries`.

### 5.4 Real production mutators (zbugs, verbatim)

```ts
import {defineMutator, defineMutators, type Transaction} from '@rocicorp/zero';
import {z} from 'zod/mini';
import {assertIsCreatorOrAdmin, assertIsLoggedIn, isAdmin, type AuthData} from './auth.ts';
import {MutationError, MutationErrorCode} from './error.ts';
import {builder, ZERO_PROJECT_ID} from './schema.ts';

export const mutators = defineMutators({
  issue: {
    create: defineMutator(
      createIssueArgsSchema,
      async ({tx, args, ctx: authData}) => {
        const {id, title, description, created, modified, projectID} = args;
        assertIsLoggedIn(authData);
        const creatorID = authData.sub;          // from ctx — NOT from args
        await tx.mutate.issue.insert({
          id,
          projectID: projectIDWithDefault(projectID),
          title,
          description: description ?? '',
          created,
          creatorID,
          modified,
          open: true,
          visibility: 'public',
        });
        await updateIssueNotification(tx, {
          userID: creatorID, issueID: id, subscribed: 'subscribe', created,
        });
      },
    ),

    update: defineMutator(
      updateIssueArgsSchema,
      async ({tx, args: change, ctx: authData}) => {
        // Security: Auth check MUST come before existence check to prevent
        // information disclosure about private issue existence
        await assertIsCreatorOrAdmin(tx, authData, builder.issue, change.id);

        const oldIssue = await tx.run(builder.issue.where('id', change.id).one());
        if (!oldIssue) {
          throw new MutationError(
            `Issue not found or not authorized`,
            MutationErrorCode.NOT_AUTHORIZED,
            change.id,
          );
        }
        await tx.mutate.issue.update(change);
        // ...notification bookkeeping
      },
    ),

    delete: defineMutator(z.string(), async ({tx, args: id, ctx: authData}) => {
      await assertIsCreatorOrAdmin(tx, authData, builder.issue, id);
      await tx.mutate.issue.delete({id});
    }),

    addLabel: defineMutator(
      z.object({issueID: z.string(), labelID: z.string(), projectID: z.optional(z.string())}),
      async ({tx, args: {issueID, labelID, projectID}, ctx: authData}) => {
        await assertIsCreatorOrAdmin(tx, authData, builder.issue, issueID);
        await tx.mutate.issueLabel.insert({
          issueID, labelID, projectID: projectIDWithDefault(projectID),
        });
      },
    ),
  },

  viewState: {
    set: defineMutator(
      z.object({issueID: z.string(), viewed: z.number()}),
      async ({tx, args: {issueID, viewed}, ctx: authData}) => {
        assertIsLoggedIn(authData);
        await tx.mutate.viewState.upsert({issueID, userID: authData.sub, viewed});
      },
    ),
  },
});
```

zbugs' shared authorization helper — note it takes `tx` and reads through it, so it works identically on client and server (verbatim, `shared/auth.ts`):

```ts
export async function assertIsCreatorOrAdmin(
  tx: Transaction,
  authData: AuthData | undefined,
  query: Query<'comment' | 'issue' | 'emoji'>,
  id: string,
) {
  assertIsLoggedIn(authData);
  if (isAdmin(authData)) return;
  const entity = await tx.run(query.where('id', id).one());
  // Security: Use generic error message to avoid leaking entity existence
  if (!entity) {
    throw new MutationError(`Not authorized to access this resource`, MutationErrorCode.NOT_AUTHORIZED, id);
  }
  if (authData.sub !== entity.creatorID) {
    throw new MutationError(`Not authorized to access this resource`, MutationErrorCode.NOT_AUTHORIZED, id);
  }
}
```

### 5.5 Registering mutators on the client

```tsx
import {ZeroProvider} from '@rocicorp/zero/react'
import type {ZeroOptions} from '@rocicorp/zero'
import {mutators} from 'zero/mutators.ts'

const opts: ZeroOptions = {/* cacheURL, schema, ... */ mutators}
return <ZeroProvider {...opts}><App /></ZeroProvider>
```

> Mutators must be registered because Zero replays (rebases) them during sync for conflict resolution. Invoking an unregistered mutator throws.

### 5.6 The `/mutate` endpoint (`ZERO_MUTATE_URL`)

```bash
export ZERO_MUTATE_URL="http://localhost:3000/api/zero/mutate"
```

Exact signature (1.8.0 `zero-server/src/process-mutations.d.ts`):

```ts
export interface Database<T> {
  transaction: <R>(
    callback: (tx: T, transactionHooks: TransactionProviderHooks) => MaybePromise<R>,
    transactionInput?: TransactionProviderInput,
  ) => Promise<R>;
}

export type TransactFnCallback<D> =
  (tx: ExtractTransactionType<D>, mutatorName: string, mutatorArgs: ReadonlyJSONValue | undefined) => Promise<void>;
export type TransactFn<D> = (cb: TransactFnCallback<D>) => Promise<MutationResponse>;

/** Runs ONCE PER custom mutation in a /mutate request. */
export type MutateRequestHandler<D> =
  (transact: TransactFn<D>, mutation: CustomMutation) => Promise<MutationResponse>;

export type HandleMutateRequestArgs<D> = {
  dbProvider: D;
  handler: MutateRequestHandler<D>;
  userID: string | null | undefined;
  logLevel?: LogLevel | undefined;
} & (
  | {request: Request}
  | {query: URLSearchParams | Record<string,string>; body: ReadonlyJSONValue}
);

export declare function handleMutateRequest<D>(input: HandleMutateRequestArgs<D>): Promise<MutateResponse>;
```

Next.js (docs, verbatim):

```ts
// app/api/zero/mutate/route.ts
import {handleMutateRequest} from '@rocicorp/zero/server'
import {mustGetMutator} from '@rocicorp/zero'
import {mutators} from 'mutators.ts'
import {dbProvider} from 'db-provider.ts'

export async function POST(request: Request) {
  const session = await authenticate(request.headers.get('Authorization'))

  const result = await handleMutateRequest({
    dbProvider,
    handler: transact =>
      transact((tx, name, args) => {
        const mutator = mustGetMutator(mutators, name)
        return mutator.fn({args, tx, ctx: session?.user})
      }),
    request,
    userID: session?.user?.id,
  })

  return Response.json(result)
}
```

zbugs / Fastify (verbatim, `api/index.ts`) — note it uses the second `mutation` param and post-commit async tasks:

```ts
async function mutateHandler(request, reply) {
  await withAuth(request, reply, async authData => {
    const postCommitTasks: (() => Promise<void>)[] = [];
    const mutators = createServerMutators(postCommitTasks);

    const response = await handleMutateRequest({
      dbProvider,
      handler: (transact, _mutation) =>
        transact((tx, name, args) => {
          const mutator = mustGetMutator(mutators, name);
          return mutator.fn({tx, args, ctx: authData});
        }),
      query: request.query,
      body: request.body,
      userID: authData?.sub,
      logLevel: 'info',
    });

    // we don't yet handle errors here, since Loops emails return 429 very often
    // and we don't want to block the mutation
    await Promise.allSettled(postCommitTasks.map(task => task()));

    reply.send(response);
  });
}
```

### 5.7 Server-only mutator behavior (`defineMutators(base, overrides)`)

`defineMutators` takes an optional base registry; overrides merge over it. zbugs uses this to add notifications on the server only (verbatim, `server/server-mutators.ts`):

```ts
import {defineMutator, defineMutators, type ServerTransaction, type Transaction} from '@rocicorp/zero';
import {createIssueArgsSchema, mutators, updateIssueArgsSchema} from '../shared/mutators.ts';

export type PostCommitTask = () => Promise<void>;

function asServerTransaction(tx: Transaction): ServerTransaction {
  assert(tx.location === 'server', 'Transaction is not a server transaction');
  return tx;
}

export function createServerMutators(postCommitTasks: PostCommitTask[]) {
  return defineMutators(mutators, {          // <-- base registry + overrides
    issue: {
      create: defineMutator(
        createIssueArgsSchema,
        async ({tx, args: {id, projectID, title, description}, ctx: authData}) => {
          // run the shared client mutator first
          await mutators.issue.create.fn({
            tx,
            args: {id, projectID, title, description, created: Date.now(), modified: Date.now()},
            ctx: authData,
          });
          await notify(asServerTransaction(tx), authData,
            {kind: 'create-issue', issueID: id}, postCommitTasks);
        },
      ),
      // ...update, addLabel, removeLabel, emoji.*, comment.* similarly
    },
  });
}
```

Simpler branch when you don't need a separate registry:

```ts
const myMutator = defineMutator(async ({tx}) => {
  if (tx.location === 'client') {
    // Client-side code
  } else {
    // Server-side code — tx is narrowed to ServerTransaction
  }
})
```

### 5.8 Raw SQL escape hatch

```ts
const markAllAsRead = defineMutator(
  z.object({userId: z.string()}),
  async ({tx, args: {userId}}) => {
    if (tx.location === 'server') {
      // `tx` is now narrowed to `ServerTransaction`.
      await tx.dbTransaction.query(
        `UPDATE notification SET read = true WHERE user_id = $1`,
        [userId],
      )
    }
  },
)
```

Or reach the native client via `tx.dbTransaction.wrappedTransaction` (docs, verbatim):

```ts
// postgres.js
await tx.dbTransaction.wrappedTransaction<{id: string; name: string}[]>`
  insert into "user" (id, name) values (${id}, ${name}) returning *`

// Drizzle
await tx.dbTransaction.wrappedTransaction.insert(drizzleSchema.user).values({id, name})

// Kysely
await tx.dbTransaction.wrappedTransaction.insertInto('user').values({id, name, status: 'active'}).execute()

// Prisma
await tx.dbTransaction.wrappedTransaction.user.create({data: {id, name, status: 'active'}})

// node-postgres
await tx.dbTransaction.wrappedTransaction.query(
  'insert into "user" (id, name) values ($1, $2) returning *', [id, name])
```

### 5.9 Running mutators, and error / rollback semantics

```ts
zero.mutate(mutators.issue.update({id: crypto.randomUUID(), title: 'New title'}))
```

`zero.mutate(...)` returns a `MutatorResult` (1.8.0 `zero-client/src/client/custom.d.ts`, verbatim):

```ts
export type MutatorResultDetails =
  | {readonly type: 'success'}
  | {
      readonly type: 'error';
      readonly error:
        | {readonly type: 'app';  readonly message: string; readonly details: ReadonlyJSONValue | undefined}
        | {readonly type: 'zero'; readonly message: string};
    };

export type MutatorResult = {
  client: Promise<MutatorResultDetails>;
  server: Promise<MutatorResultDetails>;
};
```

```ts
const write = zero.mutate(mutators.issue.insert({id, title: 'New title'}))

const clientRes = await write.client   // resolves in <1 frame, same macrotask
if (clientRes.type === 'error') { /* optimistic apply failed */ }

const serverRes = await write.server   // requires a network round trip
if (serverRes.type === 'error') { /* authoritative apply failed */ }
```

If the client-side mutator fails, `.server` also resolves to an error result, so awaiting `.server` covers both.

**Rollback / error rules (all verbatim from docs):**

| Situation | Behavior |
|---|---|
| Mutator throws inside `transact(...)` | `handleMutateRequest` catches it, **skips that mutation**, and the **next mutation runs as normal**. The optimistic mutation on the client is reverted and the error is returned as a structured response. |
| Mutator throws (client-side) | Whole mutation rolled back locally. |
| `/mutate` endpoint returns anything other than HTTP 200 / 401 / 403 | Zero disconnects and enters the `error` state. |
| `/mutate` endpoint returns 401 or 403 | Client enters `needs-auth`; requires a manual `zero.connection.connect()` / `connect({auth})`; Zero then **retries all queued mutations**. |
| `/mutate` endpoint throws / never replies | Client resends all queued mutations. |
| Server applies mutation | The Postgres change replicates to zero-cache, which sends row diffs + applied-mutation info; the client rolls back the pending optimistic effect and applies authoritative rows. |

> After `await write.server` resolves successfully, the server has **acknowledged** but its Postgres changes may not have replicated back to this client yet. A read right after can still reflect optimistic rather than authoritative state.

### 5.10 Notifications / async work

Preferred: transactional outbox table + background job. Quick-and-dirty (docs pattern, and exactly what zbugs does): build mutators as a function of a task array, then drain after `handleMutateRequest` returns:

```ts
export function createMutators(asyncTasks: Array<() => Promise<void>>) {
  return defineMutators(clientMutators, { /* ... asyncTasks.push(...) ... */ })
}

// in the route:
const asyncTasks: Array<() => Promise<void>> = []
const mutators = createMutators(asyncTasks)
const result = await handleMutateRequest({dbProvider, handler: /*...*/, request, userID})
// If any fail, do not block the response, since the mutation result
// has already been written to the database.
await Promise.allSettled(asyncTasks.map(task => task()))
return Response.json(result)
```

### 5.11 REST façade over mutators (optional)

Docs pattern — map `POST /api/mutators/cart/add` → mutator name `cart.add`:

```ts
const name = params._splat?.split('/').join('.')
const args = await request.json()
const mutator = mustGetMutator(mutators, name)
await dbProvider.transaction(async tx => { await mutator.fn({tx, args}) })
return Response.json({ok: true})
```

> `defineMutators()` does **not** expose validator schemas on the resulting registry. If you want OpenAPI docs, export your validator map separately and reuse those objects in `defineMutator(...)`.

---

## 6. Server-side database providers (`dbProvider`)

Source: <https://zero.rocicorp.dev/docs/server-zql>, `zero-server/src/adapters/*.d.ts` (1.8.0)

Exact factory signatures:

```ts
// @rocicorp/zero/server/adapters/postgresjs
export type PostgresJsTransaction<T = Record<string, unknown>> = postgres.TransactionSql<T>;
export declare function zeroPostgresJS<S extends Schema, T>(schema: S, pg: postgres.Sql<T> | string): ZQLDatabase<S, PostgresJsTransaction<T>>;

// @rocicorp/zero/server/adapters/pg
export type NodePgTransaction = Pool | PoolClient | Client;
export declare function zeroNodePg<S extends Schema>(schema: S, pg: NodePgTransaction | string): ZQLDatabase<S, NodePgTransaction>;

// @rocicorp/zero/server/adapters/drizzle
export declare function zeroDrizzle<TSchema, TDrizzle, TTransaction>(schema: TSchema, client: TDrizzle & DrizzleDatabase<TTransaction>): ZQLDatabase<TSchema, TTransaction>;

// @rocicorp/zero/server/adapters/kysely
export declare function zeroKysely<TSchema, TDatabase>(schema: TSchema, client: Kysely<TDatabase>): ZQLDatabase<TSchema, WrappedKyselyTransaction<TDatabase>>;

// @rocicorp/zero/server/adapters/prisma
export declare function zeroPrisma<TSchema, TClient extends PrismaClientLike>(schema: TSchema, client: TClient): ZQLDatabase<TSchema, PrismaTransaction<TClient>>;
```

```ts
// zero-server/src/zql-database.d.ts
export declare class ZQLDatabase<TSchema extends Schema, TWrappedTransaction>
  implements Database<TransactionImpl<TSchema, TWrappedTransaction>> {
  readonly connection: DBConnection<TWrappedTransaction>;
  constructor(connection: DBConnection<TWrappedTransaction>, schema: TSchema);
  transaction<R>(callback, transactionInput?): Promise<R>;
  run<TTable, TReturn>(query: Query<TTable, TSchema, TReturn>, options?: RunOptions): Promise<HumanReadable<TReturn>>;
}
```

zbugs' provider (verbatim, `server/db.ts`) — the smallest correct setup:

```ts
import {zeroPostgresJS} from '@rocicorp/zero/server/adapters/postgresjs';
import postgres from 'postgres';
import {schema} from '../shared/schema.ts';

export const sql = postgres(process.env.ZERO_UPSTREAM_DB as string);

export const dbProvider = zeroPostgresJS(schema, sql);

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    dbProvider: typeof dbProvider;
  }
}
```

Running ZQL directly on the server (e.g. from a REST endpoint or a cron job):

```ts
await dbProvider.transaction(async tx => {
  // await tx.mutate...
  // await tx.run(zql.issue.where(...))
  // await myMutator.fn({tx, ctx, args})
})
```

> ⚠️ `ZQLDatabase` currently reads your Postgres schema **before every transaction**. Fine at normal scale; a known issue at high scale (bug 3799).

To support an unlisted Postgres client, implement the `DBConnection` interface.

---

## 7. React bindings

Source: <https://zero.rocicorp.dev/docs/react>, `zero-react/src/*.d.ts` (1.8.0), `apps/zbugs/src/zero-init.tsx`

### 7.1 Exported surface (1.8.0 `zero-react/src/mod.d.ts`, verbatim)

```ts
export { useConnectionState } from './use-connection-state.tsx';
export { useQuery, useSuspenseQuery, type MaybeQueryResult, type QueryResult, type UseQueryOptions } from './use-query.tsx';
export { useZeroOnline } from './use-zero-online.tsx';
export { createUseZero, useZero, ZeroContext, ZeroProvider, type ZeroProviderProps } from './zero-provider.tsx';
```

### 7.2 Hook types (verbatim)

```ts
export type QueryResult<TReturn> = readonly [HumanReadable<TReturn>, QueryResultDetails & {}];
export type MaybeQueryResult<TReturn> = readonly [HumanReadable<TReturn> | undefined, QueryResultDetails & {}];

export type UseQueryOptions = {
  enabled?: boolean | undefined;
  ttl?: TTL | undefined;
};
export type UseSuspenseQueryOptions = UseQueryOptions & {
  suspendUntil?: 'complete' | 'partial';   // default 'partial'
};

// Overload 1 — always-defined data
export declare function useQuery<...>(
  query: QueryOrQueryRequest<...>,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn>;

// Overload 2 — conditional query (Falsy allowed) => data may be undefined
export declare function useQuery<...>(
  query: QueryOrQueryRequest<...> | Falsy,
  options?: UseQueryOptions | boolean,
): MaybeQueryResult<TReturn>;

export declare function useSuspenseQuery<...>(query, options?: UseSuspenseQueryOptions | boolean): QueryResult<TReturn>;
```

`useQuery` **always returns a tuple** `[data, resultDetails]`. `data` is an array for plural queries and `Row | undefined` for `.one()` queries. Options may also be passed as a bare `boolean` (legacy `enabled` shorthand).

```ts
export type ZeroProviderProps<S, MD, Context> =
  (ZeroOptions<S, MD, Context> | {zero: Zero<S, MD, Context>}) & {
    init?: (zero: Zero<S, MD, Context>) => void;   // called only when the provider constructs Zero
    children: ReactNode;
  };

export declare function useZero<S, MD, Context>(): Zero<S, MD, Context>;
export declare const ZeroContext: React.Context<Zero<any, any, any> | undefined>;
/** @deprecated Use useZero with DefaultTypes instead. */
export declare function createUseZero<...>(): () => Zero<...>;
```

### 7.3 Provider setup — docs version (verbatim)

```tsx
import {createRoot} from 'react-dom/client'
import {ZeroProvider} from '@rocicorp/zero/react'
import {useSession} from 'my-session-provider'
import App from './App.tsx'
import {schema} from 'schema.ts'
import {mutators} from 'mutators.ts'

const cacheURL = import.meta.env.VITE_PUBLIC_ZERO_CACHE_URL!

export default function Root() {
  const session = useSession()
  const userID = session?.userID
  const auth = session?.accessToken
  const context = userID ? {userID} : undefined

  return (
    <ZeroProvider {...{userID, auth, context, cacheURL, schema, mutators}}>
      <App />
    </ZeroProvider>
  )
}
```

### 7.4 Provider setup — zbugs production version (verbatim, `src/zero-init.tsx`)

```tsx
import type {ZeroOptions} from '@rocicorp/zero';
import {ZeroProvider} from '@rocicorp/zero/react';
import {useMemo, type ReactNode} from 'react';
import {mutators} from '../shared/mutators.ts';
import {schema} from '../shared/schema.ts';
import {useLogin} from './hooks/use-login.tsx';

export function ZeroInit({children}: {children: ReactNode}) {
  const login = useLogin();

  const options = useMemo(
    () =>
      ({
        schema,
        cacheURL: import.meta.env.VITE_PUBLIC_SERVER,
        userID: login.loginState?.decoded?.sub,
        mutators,
        logLevel: 'info',
        // changing the auth token will cause ZeroProvider to call connection.connect
        auth: login.loginState?.encoded,
        mutateURL: `${window.location.origin}/api/mutate`,
        queryURL: `${window.location.origin}/api/query`,
        context: login.loginState?.decoded,
      }) as const satisfies ZeroOptions,
    [login.loginState],
  );

  return <ZeroProvider {...options}>{children}</ZeroProvider>;
}
```

**Provider lifecycle rules (docs, verbatim):**
- When `auth` changes from one string to another → `ZeroProvider` refreshes auth in place via `zero.connection.connect({auth})`.
- When `auth` is **added or removed**, or `userID` changes → it **recreates** the `Zero` instance.
- When the user is logged out → omit `userID` entirely.
- If you instead pass `<ZeroProvider zero={zero}>`, the provider **only supplies React context** — it does not manage auth or lifecycle; you must call `zero.connection.connect({auth})` yourself.

### 7.5 Usage

```tsx
import {useQuery, useZero} from '@rocicorp/zero/react'
import {queries} from 'queries.ts'
import {mutators} from 'mutators.ts'

function Posts() {
  const [posts] = useQuery(queries.posts.byStatus({status: 'draft'}))
  return <>{posts.map(p => <div key={p.id}>{p.title} ({p.comments.length} comments)</div>)}</>
}

function CompleteButton({issueID}: {issueID: string}) {
  const zero = useZero()
  const onClick = () => zero.mutate(mutators.issues.complete({id: issueID}))
  return <button onClick={onClick}>Complete Issue</button>
}
```

zbugs real usage with result details and TTL (verbatim, `src/pages/issue/issue-page.tsx`):

```tsx
const [issue, issueResult] = useQuery(
  queries.issueDetail({idField, id: idValue}),
  CACHE_NAV,               // {ttl: '10s'}
);

useEffect(() => {
  if (issue || issueResult.type === 'complete') {
    onReady();
  }
}, [issue, onReady, issueResult.type]);
```

### 7.6 Conditional queries

Pass `undefined` (or any falsy) until inputs are ready. The `MaybeQueryResult` overload applies:

```tsx
function Username({userID}: {userID: string | undefined}) {
  const [user] = useQuery(userID ? queries.users.getUser({userID}) : undefined)
  return user ? <div>{user.username}</div> : null
}
```

zbugs also uses the terse `&&` form: `useQuery(issueID && queries.emojiChange(issueID))`.

### 7.7 Suspense

```tsx
const [issues] = useSuspenseQuery(issueQuery, {
  suspendUntil: 'complete',   // 'partial' (default) or 'complete'
})
```

`complete` suspends until authoritative server results arrive. `partial` suspends until any non-empty data arrives, or an empty result that is `complete`.

### 7.8 Connection state hook

```tsx
import {useConnectionState} from '@rocicorp/zero/react'

function ConnectionStatus() {
  const state = useConnectionState()
  switch (state.name) {
    case 'connecting':   return <div title={state.reason}>Connecting...</div>
    case 'connected':    return <div>Connected</div>
    case 'disconnected': return <div title={state.reason}>Offline</div>
    case 'error':        return <div title={state.reason}>Error</div>
    case 'needs-auth':   return <div>Session expired</div>
    default:             return null
  }
}
```

### 7.9 React Native / Expo

Identical to web React except you must supply `kvStore`:

```tsx
import {expoSQLiteStoreProvider} from '@rocicorp/zero/expo-sqlite'
<ZeroProvider kvStore={Platform.OS !== 'web' ? expoSQLiteStoreProvider() : 'idb'} ...>

// or, faster but not Expo Go compatible:
import {opSQLiteStoreProvider} from '@rocicorp/zero/op-sqlite'
<ZeroProvider kvStore={opSQLiteStoreProvider()} ...>
```

---

## 8. Client construction (`new Zero(...)` / `ZeroOptions`)

Source: `zero-client/src/client/options.d.ts` + `zero.d.ts` (1.8.0)

### 8.1 `ZeroOptions` — complete field list (verified)

| Option | Type | Meaning |
|---|---|---|
| `schema` | `S` | **Required.** From `createSchema`. |
| `cacheURL` | `string \| null \| undefined` | zero-cache URL. Hostname, or hostname + **a single** path segment (`https://host/zero`). More than one path segment is not allowed. |
| `server` | `string \| null` | **Deprecated** — use `cacheURL`. |
| `auth` | `string \| null \| undefined` | Opaque auth token (typically a JWT). `null`/`undefined` = logged out. |
| `userID` | `string \| null \| undefined` | Segregates client-side storage per user. Omit/`null` when logged out. |
| `context` | `C` | Client-side context object. **Required** when `DefaultTypes['context']` is registered. |
| `storageKey` | `string` | Extra discriminator concatenated with `userID` to form the IndexedDB name. |
| `mutators` | `MutatorRegistry` | Registry from `defineMutators`. |
| `mutateURL` | `string` | Per-client override; must match a `ZERO_MUTATE_URL` pattern. |
| `queryURL` | `string` | Per-client override; must match a `ZERO_QUERY_URL` pattern. |
| `getQueriesURL` | `string` | **Deprecated** — use `queryURL`. |
| `mutateHeaders` | `Record<string,string>` | Extra headers forwarded to the mutate endpoint. |
| `queryHeaders` | `Record<string,string>` | Extra headers forwarded to the query endpoint. |
| `kvStore` | `'mem' \| 'idb' \| StoreProvider` | Default `'idb'`. `'mem'` = nothing persisted on device. |
| `logLevel` | `LogLevel` | Default `'error'`. |
| `logSink` | `LogSink` | Redirect log output. |
| `onUpdateNeeded` | `(reason: UpdateNeededReason) => void` | Default: `location.reload()`. |
| `onClientStateNotFound` | `() => void` | Sync state gone; instance is dead, must be replaced. Default `location.reload()`; React/Solid providers replace in place. |
| `onOnlineChange` | `(online: boolean) => void` | **Deprecated** — use `zero.connection.state.subscribe`. |
| `hiddenTabDisconnectDelay` | `number` | Default **5 minutes**. |
| `disconnectTimeoutMs` | `number` | Default **1 minute**. |
| `pingTimeoutMs` | `number` | Default `5_000`. Dead-connection detection takes `2 × pingTimeoutMs`. |
| `maxHeaderLength` | `number` | Default 8kb. Must be ≤ zero-cache/LB max header size. |
| `slowMaterializeThreshold` | `number` | Default `5_000` ms; console warning threshold. |
| `batchViewUpdates` | `(apply: () => void) => void` | Integrate framework batching (`unstable_batchedUpdates`, solid `batch`). Must call `apply` synchronously. |
| `queryChangeThrottleMs` | `number` | Default `10`. |
| `getTraceparent` | `() => string \| undefined` | W3C traceparent for distributed tracing. |
| `maxRecentQueries` | `number` | **Deprecated** — use `ttl`. |

```ts
import {Zero} from '@rocicorp/zero'
import type {ZeroOptions} from '@rocicorp/zero'

const opts: ZeroOptions = {
  schema,
  cacheURL: 'http://localhost:4848',
  userID: 'user-123',
  auth: jwt,
  context: {userID: 'user-123'},
  mutators,
  queryURL: `${location.origin}/api/zero/query`,
  mutateURL: `${location.origin}/api/zero/mutate`,
  kvStore: 'idb',
}
const zero = new Zero(opts)
```

### 8.2 `Zero` instance surface (verified from `zero.d.ts`)

```ts
export declare class Zero<S, MD, C> {
  constructor(options: ZeroOptions<S, MD, C>);

  readonly version: string;
  readonly userID: string | undefined;
  readonly storageKey: string;

  run<...>(query, runOptions?: RunOptions): Promise<HumanReadable<TReturn>>;
  preload<...>(query, options?: PreloadOptions): {cleanup: () => void; complete: Promise<void>};
  materialize<...>(query, options?: MaterializeOptions): TypedView<HumanReadable<TReturn>>;
  materialize<T, ...>(query, factory: ViewFactory<...>, options?: MaterializeOptions): T;

  readonly mutate: ZeroMutate<S, MD, C>;   // callable: zero.mutate(mutateRequest) => MutatorResult
  readonly mutateBatch: BatchMutator<S>;

  get context(): C;
  get connection(): Connection;
  get inspector(): Inspector;
  get schema(): S;
  get schemaVersion(): string;
  get clientID(): ClientID;
  get clientGroupID(): Promise<ClientGroupID>;
  get idbName(): string;
  get server(): HTTPString | null;
  get online(): boolean;
  get closed(): boolean;

  close(): Promise<void>;
  delete(): Promise<{...}>;   // closes AND wipes the IndexedDB database
}
```

```ts
export type RunOptions = {type: 'unknown' | 'complete'; ttl?: TTL};
export type PreloadOptions = {ttl?: TTL};
export type MaterializeOptions = PreloadOptions;
```

### 8.3 Storage layout / privacy

- IndexedDB DB name is derived from `userID` + `storageKey` + internal Zero info; names are prefixed with `rep`/`replicache`.
- **Users sharing a computer can read each other's synced data** — Zero cannot prevent this. If it matters, set `kvStore: 'mem'`.
- Logout: recreate `Zero` without `userID`. To wipe local data, `await zero.delete()`.

### 8.4 Connection API

```ts
export interface Connection {
  readonly state: Source<ConnectionState>;               // .current + .subscribe(fn) => unsubscribe
  connect(opts?: {auth: string}): Promise<void>;
}

export type ConnectionState =
  | {name: 'disconnected'; reason: string}
  | {name: 'connecting'; reason?: string}
  | {name: 'connected'}
  | {name: 'needs-auth'; reason:
      | {type: 'mutate'; status: 401 | 403; body?: string}
      | {type: 'query';  status: 401 | 403; body?: string}
      | {type: 'zero-cache'; reason: string}}
  | {name: 'error'; reason: string}
  | {name: 'closed'; reason: string};
```

Reads/writes by state (docs, verbatim):

| State | Reads | Writes |
|---|---|---|
| `connecting` | ✅ | ✅ (queued) |
| `connected` | ✅ | ✅ |
| `disconnected` | ✅ | ❌ |
| `error` | ✅ | ❌ |
| `needs-auth` | ✅ | ❌ |
| `closed` | ❌ | ❌ |

- `connecting`: retries every 5s; after `disconnectTimeoutMs` (default 1 min) → `disconnected`. Writes queue.
- `disconnected`: also entered when the tab is hidden for `hiddenTabDisconnectDelay` (default 5 min). Keeps retrying every 5s. Writes rejected.
- `error`: zero-cache crashed, or `/query` `/mutate` returned a network/HTTP error. **Zero does not retry** — call `zero.connection.connect()`.
- `needs-auth`: `/query` or `/mutate` returned 401/403. Call `connect()` (cookies) or `connect({auth: newToken})` (tokens).
- `closed`: terminal; only after `zero.close()`.

`connect()` semantics (verbatim from `.d.ts`): "Calling `connect()` without `auth` preserves the current auth token. If Zero is already `connected`, it sends an auth update to the server _without_ reconnecting... This method does not reconnect from `disconnected` or `closed`."

Forward connection errors to Sentry (docs, verbatim):

```ts
zero.connection.state.subscribe(state => {
  if (state.name !== 'error') return
  Sentry.withScope(scope => {
    scope.setTag('zero.connection.state', state.name)
    scope.setExtra('zero.connection.reason', state.reason)
    Sentry.captureException(new Error(`Zero connection error: ${state.reason}`))
  })
})
```

---

## 9. ZQL reference

Source: <https://zero.rocicorp.dev/docs/zql>, `zql/src/query/query.d.ts` (1.8.0)

### 9.1 Postgres → Zero → TS type mapping (verbatim table)

| Postgres Type | `schema.ts` Type | Resulting TS Type |
|---|---|---|
| All numeric types | `number` | `number` |
| `char`, `varchar`, `text`, `uuid` | `string` | `string` |
| `cidr`, `inet`, `macaddr`, `macaddr8` | `string` | `string` |
| `pg_lsn` | `string` | `string` |
| `isn` extension types (`ean13`, `isbn`, etc.) | `string` | `string` |
| `bool` | `boolean` | `boolean` |
| `date`, `timestamp`, `timestampz`, `time`, `timetz` | `number` | `number` |
| `json`, `jsonb` | `json` | `JSONValue` |
| `enum` | `enumeration` | `string` |
| `T[]` where `T` is a supported Postgres type | `json<U[]>` where `U` is the schema.ts type for `T` | `V[]` |

> **Timestamps are `number()` (epoch millis), not Date.** This is the single most common schema mistake.
>
> ⚠️ **No ZQL operators for arrays yet.** Zero syncs arrays to the client but there is no filtering or joining on array elements.
>
> Any other Postgres type is **silently dropped from replication** (column missing from synced data) with a warning at `zero-cache` startup. Workaround: add a Postgres trigger mapping it to a supported type (e.g. `polygon` → `json`).

### 9.2 `Query` interface (verbatim from 1.8.0 `.d.ts`)

```ts
export interface Query<TTable, TSchema = DefaultSchema, TReturn = PullRow<TTable, TSchema>> {
  related<TRelationship>(relationship: TRelationship): Query<...>;
  related<TRelationship, TSub>(relationship: TRelationship, cb: (q: Query<...>) => TSub): Query<...>;

  where<TSelector, TOperator>(field: TSelector, op: TOperator, value: ... | undefined): Query<...>;
  where<TSelector>(field: TSelector, value: ... | undefined): Query<...>;     // '=' is implicit
  where(expressionFactory: ExpressionFactory<TTable, TSchema>): Query<...>;

  whereExists(relationship, options?: ExistsOptions): Query<...>;
  whereExists<TRelationship>(relationship, cb: (q: Query<...>) => Query<...>, options?: ExistsOptions): Query<...>;

  start(row: Partial<PullRow<TTable, TSchema>>, opts?: {inclusive: boolean}): Query<...>;
  limit(limit: number): Query<...>;
  orderBy<TSelector>(field: TSelector, direction: 'asc' | 'desc'): Query<...>;
  one(): Query<TTable, TSchema, TReturn | undefined>;
}

export type ExistsOptions = {
  flip?: boolean;    // true = child drives the join; undefined = planner decides
  scalar?: boolean;  // @experimental — pre-resolve subquery to an equality check
};
```

Note there is **no `select()`** — ZQL always returns the whole row. This is a deliberate tradeoff so Zero can reuse rows across queries.

### 9.3 Operators

| Operator | Allowed operand types | Description |
|---|---|---|
| `=`, `!=` | boolean, number, string | JS strict-equal (`===`) semantics |
| `<`, `<=`, `>`, `>=` | number, string | Numeric or string ordering |
| `LIKE`, `NOT LIKE`, `ILIKE`, `NOT ILIKE` | string | SQL-compatible LIKE/ILIKE |
| `IN`, `NOT IN` | boolean, number, string | RHS must be an array |
| `IS`, `IS NOT` | boolean, number, string, **null** | Same as `=` but also works for `null` |

**null comparison follows SQL**: `42 = null`, `42 != null`, `null = null` are all `false`. Use `IS` / `IS NOT` for null. Passing `undefined` to `where` always yields false (so the query returns nothing) — this is a convenience, not an error.

### 9.4 Composition

```ts
zql.issue                                        // implicit ORDER BY primary key asc
zql.issue.orderBy('priority', 'desc').orderBy('created', 'desc')
zql.issue.orderBy('created', 'desc').limit(100)
zql.issue.start(row, {inclusive: true})          // default is EXCLUSIVE (for paging)
zql.issue.where('id', 42).one()                  // Row|undefined instead of Row[]; overrides limit()

zql.issue.related('comments').related('reactions').related('assignees')
zql.issue.related('comments', q => q.orderBy('modified','desc').limit(100).related('reactions'))

zql.issue.where(({cmp, and, or, not}) =>
  or(cmp('priority','critical'), and(cmp('priority','medium'), not(cmp('numVotes','>',100)))),
)
zql.issue.where('priority','>=',3).where('owner','aa')   // chained where = AND

zql.organization.whereExists('employees', q => q.where('location','Hawaii'))
zql.issue.where(({cmp, or, exists}) => or(cmp('priority','high'), exists('comments')))

// literal-vs-column: `where` ALWAYS treats arg 1 as a column name
zql.issue.where(cmpLit('foobar', 'foo' + 'bar'))
zql.issue.where(cmpLit(ctx.role, 'admin'))
```

> ⚠️ **`orderBy` / `limit` are not supported inside a junction (many-to-many) relationship** and throw at runtime (bug 3527).

`escapeLike` (exported from `@rocicorp/zero`) escapes user input for LIKE/ILIKE — zbugs uses it for text search:

```ts
cmp('title', 'ILIKE', `%${escapeLike(textFilter)}%`)
```

**ILIKE collation caveat** (docs, verbatim): ZQLite and the in-memory engine use Unicode-aware lowercasing (`MÜLLER` matches `müller`); Postgres will only match non-ASCII if the text column uses a Unicode-aware collation.

### 9.5 Query planning: `flip` and `scalar`

```ts
// Force the child to drive the join (much faster when the child set is small)
zql.documents
  .whereExists('editors', e => e.where('userID', 42), {flip: true})
  .orderBy('created', 'desc')
  .limit(100)

// Scalar subquery: pre-resolve to an equality check instead of a join.
// Requires the subquery to constrain a UNIQUE index; throws otherwise.
// One-hop only — throws on junction relationships.
zql.issue.whereExists('project', q => q.where('name', 'zero'), {scalar: true})
```

zbugs uses `{scalar: true}` heavily for project scoping — this is the pattern to copy for yapm's tenant filter:

```ts
q.whereExists('project', q => q.where('lowerCaseName', projectName.toLocaleLowerCase()), {scalar: true})
```

Trade-off: the query must rehydrate whenever the scalar subquery result changes — fine for stable lookups (project IDs, user IDs), bad for rapidly-changing data. Scalar subqueries are **not** integrated with the planner; you choose manually.

### 9.6 Type helpers

```ts
import type {QueryResultType, QueryRowType, Row} from '@rocicorp/zero'

const complexQuery = zql.issue.related('comments', q => q.related('author'))
type MyComplexResult = QueryResultType<typeof complexQuery>   // the array
type MySingleRow    = QueryRowType<typeof complexQuery>       // one element
```

Both helpers also accept a `CustomQuery` from the registry — zbugs does exactly this (verbatim):

```ts
export type Issues = QueryResultType<typeof queries.issueListV2>;
export type Issue = Issues[number];
```

> 🧑‍🏫 **Data returned from ZQL must be treated as immutable.** ZQL caches values across queries; mutating a returned object mutates it everywhere. `readonly` is used to help but is easy to cast away.

---

## 10. Auth integration

Source: <https://zero.rocicorp.dev/docs/auth>, `apps/zbugs/api/index.ts` + `shared/auth.ts`

### 10.1 What Zero actually expects

Zero 1.x does **not** verify JWTs itself. `ZERO_AUTH_JWK`, `ZERO_AUTH_JWKS_URL`, and `ZERO_AUTH_SECRET` are **deprecated flags** in 1.8. Your `/query` and `/mutate` endpoints do the verification.

Two supported credential transports:

**Cookies** (most common). Enable forwarding on zero-cache:

```bash
export ZERO_QUERY_FORWARD_COOKIES="true"
export ZERO_MUTATE_FORWARD_COOKIES="true"
```

zero-cache then forwards all cookies received at `cacheURL` to your endpoints in the standard HTTP `Cookie` header.

**Tokens** (opaque string / JWT). Pass via `auth` on the client:

```tsx
<ZeroProvider userID={userID} auth={token}><App /></ZeroProvider>
// or: new Zero({userID, auth: token, ...})
```

Zero forwards it to your endpoints as **`Authorization: Bearer <token>`**.

### 10.2 Cookie deployment requirements (production)

1. Run `zero-cache` on a **subdomain of your main site** (`zero.example.com` for `example.com`) so the browser sends cookies to it.
2. Set cookies from the main site with `Domain=.example.com`.
3. ⚠️ **Never use `SameSite=None` for auth cookies.** Zero uses WebSockets; `SameSite=None` exposes you to Cross-Site WebSocket Hijacking (CSWSH). Use `SameSite=Lax` (browser default) or `Strict`.

In development this works automatically: browsers send cookies by domain, not port, so `localhost:3000` cookies reach `localhost:4848`.

### 10.3 How context reaches queries and mutators

The full chain, verified end-to-end from zbugs:

1. **Client** stores an encoded JWT + decoded payload; passes `auth: encoded` and `context: decoded` to `ZeroProvider`.
2. **zero-cache** forwards the token (`Authorization: Bearer`) or cookies to `ZERO_QUERY_URL` / `ZERO_MUTATE_URL`.
3. **Your endpoint** verifies and parses it into a typed object.
4. That object is passed as `ctx` to `query.fn({args, ctx})` / `mutator.fn({tx, args, ctx})`.
5. `userID` (the verified subject) is separately passed to `handleQueryRequest`/`handleMutateRequest` for client-group binding.

zbugs JWT shape and verification (verbatim):

```ts
// shared/auth.ts
export const jwtDataSchema = v.object({
  sub: v.string(),
  role: v.literalUnion('crew', 'user'),
  name: v.string(),
  iat: v.number(),
  exp: v.number(),
});
export type JWTData = v.Infer<typeof jwtDataSchema>;
export type AuthData = Pick<JWTData, 'sub' | 'role'>;
export type Role = AuthData['role'];

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    context: AuthData | undefined;
  }
}
```

```ts
// api/index.ts — verification (verbatim)
async function maybeVerifyAuth(headers: IncomingHttpHeaders): Promise<JWTData | undefined> {
  let {authorization} = headers;
  if (!authorization) return undefined;

  assert(
    authorization.toLowerCase().startsWith('bearer '),
    'Expected Authorization header to start with "Bearer "',
  );
  authorization = authorization.substring('Bearer '.length);

  const jwk = process.env.VITE_PUBLIC_JWK;
  if (!jwk) throw new Error('VITE_PUBLIC_JWK is not set');

  const jwtData = jwtDataSchema.parse(
    (await jwtVerify(authorization, JSON.parse(jwk))).payload,
  );
  return jwtData;
}
```

```ts
// api/index.ts — signing at OAuth callback (verbatim, abbreviated)
const jwtPayload: JWTData = {
  sub: userId,
  iat: Math.floor(Date.now() / 1000),
  role: userRows[0].role,
  name: userDetails.data.login,
  exp: 0, // setExpirationTime below sets it
};

const jwt = await new SignJWT(jwtPayload)
  .setProtectedHeader({alg: must(privateJwk.alg)})
  .setExpirationTime('30days')
  .sign(privateJwk);

reply.cookie('jwt', jwt, {
  path: '/',
  expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  secure: !request.hostname.includes('localhost'),
  sameSite: 'strict',
});
```

### 10.4 Rejecting, refreshing, logging out

Return **401 or 403** from `/query` or `/mutate` to mark unauthorized:

```ts
if (!session) {
  return Response.json({error: 'Unauthorized'}, {status: 401})   // 401 or 403
}
```

Zero disconnects and moves to `needs-auth`. Recover:

```ts
// cookie auth: refresh the cookie, then
zero.connection.connect()

// token auth:
const token = await fetchNewToken()
zero.connection.connect({auth: token})
```

Refreshing a token for the **same** user without recreating Zero:

```ts
const nextToken = await fetchNewToken()
await zero.connection.connect({auth: nextToken})
```

> When called while connected, Zero refreshes server-side auth context and re-transforms queries **without reconnecting**. Use this only for the current user; for logout or a different user, recreate `Zero` with new `userID`/`auth`.

Logout:

```ts
await zero.delete()   // closes the instance AND wipes IndexedDB
```

Doing nothing instead leaves synced data on disk — faster re-login, worse privacy.

### 10.5 zero-cache → API server authentication (reverse direction)

Protect your endpoints from anyone other than zero-cache:

- `ZERO_QUERY_API_KEY` / `ZERO_MUTATE_API_KEY` — sent by zero-cache in an **`X-Api-Key`** header.

### 10.6 Background auth revalidation

Two zero-cache knobs bound how long stale auth survives on already-open connections (both default **unset**):

- `ZERO_AUTH_REVALIDATE_INTERVAL_SECONDS` — periodically re-checks each live connection against `/query`; a 401/403 disconnects it. Bounds post-logout / post-revocation lifetime.
- `ZERO_AUTH_RETRANSFORM_INTERVAL_SECONDS` — periodically re-runs query transformation for a client group so auth-derived query shapes (roles, org membership, feature flags) refresh even when the query set is unchanged.

Set both if your permissions can change server-side without a client reconnect. For yapm, `ZERO_AUTH_RETRANSFORM_INTERVAL_SECONDS` matters when a user is removed from a project.

---

## 11. zero-cache: configuration, Postgres requirements, Docker

Source: <https://zero.rocicorp.dev/docs/zero-cache-config>, <https://zero.rocicorp.dev/docs/self-host>, <https://zero.rocicorp.dev/docs/connecting-to-postgres>

`zero-cache` is configured **only** by CLI flags or environment variables. There is no config file. `zero-cache --help` lists everything.

### 11.1 Architecture

Two roles in one image:

| | Replication Manager | View Syncer |
|---|---|---|
| Owns replication slot | ✅ | ❌ |
| Serves client queries | ❌ | ✅ |
| Backs up replica | ✅ (required in multi-node) | ❌ |
| Restores from backup | Optional | Required |
| CVR management | ❌ | ✅ |
| Number deployed | 1 | N (horizontal scale) |

Ports: view-syncer **4848** (public, WebSocket-capable LB), replication-manager **4849** (**private only**). Health check path: `/keepalive`.

### 11.2 Postgres requirements

- **Postgres v15.0+** with **logical replication**.
- `wal_level` must be `logical`:
  ```bash
  psql -c 'SHOW wal_level'
  psql -c "ALTER SYSTEM SET wal_level = 'logical';"
  data_dir=$(psql -t -A -c 'SHOW data_directory'); pg_ctl -D "$data_dir" restart
  ```
  On Google Cloud SQL you don't set `wal_level`; enable the flag `cloudsql.logical_decoding`.
- **`ZERO_UPSTREAM_DB` must be a DIRECT connection**, never through pgbouncer/a pooler — Zero creates a replication slot. `ZERO_CVR_DB` and `ZERO_CHANGE_DB` **should** use a pooler in production.
- Every synced table needs a **primary key or at least one unique index**. Multi-column PKs and FKs supported.
- Zero uses Postgres **event triggers** for efficient schema migration. Without them (Heroku, Fly Managed PG, Render, Supabase <15.8.1.083), *any schema change triggers a full reset* of all server- and client-side state — unless you use schema change hooks (§11.7).
- Publication: by default zero-cache creates `_{app-id}_public_0` = `CREATE PUBLICATION _{app-id}_public_0 FOR TABLES IN SCHEMA public;`.
- Reserved column name: **`_0_version`**.
- Object names must match `/^[A-Za-z_]+[A-Za-z0-9_-]*$/`.

Provider support matrix (verbatim):

| Postgres | Support |
|---|---|
| AWS RDS | ✅ |
| AWS Aurora | ✅ v15.6+ |
| PlanetScale for Postgres | ✅ (see notes) |
| Neon | ✅ (see notes) |
| Google Cloud SQL | ✅ (see notes) |
| Postgres.app | ✅ |
| Postgres 15+ Docker | ✅ |
| Supabase | ⚠️ |
| Fly.io Managed Postgres | ⚠️ |
| Render | ⚠️ |
| Heroku | 🤷‍♂️ No event triggers |

Key provider gotchas:
- **Supabase**: needs ≥15.8.1.083 for event triggers. Must use the **"Direct Connection"** string for upstream. Use the **session** pooler (not transaction pooler — it breaks prepared statements → `26000 prepared statement ... does not exist`) for CVR/Change DB. May need an IPv4 add-on (Pro plan, +$4/mo). `ALTER PUBLICATION` does not fire DDL triggers → call a schema change hook. **HA failover unsupported.**
- **Neon**: enable logical replication per branch/endpoint in the console. Zero's open replication connection keeps the compute running → surprising bills for low-traffic apps. Per-preview branching is not well supported.
- **PlanetScale**: connect with the `default` role (user roles can't create slots). Raise `max_connections` to ≥100 (default 25 is too low). Direct connection for upstream, pooled for CVR/Change. For HA, set `ZERO_UPSTREAM_PG_REPLICATION_SLOT_FAILOVER=true` and register the `a–z` slot range with `pscale api`.
- **Fly.io**: Managed PG is private-network-only; add `sslmode=disable` on the Fly private network (no TLS). No superuser → no event triggers. Use the pgBouncer endpoint for CVR/Change.
- **Render**: `wal_level=logical` requires a support ticket; publication creation requires another. **Do not enable Render HA** — async standby can drop recent writes, which is incompatible with a sync engine.

### 11.3 Environment variables that matter

**Required**

| Env | Flag | Notes |
|---|---|---|
| `ZERO_UPSTREAM_DB` | `--upstream-db` | Authoritative Postgres. **Direct connection.** |
| `ZERO_ADMIN_PASSWORD` | `--admin-password` | **Required when `NODE_ENV=production`.** Guards `/statz` and the inspector. |

**Core**

| Env | Flag | Default | Notes |
|---|---|---|---|
| `ZERO_QUERY_URL` | `--query-url` | — | Your `/query` endpoint. Comma-separated list; each entry may be a `URLPattern`. |
| `ZERO_MUTATE_URL` | `--mutate-url` | — | Your `/mutate` endpoint. Same pattern rules. |
| `ZERO_REPLICA_FILE` | `--replica-file` | `zero.db` | Path to the SQLite replica. Losable — triggers re-replication. |
| `ZERO_CVR_DB` | `--cvr-db` | = upstream | Client View Records. **Use a pooler.** |
| `ZERO_CHANGE_DB` | `--change-db` | = upstream | Recent replication log. **Use a pooler.** |
| `ZERO_PORT` | `--port` | `4848` | Sync connections. |
| `ZERO_APP_ID` | `--app-id` | `zero` | Isolates apps on one upstream. Metadata in schema `{app-id}`, shard meta in `{app-id}_{#}`, CVR/CDC in `{app-id}_{shard}/cvr` and `/cdc`. **Only lowercase letters, digits, underscore.** |
| `ZERO_APP_PUBLICATIONS` | `--app-publications` | `_{app-id}_public_0` | Comma-separated. May not start with `_`. **Changing this resyncs the replica.** |
| `ZERO_ENABLE_CRUD_MUTATIONS` | `--enable-crud-mutations` | `true` | **Set `'false'`** for custom-mutator apps — stops view-syncers connecting upstream for writes. |
| `ZERO_NUM_SYNC_WORKERS` | `--num-sync-workers` | `max(1, availableParallelism()-1)` | **`0` = replication-manager mode.** |
| `ZERO_CHANGE_STREAMER_URI` | `--change-streamer-uri` | — | View-syncers → `ws://replication-manager:4849/`. Overrides `--change-streamer-mode`. |
| `ZERO_CHANGE_STREAMER_MODE` | `--change-streamer-mode` | `dedicated` | `dedicated` (single node / RM) or `discover` (view-syncers). |
| `ZERO_CHANGE_STREAMER_PORT` | `--change-streamer-port` | `--port + 1` | |
| `ZERO_AUTO_RESET` | `--auto-reset` | `true` | Wipe+resync replica when replication halts (no event triggers). Heavy. |
| `ZERO_LAZY_STARTUP` | `--lazy-startup` | `false` | Defer startup until first request. Single-node only. Good for previews. |

**Auth / API-server integration**

| Env | Default | Notes |
|---|---|---|
| `ZERO_QUERY_FORWARD_COOKIES` | `false` | Forward browser cookies to `/query`. |
| `ZERO_MUTATE_FORWARD_COOKIES` | `false` | Forward browser cookies to `/mutate`. |
| `ZERO_QUERY_API_KEY` | — | Sent to `/query` as `X-Api-Key`. |
| `ZERO_MUTATE_API_KEY` | — | Sent to `/mutate` as `X-Api-Key`. |
| `ZERO_QUERY_ALLOWED_CLIENT_HEADERS` | none | Allowlist of client-supplied headers to forward. |
| `ZERO_MUTATE_ALLOWED_CLIENT_HEADERS` | none | Same for mutate. |
| `ZERO_QUERY_ALLOWED_REQUEST_HEADERS` | none | Allowlist of headers from the **WebSocket upgrade request** (e.g. `x-forwarded-for`, `cf-ray`). Retained for the socket's lifetime. **New in 1.8.** |
| `ZERO_MUTATE_ALLOWED_REQUEST_HEADERS` | none | Same for mutate. **New in 1.8.** |
| `ZERO_AUTH_REVALIDATE_INTERVAL_SECONDS` | unset | Re-check live connections against `/query`. |
| `ZERO_AUTH_RETRANSFORM_INTERVAL_SECONDS` | unset | Re-run auth-sensitive query transformation. |

**Deprecated auth flags** (do not use in 1.8): `ZERO_AUTH_JWK`, `ZERO_AUTH_JWKS_URL`, `ZERO_AUTH_SECRET`.

**Connections / limits**

| Env | Default |
|---|---|
| `ZERO_UPSTREAM_MAX_CONNS` | `20` (÷ sync workers; +1 for the replication stream) |
| `ZERO_CVR_MAX_CONNS` | `30` (÷ sync workers; must be ≥1 per worker or startup fails) |
| `ZERO_CHANGE_MAX_CONNS` | `5` |
| `ZERO_PER_USER_MUTATION_LIMIT_MAX` | unset |
| `ZERO_PER_USER_MUTATION_LIMIT_WINDOW_MS` | `60000` |
| `ZERO_WEBSOCKET_MAX_PAYLOAD_BYTES` | `10485760` (10 MiB) |
| `ZERO_WEBSOCKET_COMPRESSION` | `false` |
| `ZERO_WEBSOCKET_COMPRESSION_OPTIONS` | — (JSON, e.g. `{"zlibDeflateOptions":{"level":3},"threshold":1024}`) |

**Litestream / backup** (replication-manager only for the backup URL)

| Env | Default |
|---|---|
| `ZERO_LITESTREAM_BACKUP_URL` | — (`s3://…`; **required on the RM in multi-node**) |
| `ZERO_LITESTREAM_ENDPOINT` | — (non-AWS S3, e.g. `https://<id>.r2.cloudflarestorage.com`; must match across RM + VS) |
| `ZERO_LITESTREAM_REGION` | — (needed for non-standard AWS partitions; must match across RM + VS) |
| `ZERO_LITESTREAM_CHECKPOINT_THRESHOLD_MB` | `40` |
| `ZERO_LITESTREAM_INCREMENTAL_BACKUP_INTERVAL_MINUTES` | `15` |
| `ZERO_LITESTREAM_SNAPSHOT_BACKUP_INTERVAL_HOURS` | `12` |
| `ZERO_LITESTREAM_MULTIPART_CONCURRENCY` | `48` |
| `ZERO_LITESTREAM_MULTIPART_SIZE` | `16777216` (16 MiB) |
| `ZERO_LITESTREAM_RESTORE_PARALLELISM` | `48` |
| `ZERO_LITESTREAM_PORT` | `--port + 2` |
| `ZERO_LITESTREAM_LOG_LEVEL` | `warn` |
| `ZERO_LITESTREAM_EXECUTABLE` / `ZERO_LITESTREAM_CONFIG_PATH` | — / `./src/services/litestream/config.yml` |
| `ZERO_LITESTREAM_MIN_CHECKPOINT_PAGE_COUNT` | `checkpointThresholdMB * 250` |
| `ZERO_LITESTREAM_MAX_CHECKPOINT_PAGE_COUNT` | `minCheckpointPageCount * 10` (`0` disables RESTART checkpoints) |

**Observability / tuning**

| Env | Default |
|---|---|
| `ZERO_LOG_LEVEL` | `info` (`debug`\|`info`\|`warn`\|`error`) |
| `ZERO_LOG_FORMAT` | `text` (`text`\|`json`) |
| `ZERO_LOG_SLOW_HYDRATE_THRESHOLD` | `100` (ms) |
| `ZERO_LOG_SLOW_ROW_THRESHOLD` | `2` (ms) |
| `ZERO_LOG_IVM_SAMPLING` | `5000` |
| `ZERO_QUERY_HYDRATION_STATS` | unset |
| `ZERO_YIELD_THRESHOLD_MS` | `10` |
| `ZERO_ENABLE_QUERY_PLANNER` | `true` |
| `ZERO_ENABLE_TELEMETRY` | `true` (also honors `DO_NOT_TRACK=1`) |
| `ZERO_REPLICATION_LAG_REPORT_INTERVAL_MS` | `30_000` (needs write access; uses `pg_logical_emit_message()`) |
| `ZERO_INITIAL_SYNC_TABLE_COPY_WORKERS` | `5` |
| `ZERO_REPLICA_VACUUM_INTERVAL_HOURS` | unset (VACUUM needs 2× db size in free disk) |
| `ZERO_CVR_GARBAGE_COLLECTION_INACTIVITY_THRESHOLD_HOURS` | `48` |
| `ZERO_CVR_GARBAGE_COLLECTION_INITIAL_BATCH_SIZE` | `25` (`0` disables GC) |
| `ZERO_CVR_GARBAGE_COLLECTION_INITIAL_INTERVAL_SECONDS` | `60` |
| `ZERO_CHANGE_STREAMER_BACK_PRESSURE_LIMIT_HEAP_PROPORTION` | `0.04` |
| `ZERO_CHANGE_STREAMER_FLOW_CONTROL_CONSENSUS_PADDING_SECONDS` | `1` |
| `ZERO_CHANGE_STREAMER_STARTUP_DELAY_MS` | `15000` |
| `ZERO_SHADOW_SYNC_ENABLED` / `_INTERVAL_HOURS` / `_SAMPLE_RATE` / `_MAX_ROWS_PER_TABLE` | `false` / `12` / `0.1` / `10000` |
| `ZERO_STORAGE_DB_TMP_DIR` | `os.tmpdir()` |
| `ZERO_TASK_ID` | auto (ECS TaskARN or random) |
| `ZERO_SERVER_VERSION` | — |
| `ZERO_UPSTREAM_PG_REPLICATION_SLOT_FAILOVER` | `false` (PG 17+ only) |

### 11.4 Docker image

- Docker Hub: `rocicorp/zero:{version}` → **`rocicorp/zero:1.8.0`** (verified present on Docker Hub, pushed 2026-07-13; also tagged `latest`)
- GHCR: `ghcr.io/rocicorp/zero:1.8.0`

```bash
docker pull rocicorp/zero:1.8.0
docker pull ghcr.io/rocicorp/zero:1.8.0
```

### 11.5 Minimal single-node docker-compose (docs, verbatim except pinned tag)

```yaml
services:
  zero-cache:
    image: rocicorp/zero:1.8.0
    ports:
      - 4848:4848
    stop_grace_period: 10m
    environment:
      # Used for replication from postgres
      # This *must* be a direct connection (not via pgbouncer)
      ZERO_UPSTREAM_DB: postgres://postgres:pass@upstream-db:5432/zero
      # Used for storing client view records
      # Use a pooler in production
      ZERO_CVR_DB: postgres://postgres:pass@upstream-db:5432/zero
      # Used for storing recent replication log entries
      # Use a pooler in production
      ZERO_CHANGE_DB: postgres://postgres:pass@upstream-db:5432/zero
      # Path to the SQLite replica
      ZERO_REPLICA_FILE: /data/replica.db
      # Password used to access the inspector and /statz
      ZERO_ADMIN_PASSWORD: pickanewpassword
      # URLs for your API /query and /mutate endpoints
      ZERO_QUERY_URL: https://api.example.com/api/zero/query
      ZERO_MUTATE_URL: https://api.example.com/api/zero/mutate
      ZERO_ENABLE_CRUD_MUTATIONS: 'false'
    volumes:
      - zero-cache-data:/data
    healthcheck:
      test: curl -f http://localhost:4848/keepalive
      interval: 5s
      start_period: 10m

  upstream-db:
    image: postgres:18
    environment:
      POSTGRES_DB: zero
      POSTGRES_PASSWORD: pass
    ports:
      - 5432:5432
    command: postgres -c wal_level=logical
    healthcheck:
      test: pg_isready
      interval: 10s

volumes:
  zero-cache-data:
```

zbugs' own dev compose sets more replication knobs (verbatim, `apps/zbugs/docker/docker-compose.yml`):

```yaml
    command: |
      postgres 
      -c wal_level=logical
      -c max_wal_senders=10 
      -c max_replication_slots=5 
      -c hot_standby=on 
      -c hot_standby_feedback=on
```

### 11.6 Multi-node split (the two deltas that matter)

Replication manager: `ZERO_NUM_SYNC_WORKERS: 0` + `ZERO_LITESTREAM_BACKUP_URL: s3://…`, expose **4849 privately only**, no `ZERO_QUERY_URL`/`ZERO_MUTATE_URL`.

View syncers: `ZERO_CHANGE_STREAMER_URI: ws://replication-manager:4849/`, public on 4848, **no** `ZERO_LITESTREAM_BACKUP_URL`, `replicas: N`, and **sticky sessions** (`sessionAffinity: ClientIP` / `lb_cookie`).

> ⚠️ **Never expose the replication-manager to the internet.**
>
> View-syncers keep hydrated pipelines in memory — without sticky sessions, reconnects land on a different instance and force rehydration ("Rehome errors").
>
> Give a generous startup grace period (10 minutes is a good default: `healthcheck.start_period` / Fly `grace_period` / ECS `healthCheckGracePeriodSeconds`) and a generous shutdown grace period so websockets drain.

### 11.7 Local dev

```bash
ZERO_QUERY_URL="http://localhost:3000/api/query" \
  ZERO_MUTATE_URL="http://localhost:3000/api/mutate" \
  npx zero-cache-dev
```

`zero-cache-dev` watches and restarts. Also reads `.env`.

Schema-change hooks for providers without event triggers:

```sql
-- opt in once (default app id `zero`, shard `0`):
UPDATE zero_0."shardConfig" SET "ddlDetection" = true;

-- then, in the SAME transaction as your DDL, before any dependent data changes:
BEGIN;
  ALTER TABLE foo ADD COLUMN bar TEXT;
  CREATE INDEX foo_bar_idx ON foo(bar);
  SELECT zero_0.update_schemas();
COMMIT;
```

### 11.8 Rolling updates & version compatibility

Deploy order for a zero-cache upgrade:
1. replication-manager → wait for startup
2. view-syncers
3. API servers (`/query`, `/mutate`)
4. clients
5. after clients refresh, run contract migrations

**Servers are compatible with any client of the same major version, and with clients one major version back.** Server `2.2.0` works with clients `2.3.0`, `2.1.0`, `1.0.0` — but not `3.0.0` or `0.1.0`. To upgrade majors: deploy the new zero-cache first, then the frontend.

> Keep Zero version bumps and schema changes in **separate PRs/deploys** — both require specific ordering and the orderings differ.

---

## 12. Schema migrations & versioning

Source: <https://zero.rocicorp.dev/docs/schema#schema-changes>

Three components touch the DB schema: **Postgres**, the **API server**, the **client**. Order matters in production.

- **Expand** (adding): providers before consumers → **DB → (wait for replication/backfill) → API → Client**
- **Contract** (removing): consumers before providers → **Client → API → DB**

| Change | Deploy order |
|---|---|
| Add column/table | DB → (wait) → API → Client |
| Remove column/table | Client (maybe wait for app update) → API → DB |
| Add mutator/query | API → Client |
| Remove mutator/query | Client → API |
| Change mutator implementation | API only |
| Change mutator interface | Add mutator → Client → Remove mutator |
| Rename column/table | Add new + Migrate → Remove old |

> 👨‍🏫 **Incorrect order causes downtime.** Deploying the API before the schema replicates makes mutators/queries reference non-existent columns; deploying the client before the API makes it call mutators/queries that don't exist. Both put Zero in the `error` state; the user must reload once the dependency ships.

**Backfill**: when you add a column/table (or add an existing column to a custom publication), Zero backfills in the background and **hides the new column from the replica until backfill completes**. Deploying code that queries it early makes those queries fail even though the column exists in Postgres.

Monitor backfill:
```sql
SELECT * FROM "<app>/cdc"."backfilling" WHERE "schema" = 'public';
-- any rows returned => still backfilling
```
Or watch for the column appearing on synced rows client-side, or the Cloud Zero dashboard.

**Old clients**: on connect, the client sends the schema it was built against. If incompatible, it gets an error and `onUpdateNeeded` fires:

```ts
new Zero({
  // Optional. By default calls location.reload()
  onUpdateNeeded: reason => {
    if (reason.type === 'SchemaVersionNotSupported') {
      // Show a banner prompting the user to update
    }
  },
})
```

Renames and required→optional changes are compound (expand then contract) and are done with a temporary Postgres trigger keeping both columns in sync — see the docs page for the exact `plpgsql` trigger bodies.

Local dev: any order works; a reload fixes mismatches. **Resetting the local DB also requires deleting the SQLite replica and restarting `zero-cache`.**

Previews (Vercel-style per-branch hostnames): set `ZERO_QUERY_URL`/`ZERO_MUTATE_URL` to `"https://myapp.com/api/zero/query,https://my-app-*.preview.myapp.com/api/zero/query"` and derive `queryURL`/`mutateURL` from `location.origin` on the client. **You must do both endpoints.** Neon-style per-preview DB branching is not well supported (each upstream needs its own zero-cache).

---

## 13. Constraints, gotchas, limits

### Hard limitations
- **No offline writes.** Reads work while `disconnected`/`error`/`needs-auth`; writes are rejected. Not planned near-term. Show a modal / disable inputs to avoid data loss (Zero can't protect an unsaved textarea).
- **SSR is not supported.** Docs: "we don't recommend using Zero with SSR" (bug 3491). Defer the provider to the client:
  ```tsx
  // Next.js
  'use client'
  // TanStack Start
  const ZeroProvider = lazy(() => import('@rocicorp/zero/react').then(m => ({default: m.ZeroProvider})))
  // SolidStart
  const ZeroProvider = clientOnly(async () => import('@rocicorp/zero/solid').then(m => ({default: m.ZeroProvider})))
  ```
- **No aggregates** (`count`, `min`, `max`, `group by`) — on the "soon, not committed" roadmap.
- **No column-level permissions** yet (planned 2026). Today you restrict columns only via the Postgres publication (which controls what reaches zero-cache at all).
- **No first-class text search.** zbugs uses `ILIKE '%…%'` with `escapeLike`.
- **No JSON filters** in ZQL.
- **No array operators** in ZQL (arrays sync, but you can't filter/join on elements).
- **No `select()`** — queries always return whole rows.
- **Mutators can't return data** on success.
- **Column defaults are unusable from Zero.** `insert()` requires all non-nullable columns, so Postgres defaults never apply for client-originated inserts. Known issue.
- **Max TTL is 10 minutes.**
- **Relationship chaining is limited to two levels** (bug 3454).
- **`orderBy`/`limit` throw inside junction (many-to-many) relationships** (bug 3527).
- **`{scalar: true}` is one-hop only** and requires the subquery to constrain a unique index; otherwise it throws.
- **Views are never synced.** Only tables. `generated stored` columns sync only on Postgres 18+.
- **`ZQLDatabase` re-reads the Postgres schema before every transaction** (bug 3799) — a scaling concern.

### Correctness gotchas
- **Do not generate IDs inside mutators.** Mutators run multiple times (up to twice on the client for rebase, once on the server). Generate `crypto.randomUUID()` / `uuidv7` / `nanoid` at the **call site** and pass it in as an arg. Also avoid auto-increment PKs — optimistic creation with relationships breaks.
- **Treat all ZQL results as immutable.** ZQL caches row objects across queries; mutating one mutates it everywhere.
- **Client-side `tx.run` only sees synced data.** If no *active* query covers a row, a mutator's client-side read returns nothing, while the server read returns everything. Write mutators that tolerate this asymmetry (zbugs' `assertIsCreatorOrAdmin` returns a generic "not authorized" rather than distinguishing "missing").
- **Deny reads by returning an empty query, not by throwing.** `q.where(({or}) => or())`.
- **Do auth checks before existence checks** in mutators, or you leak the existence of private rows (zbugs comments this explicitly).
- **Always `await` writes** inside mutators.
- **`defineQueries` / `defineMutators` exactly once at top level** — they assign the wire names.
- **Zero types are registered globally with `declare module '@rocicorp/zero'`** (`DefaultTypes.schema`, `.context`, `.dbProvider`). Forgetting these produces confusing type errors; the `*WithType` variants are the escape hatch.
- **Auth errors need a manual reconnect** — Zero will not retry out of `needs-auth` or `error` by itself.
- **Queries must be optimized.** From llms.txt: "The query plan commonly has `TEMP B-TREE` when it is not optimized... `zero-cache` derives indexes from upstream" — so add the index in **Postgres**, not in Zero.

### Consistency behavior
Local results are returned instantly, then reconciled with server results. Local results are only guaranteed to be a **prefix** of server results if you preloaded the same sort order. If a user flips the sort, expect visible shuffling on server response. Mitigation (docs, verbatim): "for any query shape you intend to do, you should preload the first `n` results for that query shape with no filters, in each sort you intend to use." Zero does not sync duplicate rows — it syncs the union of active query results, so multiple sorts of the same set overlap cheaply.

`result.type` is currently only `complete` or `unknown` (plus `error`). A `prefix` type is planned.

### Performance levers
- **Disk IOPS on the replica volume** is the primary bottleneck for hydration. Fly.io gives physically attached SSDs even on small VMs; AWS with low IOPS is the usual culprit.
- **Co-locate zero-cache with the CVR database.** `flushed cvr ... (124ms)` in logs means it's too far away.
- Preload aggressively; TTL-evicted queries pay full hydration again on return.
- IVM advancement cost scales with **changed rows**, not query count.
- Node is single-threaded per sync worker — one client group can starve others; tune `ZERO_YIELD_THRESHOLD_MS`.
- Use `{scalar: true}` for stable lookups (project/tenant IDs) and `{flip: true}` where a child set is small.
- `/statz` (needs `ZERO_ADMIN_PASSWORD`) exposes internal health stats.

### Debugging tools
```ts
// scripts/analyze.ts
import {runAnalyzeCLI} from '@rocicorp/zero/analyze'
import {schema} from '../src/zero/schema.ts'
await runAnalyzeCLI({schema})
```
```bash
npm run analyze-query -- \
  --zero-cache-url='http://localhost:4848' \
  --auth-token="$ZERO_AUTH_JWT" \
  --query='albums.where("artistId", "artist_1").orderBy("createdAt", "asc").limit(10)'
```
Other flags: `--cookie`, `--admin-password`, `--headers-json`, `--query-name` + `--query-args`, `--ast`, `--output-synced-rows`, `--output-vended-rows`. Falls back to `ZERO_*` env vars. Output shows synced rows, rows scanned by SQLite, and the SQLite query plan — look for `USE TEMP B-TREE FOR ORDER BY`, which means a missing upstream index.

> The standalone `npx analyze-query` CLI is **deprecated**; `runAnalyzeCLI` replaces it.

Also: `zero.inspector` (the Inspector API), `/statz`, `zero-out`, `zero-sqlite3` for poking at the replica.

---

## 14. What's new / changed in 1.8

Source: <https://zero.rocicorp.dev/docs/release-notes/1.8>

- **Request header forwarding**: `ZERO_MUTATE_ALLOWED_REQUEST_HEADERS`, `ZERO_QUERY_ALLOWED_REQUEST_HEADERS` forward selected WebSocket-upgrade headers to your API.
- **GHCR**: images now published to `ghcr.io/rocicorp/zero` in addition to Docker Hub.
- **`MutatorResult`** type exported from `@rocicorp/zero`.
- **Operational + stability metrics**: API calls, startup, initial sync, replication slots, Litestream backup/restore; serving-lag, client-version reconciliation, WebSocket health, replication flow control.
- **Perf**: large transaction replication ~1.5× faster; `limit()` incremental updates up to 50× faster in specific scenarios; client-side hydration ~1.3× faster.
- **Bug fixes** (8): logical replication reconnection, socket cleanup, Drizzle compatibility, query state management, React Native, backup handling, Docker config, backpressure.
- **Breaking changes: none documented.**

Project status: GA since March 2026. 2026 roadmap: Cloud Zero GA, column permissions, "Terabugs". Soon-but-uncommitted: aggregates, SSR, JSON filters, first-class text search.

---

## 15. Quick-start skeleton for yapm (all pieces, correct API)

```
src/zero/schema.ts     # table(), relationships(), createSchema(), createBuilder() + DefaultTypes.schema
src/zero/queries.ts    # defineQueries({...}) — ONE top-level call
src/zero/mutators.ts   # defineMutators({...}) — ONE top-level call
src/zero/context.ts    # AuthContext type + DefaultTypes.context
src/zero/db-provider.ts# zeroPostgresJS/zeroDrizzle/... + DefaultTypes.dbProvider
app/api/zero/query/route.ts    # handleQueryRequest
app/api/zero/mutate/route.ts   # handleMutateRequest
app/providers.tsx      # 'use client' + ZeroProvider
```

```bash
# .env
ZERO_UPSTREAM_DB="postgres://postgres:pass@localhost:5432/yapm"   # DIRECT connection
ZERO_QUERY_URL="http://localhost:3000/api/zero/query"
ZERO_MUTATE_URL="http://localhost:3000/api/zero/mutate"
ZERO_QUERY_FORWARD_COOKIES="true"
ZERO_MUTATE_FORWARD_COOKIES="true"
ZERO_ENABLE_CRUD_MUTATIONS="false"
ZERO_REPLICA_FILE="/tmp/yapm-replica.db"

# run (alongside your app server on :3000)
npx zero-cache-dev
```

---

## 16. Source index

| Topic | URL |
|---|---|
| Agent docs index | <https://zero.rocicorp.dev/llms.txt> |
| Full docs, single file | <https://zero.rocicorp.dev/llms-full.txt> |
| Introduction | <https://zero.rocicorp.dev/docs/introduction> |
| Install | <https://zero.rocicorp.dev/docs/install> |
| Schema | <https://zero.rocicorp.dev/docs/schema> |
| Queries (synced queries) | <https://zero.rocicorp.dev/docs/queries> |
| Mutators | <https://zero.rocicorp.dev/docs/mutators> |
| ZQL | <https://zero.rocicorp.dev/docs/zql> |
| ZQL on the server | <https://zero.rocicorp.dev/docs/server-zql> |
| Authentication + permission patterns | <https://zero.rocicorp.dev/docs/auth> |
| Connection status | <https://zero.rocicorp.dev/docs/connection> |
| React | <https://zero.rocicorp.dev/docs/react> |
| SolidJS | <https://zero.rocicorp.dev/docs/solidjs> |
| React Native | <https://zero.rocicorp.dev/docs/react-native> |
| REST APIs from mutators | <https://zero.rocicorp.dev/docs/rest> |
| Postgres provider support | <https://zero.rocicorp.dev/docs/connecting-to-postgres> |
| Supported Postgres features / type map | <https://zero.rocicorp.dev/docs/postgres-support> |
| Self-hosting | <https://zero.rocicorp.dev/docs/self-host> |
| zero-cache config (all flags) | <https://zero.rocicorp.dev/docs/zero-cache-config> |
| Previews | <https://zero.rocicorp.dev/docs/previews> |
| Analyze Query CLI | <https://zero.rocicorp.dev/docs/debug/analyze-query-cli> |
| Slow queries | <https://zero.rocicorp.dev/docs/debug/slow-queries> |
| 1.8 release notes | <https://zero.rocicorp.dev/docs/release-notes/1.8> |
| Status / roadmap | <https://zero.rocicorp.dev/docs/status> |
| **zbugs reference app** | <https://github.com/rocicorp/mono/tree/main/apps/zbugs> |
| zbugs schema | `apps/zbugs/shared/schema.ts` |
| zbugs synced queries | `apps/zbugs/shared/queries.ts` |
| zbugs mutators | `apps/zbugs/shared/mutators.ts` |
| zbugs auth/context | `apps/zbugs/shared/auth.ts` |
| zbugs server mutator overrides | `apps/zbugs/server/server-mutators.ts` |
| zbugs dbProvider | `apps/zbugs/server/db.ts` |
| zbugs API server (query + mutate endpoints, JWT) | `apps/zbugs/api/index.ts` |
| zbugs client init | `apps/zbugs/src/zero-init.tsx` |
| zbugs preload | `apps/zbugs/src/zero-preload.ts` |
| `handleMutateRequest` source | <https://github.com/rocicorp/mono/blob/main/packages/zero-server/src/process-mutations.ts> |
| AST schema (custom query endpoints) | <https://github.com/rocicorp/mono/blob/main/packages/zero-protocol/src/ast.ts> |
| Server adapters | <https://github.com/rocicorp/mono/tree/main/packages/zero-server/src/adapters> |
| Live zbugs instance | <https://bugs.rocicorp.dev/> (password: `zql`) |

### Explicitly UNVERIFIED

- **Solid `useQuery` / `ZeroProvider` exact `.d.ts` signatures** — the docs examples above are verbatim, but I read the `.d.ts` only for the React bindings, not `zero-solid`. React types are exact; Solid types are docs-level.
- **`Inspector` API surface** (`zero.inspector`) — exists in 1.8.0 exports; individual methods not enumerated here.
- **`BatchMutator` / `zero.mutateBatch`** — exists in 1.8.0 exports; no docs coverage found, no usage in zbugs.
- **`ZERO_PER_USER_MUTATION_LIMIT_MAX` default** — documented as existing, no default value stated.
- **Cloud Zero specifics** (dashboard, pricing tiers, instance IDs) — docs page is a stub.
- **`drizzle-zero` / `prisma-zero` generator flags** beyond `--output` and the `generator zero {}` block.
- **`useZeroOnline`** — exported from `@rocicorp/zero/react` in 1.8.0; no docs coverage found.
- **`zero-deploy-permissions` / `definePermissions` / `ANYONE_CAN` / `NOBODY_CAN`** — still exported from 1.8.0 for backwards compatibility, but the docs no longer describe a declarative permission system. **Do not use these in new code**; use context-based permissions in your query/mutate endpoints (§4.5, §5.4).
