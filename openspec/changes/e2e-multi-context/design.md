# Design — a deterministic Playwright suite, taken from the multi-client end

## Context

The end-to-end tier is the only one that can prove keyboard flows, multi-client sync convergence and
reconnection (PROCESS.md §3). It runs on every PR: `fullyParallel: false`, `workers: 1`,
`retries: 1`, `timeout: 60_000`, ~20 minutes. It fails on first attempt often enough that re-running
is a habit, which is the failure mode that matters — a gate nobody believes is not a gate.

### What the previous attempt established, and what it did not

PR #41 (`feat/e2e-isolation`, open, unmerged) built a per-test database reset on the theory that
specs poison each other through a shared, ever-growing workspace. It is honest about the outcome and
the numbers below are lifted from it and from the owner's comment on it. **They are inherited
evidence, not this change's own measurements**, and are labelled as such.

| Run | Tree | Result |
|---|---|---|
| CI 31274936160 | `main` | 1 failed (`projects.spec.ts:188`), 22.4m |
| CI 31274716121 | PR #41 | 2 failed (`projects.spec.ts:188`, `retro.spec.ts:236`), 22.4m |
| CI 31276211088 | PR #41 | 1 failed (`projects.spec.ts:242`), 18.2m |
| local, one spec | `main`, ×2 | 2 of 5 failed, 2.3m, **identical both times** |
| local, one spec | PR #41 | 4 of 5 failed, 4.6m |

Four findings from that work are load-bearing here and are **kept**:

1. **`Target.disposeBrowserContext` is absent from current runs.** Counted in the raw job logs of
   three CI runs: 0 occurrences on `main` and 0 on the branch. What appears instead is Playwright's
   own benign `browserContext.close: Test ended.` The protocol error in the original brief is from
   an older run and cannot be the subject.
2. **The failures are wall-clock exhaustion, never a disagreeing assertion.** Every one is
   `Test timeout of 60000ms exceeded`, and CI run 1's died *inside* `goToMore`, waiting for the
   `Projects` menuitem to appear.
3. **A browser log from a failing run showed ~50 `[vite] connected.` messages in 95 seconds.** One
   such message is printed per page load. A test that navigates three times does not load fifty
   pages. Something was reloading the page under the test.
4. **Isolation alone did not fix it.** First-attempt pass rate 0/2 before and 0/2 after. The
   accumulation defect was real and was fixed; it was not this defect.

Finding 3 is the thread this change pulls.

### The mechanism this change was written to prove or kill

`@rocicorp/zero@1.8.0` ships `out/zero-client/src/client/reload-error-handler.js`. Read in
`node_modules`, not from memory:

```js
function reloadWithReason(lc, reload, reason, message) { … lc.error?.(reason, "\n", "reloading", …) }
```

and in `out/zero-client/src/client/zero.js`:

```js
const onUpdateNeededCallback = (reason) => {
  if (onUpdateNeeded) onUpdateNeeded(reason);
  else reloadWithReason(this.#lc, this.#reload, reason.type, updateNeededReloadReasonMessage(reason));
};
this.#onClientStateNotFound = (kind, message) => {
  if (onClientStateNotFound) onClientStateNotFound();
  else reloadWithReason(this.#lc, this.#reload, kind, message);
};
```

`apps/web/src/zero/provider.tsx` passes `schema`, `mutators`, `cacheURL`, `userID`, `auth`,
`context`, `kvStore` and `disconnectTimeoutMs` — **neither handler**. So on `UpdateNeeded`
(`SchemaVersionNotSupported`, `VersionNotSupported`, `ClientNotFound`) or `ClientStateNotFound`, the
library calls `location.reload()` on a `sessionStorage`-backed backoff that starts immediately and
doubles to a 60s ceiling.

A page that reloads under a running test destroys every locator the test is waiting on and fails no
assertion. That is exactly the observed signature, and it is exactly what finding 3 recorded.

**Reproduced on demand while writing this proposal** (Node 24.19.0 — installed for the purpose,
because the repo pins 24 and this machine's default is 26 — against `docker-compose.dev.yml` with
`YAPM_HOST_PORT=3210`):

```
[vite] (client) [console.error] clientID=bck3fv8ugtb35r7ej9 wsid=… runLoopCounter=5 Failed to connect
  {"name":"ProtocolError","message":"The \"attachment\" table does not exist or is not one of the
   replicated tables: …"} SchemaVersionNotSupported {"lmid":0,"baseCookie":null}
[vite] (client) [console.error] clientID=bck3fv8ugtb35r7ej9 SchemaVersionNotSupported
 reloading in 0.735 seconds
```

Result: **5 of 5 `projects.spec.ts` tests failed**, all on `Test timeout of 60000ms exceeded`, none
on an assertion. The CI failure shape, produced deliberately, from a client that reloads itself.

**The confound, stated plainly.** Those runs were taken while a *different worktree* on the same
machine held port 3210 with its own server process (`/Users/thettwe/Works/yapm-wt/inbox`, Node 26),
which `reuseExistingServer: !process.env.CI` silently attached to; a later run against that foreign
server failed all five tests on `alert: Invalid origin` instead. So the reload observation is real —
the console lines above are verbatim — but the *count* of failures from it is not a clean
measurement and is not offered as one. See D9.

That particular trigger was a stack-ordering artefact of the local reset (see D3) and is **not**
claimed to be the CI cause. What it establishes is the causal chain — *unrequested reload → locator
destroyed → test-budget timeout with no assertion disagreeing* — and that the chain is reachable in
this product with this Zero version. The build pass's first job is to count reloads per test in CI
and say whether that chain is what is firing there.

### Why this lands on multi-client tests

A second `browser.newContext()` is a second Zero client: a second `clientGroupID`, a second
IndexedDB replica, a second initial sync, a second sign-in, a second WebSocket. Every one of those is
another chance to be handed an error whose default handling is a page reload — and the two-client
tests are also the longest, so a reload costs them a larger fraction of a fixed 60-second budget.
Three of the four tests that fail are two-client tests; the fourth (`retro.spec.ts`) is too.

### The `PushProcessor` replay messages

`PushProcessor {"name":"Error","message":"Ignoring mutation from <clientID> with ID 4 as it was
already processed. Expected: 9"}` fills the server log in passing and failing runs. `PushProcessor`
is a log context **inside** `@rocicorp/zero/server` (reached through `handleMutateRequest` at
`apps/server/src/zero/routes.ts`), not a 0.x API this repo calls — see `reference/zero.md`.

The prior stated by PR #41 is that this is benign idempotency bookkeeping: Zero keeps a
`lastMutationID` per client and skips anything at or below it. This change adds a reason to suspect
it is also a **fingerprint**: a client that reloads rehydrates its queued mutations from IndexedDB
and re-sends ones the server has already applied, which produces exactly this message with exactly
this shape (a low received ID against a much higher expected one). If reload count and replay count
move together, the messages are a cheap proxy for the defect. The change rules on it **with counts
per spec file across a passing and a failing run**, as the brief requires — not with the prior.

## Goals / Non-Goals

**Goals**

- A measured pass rate for the affected specs, over ≥5 repeated runs, before and after.
- A ruling, with counts, on the `PushProcessor` messages.
- A ruling on whether the context-disposal error precedes or follows the timeout — including the
  answer "it does not occur in current runs", if that is what the logs say.
- Browser-context lifecycle owned by a Playwright fixture, on the pass and fail path alike.
- An explicit product policy for Zero's `UpdateNeeded` / `ClientStateNotFound`, replacing the
  library's silent `location.reload()`.
- A written contract in `apps/web/e2e/README.md`.

**Non-Goals**

- Parallel workers. Test independence here serves determinism, not speed.
- A global timeout raise, or any `test.slow()`/`fixme`/skip added to reach green.
- Re-litigating PR #41's per-test reset. It is not adopted by default; measurement decides.
- New product coverage.

## Decisions

### D1 — The diagnosis is measured before anything is changed

The first build task produces, on Node 24 against the compose stack, five consecutive runs of
`projects.spec.ts` + `pm-digest.spec.ts` + `retro.spec.ts` on unmodified `main`, recording per test:
pass/fail, duration, count of `reloading in` / `Zero reloaded the page.` / `SchemaVersionNotSupported`
/ `ClientNotFound` in the forwarded browser console, and count of `Ignoring mutation` in the server
log. Vite already forwards the page's `console.error` into the harness log prefixed
`[vite] (client) [console.error]`, so this needs no product instrumentation — it needs the harness
log kept.

Nothing else is touched until that table exists. If it shows zero reloads in failing tests, the
hypothesis in Context is dead and the build follows the evidence to wherever the sixty seconds
actually went (the trace for a failing two-client test is the next instrument).

### D2 — The reload policy becomes the product's, not the library's

Whatever the measurement says about CI, the current state is a defect on its own terms: a
self-hosted user typing into an issue can have the page reloaded under them by a schema-version
error, silently, because an option was not passed. `ZeroRoot` therefore supplies both handlers.

- `onClientStateNotFound`: the client's state is unrecoverable; the correct response is to drop the
  local replica and re-open, surfaced through the existing `SyncRecovery` status rather than a hard
  reload. `SyncRecovery` is already "the single owner of every reconnect" (its own comment) and this
  keeps that true.
- `onUpdateNeeded`: a genuine "the deployed app is older than the server" needs a reload eventually,
  but it must be *the product's* reload — visible, and not while a mutation is in flight.

The exact behaviour is settled in the build pass against the real `UpdateNeededReason` union in
`node_modules`, and recorded below under "Decisions made during implementation". What is fixed here
is that the decision stops being implicit.

**This is the part of the change that touches product code**, and it is why `local-first-sync` gets
a spec delta. It is deliberately small: two options and their tests.

### D3 — The dev-environment startup order is a real sharp edge, and it is documented either way

`docker-compose.dev.yml` starts `zero-cache` against a database whose tables the **server** creates
at boot. On fresh volumes zero-cache therefore snapshots a schema-less database, and until it catches
up, every client is told `SchemaVersionNotSupported` and reloads itself. CI does exactly this:
`.github/workflows/ci.yml` runs `up -d --wait postgres zero-cache` on fresh volumes and only then
starts the harness, which boots the server that migrates.

Locally this reproduced as a total, unrecoverable failure of all five `projects.spec.ts` tests. CI
evidently usually recovers — the suite mostly passes — which means CI is racing it. A race that is
usually won is the exact shape of "fails on first attempt, passes on re-run".

This is a strong second hypothesis and the build pass tests it directly: count
`SchemaVersionNotSupported` in the first minutes of a CI e2e job. If it is present, the fix is
ordering (bring zero-cache up after the first migration, or gate the harness on zero-cache having
the tables) and it is a one-line CI change with a large payoff. If it is absent, this section stands
as documentation of a sharp edge that cost a day.

### D4 — Contexts move to a fixture; the lifecycle stops being the spec's problem

Seventeen `browser.newContext()` sites across eleven spec files each close in a `finally`. That is
correct on the pass path and racy on the fail path: when the test times out Playwright tears the
worker down, and the `finally` then closes a context that may already be gone. This change moves
them all to a `newContext` fixture whose teardown Playwright owns — the same shape PR #41 wrote, and
it is carried over rather than re-invented.

This is not claimed to be a fix for the timeouts. It is a fix for the *diagnosis*: a secondary error
that fires only on failures is a trap, and the next person will spend an hour on it.

### D5 — Second-client waits are budgeted from measurement, or not at all

A second context pays sign-in, initial sync and replica bootstrap that the first has already paid.
If the measurement in D1 shows a two-client test's *successful* runs sitting close to the 60s budget,
that budget is genuinely under-provisioned and is raised **for those tests, with the measured
distribution quoted in the code beside it**. If successful runs sit at 25s and failures sit at 60s,
the budget is not the problem and nothing is raised. The brief permits exactly one of these and this
change will say which, with numbers.

`pm-digest.spec.ts:306` already carries a `test.slow()`. That is inherited, not added, and it is
audited in the build pass: a `test.slow()` that was added to paper over this defect should be
justified by the measurement or removed with the defect.

### D6 — Specs that depend on a sibling's state are fixed, whatever the flake turns out to be

PR #41's per-test reset made things worse, and the most likely reading is that some specs quietly
rely on state an earlier spec created. That is a defect on its own: it makes a spec unrunnable alone,
which is how everyone debugs. The build pass runs each affected spec file **in isolation** on a fresh
database and fixes whatever cannot stand up by itself, by having the spec create what it needs.

This does not commit the change to a per-test reset. It commits it to specs that pass alone.

### D7 — What is taken from PR #41, and what is left

**Taken:** `zz-isolation.spec.ts` (the last-running guard, adapted to whatever isolation model this
change ends with — its value is that it asserts what the *browser* sees, not only what Postgres
holds); the `newContext` fixture shape from `fixtures.ts`; `apps/web/e2e/README.md` as the home of
the contract; the diagnostic findings quoted in Context, with attribution.

**Left, for now:** the per-test `resetToBaseline` / `assertBaseline` and the `information_schema`
derivation, the boundary gate in `scripts/lib/boundaries.mjs`, the twenty-one-file spec migration,
and the `order.ts` helper. They are not wrong — they are unproven against this defect and they
measured slower. If D1's measurement implicates accumulation after all, they are re-introduced by
cherry-pick with credit, not rewritten.

### D8 — A local measurement requires exclusive ownership of the harness ports, and the harness does not check

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI` on both web servers. On a machine
running several worktrees of this repository — which is the normal state of this project — a server
belonging to another branch that happens to hold port 3210 is silently adopted, with **that**
branch's environment: a different `WEB_ORIGIN`, a different `YAPM_BOOTSTRAP_ADMIN_EMAIL`, a
different code revision. Observed while writing this proposal: five `projects.spec.ts` tests failing
on `alert: Invalid origin` because the adopted server trusted a different web origin.

Two consequences, both of which the build pass acts on:

1. **Every local number in this change must be taken with the ports verifiably ours**, and the
   procedure for that is written into `apps/web/e2e/README.md`: the compose stack, the ports, the
   check that nothing else is listening, and the fact that a shared dev Postgres means one run at a
   time on a machine.
2. **The harness should refuse rather than adopt.** A reused server that does not answer with the
   revision and configuration this run expects is a misconfiguration, and the suite should say so
   in one line instead of failing forty tests on `Invalid origin`. This is small and it is the kind
   of thing that costs the next person a full afternoon.

### D9 — What was and was not measured in the proposal pass

Written down so no number here is read as stronger than it is:

- **Measured:** Node 24.19.0 installed and used; `@rocicorp/zero@1.8.0`'s `reloadWithReason` /
  `onUpdateNeeded` / `onClientStateNotFound` code paths read in `node_modules`; `ZeroRoot`'s option
  list read and confirmed to pass neither handler; the `SchemaVersionNotSupported … reloading in
  0.735 seconds` console output reproduced verbatim against the dev stack; `.github/workflows/ci.yml`
  confirmed to bring `zero-cache` up on fresh volumes before the server that migrates; the
  `Invalid origin` cross-worktree adoption reproduced.
- **Not measured, and owed by the build pass:** the before/after pass rate over ≥5 runs;
  `PushProcessor` counts per spec file across a passing and a failing run; whether reloads occur in
  CI runs; whether `Target.disposeBrowserContext` precedes or follows a timeout in a run where it
  occurs at all; per-spec-file isolation results.

### D10 — Nothing is weakened to reach green

No assertion is deleted, weakened, skipped, `fixme`-d or newly `slow`-ed. The assertion multiset
before and after is compared and any delta is stated explicitly with its reason. A raised timeout
counts as a fix only under D5's evidence bar.

## Risks / Trade-offs

- **The hypothesis may be wrong.** It is falsifiable by D1's first table, and the change is
  sequenced so that discovering it is wrong costs one measurement pass, not a rewrite. The fallback
  instrument is the Playwright trace of a failing two-client test.
- **Touching `provider.tsx` touches the product.** Mitigated by keeping it to two options plus
  tests, and by the fact that the current behaviour is a library default nobody chose.
- **CI is the only place the real failure has been seen recently.** Local measurement on Node 24 is
  the best available proxy and its limits are stated wherever a number is quoted.
- **A CI ordering fix (D3) could mask rather than fix.** It is only taken if the count shows the
  race is real, and the reload policy (D2) is taken regardless, so a masked race would still be
  visible as a reload count.

## Migration Plan

No data migration, no rollout. The change is confined to `apps/web/e2e/`, two options in
`apps/web/src/zero/provider.tsx`, and possibly one step in the CI workflow. Reverting is deleting
the branch.

## Open Questions

- Does the reload chain fire in CI, or only in the locally provoked case? (D1 answers with counts.)
- Are the `PushProcessor` replay messages a fingerprint of reloads or independent noise? (Counts
  per spec file across a passing and a failing run.)
- Is `SchemaVersionNotSupported` present in the opening minutes of CI e2e jobs? (D3.)
- Which two-client tests, if any, have genuinely under-provisioned budgets? (D5.)
