# e2e-determinism — design

## Context

Three changes have now been scoped against one failing test. The first two were scoped against a
misleading error message; this one was scoped against a trace. The sequence is worth keeping,
because the lesson is not about Playwright:

1. **PR #41 — accumulation.** Theory: specs poison each other through an ever-growing shared
   workspace. Built a per-test database reset, measured it, reported honestly that it did not fix
   the flake and on one measurement made it worse (2 failures in 2.3 min → 4 failures in 4.6 min).
   Accumulation was real; it was not this.
2. **PR #51 `e2e-multi-context` — the reload chain.** Theory: Zero's client reloads the page under
   a second browser context on `UpdateNeeded` / `ClientStateNotFound`. Proposal merged, no code
   written. Falsified by the measurement it asked for.
3. **This change — the unopened transient.** Theory: the `more▾` menu never opens for the second
   client, and an unbounded action turns that into a sixty-second mystery reported three frames
   away. Proven by fixing it.

What all three share is that the reported error was `browserContext.close`, raised in a hand-rolled
`finally`, long after and far from the cause. **The harness's inability to report where it failed
is the defect that produced two wrong diagnoses.** That is why bounding actions is the first change
here and not a footnote.

## The measured baseline

Node **24.19.0** (`.node-version` says 24; the machine's default is v26, so Node 24 was installed
keg-only and put on `PATH` for every command — every number below is under 24.19.0). Isolated
compose project `yapm-e2e` on its own volumes and ports (postgres 5445, zero-cache 4855, server
3210, web 5174), so the developer's running `yapm-dev` stack could not be adopted by
`reuseExistingServer` and could not be torn down. Postgres up → server booted once so migrations
ran (51 tables, through `0023_deploy_history`) → zero-cache up → replication confirmed before any
test ran.

### Section 2.1–2.2 — five runs each

| spec | run 1 | run 2 | run 3 | run 4 | run 5 | passed |
|---|---|---|---|---|---|---|
| `projects.spec.ts` | 2 failed (2.4m) | 1 failed (1.4m) | 1 failed (1.4m) | 1 failed (1.4m) | 2 failed (2.3m) | **0/5** |
| `pm-digest.spec.ts` | 2 passed (27.9s) | 2 passed (31.4s) | 2 passed (29.9s) | 1 failed (29.3s) | 1 failed (50.4s) | 3/5 |
| `retro.spec.ts` | 7 passed (38.7s) | 7 passed (42.0s) | 7 passed (40.3s) | 7 passed (42.4s) | 7 passed (41.4s) | **5/5** |

Per test: `projects.spec.ts:190` failed 4/5, `:248` failed 3/5, `pm-digest.spec.ts:306` failed 2/5.
`retro.spec.ts` did not fail once in five runs — it is in the failing set only from CI flakes.

A first attempt at this table was discarded: two runner processes were started against the same
ports and interleaved, which is the exact hazard `e2e-multi-context` task 1.2 warned about. The
contaminated logs were deleted and the affected specs re-run single-file. `projects` runs 1–5 were
taken before the second runner existed and are kept.

### Section 2.2–2.3, 2.6 — the marker counts

| marker | local (5 runs) | CI (last 3 e2e jobs) |
|---|---|---|
| `reloading in` | 0 | 0 |
| `Zero reloaded the page.` | 0 | 0 |
| `SchemaVersionNotSupported` | 0 | 0 |
| `ClientNotFound` | 0 | 0 |
| `Ignoring mutation … already processed` | 0 | 0 |
| `Target.disposeBrowserContext` | 0 | 0 |

Task 2.6 asked for "does not occur" to be recorded if that is the answer. **It does not occur.**

### Section 2.5 — where the sixty seconds went

Both traces: 108 actions, ~60.3s span, **104 of them under 400ms**. Exactly one action never
completes, in the watcher (second) context:

```
UNFINISHED [1-trace.trace]  click  {"selector":"internal:role=menuitem[name=/^Projects/u]","timeout":0}
```

CI's watcher context ends on `http://localhost:5174/teams/{id}/issues` — it never reached Projects.
Across its 48 frame snapshots, **0 contain a `menu` or `menuitem` element**. The transient never
opened; the click waited for an element that was never going to exist.

### Section 2.7 — the CI ordering race, ruled out

`SchemaVersionNotSupported` is **0** across CI runs 31306107908, 31305143624 and 31304141343
(23,384 log lines pulled and searched for the first). PROCESS.md §3 documents
"postgres → migrate → zero-cache → vite" and `ci.yml` brings both containers up before anything
migrates — the contradiction `e2e-multi-context` recorded is real **as a documentation defect**,
but the race it was suspected of causing does not happen. Task 4.7 of that change is therefore not
taken here.

### The local-only aggravator

| | local | CI |
|---|---|---|
| distinct Vite dep-optimizer hashes in one run | **3** (`7798e96a` ×24, `d0028597` ×8, `b96f8a29` ×4) | **1** (`533b8a4a` ×9) |
| `Invalid hook call` | 2 | 0 |
| `more than one copy of React` | present | 0 |
| `TypeError: … (reading 'useRef')` in `<MenuRoot>` | present | 0 |

Locally, Vite re-optimized dependencies mid-run and a context that loaded across the boundary got
`react` and `react-dom` from different bundles, so `MenuRoot` could not mount at all. CI's optimizer
was stable and CI failed anyway. **The duplicate React is a local amplifier, not the cause** — and
saying so is the whole point of writing it down, because it is exactly the kind of vivid nearby
error that produces a fourth wrong diagnosis.

## Goals / Non-Goals

**Goals**

- A failing action reports itself, at its own selector, within a bounded time.
- `goToMore` is honest about the transient: it asserts the menu opened before clicking into it.
- The multi-client lifecycle is owned by Playwright, not by hand-rolled `finally` blocks.
- A spec passes alone, on a freshly bootstrapped database.
- The local suite is not harder than CI.

**Non-Goals**

- Weakening any assertion. If a shipped test disagrees with a fix, the fix is wrong or the test is
  asserting the defect; either way it is recorded here, never loosened.
- Raising budgets to hide slowness. 104 of 108 actions ran under 400ms; nothing here is slow.
- The CI startup-ordering change, ruled out above.
- Fixing `MenuRoot` itself. The duplicate React is a dev-server artifact; if it ever appears in a
  built bundle that is a product bug and a different change.

## Decisions

### D1 — Bound actions, and do it first

`actionTimeout: 15_000`, `navigationTimeout: 30_000`. Chosen over per-call timeouts because the
defect is systemic: **every** action in the suite currently inherits `timeout: 0`. 15s is above the
slowest completed action observed by a factor of ~10 (1.54s), so it cannot convert a slow-but-real
action into a failure, and it is below the 60s test timeout by enough that a hung action leaves
room for the trace to be written.

### D2 — `goToMore` retries the opener, it does not sleep

The transient's liveness has exactly one observable: a menu item in the DOM. So the opener is
clicked and the item asserted, and that pair is retried under `expect.toPass`. A fixed wait would
be a guess that ages badly; asserting the observable cannot.

The alternative — making the *caller* wait for the destination to settle before calling `goToMore`
— was rejected: it puts the fix in eleven call sites instead of one, and the next call site added
will not have it.

### D3 — The reload watcher stays, reclassified

`e2e-multi-context` specced it as part of a fix. The measurement says there is nothing to fix. It
is kept as a **tripwire**: had it existed, the reload theory would have died in one afternoon
instead of surviving a merged proposal. A cheap assertion that would have falsified a wrong theory
early is worth keeping after the theory dies.

### D4 — The Zero handlers stay, explicitly not as the fix

Zero's client reloads the page on `UpdateNeeded` / `ClientStateNotFound` by default, `ZeroRoot`
passes neither handler, and `reference/zero.md` does not record the default. That is a real gap
worth closing — a user losing an in-flight write to a silent reload is a genuine defect — and it is
**not** why these tests fail. Both facts go in the same paragraph wherever this is documented, so
the next reader inherits the evidence rather than the story.

### D5 — Freeze the dep optimizer for e2e rather than chase the React duplication

The duplication is a symptom of re-optimization mid-run. Freezing the optimizer for the e2e run
removes the boundary entirely, which is a smaller and more durable change than any attempt to
de-duplicate React across bundles.

## Risks / Trade-offs

- **A bounded action could newly fail a genuinely slow test.** Mitigated by the margin (15s vs a
  1.54s slowest observed) and by the fact that the full suite is run more than once before this
  lands, with every run reported.
- **`expect.toPass` around a click could mask a real regression** in which the menu is simply
  broken. Bounded at 20s: a genuinely broken transient still fails, and now it fails naming the
  menu rather than the teardown.
- **The optimizer freeze makes local diverge from a developer's ordinary `pnpm dev`.** Accepted and
  documented: it applies to the e2e run, which is not the dev loop.
- **This is the third diagnosis.** It is the first with a trace and a proven fix, which is the only
  reason to believe it over the previous two — and the reason the before/after numbers are
  published rather than summarized.

## Migration Plan

No data migration. Confined to `apps/web/e2e/`, `playwright.config.ts`, `vite.config.ts`, two
options in `apps/web/src/zero/provider.tsx`, and one boundary-gate script. Reverting is deleting the
branch.

## Open Questions

None outstanding. The four `e2e-multi-context` carried are answered in "The measured baseline"
above.

## Decisions made during implementation

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->

### DI-1 — Node 24 was not on the machine, and the baseline is worthless without it

`.node-version` says 24; the machine's default interpreter is v26.0.0 and there is no version
manager installed. Every number in this change is a comparison against CI, which uses
`actions/setup-node` against `.node-version`, so measuring on v26 would have confounded the one
thing the measurement exists to establish. Node 24.19.0 was installed keg-only
(`/opt/homebrew/opt/node@24`) and prepended to `PATH` for every command; it does not shadow the
developer's `node`. Recorded because the version is a property of every number above.

### DI-3 — There are two defects, not one, and PR #41 was right about the second

The fixes above take each spec file **run alone** from its baseline to green:

| spec | baseline | after D1+D2+D5 |
|---|---|---|
| `projects.spec.ts` | 0/5 (1.4–2.4 min) | **5/5** (16.8–20.7s) |
| `pm-digest.spec.ts` | 3/5 | 4/5 (36.5–37.0s) |
| `retro.spec.ts` | 5/5 | 5/5 (27.0–28.4s) |

**The full suite still fails, and it degrades run over run**: 3 failed → 5 failed → 6 failed across
three consecutive runs, spreading from `projects` and `pm-digest` into `auth.spec.ts:37`,
`auto-status.spec.ts:152` and `board.spec.ts:330`. `auth.spec.ts:37 admin creates a team` failed in
all three.

The database explains it. After those runs, one workspace held:

| table | rows |
|---|---|
| `team` | **533** |
| `issue` | 687 |
| `cycle` | 446 |
| `user` | 112 |
| `project` | 131 |

That is **accumulation** — the theory PR #41 was commissioned on, built a per-test database reset
for, and then honestly reported as not fixing the flake. It did not fix the flake because the flake
it was measured against was the unopened transient, which no amount of database hygiene touches.
Both defects were live the whole time, and each one hid the other: accumulation made the transient
race more likely to lose, and the transient's sixty-second timeout made the accumulation
unmeasurable.

So PR #41's reset was not wrong work; it was right work credited to the wrong defect. Its fixture
and `zz-isolation.spec.ts` are carried into this change (tasks 5.1, 5.6), and its diagnosis is
restored rather than discarded.

The measurement that separates the two is a **fresh database per full-suite run**, which is what
`ci.yml` already does with fresh volumes — so accumulation across runs is a local-only artifact,
while accumulation *within* one suite run is real in CI too.

### DI-4 — On a fresh database a third thing remains, and it is not one defect

Three full-suite runs, each on a database torn down to its volumes and rebuilt in the documented
order (postgres → migrate → zero-cache), each ending with an identical **72 teams**, so
within-run accumulation was held constant:

| run | result | duration |
|---|---|---|
| 1 | 3 failed, 91 passed | 9.7m |
| 2 | 5 failed, 89 passed | 10.0m |
| 3 | **1 failed**, 93 passed | 9.4m |

The failing set is **not stable**: run 1 was `attachments:96`, `issues:78`, `triage:121`; run 2 was
`attachments:96`, `retro:258`, `triage:95`, `triage:191`, `triage:227`; run 3 was `attachments:96`
alone. One test fails in all three — **`attachments.spec.ts:96`** — and everything else moves.

That shape says the residue is not a single defect. It is one reproducible failure plus a
population of races, and the two want different treatment: the first is a bug to fix, the second is
a property to establish.

The failure modes now report as `TimeoutError: locator.press: Timeout 15000ms exceeded` (a keypress
that never lands — a real hang, surfaced at 15s by D1 rather than absorbed into the 60s budget),
`expect(locator).toBeVisible() failed`, and one `Test timeout of 180000ms exceeded` which is
`pm-digest`'s inherited `test.slow()` tripling the 60s timeout (task 5.7's subject).

### DI-5 — The control, and the uncomfortable answer

Unmodified `main`, same fresh-database protocol, same machine, same session, three runs:

| | run 1 | run 2 | run 3 | mean failures |
|---|---|---|---|---|
| **`main` (control)** | 2 failed, 92 passed | 2 failed, 92 passed | 2 failed, 92 passed | **2.0** |
| **this branch** | 3 failed, 91 passed | 5 failed, 89 passed | 1 failed, 93 passed | **3.0** |

`main` fails **the same two tests every single time** — `projects.spec.ts:248` plus one of
`projects.spec.ts:190` / `pm-digest.spec.ts:306`, all with the 60s signature. It is perfectly
reproducible.

This branch never fails those. It fails a **different, moving set** — and by mean count it is
**worse**, not better.

That is the honest reading, and it is not the one this change wanted:

- **The deterministic defect is genuinely fixed.** The two-client tests that failed 100% of control
  runs fail 0% here, and run alone they went 0/5 → 5/5 at a fifth of the wall clock. That is real
  and it is not in dispute.
- **Something else got worse.** `attachments.spec.ts:96` fails **3/3** on this branch and **0/3** on
  `main`, at `ensureAccount` — sign-in never completing, hitting a 180s `test.slow()` cap. Two
  variables changed for it at once (the built bundle, and bounded actions), and neither has been
  isolated yet.
- **The rest of the residue is a population of races**, not a defect: identity moves run to run and
  the count swings 1–5.

**This change does not land until the mean is at or below the control's and `attachments:96` is
explained.** Trading a reproducible failure for a wider distribution of irreproducible ones is a bad
trade even when the mean looks close, because a stable failure can be fixed and a moving one teaches
the team to re-run — which is the exact habit this change exists to end.

One hazard already identified, not yet ruled in or out as the cause: `reuseExistingServer` is true
locally, so Playwright adopts whatever already holds the web port. Under `vite dev` that is benign.
Under `vite build && vite preview` it means a run can be served a bundle it did not build. It did
not vary across these runs (no source changed between them), so it does not explain this table — but
it is a hazard this change introduces and it needs closing regardless.

For scale: CI's own state on the commit this work started from was **1 failed + 1 flaky, 92 passed**,
so this machine is harsher than CI and the two numbers are not interchangeable.

### DI-2 — An isolated compose project, not the default `yapm-dev`

`docker/docker-compose.dev.yml` hardcodes `name: yapm-dev`, and a `yapm-dev` stack was already
running on the machine with its own volumes. Using it would have meant either adopting a foreign
zero-cache whose `ZERO_QUERY_URL` points at port 3000 (the failure mode task 1.2 names) or
destroying a developer's seeded data to get the fresh database the measurement needs. A separate
`-p yapm-e2e` project on its own ports and volumes gets both properties and costs nothing.

### DI-6 — The forensic pass, and the fourth diagnosis that finally held (2026-08-10)

After DI-5's negative re-measurement, a five-way forensic investigation (timestamped trace
timeline, server cold-path audit, SPA state-machine audit, an audit of the measurements
themselves, and a mechanism classification of every moving failure) produced a unified
explanation, and a decisive experiment confirmed it live. Four root causes:

**RC1 — the cold-DB wedge is a renderer freeze, not a network wait.** Sign-up flips the auth
session immediately while sync status still reads `logged-out` from the pre-auth 401. In that
window `/login` renders `<Navigate to="/">` (session exists) and `Authenticated` renders
`<Navigate to="/login">` (logged-out) — a reciprocal redirect cycle that starves the renderer so
completely that **no timer, fetch callback or paint ever runs again**. The decisive run measured
the server answering the post-sign-up `/api/zero/token` in **29.116ms** while the page locked
anyway; the client's own 10s abort never fired because no timer could. Fixed by two guards
(either sufficient): ZeroRoot returns the session to `pending` on identity change, and
`Authenticated` renders the retry surface instead of the redirect when `logged-out` carries
`unavailable`. Cold attachments: 6/6 failures at ~3.1min → **passing at 6.8s**.

**RC2 — the `more▾` transient race** (main's stable two-client 60s hangs): confirmed certain,
fixed by the aria-expanded-keyed `goToMore` retry. Cherry-pickable.

**RC3 — the "moving population" is real latent product defects, exposed (not caused) by the
faster harness.** Family A (~7/15): the command palette's `close()` awaits the **server ack**
rather than the optimistic apply, so a palette the test reuses within ~50–500ms is closed out
from under it — a genuine sub-100ms violation, latent on `main`, byte-identical code. Family B
(~3/15): the board's focus-restore rAF loop re-steals focus on server-ack rebase, so `m` opens
Move for the wrong card. Family C (2): test bugs (`issues.spec` vacuous `data-pending` guard;
`retro.spec` Escape probe missing Base UI's exit transient). The one-origin harness halved
compute-bound test times, shifting ack latency into the danger window. These are a fast-follow.

**RC4 — two observation-layer defects manufactured every prior wrong conclusion.** Playwright
tracing withholds pending API responses behind an after-snapshot capture that cannot complete
against a frozen page — which is what made RC1 read as a 180-second network hang for three
diagnoses running (with tracing off, the same failure reports cleanly in ~25s). And the
measurement comparisons in DI-3/DI-5 changed 3–5 variables at once.

**Retractions this forces.** DI-5's "the sync fix made it worse" is withdrawn: the comparisons
do not survive the experiment-design audit (within-variant spread exceeded the claimed effect,
and the failure classes were disjoint). The retry-gate fix's earlier claim to close the e2e
failure is withdrawn: byte-confirmed in the failing bundle, it changed nothing — the wedge never
reaches the settled-`unavailable` state the gate keys on; its unit test passes because jsdom has
a living event loop and a mocked fetch that always settles. The fix itself stays: it is correct
for its own settled state, and its test is falsifiable.

**Harness rulings.** `actionTimeout: 15_000` stays — every observed 15s failure had a
permanently-dead target; nothing slow-but-real was truncated; it converts 60s burns into
attributed 16s failures. The one-origin harness stays — production-shaped, ~2× faster, and it
surfaced RC1 and RC3 — with `reuseExistingServer: false`, because an adopted server means
`vite build` silently did not run and the suite asserts an arbitrary old bundle.

### DI-7 — What "carrying PR #41's per-test isolation" means under this change's model (2026-08-10)

Task 5b.4 says "carry PR #41's per-test isolation over". PR #41's branch carried three things: a
`newContext` fixture whose teardown Playwright owns, a per-test `resetToBaseline` database reset
with `zz-isolation.spec.ts` as its falsifiable check, and the accumulation diagnosis. This change
carries the fixture verbatim (with credit), carries `zz-isolation.spec.ts` adapted, restores the
diagnosis — and does **not** carry the per-test reset. The reasons are this change's own
measurements: the delta specs (the acceptance criteria) require **file-level** self-containment
("a spec file passes alone"), not per-test emptiness; DI-6's forensic audit showed the cross-run
degradation that made per-test reset look necessary was a reused-database artifact of the
measurement protocol, while CI's fresh-volumes-per-run already provides the isolation boundary
that matters; and a per-test reset would rewrite every spec that builds state in one test and
reads it in the next, for a defect the fresh-database protocol already rules out. What replaces
the reset is visibility (5b.6): a `workspaceGrowth` auto-fixture that annotates any test leaving
the workspace larger than it found it, and `zz-isolation.spec.ts` asserting the run-end
population against measured ceilings — so the 533-team failure mode cannot recur silently, which
was the property the reset was actually bought for.

### DI-8 — The startup-order requirement is reconciled to the measurement, in the delta spec too

The ci-pipeline delta requirement "The stack starts in an order the sync layer survives" was
drafted (inherited from `e2e-multi-context`) before task 2.7's measurement and demanded
migrate-before-zero-cache as CI's actual order. The measurement ruled the race out —
`SchemaVersionNotSupported` is 0 across the audited CI runs; zero-cache follows migrations
through logical replication after its initial snapshot — and tasks.md 2.7 already recorded the
contradiction as a documentation defect. The delta spec is updated to say what is true (the
documented order SHALL be the workflow's actual order, with the safety argument recorded), rather
than archiving a requirement the change deliberately declined to implement. PROCESS.md §3 now
describes the real order and names the measurement.

### DI-9 — `onClientStateNotFound` under the React provider: a supplied handler must replace the client itself

The installed 1.8.0 `ZeroProvider` wraps `onClientStateNotFound`: with no handler supplied it
rotates the client in place; with one supplied, **the rotation is skipped** (unless the handler
throws). So a handler that only surfaced a status would leave a dead client running forever —
"the current Zero instance should be treated as dead and replaced, not reconnected"
(options.d.ts). `ZeroRoot`'s handler therefore performs the replacement itself, by bumping a
`key` on `ZeroProvider` — the same in-place construction the provider's own rotation does — and
surfaces `client-reset` through `SyncConditionContext` until the replacement connects. Recorded
because the wrapper's suppress-on-supply behaviour is invisible in the type signature and is
exactly the kind of post-cutoff fact the next reader would guess wrong.

### The coverage delta (task 8.3)

Counted mechanically — `expect(` occurrences per spec file at the pre-change commit (`3b02308`)
against this branch:

- **Every one of the 21 pre-existing spec files has an identical assertion count before and
  after** (967 textual `expect(` sites in total; per-file table in the PR). The lifecycle
  migration deleted only `try`/`finally` scaffolding and `close()` plumbing, which contained no
  assertions; per-file `test(` counts are also identical, so no test was dropped or merged.
- **The delta is purely additive.** `harness.spec.ts` adds 12 assertion sites across 4 tests (the
  reload watcher proven both ways, `goToMore` proven both ways). `zz-isolation.spec.ts` adds 3
  textual sites, one of which is a loop asserting 10 tables against their ceilings — 12 runtime
  assertions plus the live-app checks. Unit tier: 3 new tests in `provider.test.tsx` (both
  handlers supplied; client-state-not-found routes into recovery; update-needed never reloads),
  3 in `connection.test.ts` and 4 in `sync-indicator.test.tsx` (the condition summaries and their
  rendering, tokens only).
- **Reason for the difference:** the new files are the self-tests sections 5 and 7 demanded — the
  instruments proven both ways — and the run-end population gate. Nothing was weakened, loosened,
  or re-homed; the non-goal "weakening any assertion" held by construction, and the per-file
  equality is the proof.

### The completion measurement (2026-08-10, sections 4–10 on top of the merged first half)

Node 24.19.0, isolated `yapm-e2e` compose project, fresh volumes per run (`down -v` between),
postgres+zero-cache up together per the reconciled CI order, the suite serving its own built
bundle.

| protocol | result |
|---|---|
| full suite, fresh DB, run 1 | **99 passed / 0 failed**, 6.4m |
| full suite, fresh DB, run 2 | **99 passed / 0 failed**, 6.6m |
| full suite, fresh DB, run 3 | **99 passed / 0 failed**, 6.5m |
| every spec file alone, each on its own fresh DB | **23/23 green** (durations in tasks 5.5) |
| `reconnect.spec.ts` ×3 (it was touched by the migration; `:322` once flaked on CI) | 5/5, 5/5, 5/5 (2.3m / 2.2m / 2.2m) |

The 99 is the pre-change suite's tests — per-file `test(` counts byte-identical — plus
`harness.spec.ts` (4, one an expected-failure proving the reload tripwire fires) and
`zz-isolation.spec.ts` (1). Run-1 end population, the basis for the zz ceilings: team 76,
invite 17, project 7, issue 164, cycle 36, retro 14, comment 6, notification 6, attachment 3,
pull_request 7.
