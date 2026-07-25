# yapm — Engineering process

How every change is built. Enforced by the change workflows and the PR-review flow, not left to memory.

## 1. Spec-driven, one change at a time

Every behavior/schema change is an OpenSpec change under `openspec/changes/<name>/` (propose → design → specs → tasks → apply → archive). Mechanical changes (typos, renames) skip the ceremony. Specs are the acceptance criteria; the change's Close phase walks every scenario.

## 2. Documentation is definition-of-done

Docs ship *with* the change that adds the behavior — never "later". Enforced at three points:

1. **Proposal** — a `Docs:` line in the Impact section naming the pages this change adds or touches.
2. **Tasks** — a `## Documentation` task group in `tasks.md`.
3. **Close gate** — archive is blocked until: the pages exist in `apps/docs` (Astro Starlight), `pnpm --filter @yapm/docs build` passes, and the config/reference docs match the Zod env schema (no drift).

**No stale docs, ever.** "Docs" is not only the site — a change must update **every root doc it makes stale**: `README.md` (status + feature list), `ROADMAP.md` (change status), `TECHSTACK.md` (version baseline / changed decisions), `.env.example` (new env vars), and any reference/`VISION`/`DESIGN`/`CLAUDE`/`PROCESS` doc whose content it changes. The PR-review flow's `ux-docs` lens flags a stale root doc as a **merge-blocking finding**; mechanical checks catch the detectable cases (`.env.example` vs the Zod schema; ROADMAP status vs archived changes).

Audiences: evaluators (why / the work-graph wedge), self-hosters (install, 3-container stack, config, upgrades, backup, connectors/AI setup), users (features), contributors (architecture, sync model, boundaries, OpenSpec, testing, DCO).

## 3. Three test tiers

- **Unit** (Vitest, no DB): pure logic — mutator validation, permission predicates, color/ordering math, filter logic.
- **Integration** (Vitest against live Postgres + zero-cache): migrations, schema-drift, synced-query permission **scoping**, mutator authz end-to-end, per-team numbering. Self-gated by `describe.skipIf(DATABASE_URL === undefined)`, with an in-CI guard that fails if the DB is absent.
- **E2E** (Playwright against the real 3-container stack): keyboard flows, multi-client sync convergence, offline read / blocked-write, sync **reconnection and recovery** (a refused socket, the protocol errors zero-cache really sends, and a failing or hung sync-credential request — each asserting the visible reconnecting state and recovery *without* a page reload), theme persistence.

**Big-feature rule** — a change needs all three tiers iff it touches **≥2 of** {synced entity/schema, mutator, permission surface, signature UI}. Otherwise it is small: unit + integration only; do not add E2E reflexively.

> CI runs the full Playwright E2E suite as a dedicated `e2e` job (added with `connectors`) alongside the compose smoke test: fresh volumes on the e2e port (`YAPM_HOST_PORT=3210`), booting postgres → migrate → zero-cache → vite. **CI is where e2e runs** — the PR-review flow no longer duplicates it locally; it blocks the merge on the `e2e` and `smoke` checks instead, so merges stay gated on it either way.

## 4. Every feature ships via a reviewed PR

Change workflows build on a `feat/<change>` branch (never direct to `main`), then hand off to **`.claude/workflows/pr-review-flow.js`**:

open PR → **parallel 3-lens review** (correctness+security, constraints+tests, ux+docs) → **adversarial confirm** (one batched skeptic tries to refute every finding — kills false positives and subjective nits) → **fix every confirmed finding**, run the fast gates, push → **re-review the fix commits** (cap 3 rounds; reappearing findings are flagged as stuck) → **merge only when the review is settled AND every GitHub CI check is green**. A stuck finding blocks the merge and is reported, never merged around.

"Fix 100%" means 100% of *confirmed* defects; the adversarial step is what lets the review converge instead of chasing noise.

**Guarantees, whatever the ratings say.** Every confirmed finding is fixed in the round it surfaces. The last fix pass is always re-reviewed before the review can be called settled. A finding is weighed at the more severe of the two ratings it receives unless the downgrade is written down and cited; a critical or high dropped without refuting evidence is reinstated automatically; and a critical or high declared unfixable blocks the merge in code, not by judgement. These hold independently of how any single agent rates anything — which is the point, because ratings that steer the process are ratings worth bending. An adversarial pass over an earlier draft demonstrated exactly that, and the structure above is the result.

**CI is the gate of record.** The fix pass runs *fast gates only* — `turbo typecheck`, `lint`, affected `test`, `check-boundaries` — then pushes immediately so CI overlaps the next review round. It does **not** run the full build, the Playwright e2e suite, docker compose, or the compose smoke test, and the merge pass runs no local gates at all: it joins `gh pr checks --watch` and reads every one. CI covers that ground in 8–10 min, and duplicating it locally on every round plus once more at merge was 67% of the flow's wall clock.

## 5. Parallelism & the working-tree rule

- **Never run two repo-mutating workflows in the same working tree concurrently** — their `git add -A && commit` steps corrupt each other. Safe concurrency = scratchpad-only work (research/planning) alongside one repo workflow, or separate git **worktrees** for genuinely disjoint tracks.
- The verified API references for upcoming work live in [`reference/`](reference/) (`connectors.md`, `ai-providers.md`, `board-dnd.md`, plus the stack refs). Read the relevant one before implementing — the stack postdates model training data.

## 6. Constraints that never bend

See [CLAUDE.md](CLAUDE.md): three containers, ZQL/mutators only in `packages/schema`, client-minted UUIDv7 at the call site, tokenized styling, row-level permissions, free-means-free, team-level metrics only, sub-100ms, keyboard-first.
