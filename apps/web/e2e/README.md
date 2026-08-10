# The Playwright suite — the contract

Read this before adding or changing a spec. Every rule here was paid for: three changes were
scoped against one flaking test before the harness could report where it actually failed
(`openspec/changes/e2e-determinism/design.md` is the full record, DI-1 through DI-6).

## The multi-client lifecycle

Every spec imports its `test` (and `expect`) from `./fixtures`, never from `@playwright/test`:

```ts
import { expect, test } from './fixtures'
```

- **Second browsers come from the `newContext` fixture.** A direct `browser.newContext()` in a
  spec body needs a hand-rolled `finally`, which races Playwright's own teardown when the test
  times out and reports `Target.disposeBrowserContext: Failed to find context` **over the real
  failure** — the misreporting that produced two wrong diagnoses in a row. The fixture's teardown
  is owned by Playwright, runs on the pass and the fail path alike, and closes each context
  exactly once. `scripts/check-boundaries.mjs` (rule 7) fails CI on a direct call; the fixture is
  carried from PR #41, whose isolation work was right work credited to the wrong defect.
- **No page reloads unless the test asked.** The `reloadWatch` auto-fixture fails any test whose
  page produces a `type: "reload"` navigation entry the test did not request, naming the URL and
  the reason Zero recorded in `sessionStorage['_zeroReloadReason']`. `page.goto` is a `navigate`,
  and a deliberate `page.reload()` is pre-authorized — the tripwire only fires on the page's own
  act. It exists because a reload chain was hypothesized as the cause of the flake and survived a
  merged proposal before measurement falsified it; this assertion kills the next such theory in
  one run. (The product makes the library's reload path unreachable — `ZeroRoot` supplies
  `onClientStateNotFound` and `onUpdateNeeded` — so this watcher firing means that contract broke.)
- **Growth is visible.** The `workspaceGrowth` auto-fixture annotates every test that leaves the
  workspace holding more rows than it found (`workspace-growth: team +2, issue +5`), and
  `zz-isolation.spec.ts` — lexicographically last, deliberately — asserts the run's total
  population against measured ceilings. A 533-team workspace was once discovered three changes
  after the tests that built it; now the test that grew it is named in its own report.

## A spec passes alone

Every spec file passes by itself against a freshly bootstrapped database, and builds the fixtures
it needs — its own team, its own invite, its own second account — rather than inheriting a
sibling's. A suite whose files depend on each other's leftovers cannot be bisected, and a failure
in it cannot be attributed. There is no per-test database reset: accounts are reused across a run
by design (`ensureAccount` is idempotent), and a fresh database per **run** is the isolation
boundary — which is exactly what CI's fresh compose volumes provide.

## A transient is asserted open before it is used

A menu, popover or dialog that has to open is asserted open before anything inside it is clicked,
keyed on an observable that distinguishes open from closed, with an **idempotent** opener retry —
a retry that re-clicks a toggle closes what it opened and oscillates instead of converging.
`goToMore` and `signOut` in `support.ts` are the pattern: the opener is clicked only while
`aria-expanded` is not `"true"`, and the item is clicked only once it is visible. The deck's
`more▾` is the case this comes from — clickable the instant a route change begins, before the
transient behind it can respond; a click landing in that window opens nothing, and the old
unbounded wait turned that into a sixty-second mystery reported three frames away.
`harness.spec.ts` proves the helper both ways: green through the transient, and failing **at the
menu, naming the item**, when it cannot open.

## Budgets, and what it takes to raise one

- `actionTimeout: 15_000` / `navigationTimeout: 30_000` (`playwright.config.ts`): the slowest
  completed action ever measured in this suite is 1.54s, so 15s is a ~10× margin — every 15s
  failure observed so far had a permanently dead target. Do not raise these to absorb a slow
  surface; a common interaction that newly waits on the network is a product bug (VISION: sub-100ms).
- `goToMore`'s open-retry is bounded at 20s: a genuinely broken transient still fails, naming the
  menu, not the teardown.
- The population ceilings in `zz-isolation.spec.ts` sit ~50% above the measured end-of-run
  population.

Raising any of these takes **evidence, in the PR that raises it**: the measured distribution that
no longer fits (durations for a timeout, the annotated growth trail for a ceiling), and why the
growth is legitimate rather than a leak. A budget raised to make a red run green, without the
numbers, is the suite learning to lie again. The same holds for `test.slow()`: it triples the
budget, it is an inherited claim about a distribution, and it is only earned while the
distribution actually needs it.

## A trustworthy local run

`.node-version` says Node 24 and CI measures under it; a run under another major is a different
experiment. The suite builds the SPA and serves it from the app server itself — one origin, the
production shape, `reuseExistingServer: false`, so a run can never adopt a stale server and assert
against a bundle it did not build. The dev optimizer is absent by construction.

Use a dedicated compose project so the run can neither adopt nor destroy a developer's `yapm-dev`
stack (the compose file hardcodes `name: yapm-dev`; `-p` and the port env must be passed on
**every** compose command):

```bash
# fresh stack, isolated project and ports
POSTGRES_HOST_PORT=5445 ZERO_CACHE_HOST_PORT=4855 YAPM_HOST_PORT=3210 \
  docker compose -p yapm-e2e -f docker/docker-compose.dev.yml down -v
POSTGRES_HOST_PORT=5445 ZERO_CACHE_HOST_PORT=4855 YAPM_HOST_PORT=3210 \
  docker compose -p yapm-e2e -f docker/docker-compose.dev.yml up -d --wait postgres zero-cache

# the run (from apps/web)
DATABASE_URL=postgres://yapm:yapm@localhost:5445/yapm \
E2E_ZERO_CACHE_URL=http://localhost:4855 \
E2E_SERVER_PORT=3210 \
YAPM_ALLOW_INSECURE_DEFAULTS=true \
  pnpm exec playwright test
```

`down -v` between full runs: the fresh database is the isolation boundary, and a number measured
on a reused database is a number about the reuse (that artifact manufactured a whole wrong
diagnosis — design DI-6). Never a bare `down`, and never against the `yapm-dev` project.
