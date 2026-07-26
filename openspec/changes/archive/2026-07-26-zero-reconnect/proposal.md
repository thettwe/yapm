## Why

**The authenticated app freezes after idling** (confirmed against the prod compose, 2026-07-25): the tab hangs at "Loading…", the main thread pins, team routes throw through the React error boundary, and only a hard refresh recovers — while the server stays healthy (auth/token/query/mutate all 200). This is a P1 against VISION #1 (*it just works on your own server*) and constraint #9 (*sub-100ms interactions*): the single most common real-world interaction — coming back to a tab you left open — is the one yapm gets wrong.

The mechanism has two halves, and both are yapm's:

1. **The server answers an expired credential with `200 OK`.** `apps/server/src/zero/routes.ts` passes `userID: ctx?.userID ?? null` into `handleQueryRequest`; when the forwarded JWT has expired, `createSessionContextResolver` returns `undefined`, so the endpoint replies `200 {kind:'QueryResponse', userID: null}`. zero-cache reads that as `{kind:'server-validated', validatedUserID: null}`, compares it to the websocket's claimed userID, and throws `Unauthorized` — killing and *removing* that connection instead of taking the documented `needs-auth` path a `401` would have produced. The client group is then left with **zero validated connections**, and the next piece of shared background work (`#hydrateUnchangedQueries` / `#syncQueryPipelineSet(…, undefined)` on pipeline re-init, or the TTL expire timer) calls `mustGetBackgroundConnectionContext()`, which throws exactly the observed `InvalidConnectionRequest: "No validated connection is available for shared query work."` — a fatal error that runs `#cleanup(e)` and **fails every client on that view-syncer**. Reference `zero.md` §10.4 is explicit: *"Return **401 or 403** from `/query` or `/mutate` to mark unauthorized."* yapm does not.

2. **The client can never escape.** `InvalidConnectionRequest` maps to Zero's `error` state, which is terminal — *"Zero will not retry out of `needs-auth`/`error` by itself"* (`zero.md` §13). `apps/web/src/zero/provider.tsx`'s `SyncAuthRefresher` re-mints the token **only** on `needs-auth`, so `error` and a stale `disconnected` never trigger a refresh, and there is no backoff anywhere. Compounding it, `fetchSyncSession()` maps *any* thrown fetch error to `LOGGED_OUT` and has no timeout — so a network blip during reconnect either bounces a signed-in user to `/login` or wedges `Authenticated` at "Loading…" forever.

CI missed all of it because the compose smoke test and every e2e spec exercise exactly one fresh, happy-path connection. Closing that gap is part of this change.

## What Changes

- **Server: honour Zero's rejection protocol.** `/api/zero/query` and `/api/zero/mutate` return **401** when an `Authorization: Bearer` credential is *presented but fails verification*, instead of `200` with a null user id. An **absent** credential keeps the current `200 + userID: null` (the genuine logged-out case, where the connection also claims no user, so nothing mismatches). This converts the idle-expiry case into `TransformFailed(HTTP 401)` → the client's recoverable `needs-auth`, and stops stranding the client group without a validated connection.
- **Client: recover from every non-terminal-for-us state.** A `SyncRecovery` component inside `ZeroProvider` drives recovery from `error` and `needs-auth` (re-mint the token, then `zero.connection.connect({auth})`) and from a lingering `disconnected` (re-mint so Zero's own 5s retry carries a fresh credential — `connect()` is documented not to reconnect from `disconnected`), under **exponential backoff with full jitter (1s base, ×2, 30s cap)** that resets on `connected`. A persistent server-side fault degrades to a calm 30s poll instead of a CPU-pinning hot loop.
- **Client: never log a user out on a failed request.** `fetchSyncSession()` returns a discriminated result — `session` / `no-session` (**only** an HTTP 401/403) / `unavailable` (thrown error, timeout, 5xx, malformed body). Only `no-session` routes to `/login`; `unavailable` keeps the last known session and retries on the same backoff. A 10s `AbortSignal.timeout` stops a hung fetch from wedging the app at "Loading…".
- **Proactive token refresh.** `/api/zero/token` additively returns `expiresAt`; the client re-mints at 75% of the remaining lifetime (clamped 60s–30min) and on `visibilitychange → visible` / `online` past half-life — so the credential is fresh *before* the socket ever breaks, which is what turns a long idle into the freeze today.
- **A visible, keyboard-accessible reconnecting state.** The existing header `ConnectionStatus` pill becomes a polite live region that reports `Reconnecting…` / `Offline — retrying` / `Sign-in expired — reconnecting` and, once backoff stretches, exposes a focusable **Retry now** button that fires immediately and resets the schedule. `Authenticated`'s indefinite "Loading…" becomes the same actionable state. All colors move from hardcoded `bg-emerald-500`/`bg-amber-500` to `--color-status-*` tokens, so it is correct in all three presets × light/dark.
- **Close the CI gap**: unit tests for the backoff/recovery state machine and the session-result classifier, integration tests for the 401-vs-200 endpoint contract, and a reconnection e2e that drops the connection, asserts the visible reconnecting state, and asserts recovery **without a page reload**.

## Capabilities

### New Capabilities

None. This change adds no entity, mutator, permission surface, or synced query.

### Modified Capabilities

- `local-first-sync`: reconnection and recovery behavior becomes normative — the client SHALL recover from `error`/`needs-auth`/stale `disconnected` under bounded exponential backoff, the reconnecting state SHALL be visible and keyboard-operable, and the sync endpoints SHALL reject a presented-but-invalid credential with 401 rather than a 200 carrying a null user id.
- `authentication`: sync-token issuance gains an expiry hint and a proactive pre-expiry refresh; a *failed* token request SHALL be retried, never treated as "signed out"; and the server auth context requirement now distinguishes an **absent** credential (no authority, 200) from an **invalid/expired** one (401).

## Impact

- **Server** (`apps/server`): `src/zero/routes.ts` gains credential-presence/validity classification before `handleQueryRequest`/`handleMutateRequest`; `src/zero/context.ts` reports *why* there is no context (absent vs rejected); `src/auth.ts` + `src/auth-routes.ts` return `expiresAt` alongside `token`/`userID`/`role`.
- **Web** (`apps/web`): `src/zero/provider.tsx` (recovery state machine, discriminated session fetch, proactive refresh scheduling), `src/zero/connection.ts` (recovery-aware summary), `src/components/connection-status.tsx` (live region, Retry now, tokenized dots), `src/components/authenticated.tsx` (actionable unreachable state).
- **Schema / migrations / Zero schema**: none. **Dependencies**: none. **Containers**: still three. One optional env var, `ZERO_LOG_LEVEL`, added by the review fix pass: zero-cache's own log level, forwarded by both compose files (default `info`) so an operator can raise it while diagnosing a connection that will not settle. It is not app config — the app's Zod env schema is unchanged.
- **API**: `/api/zero/token` response gains `expiresAt` (additive). `/api/zero/query` and `/api/zero/mutate` gain a 401 response for an invalid presented credential.
- **CI**: the existing `e2e` job picks up a new `reconnect.spec.ts`; no new job, no new service.

Docs (`apps/docs`): a new self-hosting page **Sync connection & recovery** (`self-hosting/sync-recovery.md`, added to the Starlight sidebar) covering the connection states a user can see, the automatic re-mint + backoff behavior, the 1h sync-token lifetime, and what to check when it stays reconnecting (zero-cache logs, `ZERO_QUERY_URL` reachability, clock skew); `pnpm --filter @yapm/docs build` passes. Root docs: `ROADMAP.md` (a maintenance row for this change), `reference/zero.md` (the harvested-from-source facts this change is built on: the `/query` validation round trip, the background-connection requirement, `connect()`'s terminal-state rule), `PROCESS.md` (the e2e tier explicitly covers reconnection/recovery), and `README.md` only where it becomes stale. `.env.example` gains the optional `ZERO_LOG_LEVEL` passthrough described above, added by the review fix pass and documented on the sync-recovery page. No `TECHSTACK.md` change — no version change.

## Non-goals

- **Redesigning the auth model.** better-auth, the session/JWT split, the 1h sync-token lifetime, roles, and the access gate all stay as they are.
- **Changing the Zero schema, any entity, mutator, or permission predicate.** Zero rows, migrations, and the drift test are untouched.
- **Offline write queueing beyond what exists.** Zero rejects writes while disconnected; yapm keeps surfacing that and holding user input in the editing surface. No local write queue.
- **Patching, forking, or pinning off zero-cache.** The residual Zero 1.8 fragility (one fatal `ProtocolError` tearing down the view-syncer for a whole client group) is documented in `design.md` with source evidence and mitigated client-side, not worked around by forking the image or adding a service.
- **A new global toast/modal system.** The reconnecting state rides the connection pill that is already on every app-shell surface — DESIGN.md's restraint, not new chrome.
