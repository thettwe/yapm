## Context

The Playwright suite is the only tier that can prove keyboard flows, multi-client sync convergence
and reconnection (PROCESS.md §3). It runs in CI on every PR, `fullyParallel: false`, `workers: 1`,
`retries: 1`, `timeout: 60_000`, ~21 minutes. It currently fails on roughly a third of first
attempts and passes on re-run.

### The evidence

All from the last two days, all real:

| PR | Contents | Failed | Outcome |
|---|---|---|---|
| #37 | One attribute on an issue-title input | `projects.spec.ts:188`, `:246` — twice | passed on re-run |
| #39 | **Zero product code** — 7 static HTML mocks, 1 markdown file | `projects.spec.ts:188` **and** `connectors.spec.ts:236 › the reality track renders in all three presets, light and dark` | passed on re-run |
| #40 | 17 markdown files, one route wrapper, two dead CSS tokens | `projects.spec.ts:188`, `:246` — twice | — |

PR #39 is the load-bearing one. A static HTML mock in `design-explorations/` is not imported by the
app and cannot change the reality track's rendering. Two unrelated specs failing on a diff that
cannot reach either of them is proof the cause is environmental.

The failure signature says the same thing:

- `Test timeout of 60000ms exceeded` — the *test* budget, never a failed expectation. Nothing
  asserted the wrong thing; the test ran out of wall clock.
- `Error: browserContext.close: Protocol error (Target.disposeBrowserContext): Failed to find
  context with id …`, on **multiple** contexts in one run.
- The assertion it dies on, `expect(vp.getByTestId('new-project')).toHaveCount(0)`, is the *last*
  line of a viewer-permission test that has already done twelve waits in two browser contexts.

### What is measurably true in the tree today

Verified by reading the code at `abaae19`, not assumed:

1. **One workspace, forever.** `packages/schema/src/db/seed.ts`'s `seedWorkspace` inserts
   `where not exists (select 1 from workspace)`, and `queries.ts`'s `workspace.current` is
   `zql.workspace.orderBy('createdAt','asc').one()`. The product is single-workspace by
   construction. There is no second workspace to isolate into.
2. **Five unbounded workspace-wide queries.** `queries.ts` lines 89–121 and 223–239:
   `workspace.current`, `members.all` (`+related('user')`), `users.all`, `teams.all`
   (`+related('members')`), `invites.all`, and `projects.all` (`+related('lead')` **and**
   `+related('issues')` with each issue's assignee). None has a `limit`. Every one of them is
   scoped by *membership*, not by recency — so every client on any page holding the switcher syncs
   every team, member, user and invite the whole suite has ever created.
3. **21 spec files pour into that one workspace.** Counted call sites: 18 files call `create-team`,
   13 call `create-invite`, `projects.spec.ts` creates 4+ workspace-level projects. Each of ~100
   tests that calls its file's `openTeam` helper adds a team; each accepted invite adds a user and
   a `workspace_member`.
4. **The accumulation has already broken a test once.** Recorded in
   `openspec/changes/archive/2026-08-08-app-frame`: a keyboard test failed because the retry button
   had become the **166th** tab stop against a hard-coded budget of **150**, with **45 teams, 13
   members and 12 invites** in the trace. `reconnect.spec.ts:162` now derives the bound from the
   page and says so in a comment; the accumulation itself was left alone.
5. **The two worst offenders are the two most fixture-sensitive tests.**
   `projects.spec.ts:188` runs twelve network-bound waits across two contexts inside one 60s budget
   (sign in + `connected` ≤30s, create team ≤20s, create project ≤20s, mint invite, second context
   sign-up + `workspace-name` ≤20s + `connected` ≤30s, join team, navigate, project rail ≤20s).
   `connectors.spec.ts:236` reloads the page **six** times in a preset×mode loop, and every reload
   re-hydrates the whole workspace-wide sync set.
6. **The dev database is empty right now** (`team=0, invite=0, project=0, issue=0, user=1,
   workspace=1`), so builders have a clean baseline to measure growth from.

### The context error is very likely a *consequence*, not a cause

`playwright@1.61.1`'s `_contextFactory` (lib/index.js:367–415) closes only the contexts **it**
created for the `context`/`page` fixtures. Contexts made by hand with `browser.newContext()` are the
test's own responsibility, and the suite does close them — 17 sites, every one in a `finally`. But
when a test times out, Playwright aborts the test body, marks the worker for replacement and tears
the browser down; the `finally` block's `context.close()` then races that teardown and reports the
context id as already gone. `projects.spec.ts:246` holds two contexts, which is exactly why the
error appears on *multiple* contexts in one run.

That is a hypothesis with a mechanism, not a conclusion — the build's first task is to falsify it by
correlating the error against the timeout in the same trace. It matters because if it is right, item
3 of the brief ("fix the context leak") is cosmetic on its own: the leak stops when the timeouts
stop. Moving to fixtures is still correct, because a secondary error that fires only on failures is
a diagnostic trap, and the next person will spend an hour on it.

### The PushProcessor replay messages

`PushProcessor {"name":"Error","message":"Ignoring mutation from <clientID> with ID 4 as it was
already processed. Expected: 9"}` appears throughout, in passing **and** failing runs.

`PushProcessor` here is a class **inside** `@rocicorp/zero/server` (the log context of
`handleMutateRequest`, `apps/server/src/zero/routes.ts:87`) — not the 0.x API name, and not
something this repo calls. `reference/zero.md` §"Failure modes" documents two paths that resend an
already-applied mutation: a `/mutate` endpoint that throws or never replies ("client resends all
queued mutations"), and a 401/403 that parks the client in `needs-auth` and then "retries all queued
mutations". Zero's server keeps a `lastMutationID` per client and skips anything at or below it —
which is the whole point of the ID. So the *prior* is benign: idempotency bookkeeping logged at
error level by the library.

**The change does not get to assume that.** The build must count these messages per run and compare
passing runs with failing ones. Two outcomes are actionable: if the rate is flat, say so, cite the
counts, and record it as noise; if failing runs show a spike or a gap in the expected IDs, the
resend path is doing real work and the diagnosis changes. `reconnect.spec.ts` deliberately provokes
both resend paths, so a per-file breakdown will separate its contribution from everyone else's.

## Goals / Non-Goals

**Goals**

- A measured before/after first-attempt pass rate over repeated runs of the whole suite (or, where
  wall clock forbids, of `projects.spec.ts` + `connectors.spec.ts` + the three specs measured to be
  slowest), with the actual output quoted.
- Every test starts from the same baseline. What one spec creates cannot be seen by the next.
- The isolation is enforced by a check that goes red, not by a paragraph in a README.
- No constant in the suite encodes fixture size or machine speed.
- Runtime does not get materially worse. The prediction is that it gets **better** — every page load
  syncs a small replica instead of a growing one — and the prediction is stated so it can be wrong.

**Non-Goals**

- Changing product code to make tests convenient. In particular: not adding multi-workspace support,
  and not putting `limit`s on `teams.all` / `projects.all` (a real workspace with 45 teams is a real
  product question, but it is not this change's question and it would alter shipped behaviour).
- Parallelising the suite. `workers: 1` stays; isolation is a prerequisite for parallelism, not this
  change's deliverable.
- Reducing coverage anywhere, for any reason.
- Repairing individual assertions that are merely slow *because* of accumulation — fix the cause
  once, then re-measure, and only then judge what is genuinely under-provisioned.

## Decisions

### D1 — Isolation is a **reset to the bootstrapped baseline**, not a per-file workspace, per-file account, or per-file database

The four options weighed:

| Option | Verdict |
|---|---|
| **Per-file workspace scope** | **Rejected.** The product is single-workspace by construction (`seedWorkspace`'s `where not exists`; `workspace.current` takes the first row). Making this work means shipping multi-workspace support so the harness can use it — production code written for the test suite, and a large change hiding inside a test-reliability change. |
| **Per-file accounts instead of the shared bootstrap admin** | **Rejected as the primary mechanism.** It does not touch the disease: the lists that grow are workspace-level, so a new account still syncs all 45 teams and all 12 invites. It also *adds* rows to `users.all`. It would also throw away what `YAPM_BOOTSTRAP_ADMIN_EMAIL` genuinely buys — `bootstrapFirstAdmin` promotes only when `workspace_member` is empty **and** the caller's email matches, so `admin@example.test` is deterministically the admin regardless of sign-up order, and several specs legitimately need an admin. |
| **Playwright projects / sharding with separate databases** | **Rejected.** One zero-cache process serves one upstream database. N databases means N zero-cache processes, which contradicts the three-container promise for the harness and multiplies CI time and flake surface. |
| **A reset between tests** | **Chosen.** Small, mechanical, complete, and it makes every later page *faster* rather than slower. |

The reset preserves exactly the state the server creates at boot and nothing else: the single
`workspace` row, the bootstrap admin's `user` + better-auth `account` row, and that admin's
`workspace_member` row. Everything else is deleted.

Preserving the admin (rather than deleting it and letting `bootstrapFirstAdmin` re-promote on the
next `/api/zero/token`) is a deliberate choice with a cheap fallback: it keeps `ensureAccount`'s
fast path (sign-up reports "already exists", spec falls through to sign-in) and it keeps admin-ness
independent of who signs in first. If measurement shows preserving auth rows causes trouble —
stale sessions, better-auth internals the harness should not be curating — the fallback is to delete
everything but `workspace` and let the bootstrap re-run, which the email gate makes deterministic.
Whichever is chosen gets recorded under "Decisions made during implementation" with the reason.

### D2 — The reset runs **per test**, with a documented opt-out for files that genuinely need cross-test state

Playwright has no per-file fixture scope. The alternatives were a worker-scoped fixture that
remembers the last `testInfo.file` (breaks on `retries: 1`, because the worker is replaced after a
failure and the memo is lost mid-file, silently wiping state a later test in that file depended on)
or a plain per-test auto fixture. Per-test is both simpler and stronger, and its cost is small: a
few dozen `DELETE`s over near-empty tables plus a smaller sync set on the very next page load.

This is safe only if no test depends on a previous test's fixture. The dominant pattern says it is —
almost every test opens with its file's `enterApp` + `openTeam` helper, building its own team from
scratch — but that is an inference from reading, and **auditing all ~100 tests for cross-test
dependence is an explicit build task**, not an assumption. Where a file genuinely needs shared
state, the opt-out is explicit and named in the file, never silent.

The two existing `test.beforeAll` hooks (`attachments.spec.ts:88`, `search.spec.ts:199`) only open
and close a Kysely handle, so they are unaffected.

### D3 — The reset enumerates its tables from the database, not from a list a human maintains

A hand-kept table list is a leak waiting for the next migration. The reset reads
`information_schema.tables` for the `public` schema, subtracts an explicit, commented
**preserve/ignore** set, and deletes the rest:

- **Preserved:** `workspace`, plus the bootstrap admin's rows in `user`, `account`,
  `workspace_member` (targeted deletes, not table-level). **Superseded by D8: only `workspace` is
  preserved.** The admin is deleted with everyone else and re-promoted by the product's own gate.
- **Never touched:** Kysely's migration bookkeeping, pg-boss's job schema, and anything outside
  `public` (zero-cache's `zero_*` schemas own themselves — see `reference/zero.md` §"Postgres
  objects zero-cache creates").

Deletion is by ordinary `DELETE` in FK-dependency order (or one statement with `ON DELETE` chains
where the schema already cascades), **not** `TRUNCATE`: ordinary row deletes are unambiguously
carried by logical replication, and this change is not the place to find out how Zero's change
streamer treats a `Truncate` message.

### D4 — The isolation contract is executed, not documented

After the reset, and before the test body runs, the fixture asserts every non-preserved table is
empty. It is deliberately close to tautological — that is the point: it catches a reset that
*silently stopped covering a table*, which is precisely the failure mode a hand-maintained list has.
Because the table set is read from `information_schema`, a table added by a future change joins both
the reset and the assertion with no human step.

The change also lands one dedicated spec that runs **last** in the suite (Playwright orders files
lexicographically, so `zz-isolation.spec.ts`), asserting the workspace it inherits holds no teams,
no invites, no projects and no issues. That spec is the falsifiable check: on today's `main` it sees
~45 teams and fails; with this change it sees zero and passes.

### D5 — Browser contexts move to fixtures; manual `newContext()` disappears from spec bodies

17 call sites across 13 files create contexts by hand. They all close in a `finally`, which is
correct on the happy path and racy against Playwright's own teardown when the test times out. They
are replaced by fixtures whose teardown Playwright owns:

- A `secondContext` / `contexts` fixture yielding freshly-made contexts and closing every one after
  the test, once, on both paths.
- The two-client specs (`sync`, `projects`, `retro-ai`, `pm-digest`, `notifications`, `mentions`)
  express "another browser" through that fixture rather than through a `finally`.

This removes the `Target.disposeBrowserContext` noise from failure reports whether or not it was
ever a cause — which is the real benefit, because that error is what made this look like a browser
bug for two days.

### D6 — Every bound is derived; `.first()` over a shared list is treated as a bug

`reconnect.spec.ts:162`'s `retryFromTheKeyboard` is the pattern: count the page's focusable stops,
add a stated margin, walk that many, and say in the failure message how far it walked.
`auto-status.spec.ts`'s `tabTo` already follows it. The sweep covers:

- Tab-stop budgets and any `for` loop with a literal bound.
- `page.getByTestId('invite-link').first()` — six sites. This one is *currently* safe only because
  `invites.all` orders `createdAt desc`, so `.first()` is the newest invite. That is a load-bearing
  coupling between a query's ordering and a test's selector, discovered by reading `queries.ts`, and
  it must be replaced by selecting the invite by something the test itself knows. After D1 the list
  holds one invite anyway, but a selector that is right by accident is still wrong.
- `.nth(i)` and index-based row assertions over lists other specs append to.
- Timeouts: **not** raised as a class. After the reset lands, re-measure; raise only where the
  evidence shows the wait was genuinely under-provisioned, and write the evidence beside the number.
  Every unexplained `20_000` / `30_000` that is *not* justified stays exactly as it is.

### D7 — Nothing is weakened to reach green

No assertion is removed, softened, `test.fixme`'d, `test.skip`'d or newly `test.slow()`'d. The one
existing `test.slow()` (`notifications.spec.ts:181`) is left as found unless measurement shows it is
no longer needed, in which case removing it is a tightening and is reported as one. Any coverage
delta at all is stated explicitly in the change's completion report.

## Risks / Trade-offs

- **A mid-run delete could race zero-cache's replication**, briefly showing a client rows that no
  longer exist. Mitigated by ordering: the reset runs before the test's page navigates and signs in,
  so the client's first sync is already post-delete. If a race is observed, the barrier is to poll a
  cheap post-reset invariant from the first page rather than to sleep. **Open until measured.**
- **Per-test reset breaks a test that secretly depended on a sibling.** Mitigated by the explicit
  audit in D2 and by the fact that such a dependence is itself a defect this change should surface.
  If one is found, it is fixed by giving the test its own fixture — never by re-sharing state.
- **Runtime.** Predicted *faster*, because the growing sync set is the thing being removed. If it is
  slower, the change reports by how much and why the trade is worth it, rather than quietly
  accepting it.
- **Repeated full-suite runs cost wall clock** (~21 min each; four runs before and after is ~3
  hours). The mitigation is to measure the full suite fewer times and the two worst specs many
  times, and to say exactly which numbers came from which.
- **This does not make the suite parallel-safe.** `workers: 1` is still required, because the reset
  is global to one database. Making it parallel needs per-worker databases and is explicitly out of
  scope; the reset is the prerequisite, and the README says so, so nobody assumes otherwise.

## Migration Plan

Not a data migration — a harness migration, done in one build pass because every step touches the
same 21 files:

1. Measure the status quo (failure rate, per-spec duration, row counts per table at each file
   boundary, PushProcessor message counts).
2. Land `reset.ts` + `fixtures.ts` and the executable contract.
3. Migrate all 21 spec files to import `test` from `fixtures.ts`; move the 17 manual contexts onto
   the fixture; audit for cross-test dependence.
4. Sweep the derived bounds.
5. Re-measure the same numbers and report before/after side by side.

## Open Questions

- Does zero-cache need any barrier after a bulk delete, or is arrival ordering sufficient? (D1/risk
  1 — answer by measurement, record the answer.)
- Are the PushProcessor replay messages benign? (Answer with counts from passing and failing runs;
  do not assume either way.)
- Is any of the ~100 tests genuinely dependent on a sibling test's fixture? (Audit; if yes, name it
  and give it its own fixture.)

## Decisions made during implementation

### What was measured, and what was not

**Not measured in this pass, and this matters.** The build pass was explicitly scoped to the fast
gates — `turbo typecheck`, `lint`, affected `test`, `check-boundaries` — and told not to run
Playwright, docker compose, the full build or the smoke test, because the PR is already open and CI
runs the whole suite on every push (PROCESS.md §4: "CI is the gate of record"). So tasks 2.2–2.6 and
7.2–7.4 are **not** ticked, and nothing below claims a number that was not read off something real:

- The baseline failure rate over ≥5 repeated runs of `projects.spec.ts` + `connectors.spec.ts`: **not
  measured.** The evidence for the failure rate remains the three PRs in the Context section.
- Per-spec-file row counts and durations: **not measured.**
- `PushProcessor` message counts split by spec file across a passing and a failing run: **not
  measured.** The prior in the Context section — benign idempotency bookkeeping inside
  `@rocicorp/zero/server`, since Zero keeps a `lastMutationID` per client and skips anything at or
  below it — stands as a prior and nothing more. It has *not* been ruled on with counts.
- Whether `Target.disposeBrowserContext` fires before or after the test timeout: **not measured.**
  The change removes the manual lifecycle either way (D5), which is correct whichever it turns out
  to be, but the falsification is still owed.

The measured before/after pass rate is the deliverable this change advertises, and it is still
outstanding. Whoever runs the review pass should treat "CI went green once" as insufficient and get
those numbers, or say plainly that the change landed without them.

What *was* verified in this pass: the whole `e2e/` tree typechecks under an ad-hoc TS project
(`apps/web/tsconfig.json` deliberately excludes `e2e/` — see D11), `biome ci` is clean over it, and
the assertion multiset before and after is identical bar the two deltas named in D10.

### D8 — The reset deletes the bootstrap admin too, and lets `bootstrapFirstAdmin` re-promote

D1 planned to preserve the admin's `user`, `account` and `workspace_member` rows and named
deleting-everything-but-`workspace` as the fallback. **The fallback was chosen**, for three reasons
found while writing it:

1. Preserving those rows means the harness has to name better-auth's own column layout — which table
   holds the credential, what the user foreign key is called. That is a coupling to a library's
   internals that breaks silently on an upgrade, and CLAUDE.md's rule about not writing post-cutoff
   APIs from memory applies to schemas as much as to functions.
2. The promotion really is deterministic. `bootstrapFirstAdmin` fires only when `workspace_member`
   is empty **and** the caller's address matches `requiredEmail`, and the Playwright server env pins
   `YAPM_BOOTSTRAP_ADMIN_EMAIL=admin@example.test`. No other account can ever be promoted, whatever
   order sign-ups happen in.
3. It is not slower. `ensureAccount` already leads with sign-up and only falls through to sign-in
   when the address is taken, so a cleared account takes the *short* path (one round trip), not the
   long one.

The thing that would have made this wrong is `seedDemoContent`, which runs off the back of a
successful promotion and would then re-seed a demo team, twelve issues, three cycles, two projects
and a retro before **every** test. It does not fire: `SEED_DEMO_CONTENT` defaults to `'false'`
(`apps/server/src/config/env.ts`) and the Playwright webServer env does not set it. If a later change
turns that default on, `zz-isolation.spec.ts` goes red immediately, which is the right failure.

`jwks` is in the never-touched set for a reason worth keeping: `apps/server/src/auth.ts` verifies
Zero tokens against a **remote** JWKS set fetched over loopback and cached by `jose` behind a
refetch cooldown. Deleting the row rotates better-auth's signing key, and verification would then
sit behind that cooldown rather than fail fast — a self-inflicted flake of exactly the kind this
change exists to remove.

### D9 — `auth.spec.ts` stopped being a serial journey instead of opting out of the reset

`auth.spec.ts` was the only genuine cross-test dependence in the suite, and it was a real one: a
`test.describe.serial` block where step 3 minted an invite into a module-level `let` that step 4
consumed, and step 4 created the viewer account that steps 5, 6 and 7 signed in as. The audit
(task 4.3) found no others — every other file's tests open with their own `enterApp` + `openTeam`,
and the two `test.beforeAll` hooks (`attachments.spec.ts`, `search.spec.ts`) only open a Kysely
handle.

The plan allowed an explicit, named opt-out for such a file. It was **not** used. Each of the seven
tests now builds its own viewer through one `inviteAViewer` helper — the same admin-mints-invite,
second-context-accepts pattern six other spec files already use — so the contract has no exceptions
and the README has no asterisk. `.serial` is gone with it, which is a strengthening: a failure in one
of those tests no longer skips the six behind it.

Cost: four extra invite-and-sign-up cycles in that file, perhaps 30–40 seconds. Set against a suite
that should get faster overall, that is worth paying to keep the rule absolute.

### D10 — The coverage delta, stated exactly

`git diff main -- apps/web/e2e`, with every assertion line normalised for indentation and compared as
a multiset, shows **two** removals that are not moves or reformats:

1. `expect(inviteLink).not.toBe('')` in `auth.spec.ts`. It asserted that the *previous test in the
   serial block* had populated a module-level variable. With no cross-test state there is no
   variable and nothing to assert; it was never a claim about the product.
2. The `signInViewer` helper, which signed the viewer in through the login form. The viewer now
   arrives by accepting the invite. Form sign-in for a non-admin account is still covered, in the
   same file, by "keyboard-only sign-in reaches the app".

Everything else that the raw grep flags is a move (`page` → `viewerPage`, a helper relocating into
`support.ts`) or a Biome reflow. The `test.slow()` count is 20 before and 20 after — none added, none
removed. No `test.skip`, no `test.fixme`. One assertion was **strengthened**: `retro-ai.spec.ts` now
asserts `toHaveCount(2)` before its two positional reads.

One timeout was raised, with its evidence: `auth.spec.ts`'s "admin changes the viewer role" now waits
20s (was the 15s default) for `Role for <viewer>`. Under the old serial block the viewer had joined
in an earlier test and the row was already in the admin's replica when the test started; the viewer
now joins *during* the test, so the control genuinely waits on one sync hop that it previously did
not. That is an under-provisioned wait by the change's own definition, not a papered-over failure.

### D11 — `e2e/` is not typechecked by `pnpm typecheck`, and this change did not fix that

`apps/web/tsconfig.json`'s `include` is `["src", "vite.config.ts", "vitest.config.ts"]`, so neither
the specs nor `playwright.config.ts` are typechecked by the repo's gates; Playwright transpiles
without checking. Folding `e2e/` in surfaces five pre-existing errors in `e2e/db.ts` — all
`Date` vs `ColumnType<…>` on insert — which exist only because `@yapm/schema/db`'s published types
name `kysely` and `apps/web` does not depend on `kysely`, so TS cannot resolve `ColumnType` from
here. Fixing it properly means adding `kysely` to `apps/web`'s devDependencies (catalog-pinned) and
a lockfile change, which is a different change from this one.

It is not hypothetical: the first draft of `reset.ts` imported `sql` from `kysely` and would have
failed at runtime under Playwright with an unresolvable module, and no gate in this repo would have
caught it. `reset.ts` now goes through the pg `Pool` already on the `Database` handle, which needs no
new dependency. **Named follow-up:** add `kysely` to `apps/web` devDependencies, fix the five
`db.ts` insert types, and put `e2e` in the typecheck project. Until then, the check is
`npx tsc --noEmit` against an ad-hoc project that includes `e2e`, which this pass ran clean.

### D12 — The bounds that were derived, and the ones deliberately left alone

Derived from the page (task 6.1): `sso.spec.ts`'s account-menu walk now counts `menuitem` roles
instead of walking a literal 8, and `search.spec.ts`'s palette walk counts `[cmdk-item]` rows
instead of a literal 12. Both failure messages state the derived bound.

Left alone, with the reasoning rather than silently:

- `retro-ai.spec.ts`'s `tabTo(page, testId, steps)` keeps its numeric budgets (4, 14, 20). Those
  bound a walk over a retro board the test builds in full — they encode DOM arrangement, not fixture
  size or machine speed. Converting it to a full-ring walk like `reconnect.spec.ts` would break its
  in-loop `expect(at).not.toBe('BODY')` assertion, because focus legitimately passes through the
  document body when a tab ring wraps. Deriving the bound would therefore have cost a real
  assertion, which rule 1 forbids.
- `retro.spec.ts`'s `for (let frame = 0; frame < 60 && closingPopup() === null; …)` is a bounded
  `requestAnimationFrame` poll with an exit condition, not a fixed wait. That is already the right
  shape.
- Every `.first()` over a list a test built itself (board cards, retro cards, palette options) stays.
  The `getByTestId('invite-link').first()` sites — thirteen of them, not the six the brief counted —
  are gone: `support.ts`'s `mintInvite` returns the link that was **not** on the page before it
  clicked, which is identity rather than position. `sso.spec.ts` had already invented that pattern
  locally; the shared helper is its generalisation and `sso.spec.ts` now calls it.
- `notifications.spec.ts`'s `rows.nth(0)` / `.nth(1)` are already preceded by
  `expect(rows).toHaveCount(2)` over the recipient's own inbox, which is the derived form.

### D13 — Open, and honestly open

- **Does zero-cache need a barrier after the bulk delete?** Unanswered — it needs a run.
  `zz-isolation.spec.ts` is the instrument: it asserts the *browser* sees the empty states, not just
  that Postgres is empty, so a replica that serves deleted rows fails it. If that turns out to need
  a barrier, the fix is a polled post-reset invariant, never a sleep.
- **Are the `PushProcessor` replay messages benign?** Still a prior, not a ruling. See above.
- **Runtime delta against the ~21-minute baseline.** Predicted faster, unmeasured.

### D14 — What `zz-isolation.spec.ts` actually proves, and the claim it stopped making

D4 and the first draft of the spec both said the last spec "asserts the workspace it inherits from
the whole preceding run holds no accumulated fixtures". Read literally against what was built, that
is false, and it is worth writing down because it is the sentence a reviewer would nod along to.

The reset runs **before** each test, never after. So at the end of any test the database holds that
test's own fixtures, and what `zz-isolation.spec.ts` inherits is not the run's accumulation — it is
the baseline produced from it moments earlier. A version of this spec that opted out of the reset in
order to observe the accumulation directly would fail every run, correctly: the test before it left
its own team behind, exactly as designed.

What is genuinely unique about that position in the suite is the *size* of the job the reset had to
do there — twenty-one files' worth of rows had to disappear immediately before the assertions ran —
and two things the per-test gate structurally cannot check:

1. **The browser.** `assertBaseline` reads Postgres. A client rendering rows the bulk delete removed
   passes a `select count(*)` and breaks the next spec anyway. The empty states, and the
   single-member list, are the only place in the suite where the synced replica is asserted to have
   reached the baseline. This is also the instrument for D13's first open question.
2. **The gate's own coverage.** Both halves of `reset.ts` read the same derived table set, so a
   table wrongly added to `IGNORED_TABLES` leaves the reset and the assertion together and nothing
   goes red. `zz-isolation.spec.ts` names its tables as literals for that reason — `team`, `invite`,
   `project`, `issue`, `cycle`, `retro`, `comment`, `notification`, `attachment`, `pull_request`,
   each one an earlier spec fills. A hard-coded list is the right instrument for checking a derived
   one; it is the wrong instrument for *being* one, which is D3.

Two changes followed from writing this down. The spec delta now states the browser claim rather than
the inheritance claim, and `deletionOrder` throws when the derived table set is **empty** — the one
way this entire gate could have been green while inspecting nothing, reachable by a wrong schema
name or a database the migrations never ran against.

### D15 — No docs-site page, and the one root doc that was missing

PROCESS.md §2 blocks archive on "the pages exist in `apps/docs`". There is no page here, and the
reason is structural rather than an omission: `apps/docs` has exactly two sections, Features and
Self-hosting, serving evaluators, users and operators. This change adds no behaviour any of the
three can observe — no setting, no surface, no env var, so `.env.example`, the compose environment
block and the configuration reference all stay byte-identical, and `pnpm --filter @yapm/docs build`
passes unchanged (35 pages). §2's fourth audience, contributors, is served by the root docs, which
is where the contract went: `apps/web/e2e/README.md` for the rule in full, PROCESS.md §3 for the
tier it belongs to.

`CONTRIBUTING.md` was the gap. Its "Development / Before pushing" section named the fast gates and
said nothing about the e2e suite at all, so a first-time contributor writing a spec would meet the
isolation contract for the first time as a CI failure. It now points at the e2e README in three
lines, next to the gates it sits beside.
