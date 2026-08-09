## Why

The Playwright suite fails on changes that cannot have caused the failure, and the team has learned
to re-run until green — which is exactly how a real regression gets waved through. PR #39 carried
**zero product code** (seven static HTML mocks and one markdown file) and still failed
`projects.spec.ts`; it passed on re-run. The failing set is stable and small: the three tests that
fail on `main` locally — `projects.spec.ts:190`, `projects.spec.ts:248`, `pm-digest.spec.ts:306` —
are all tests that open a **second browser context**, and `retro.spec.ts` (also two-client) has
flaked in CI. The signature is always `Test timeout of 60000ms exceeded`: the wall clock ran out and
**no assertion ever disagreed**.

A first attempt (PR #41, open and unmerged) was commissioned on the theory that specs poison each
other through an ever-growing shared workspace. It built a per-test database reset, measured it, and
reported honestly that it did not fix the flake — and the owner's own measurement on one machine,
one spec, one freshly reset database, showed it made things worse: 2 failures in 2.3 min on `main`
became 4 failures in 4.6 min on that branch. Accumulation was a real defect, but it was not this
one.

This change takes the corrected diagnosis: **the multi-client lifecycle**. The specific mechanism it
was written to prove or kill is that Zero's client, when it is handed an `UpdateNeeded` or
`ClientStateNotFound` from the server, **reloads the page by itself** — `ZeroRoot` supplies neither
`onUpdateNeeded` nor `onClientStateNotFound`, so `@rocicorp/zero`'s
`reload-error-handler.reloadWithReason` calls `location.reload()` on a `sessionStorage`-backed
backoff. A page that reloads under a running test destroys the locator the test is waiting on
without failing an assertion, which is precisely the observed signature. It also explains the
`PushProcessor` "Ignoring mutation … already processed" noise: a reloaded client rehydrates its
queued mutations from IndexedDB and re-sends ones the server already applied.

Reproduced while writing this proposal, on Node 24, against a freshly reset stack: a zero-cache
replica that does not match the client's schema puts every page into exactly that loop —
`SchemaVersionNotSupported … reloading in 0.735 seconds` — and all five `projects.spec.ts` tests die
to test timeouts with no assertion disagreeing. That is the same failure shape CI reports, produced
on demand. Whether the same handler fires **mid-run** in CI for a different reason is the question
this change exists to answer with counts.

Vision principles served: **sub-100ms interactions** (a suite that cannot tell a slow product from a
reloading page cannot defend that budget) and the working agreement's **"report failures
honestly"** — a gate nobody believes is not a gate.

## What Changes

- **Instrument first, fix second.** Capture, per test: browser console (Vite already forwards
  `console.error` from the page into the harness log), the number of unrequested page reloads and
  their Zero reason, the server's `PushProcessor` replay lines, and the wall clock. Establish a
  measured baseline pass rate over **at least five repeated runs** of the affected specs before
  changing anything.
- **Answer the two questions the brief names, with numbers.** (a) Does
  `Target.disposeBrowserContext` fire before or after the test timeout — i.e. does the leak cause
  the hang or the hang cause the leak? (b) Are the `PushProcessor` replay messages benign, counted
  per spec file across a passing and a failing run?
- **Give the app an explicit sync-recovery policy instead of an implicit page reload.** `ZeroRoot`
  supplies `onUpdateNeeded` and `onClientStateNotFound` so that the product — not the library's
  default — decides what a schema-version or missing-client error does. This is a product decision
  as much as a test one: a self-hosted user mid-sentence should not have the page yanked out from
  under them by an upgrade, and the existing `SyncRecovery` component is already the single owner of
  every reconnect.
- **Make the multi-client lifecycle a fixture, not a `finally` block.** Every `browser.newContext()`
  in the suite (17 sites across 11 files) moves onto a fixture whose teardown Playwright owns, so it
  runs on the pass path and the fail path alike and cannot race the worker teardown.
- **Make the second-client waits honest.** A second context pays a full sign-in, a full initial
  sync and a full replica bootstrap that the first context has already paid; where the evidence
  shows a wait was genuinely under-provisioned, the budget is raised **with the measurement quoted
  beside it**, and nowhere else.
- **Make the specs self-contained where they are not.** PR #41's measurement suggests some specs
  depend on state a sibling created. Any such dependency is a real defect regardless of the flake
  and is removed by having the spec build what it needs.
- **Keep what PR #41 got right.** `zz-isolation.spec.ts` — the guard that runs last and asserts what
  the workspace it inherits actually holds — is carried over, and its diagnostic notes are preserved
  in this change's `design.md` with attribution.
- **Write the contract down.** `apps/web/e2e/README.md` states the isolation and lifecycle rules the
  next person writing a spec must follow.

**No assertion is weakened, skipped, `fixme`-d, `slow`-ed or deleted.** Coverage after this change
is coverage before it, and any delta is reported explicitly. The deliverable is a measured
before/after pass rate over repeated runs — a single green run is not evidence.

## Non-goals

- **Not a rewrite of the isolation model.** PR #41's per-test database reset is not adopted
  wholesale; it measured worse. Whether any part of it is re-introduced is decided by measurement in
  this change, not assumed.
- **Not parallelism.** The suite stays `workers: 1`, `fullyParallel: false`. Making tests
  independent is a means to determinism here, not a step toward running them at once.
- **Not a blanket timeout raise.** Raising `timeout` globally would convert a visible failure into
  an invisible one.
- **Not new coverage.** No new product behaviour is asserted; the one new spec file is a harness
  guard.
- **Not a fourth container, not a second database.** The three-container promise is untouched.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ci-pipeline`: adds the end-to-end **multi-client lifecycle contract** — every browser context a
  test opens is owned by a fixture with automatic teardown, a test that spans two clients states its
  budget from measured evidence, and an unrequested page reload during a test is a harness failure
  rather than a silent timeout.
- `local-first-sync`: the client's response to a server-signalled schema-version or missing-client
  error becomes an explicit, tested product decision instead of the sync library's default
  full-page reload.

## Impact

- `apps/web/e2e/` — new `fixtures.ts` (context lifecycle + console/reload instrumentation), new
  `zz-isolation.spec.ts` (carried from PR #41), new `README.md`; the 11 spec files that call
  `browser.newContext()` migrate onto the fixture.
- `apps/web/src/zero/provider.tsx` — `ZeroRoot` gains explicit `onUpdateNeeded` /
  `onClientStateNotFound` policy; `apps/web/src/zero/recovery.ts` may gain the reason plumbing.
  Unit-tested in `provider.test.tsx`.
- `apps/web/playwright.config.ts` — reporter posture so browser console reaches the run log; timeout
  posture only where measured.
- `.github/workflows/ci.yml` — the e2e job may gain the "zero-cache must not snapshot a schema-less
  database" ordering if measurement shows it matters; the job's shape is otherwise unchanged.
- No schema change, no migration, no mutator change, no new dependency, no new container.
- **Docs:** `apps/web/e2e/README.md` (new — the lifecycle contract), `PROCESS.md` §3 (the E2E tier
  gains the contract), `reference/zero.md` (the reload-on-error default and the two handlers that
  override it — a post-cutoff API fact the repo does not yet record). **No docs-site page**:
  `apps/docs` serves evaluators and self-hosters and has no contributor section — except the one
  page that documents sync recovery for operators, which is updated if the client's reload policy
  changes what an operator sees during an upgrade.
