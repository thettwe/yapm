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
  `workspace_member` (targeted deletes, not table-level).
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
