# yapm — Engineering process

How every change is built. Enforced by the change workflows and the PR-review flow, not left to memory.

## 1. Spec-driven, one change at a time

Every behavior/schema change is an OpenSpec change under `openspec/changes/<name>/` (propose → design → specs → tasks → apply → archive). Mechanical changes (typos, renames) skip the ceremony. Specs are the acceptance criteria; the change's Close phase walks every scenario.

### Delta hazards — three ways a delta silently destroys work

A `## MODIFIED Requirements` block **replaces a requirement wholesale**: it restates the whole body and every scenario, and archiving overwrites what was there. That is what makes deltas readable, and it is also what makes the following three failures possible. All three are silent, and **`openspec validate --all` catches none of them** — it validates each change in isolation, so a set of changes that destroy each other passes.

1. **Two changes restating one requirement.** Whoever archives last wins, and the other's work is gone with no error. This is not hypothetical: as of 2026-08-16 **three** in-flight changes — `explanation-at-rest`, `destination-budget` and `decision-record` — all restate `team-home`'s *"The team page is an adaptive digest composed from synced work-graph facts"*, and `validate --all` reports 47 passed, 0 failed. **Before authoring a delta, grep the other changes** (including parked ones) for your requirement names:

   ```sh
   grep -rl "Requirement: <the exact name>" openspec/changes/*/specs/
   ```

   If another change claims it, write the **union** and record the required archive order as an explicit pre-archive task. Order is a human obligation here, not a tooling guarantee.

2. **Authoring against `openspec/specs/` when a sibling lands first.** If a merged-but-unarchived change already modifies your requirement, *its* version is your baseline — not the live spec. Restating the live spec reverts the sibling.

3. **Deleting something another capability mandates.** A sentence that looks like trimmable prose on one surface may be *required* by a different capability's spec. `app-frame` mandates the Delivery metrics standfirst; `delivery-metrics` mandates its section standfirsts as "the only place on this work surface where a full sentence is allowed". Removing either is an **amendment to that capability**, argued there — not an application of your own rule. Grep `openspec/specs/` for what requires a thing before proposing its removal.

**A delta cannot reach a capability's `## Purpose` line.** Archiving rewrites only the `## Requirements` section. Verified by dry run: archiving `destination-budget` against a scratch copy applied `+4, ~4, -1` to `app-frame` and left its Purpose line still reading "It carries the six destinations". A Purpose that a change makes stale is a **hand edit in the archiving commit**, and belongs in the change's Documentation task group.

## 2. Documentation is definition-of-done

Docs ship *with* the change that adds the behavior — never "later". Enforced at three points:

1. **Proposal** — a `Docs:` line in the Impact section naming the pages this change adds or touches.
2. **Tasks** — a `## Documentation` task group in `tasks.md`.
3. **Close gate** — archive is blocked until: the pages exist in `apps/docs` (Astro Starlight), `pnpm --filter @yapm/docs build` passes, and the config/reference docs match the Zod env schema (no drift).

**No stale docs, ever.** "Docs" is not only the site — a change must update **every root doc it makes stale**: `README.md` (status + feature list), `ROADMAP.md` (change status), `TECHSTACK.md` (version baseline / changed decisions), `.env.example` (new env vars), and any reference/`VISION`/`DESIGN`/`CLAUDE`/`PROCESS` doc whose content it changes. The PR-review flow's `ux-docs` lens flags a stale root doc as a **merge-blocking finding**; mechanical checks catch the detectable cases (`apps/server/src/config/env-example.test.ts` asserts set equality between the Zod schema, `.env.example`, the `yapm` service's compose `environment:` block and the docs-site configuration reference, modulo two literal, commented exception lists for the container-set and compose-only variables; the same file asserts every `docker compose … -f docker/` invocation in `README.md`, `SECURITY.md` and every page under `apps/docs/src/content/docs/` passes `--env-file`; ROADMAP status vs archived changes).

Audiences: evaluators (why / the work-graph wedge), self-hosters (install, 3-container stack, config, upgrades, backup, connectors/AI setup), users (features), contributors (architecture, sync model, boundaries, OpenSpec, testing, DCO).

## 3. Three test tiers

- **Unit** (Vitest, no DB): pure logic — mutator validation, permission predicates, color/ordering math, filter logic.
- **Integration** (Vitest against live Postgres + zero-cache): migrations, schema-drift, synced-query permission **scoping**, mutator authz end-to-end, per-team numbering. Self-gated by `describe.skipIf(DATABASE_URL === undefined)`, with an in-CI guard that fails if the DB is absent.
- **E2E** (Playwright against the real 3-container stack): keyboard flows, multi-client sync convergence, offline read / blocked-write, sync **reconnection and recovery** (a refused socket, the protocol errors zero-cache really sends, and a failing or hung sync-credential request — each asserting the visible reconnecting state and recovery *without* a page reload), theme persistence.

**The E2E lifecycle contract** (`apps/web/e2e/README.md` is the full text): every spec imports
`test` from `./fixtures`; second browser contexts come from the `newContext` fixture (a direct
`browser.newContext()` fails the boundaries gate — hand-rolled `finally` teardown races
Playwright's own and misreports the failure); a page that reloads without the test asking fails
the test that saw it, naming the reload; every spec file passes **alone** against a freshly
bootstrapped database, building its own fixtures; and a transient (menu, popover, dialog) is
asserted open before anything inside it is clicked. Budgets are measured, and raising one takes
the measured distribution in the PR that raises it.

**Big-feature rule** — a change needs all three tiers iff it touches **≥2 of** {synced entity/schema, mutator, permission surface, signature UI}. Otherwise it is small: unit + integration only; do not add E2E reflexively.

> CI runs the full Playwright E2E suite as a dedicated `e2e` job (added with `connectors`)
> alongside the compose smoke test, on fresh volumes on the e2e port (`YAPM_HOST_PORT=3210`).
> The actual startup order is the workflow's: **postgres and zero-cache come up together
> (`--wait` on both healthchecks), then the Playwright webServer builds the SPA and boots the
> app server, which migrates at boot.** An earlier revision of this section documented
> "postgres → migrate → zero-cache → vite" and the workflow never did that; the disagreement was
> investigated rather than papered over, and the measured answer is that the suspected race does
> not occur — `SchemaVersionNotSupported` is zero across audited CI runs, because zero-cache
> follows the migrations through logical replication after its initial snapshot
> (`openspec/changes/e2e-determinism/design.md` §2.7). **CI is where e2e runs** — the PR-review
> flow no longer duplicates it locally; it blocks the merge on the `e2e` and `smoke` checks
> instead, so merges stay gated on it either way. For a trustworthy local run (isolated
> `yapm-e2e` compose project, fresh volumes per run, Node 24), follow `apps/web/e2e/README.md`.

## 4. Every feature ships via a reviewed PR

Change workflows build on a `feat/<change>` branch (never direct to `main`), then hand off to **`.claude/workflows/pr-review-flow.js`**:

open PR → **parallel 3-lens review** (correctness+security, constraints+tests, ux+docs) → **adversarial confirm** (one batched skeptic tries to refute every finding — kills false positives and subjective nits) → **fix every confirmed finding**, run the fast gates, push → **re-review the fix commits** (cap 3 rounds; reappearing findings are flagged as stuck) → **merge only when the review is settled AND every GitHub CI check is green**. A stuck finding blocks the merge and is reported, never merged around.

"Fix 100%" means 100% of *confirmed* defects; the adversarial step is what lets the review converge instead of chasing noise.

**Guarantees, whatever the ratings say.** Every confirmed finding is fixed in the round it surfaces. The last fix pass is always re-reviewed before the review can be called settled. A finding is weighed at the more severe of the two ratings it receives unless the downgrade is written down and cited; a critical or high dropped without refuting evidence is reinstated automatically; and a critical or high declared unfixable blocks the merge in code, not by judgement. These hold independently of how any single agent rates anything — which is the point, because ratings that steer the process are ratings worth bending. An adversarial pass over an earlier draft demonstrated exactly that, and the structure above is the result.

**The flows merge. That is the contract, not a bug.** `change-build-flow` hands off to `pr-review-flow`, whose terminal step is the merge described above; `docs-change-flow` with `landOn: 'pr'` opens a PR, waits for CI and merges it too. Neither pauses for a second confirmation once the gates are green — the design assumption is that authorising the flow *is* authorising the merge. Two consequences worth knowing before you start one:

- **To stop at an open PR, do not use these flows.** Drive the commit/push/`gh pr create` steps directly, or run the flow and be clear that its merge is what you are asking for. There is no "review it myself first" flag; a mission note asking it to stop is not binding on the merge step.
- **A merge takes the whole branch, including its base.** A stacked branch squash-merged to `main` carries its base commits with it. This happened once: PR #57 was branched off an unmerged docs branch and its squash landed `SCOPE-planning-surfaces.md` on `main` as a side effect, leaving that branch's own PR a no-op. **Check `git merge-base main HEAD` before opening a PR** — if it is not on `main`, decide deliberately whether you are stacking or rebasing.

**CI is the gate of record.** The fix pass runs *fast gates only* — `turbo typecheck`, `lint`, affected `test`, `check-boundaries` — then pushes immediately so CI overlaps the next review round. It does **not** run the full build, the Playwright e2e suite, docker compose, or the compose smoke test, and the merge pass runs no local gates at all: it joins `gh pr checks --watch` and reads every one. CI covers that ground in 8–10 min, and duplicating it locally on every round plus once more at merge was 67% of the flow's wall clock.

## 5. Parallelism & the working-tree rule

- **Never run two repo-mutating workflows in the same working tree concurrently** — their `git add -A && commit` steps corrupt each other. Safe concurrency = scratchpad-only work (research/planning) alongside one repo workflow, or separate git **worktrees** for genuinely disjoint tracks.
- The verified API references for upcoming work live in [`reference/`](reference/) (`connectors.md`, `ai-providers.md`, `board-dnd.md`, `email.md`, plus the stack refs). Read the relevant one before implementing — the stack postdates model training data.

## 6. Constraints that never bend

See [CLAUDE.md](CLAUDE.md): three containers, ZQL/mutators only in `packages/schema`, client-minted UUIDv7 at the call site, tokenized styling, row-level permissions, free-means-free, team-level metrics only, sub-100ms, keyboard-first.
