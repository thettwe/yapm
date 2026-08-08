## Why

The Playwright suite fails roughly a third of the time on changes that cannot have caused the
failure, and the team has learned to re-run until green — which is exactly how a real regression
gets waved through. Three of the last four PRs failed on their first attempt:

- **PR #37** — a one-attribute change to an issue-title input — failed `e2e/projects.spec.ts:188`
  and `:246`, twice, then passed clean on re-run.
- **PR #39** — **zero product code**: seven static HTML mock files and one markdown file — failed
  both `projects.spec.ts:188` and `connectors.spec.ts:236 › the reality track renders in all three
  presets, light and dark`, then passed on re-run. A static mock cannot break the reality track.
  That run is the proof the failures are environmental, not behavioural.
- **PR #40** — 17 markdown files, one route wrapper, two dead CSS tokens — failed the same
  `projects.spec.ts` pair twice.

The signature points at the harness, not the product: `Test timeout of 60000ms exceeded` (a test
timeout, never a failed expectation) plus
`browserContext.close: Protocol error (Target.disposeBrowserContext): Failed to find context with
id …` on multiple contexts in the same run.

The mechanism is fixture accumulation in a single shared workspace. Every spec signs in as the same
bootstrap admin and 21 spec files pour teams, users, invites, projects and issues into ONE workspace
that is never cleaned. `queries.ts` exposes `teams.all`, `members.all`, `users.all`, `invites.all`
and `projects.all` as **unbounded workspace-wide queries** — `projects.all` even drags each
project's issue subtree — so every later spec syncs, renders and re-renders every earlier spec's
leftovers. The suite therefore gets monotonically slower as it runs, and the late tests are the ones
whose 60s budget runs out. This is not speculation: the `app-frame` change already recorded a
keyboard test failing because the retry button had become the 166th tab stop against a hard-coded
budget of 150, with 45 teams, 13 members and 12 invites accumulated from earlier specs. That symptom
was fixed by deriving the bound from the page; the disease was left in place. Six more UI changes
are queued behind this.

Vision principles served: **sub-100ms interactions** (a suite that cannot tell a slow product from a
slow fixture cannot defend that budget) and the working agreement's **"report failures honestly"** —
a gate nobody believes is not a gate.

## What Changes

- **Diagnose before fixing.** Measure the failure rate over repeated runs of the worst specs,
  instrument fixture growth (rows per table at the start of each spec file) and correlate it with
  per-spec duration. Report real numbers. If the evidence contradicts the accumulation hypothesis,
  follow the evidence.
- **Isolate the fixtures.** Each Playwright test starts from the same baseline: the bootstrapped
  workspace and its admin, and nothing else. A shared `apps/web/e2e/reset.ts` restores that baseline
  through a Playwright auto-fixture, so one spec's data can never slow or confuse another's.
- **Enforce the isolation, do not merely document it.** The reset enumerates the tables it must
  clear from `information_schema` rather than from a hand-kept list, and asserts the baseline is
  clean — so a table added by a future change joins the reset automatically instead of quietly
  re-introducing the leak.
- **Fix the browser-context lifecycle.** Every `browser.newContext()` in the suite is audited for a
  matching close on both the pass and the fail path, and replaced with a Playwright fixture whose
  teardown is automatic. The `Target.disposeBrowserContext` noise stops misdirecting diagnosis.
- **Sweep the hidden caps.** Any constant that silently encodes fixture size or machine speed — tab
  budgets, hard-coded indices, `.nth()`/`.first()` over a list other specs append to, timeouts tuned
  to a fast laptop — is derived from the page instead, copying the pattern already proven in
  `reconnect.spec.ts`.
- **Rule the PushProcessor replay noise in or out with evidence.** The server log carries
  `Ignoring mutation from <clientID> with ID 4 as it was already processed. Expected: 9` in passing
  *and* failing runs. It is either benign idempotency bookkeeping inside `handleMutateRequest` or a
  real symptom; the change says which, with counts from both kinds of run.
- **Prove it.** The deliverable is a measured before/after pass rate over repeated runs, not one
  green run.

**No assertion is weakened, skipped, `fixme`-d, `slow`-ed or deleted.** Coverage after this change
is coverage before it, and any delta is reported explicitly. Raising a timeout counts as a fix only
where the evidence shows the wait was genuinely under-provisioned.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ci-pipeline`: adds the E2E fixture-isolation contract — every Playwright test begins from the
  bootstrapped baseline, the isolation is enforced by an executable gate rather than by convention,
  and no test may encode fixture size or machine speed as a constant.

## Impact

- `apps/web/e2e/` — new `reset.ts` (baseline restore) and `fixtures.ts` (the extended `test` every
  spec imports); all 21 spec files migrate onto it; `support.ts` gains the shared account and
  navigation helpers the migration factors out; `db.ts` unchanged in shape.
- `apps/web/playwright.config.ts` — reporter/timeout posture reviewed against the measured evidence;
  no product code touched.
- No product code, no schema, no mutator, no query, no migration. `packages/schema` is read, never
  written to.
- CI (`.github/workflows/ci.yml`) — the `e2e` job's shape is unchanged; only its reliability is.
- **Docs:** `PROCESS.md` §3 (the E2E tier gains the isolation contract), `apps/web/e2e/README.md`
  (new — the rule the next person writing a spec has to follow), `CLAUDE.md` verification note if
  the local-run instructions change. **No docs-site page**: `apps/docs` serves evaluators,
  self-hosters and users, and has no contributor section; the harness contract belongs with the
  contributor docs at the repo root, beside PROCESS.md.
