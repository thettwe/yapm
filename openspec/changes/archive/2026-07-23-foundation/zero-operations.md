# Zero pipeline — operations notes

The walking skeleton proves Postgres → zero-cache → ZQL in the browser and back through a
shared mutator. This file records how the pieces are wired and every Zero misconfiguration
error hit while building it, with the fix, so the next person recognises them instantly.

## Topology

```
Postgres (wal_level=logical)
   │  logical replication slot  (zero-cache creates `zero_0_a`)
   ▼
zero-cache  :4848   ── HTTP ──▶  yapm server /api/zero/query  (handleQueryRequest)
   ▲  WebSocket sync            └─ HTTP ──▶  /api/zero/mutate  (handleMutateRequest → zeroKysely)
   │
browser (IndexedDB replica, @rocicorp/zero/react)
```

- All ZQL and the `renameWorkspace` mutator live in `packages/schema/src/zero`. Client and
  server import the same functions (CLAUDE.md constraint 2).
- The server endpoints are Hono routes (`apps/server/src/zero/routes.ts`), mounted under
  `/api/zero` before the SPA wildcard so route order (not an exclusion list) keeps them live.
- `zeroKysely(schema, db)` runs every mutator inside one real Kysely transaction on the shared
  pool.

## Required environment

Server (`apps/server`):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | The Kysely pool; also what the drift test and mutators write through. |
| `ZERO_QUERY_API_KEY` / `ZERO_MUTATE_API_KEY` | Optional. When set, the endpoint rejects any request whose `X-Api-Key` header does not match — this is the zero-cache → API-server auth. |

Web (`apps/web`, Vite):

| Var | Default | Purpose |
|---|---|---|
| `VITE_ZERO_CACHE_URL` | `http://localhost:4848` | The zero-cache WebSocket/HTTP origin the client connects to. |

zero-cache (dev, run against the same Postgres):

```bash
ZERO_UPSTREAM_DB=postgres://yapm:yapm@localhost:5440/yapm \
ZERO_REPLICA_FILE=/tmp/yapm-replica.db \
ZERO_QUERY_URL=http://localhost:3210/api/zero/query \
ZERO_MUTATE_URL=http://localhost:3210/api/zero/mutate \
ZERO_ENABLE_CRUD_MUTATIONS=false \
ZERO_ADMIN_PASSWORD=devpassword \
pnpm --filter @yapm/schema exec zero-cache
```

`@rocicorp/zero-sqlite3` is a native module; it is in `allowBuilds` in `pnpm-workspace.yaml`
(pnpm 11 blocks postinstall otherwise). `protobufjs` — pulled in transitively — is pinned to
`false` in `allowBuilds`; its postinstall only prints a version-scheme warning, so blocking it
is correct.

## Misconfiguration errors seen while building this (and the fix)

1. **`missing --admin-password: required in production mode`** — zero-cache exits immediately.
   It treats the absence of `NODE_ENV=development` as production and demands
   `ZERO_ADMIN_PASSWORD` (guards `/statz` and the inspector). Fix: always set
   `ZERO_ADMIN_PASSWORD` for zero-cache, even in the dev/compose stack.

2. **`Failed to parse query request: Expected array with length 2. Got array with length 1`**
   — returned (HTTP 200, `kind: "TransformFailed"`) when the `/query` endpoint is probed with
   the wire body `[{id,name,args}]`. The real `/query` wire body is the tuple
   `["transform", [{id,name,args}]]`. `handleQueryRequest` unwraps it; only tests that hand-roll
   the body need to know. Not an error in production — zero-cache always sends the tuple form.

3. **Query name not in the registry** — surfaced as a per-query object
   `{error:"app", id, name, message:"Query not found: <name>"}` inside the `QueryResponse`,
   never a thrown 500. `mustGetQuery`/`mustGetMutator` throw, and `handleQueryRequest`/
   `handleMutateRequest` catch per query/mutation and return the structured error. This is the
   boundary that stops a client widening a query: an unknown name is refused, and a known name
   is re-evaluated server-side with the server's `ctx`, so client-supplied args cannot broaden it.

4. **`Zero was unable to connect for 5 seconds and was disconnected`** (client console,
   `error.type: "zero"`) — a mutation's `write.server` promise rejects with this when the socket
   drops mid-flight. It is **not** an authoritative rejection; the mutation stays queued and
   retries on reconnect. The rename UI only rolls back on `error.type === "app"`; a `zero`
   transport error is left to the connection indicator. Treating it as a rejection wrongly
   reverted an already-applied optimistic edit.

5. **Slow first query: `Slow query materialization (including server/network) … 20000ms`** — the
   very first `useQuery` after a fresh `zero-cache` start can take ~20s while the replica
   hydrates the table. Subsequent reads are instant from IndexedDB. Not a bug; the e2e timeouts
   account for it. On a warm replica it is sub-frame.

## Health

`/readyz` runs a `database` check and a `replication` check (`apps/server/src/health.ts` +
`packages/schema/src/db/replication.ts`). The replication check reads `wal_level` and
`pg_replication_slots`:

- `wal_level` must be `logical`, else it fails with the exact fix (`-c wal_level=logical`).
- **No slot yet is healthy** — the app boots before zero-cache (compose order
  postgres → app → zero-cache), so the slot does not exist until zero-cache first connects.
- A slot with `wal_status = 'lost'` or a null `restart_lsn` fails the check: Postgres has
  invalidated it and zero-cache must resync its replica.

Sample ready output once zero-cache has connected:

```json
{ "name": "replication", "ok": true,
  "detail": "wal_level=logical, slots: zero_0_a (pgoutput, active, wal_status=reserved)" }
```
