# zero-reconnect — design

Every Zero fact below was read out of the **installed 1.8.0 sources** in this worktree
(`node_modules/.pnpm/@rocicorp+zero@1.8.0…/node_modules/@rocicorp/zero/out/**`, whose
`.js.map` files carry `sourcesContent` — the original TypeScript). Paths are given relative
to that package as `out/<path>`; the corresponding original file is named in each citation.
The API-level contract is in [`reference/zero.md`](../../../reference/zero.md) §7.8, §8.4,
§10.4, §13 — read those before touching sync code.

## Context

The bug, as observed by the user against the prod compose on 2026-07-25: after the tab
idles, the authenticated app hangs at "Loading…", the main thread pins ("Page
Unresponsive"), navigating to a team route throws through the React error boundary, and
only a hard refresh recovers. The server is healthy the whole time — `/api/auth/*`,
`/api/zero/token`, `/api/zero/query`, `/api/zero/mutate` all 200. zero-cache logs a
ProtocolError for one client group: `InvalidConnectionRequest: "No validated connection is
available for shared query work."` Some client groups connect fine; one loops. Multiple
tabs make it worse.

Current code: `apps/web/src/zero/provider.tsx` mounts `ZeroProvider` with `auth` from
`/api/zero/token` and re-mints **only** when `useConnectionState().name === 'needs-auth'`;
`fetchSyncSession()` maps every thrown error to `LOGGED_OUT` and has no timeout.
`apps/server/src/zero/routes.ts` hands `handleQueryRequest`/`handleMutateRequest`
`userID: ctx?.userID ?? null` and always answers 200 unless the API key check fails.
The sync JWT lives 1 hour (`SYNC_TOKEN_EXPIRATION` in `apps/server/src/auth.ts`).

Constraints that bind this change: three containers (no new service, no zero-cache fork,
no sidecar); no schema, mutator, or permission change; every color via `--color-*` tokens;
keyboard-first; sub-100ms; Biome; the stack postdates model training, so nothing is written
from memory.

## Goals / Non-Goals

**Goals:**
- The app recovers from *every* reachable broken-sync state without a page reload, under
  bounded backoff, with the CPU idle while it waits.
- A transient request failure never signs a user out and never wedges the app at "Loading…".
- The credential is refreshed **before** it expires, so the common idle case never breaks
  the socket at all.
- Recovery is *visible*: tokenized, keyboard-operable, announced to assistive tech, correct
  in all three presets × light/dark.
- The server obeys Zero's documented rejection protocol, so a stale credential produces a
  recoverable client state instead of tearing down a client group.
- The reconnection path is covered by tests, at the tier that actually exercises it.

**Non-Goals:** see proposal *Non-goals* — no auth-model redesign, no schema/mutator change,
no offline write queue, no zero-cache patch/fork, no new toast system.

## Root cause

### The evidence chain

1. **yapm answers an expired credential with `200 OK` and a null user id.**
   `createSessionContextResolver` (`apps/server/src/zero/context.ts`) returns `undefined`
   when `verifySyncToken` rejects the JWT — which is exactly what happens once the 1h token
   expires. `routes.ts` then calls `handleQueryRequest({… userID: ctx?.userID ?? null })`,
   and `handleQueryRequest` (`out/zero-server/src/queries/process-queries.js.map` →
   `zero-server/src/queries/process-queries.ts`) ends with:

   ```ts
   return {
     kind: 'QueryResponse',
     queries: responses,
     ...(typeof args.userID !== 'undefined' ? {userID: args.userID} : {}),
   }
   ```

   So the wire response is `200 {kind:'QueryResponse', queries:[…], userID: null}`.

2. **zero-cache reads that as an authoritative "the server says this socket belongs to
   nobody".** `CustomQueryTransformer.#requestTransform`
   (`zero-cache/src/custom-queries/transform-query.ts`) maps a present `userID` field to
   `{kind:'server-validated', validatedUserID: transformResponse.userID}` — `null` is a
   *value*, not "unknown". `ConnectionContextManagerImpl.validateConnection`
   (`zero-cache/src/services/view-syncer/connection-context-manager.ts`) then does:

   ```ts
   if (connection.user.id !== validatedUserState.id) {
     throw new ProtocolErrorWithLevel({kind: ErrorKind.Unauthorized,
       message: 'Connection userID does not match validated server userID.', …}, 'warn')
   }
   ```

3. **That failure *removes* the connection from the group.** `#validateConnection`
   (`zero-cache/src/services/view-syncer/view-syncer.ts`) catches it, sees
   `isAuthErrorBody`, and calls `#failMaintenanceConnection` → `failConnection` →
   `#removeConnection`. The group's `backgroundConnection` is recomputed; with no other
   `validated` connection it becomes `undefined`.

4. **The next piece of shared background work then throws the observed error.** Two paths
   in `view-syncer.ts` take the *background* context (`connCtx === undefined`):
   - the run loop's pipeline (re)initialisation — `#hydrateUnchangedQueries(lc, cvr)`
     followed by `#syncQueryPipelineSet(lc, cvr, 'missing', undefined, driftedQueryIDs)`;
   - `#removeExpiredQueries` — the TTL eviction timer — `#syncQueryPipelineSet(lc, cvr,
     'missing', undefined)`.

   Both resolve their context with
   `connCtx ?? this.connContextManager.mustGetBackgroundConnectionContext()`, and that
   method's only failure mode is, verbatim:

   ```ts
   throw new ProtocolErrorWithLevel({
     kind: ErrorKind.InvalidConnectionRequest,
     message: 'No validated connection is available for shared query work.',
     origin: ErrorOrigin.ZeroCache,
   }, 'warn')
   ```

   — the exact string in the user's logs.

5. **That error is fatal for the whole client group.** It propagates out of
   `#runInLockWithCVR` inside the `for await (… of this.#stateChanges)` loop, into `run()`'s
   `catch`, into `await this.#cleanup(e)`, which does `for (const client of
   this.#clients.values()) { … client.fail(err) }`. Every client on the view-syncer — not
   just the one with the bad token — is failed with `InvalidConnectionRequest`.

6. **The client parks in `error` and stays there.** `getErrorConnectionTransition`
   (`zero-client/src/client/error.ts`) maps `ErrorKind.InvalidConnectionRequest` →
   `ConnectionStatus.Error`; the run loop then *awaits a state change* and only
   `zero.connection.connect()` can resume it (`zero-client/src/client/connection.ts`, and
   `reference/zero.md` §13: *"Auth errors need a manual reconnect — Zero will not retry out
   of `needs-auth` or `error` by itself"*). `SyncAuthRefresher` only fires on `needs-auth`,
   so nothing ever calls it. The app is dead until a reload.

### Verdict: primarily yapm's fault, with a Zero 1.8 fragility amplifying it

**yapm's bug** — and therefore fixed here — is step 1. `reference/zero.md` §10.4 states the
contract plainly: *"Return **401 or 403** from `/query` or `/mutate` to mark unauthorized …
Zero disconnects and moves to `needs-auth`."* A 401 produces
`TransformFailed{reason: HTTP, status: 401}`, which `isAuthError`
(`zero-client/src/client/error.ts`) classifies as an auth error → `needs-auth` → recoverable
by `connect({auth})`, *and* leaves the connection's validation state untouched rather than
asserting a contradictory identity. yapm instead asserts "this socket belongs to `null`",
which is a protocol violation, and it is that assertion — not the expiry — that strands the
client group.

**The genuine Zero 1.8 fragility** — documented, not fixed here (fixing it means patching
the zero-cache image, which the three-container constraint forbids):

- A single `mustGetBackgroundConnectionContext()` throw takes down the **entire
  view-syncer** for the client group (step 5), rather than deferring the background work
  until a validated connection exists. Compare `#runBackgroundRetransform`, which handles
  the same situation gracefully with the *non-throwing* `getBackgroundConnectionContext()`
  and logs `'Skipping background retransform with no selected connection'` — the safe
  pattern exists in the same file; the two `mustGet…` call sites do not use it.
- The window where a group has zero `validated` connections is not rare. Connections are
  registered `provisional`; `initConnection` and any `updateAuth` with a changed token call
  `#demoteConnection` back to `provisional`; and promotion happens **only** via an
  *uncached* custom-query transform — `#syncQueryPipelineSet` calls `validateConnection`
  under `if (!transformedCustomQueries.cached)`, and `CustomQueryTransformer.transform`
  short-circuits to `{cached: true}` when every query hits its 5s `TimedCache` or when the
  request list is empty. `planMaintenance` only schedules revalidation for connections
  already in `state === 'validated'`, so a provisional connection is never rescued by
  maintenance.
- Consequence for us: `ZERO_AUTH_REVALIDATE_INTERVAL_SECONDS` would **not** help (it
  revalidates already-validated connections only) and would add load and more failure
  points. We do not enable it. Recorded here so nobody "fixes" it that way later.

Because that window remains reachable for reasons outside yapm's control (a browser waking
several tabs at once re-registers several provisional connections while replication ticks),
**client-side recovery is load-bearing even after the server fix** — which is why this
change ships both halves.

### Why it presents as "Loading…" + a pinned main thread

`Authenticated` renders "Loading…" while `useSyncSession().status === 'pending'`, and
`fetchSyncSession()` has **no timeout**: a fetch issued while the machine is still waking
can hang far longer than any human waits, so the gate never resolves. Separately, once Zero
is in `error`, every `useQuery` on the route resolves against an errored client — the team
routes throw through the error boundary, as reported. We do not claim to have profiled the
exact CPU-pinning loop in the user's session; the fix removes all three of its preconditions
(the terminal `error` state, the unbounded retry, the never-settling gate), and the
reconnection e2e asserts the recovered end state rather than a CPU metric. Recorded as an
open question below.

## Decisions

### 1. Server: 401 only when a credential is *presented and rejected*

`resolveContext` grows a three-way result — `authenticated` / `absent` / `rejected` — and
`/api/zero/query` + `/api/zero/mutate` return `401 {error: 'unauthorized'}` for `rejected`
before calling into Zero's handlers. `absent` keeps today's `200 + userID: null`.

*Why not 401 for `absent` too:* a socket with no credential also claims no user
(`connection.user.id === null`), so `server-validated: null` matches and nothing breaks;
answering 401 there would push a legitimately logged-out client into a `needs-auth` loop
before sign-in. The asymmetry is the point — "you gave me nothing" and "you gave me
something invalid" are different facts, and today's code destroys that distinction.

*A resolver that throws* (e.g. the role lookup fails because Postgres is briefly down) keeps
producing a 500. That is honest — it is a server fault, not an auth fault — and the client's
new recovery loop handles it with backoff. Deliberately not converted to a 401.

### 2. Client: one recovery state machine, one owner

A single `SyncRecovery` component mounted inside `<ZeroProvider>` (where `useZero()` and
`useConnectionState()` are both available) owns every re-mint. `SyncAuthRefresher` is folded
into it; `useSyncControl().refresh()` keeps its existing contract for membership changes and
delegates to the same scheduler, so a role change and a reconnect can never race two
in-flight token fetches.

Per state:

| Zero state | Action |
|---|---|
| `connected` | reset backoff to base; cancel any pending retry |
| `connecting` | do nothing — Zero is already retrying every 5s |
| `needs-auth` | re-mint, then `connect({auth})`, on backoff |
| `error` | re-mint, then `connect({auth})`, on backoff |
| `disconnected` | after a 20s grace, re-mint on backoff so Zero's own retry carries a fresh credential; **never** call `connect()` |
| `closed` | terminal — nothing to do (only reachable via `zero.close()`) |

`disconnected` is deliberately different because `Connection.connect()` documents (and the
1.8.0 source confirms) *"This method does not reconnect from `disconnected` or `closed`"* —
`ConnectionImpl.connect` sets the new auth token and then returns early unless
`isInTerminalState()`. Setting the token is still worth doing: Zero's own 5s retry then
presents a valid credential. The 20s grace keeps an ordinary brief network dip from
generating token traffic.

**The subtle part, logged because it is exactly the class of bug being fixed:** changing the
`auth` prop is how `ZeroProvider` reconnects (§7.4: *"changing the auth token will cause
ZeroProvider to call connection.connect"*), but if the re-minted JWT is **byte-identical** to
the current one — plausible, since better-auth may return a cached token inside its validity
window — the prop does not change and the provider does nothing, leaving the client parked
forever. So `SyncRecovery` compares the new token to the current one and, when they are
equal *and* the state is terminal, calls `zero.connection.connect()` itself.

*Alternative rejected:* recreating the `Zero` instance (dropping and re-adding `auth`, or
changing `userID`) to force a reconnect. It re-opens IndexedDB and re-hydrates every query —
seconds of blank UI, and a violation of the sub-100ms spirit — to solve something
`connect()` already solves.

### 3. Backoff: 1s base, ×2, 30s cap, full jitter, reset on `connected`

`delay = random() * min(cap, base * 2 ** attempt)`, with `base = 1_000`, `cap = 30_000`,
attempts unbounded, the counter reset the moment the state reaches `connected` (or a manual
Retry succeeds). Full jitter (rather than none, or ±20%) because the failure mode is
correlated across tabs and users — several tabs waking together is one of the aggravating
factors in the report — and full jitter is what actually decorrelates a thundering herd.

Unbounded attempts, capped delay: a self-hosted instance may legitimately be down for a
deploy, and the app must come back on its own when it returns. The cap is what turns the
hot loop into a 30s poll, which is the actual user-visible fix. The **Retry now** button
(decision 5) is the escape hatch for someone who does not want to wait out a 30s window.

We are not fighting Zero's internal `RUN_LOOP_INTERVAL_MS = 5_000`: that governs
`connecting`/`disconnected` retries, which we leave alone. Our schedule only ever fires from
states where Zero has stopped retrying, plus the throttled `disconnected` re-mint.

### 4. Session fetch: three outcomes, a timeout, and a memory

`fetchSyncSession()` returns
`{kind:'session', …} | {kind:'no-session'} | {kind:'unavailable', reason}`:

- `no-session` **only** for HTTP **401 or 403** — the endpoint's documented answer for "no
  session" (`requireSession` returns 401). This is the only outcome that produces
  `LOGGED_OUT` and a redirect to `/login`.
- `unavailable` for a thrown fetch error, an abort/timeout, any other non-OK status
  (5xx, 404, a proxy's 502), or a 200 with a malformed body. The previous session is
  **kept**, and the recovery scheduler retries on the same backoff.
- `AbortSignal.timeout(10_000)` on the request, so a hung socket can never wedge the gate.

While `status === 'pending'` and attempts keep coming back `unavailable`, `Authenticated`
stops rendering a bare "Loading…" after the first failure and renders the same
`role="status"` + **Retry now** surface as the header pill (decision 5). Losing the
distinction between "not signed in" and "cannot reach the server" is what makes today's
failure look like a logout; keeping it is the whole fix.

### 5. Proactive refresh: driven by the token's own expiry

`/api/zero/token` additively returns `expiresAt` (epoch seconds), read from the JWT it just
minted via the existing local `verifySyncToken` JWKS path — no new dependency, no hardcoded
duplicate of `SYNC_TOKEN_EXPIRATION`. The client schedules a re-mint at **75% of the
remaining lifetime**, clamped to `[60s, 30min]` (so ≈45min on today's 1h token), and also
re-mints on `visibilitychange → visible` and on `online` when more than half the lifetime
has elapsed — timers do not fire faithfully across a laptop sleep, which is precisely the
scenario in the report. If `expiresAt` is absent (an older server behind a newer client), it
falls back to a fixed 45-minute timer.

Refresh is deliberately *lazy*, not aggressive: every changed token triggers `updateAuth` on
zero-cache, which **demotes that connection to `provisional`** (see Root cause) — so
needless re-minting would widen the very window that makes the group fragile. One refresh
per token lifetime, plus wake-ups, is the balance.

### 6. The reconnecting UI lives on the connection pill that already exists

`ConnectionStatus` is already rendered by `AppShell` on every authenticated surface and is
already `role="status"` with a `data-connection` hook the e2e suite uses. It becomes the
recovery surface rather than growing a second, competing one:

- Labels driven by the recovery state, not just Zero's: `Connected`, `Reconnecting…`,
  `Offline — retrying`, `Sign-in expired — reconnecting`, `Sync error — retrying`.
- The status text sits in an `aria-live="polite"` region so a screen reader hears the
  transition; the detail string stays in the existing `sr-only` span.
- Once the scheduled delay reaches the top of the range (or recovery has been failing for
  >15s), a real `<button>` **Retry now** appears in the pill: Tab-reachable, Enter/Space
  activated, no pointer required; it fires the attempt immediately and resets the schedule.
- `data-connection` keeps its current values and a new `data-recovery` attribute
  (`idle | retrying | waiting`) is added for tests, so no existing e2e assertion changes.
- The hardcoded `bg-emerald-500` / `bg-amber-500` dots are replaced with
  `bg-status-done` / `bg-status-in-progress` / `bg-status-urgent` / `bg-muted-foreground`.
  Fixing an existing token violation in a file this change already rewrites is cheaper than
  leaving it; it also makes the new state correct in all three presets × light/dark.

*Alternative rejected:* a full-width banner or a toast stack. DESIGN.md's restraint thesis
(*"show the one right signal — not more chrome"*) and the fact that a global toast system
does not exist yet and is not worth introducing for one state.

### 7. Test tiers — the honest PROCESS.md §3 judgement

The big-feature rule needs **≥2 of** {synced entity/schema, mutator, permission surface,
signature UI}. This change touches **none** of the first three — no table, no migration, no
mutator, no query predicate, no role check — and the connection pill is not a signature
surface (those are the issue row, board, and command palette). So by the letter of the rule
this is a **small change: unit + integration**.

It nonetheless ships **one** e2e, because the entire reason this bug reached production is
that no test ever exercised a *second* connection attempt — the smoke test and all nine
existing specs assert one fresh happy-path connection. A regression test that lives at the
unit tier cannot catch a reconnect that the real stack refuses. So: unit + integration +
exactly one targeted `reconnect.spec.ts`, not the full big-feature tier, and no reflexive
e2e for anything else in this change.

- **Unit** (Vitest, no DB): the backoff schedule (base/factor/cap/jitter bounds, reset on
  `connected`), the per-state action table, the identical-token `connect()` fallback, and
  the `session`/`no-session`/`unavailable` classifier including timeout and malformed body.
- **Integration** (Vitest, live Postgres): `/api/zero/query` and `/api/zero/mutate` return
  401 for a presented-but-invalid bearer, 200 + `userID: null` for an absent one, and 200
  with the verified subject for a valid one; `/api/zero/token` returns a plausible
  `expiresAt`.
- **E2E** (Playwright): the connection drops, the pill announces reconnecting, recovery
  completes **without a page reload** (asserted via a page-lifetime sentinel), and a failing
  `/api/zero/token` (injected with `page.route`) leaves the user signed in on a retry
  surface instead of bouncing to `/login`.

## Risks / Trade-offs

- **The Zero 1.8 view-syncer teardown remains reachable** (a fatal `ProtocolError` from
  `mustGetBackgroundConnectionContext()` fails every client in the group) → client recovery
  now escapes it within ~1s, and the server fix removes the dominant way yapm creates the
  precondition. Documented above with source citations so a future upgrade can check whether
  Zero switched those two call sites to the non-throwing variant.
- **Returning 401 changes behavior for a class of requests that currently 200** → the change
  is narrowly scoped to *presented-and-rejected* credentials, integration-tested on all
  three cases, and it is what `reference/zero.md` §10.4 prescribes. The logged-out path is
  explicitly unchanged.
- **A wrong recovery loop could hammer `/api/zero/token`** → the cap bounds the worst case
  to one request per 30s per tab, refreshes are single-flighted through one scheduler
  (`useSyncControl().refresh()` included), and the unit tests assert the schedule.
- **Proactive refresh briefly demotes the zero-cache connection to `provisional`** → keep it
  lazy (once per token lifetime + wake-ups), never on a short interval.
- **`expiresAt` is a new field on a response the client parses** → additive and optional;
  the client falls back to a fixed timer when it is missing, so a version-skewed deployment
  degrades rather than breaks.
- **A reconnection e2e can be flaky** → it asserts observable end states with generous
  timeouts (the existing offline spec already does this successfully) and never asserts
  wall-clock timing of the backoff, which is unit-tested instead.

## Migration Plan

No migration. No schema change, no new env var, no compose change. Deploy is a normal image
roll: the server fix is backward compatible with an old client (a 401 sends it to
`needs-auth`, where even today's `SyncAuthRefresher` re-mints), and the new client is
backward compatible with an old server (missing `expiresAt` → fixed-timer fallback).
Rollback is reverting the commit; nothing persists.

## Open Questions

- **Exactly which loop pinned the main thread.** The reported symptom is consistent with an
  errored Zero client plus a never-settling auth gate, but we have not profiled the user's
  session. If a pinned thread survives this change, the next step is a `logSink` capture of
  the client run loop rather than more speculation.
- **Does better-auth's `getToken` return a cached JWT inside its validity window?** Decision
  2 handles both answers (identical token ⇒ explicit `connect()`), so this is an efficiency
  question, not a correctness one. Worth confirming while implementing.

## Decisions made during implementation

### C1. Every re-mint was silently destroying and rebuilding the Zero client

Not anticipated by the design, and the more expensive half of the bug. `ZeroProvider`'s
construction effect (1.8.0 `zero-react/src/zero-provider.tsx`, read from
`out/zero-react/src/zero-provider.js.map`) has this dependency array:

```ts
const keysWithoutAuth = useMemo(
  () => Object.entries(props).filter(([key]) => key !== 'auth')
    .sort(([a], [b]) => stringCompare(a, b)).map(([_, value]) => value),
  [props],
)
useEffect(() => { … new Zero({…props}) … return () => { void z.close() } },
  [hasAuth, init, rotationGeneration, ...keysWithoutAuth])
```

Every non-`auth` option is compared **by value identity**. `context` was
`{ userID, role: asRole(data.role) }` — a fresh object on every token fetch — so each
re-mint changed a dependency, closed the Zero instance, reopened IndexedDB and rehydrated
every query. That is why the design's *"alternative rejected: recreating the Zero
instance"* was in fact what already happened on every `useSyncControl().refresh()`.

`context` is now memoized on `[userID, role]`, so a re-mint that keeps the same identity and
role changes **only** `auth`, which is the in-place `connect({auth})` path. All the other
options are module constants or primitives. Recorded here because nothing in the type system
prevents someone from reintroducing an inline object literal in `options`.

### C2. The recovery effect must not depend on the Zero instance's identity

The first run of `provider.test.tsx` did not fail — it exhausted the V8 heap after 193
seconds. The mocked `useZero()` returned a fresh object per call, `zero` was in the
scheduler effect's dependency array, and the effect's `setStatus` re-rendered: effect →
render → effect, forever. A hot loop, produced by the code written to remove a hot loop.

The mock is unrealistic, but the coupling was real and the fix is unconditional: `zero` (and
the current token) are read through refs, and the dependency array is only
`[name, request, enabled, remint]` — all primitives or stable callbacks. The mock is left
deliberately churning as a standing regression guard, with a comment saying so. Every
`setStatus` in a non-scheduling branch was also made idempotent (returns `current` when
nothing changed) so no future dependency mistake can spin.

### C3. `retryNow` reuses the scheduling path with a zero delay

Rather than a second, separately-tested "immediate attempt" code path, **Retry now** resets
the attempt counter and schedules the normal attempt with `delayMs === 0`. One path, one set
of invariants. The unit test asserts a zero-length timer window is enough, which is the
observable meaning of "immediate".

### C4. A settled-request counter, so a failed proactive refresh reschedules itself

The proactive timer is keyed on the credential. An `unavailable` outcome changes no
credential field, so the timer would not have been re-armed and proactive refresh would
silently stop for the rest of the token's life. `SyncSessionRecord` carries a `revision`
counter bumped by every settled request; the timer effect depends on it, and re-arms at
`proactiveRefreshDelay(expiresAt, now)` — never below the 60s floor.

### C5. Recovery is disabled while the session is `logged-out`

`ZeroProvider` is mounted on the login page too, with `auth: null`. Running the scheduler
there would poll `/api/zero/token` on backoff for a user who is deliberately signed out. The
machine is gated on `status !== 'logged-out'`; the initial credential still comes from
`ZeroRoot`'s mount effect, so the login → app transition is unaffected.

### C6. A state the machine will act on reads as "recovering" immediately

React passive effects run after paint, so a strict `phase !== 'idle'` test would paint one
frame of "Sync error" and announce that dead end to a screen reader before the first retry
was scheduled. `summarizeConnection` therefore treats a state whose `recoveryPlan` is a
re-mint as recovering regardless of phase. The phase still decides the only genuinely
ambiguous case — `connecting` is "Connecting" on a first connect and "Reconnecting…" once
an attempt has been made.

### C7. `expiresAt` and the 401 protocol are consumed optionally

This phase ships the client only. `expiresAt` is absent from `/api/zero/token` until the
server phase lands, so the client falls back to the fixed 45-minute timer — the
version-skew path the design already required, now the live path until then. Likewise the
`error`-state recovery does not depend on the server returning 401; the 401 work makes the
common case take the cheaper `needs-auth` route.

### C8. `DOMException` is not reliably `instanceof Error`

`AbortSignal.timeout` rejects with a `DOMException`, which under this jsdom did not satisfy
`error instanceof Error`, so the abort reason fell through to a generic string. The
classification was never wrong (both are `unavailable`), but the reason is diagnostic, so it
is now read structurally from `.name`. Caught by the unit test, noted because the same
assumption appears elsewhere in web code.

### C9. The `disconnected` grace floors every attempt, not only the first

The design says *"after a 20s grace, re-mint on backoff"*, which read literally means attempt
0 waits 20s and attempt 1 waits ~2s — a **tighter** cadence than the grace was meant to
establish. Since Zero is already retrying every 5s while `disconnected`, the re-mint exists
only to have a fresh credential ready, so the grace is applied as a floor on every attempt:
`delay = max(graceMs, backoffDelay(attempt))`. `needs-auth` and `error` have `graceMs === 0`,
so their schedule is unchanged, and this removed a special case rather than adding one.

### C10. The single-flight slot is cleared on rejection as well as fulfilment

`fetchSyncCredential` is total by construction, but if a rejection ever escaped it, the
in-flight slot would stay occupied and every later `remint()` would return the same rejected
promise — recovery permanently disabled, which is a worse version of the reported bug. Both
settlement paths clear the slot and record an `unavailable` outcome.

### C11. Pill markup: `data-*` moved out to a wrapper, `role="status"` kept where it was

`data-testid="connection-status"` and `data-connection` now sit on a wrapping `<div>` with
`data-recovery`, and the announced text keeps `role="status"` (plus an explicit
`aria-live="polite"`) on the inner `<p>`. This keeps **Retry now** out of the live region —
a button inside it would be re-announced on every state change — while leaving all nine
existing e2e `data-connection` assertions untouched.
