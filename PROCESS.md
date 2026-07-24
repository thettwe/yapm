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
- **E2E** (Playwright against the real 3-container stack): keyboard flows, multi-client sync convergence, offline read / blocked-write, theme persistence.

**Big-feature rule** — a change needs all three tiers iff it touches **≥2 of** {synced entity/schema, mutator, permission surface, signature UI}. Otherwise it is small: unit + integration only; do not add E2E reflexively.

> Tracked gap: the Playwright E2E suite is not yet run in ongoing CI (only `scripts/smoke.mjs` is). The PR-review flow runs the full E2E suite before every merge, so merges are gated on it; a dedicated CI E2E job is a pending follow-up, to be added with local verification of the boot ordering (postgres → migrate → zero-cache → vite).

## 4. Every feature ships via a reviewed PR

Change workflows build on a `feat/<change>` branch (never direct to `main`), then hand off to **`.claude/workflows/pr-review-flow.js`**:

open PR → **parallel 8-lens review** (correctness, security, yapm-constraints, tests, performance, accessibility, design-fidelity, docs) → **adversarial confirm** (each finding gets a skeptic that tries to refute it — kills false positives and subjective nits) → **fix every confirmed finding, critical → low** → **loop until a review round is clean** (cap 4 rounds; reappearing findings are flagged as stuck) → **merge only when dry AND all gates green** (typecheck/lint/build/unit/integration/e2e/boundaries/three-container). A stuck finding blocks the merge and is reported, never merged around.

"Fix 100% critical→low" means 100% of *confirmed* defects; the adversarial step is what lets the loop converge instead of chasing noise.

## 5. Parallelism & the working-tree rule

- **Never run two repo-mutating workflows in the same working tree concurrently** — their `git add -A && commit` steps corrupt each other. Safe concurrency = scratchpad-only work (research/planning) alongside one repo workflow, or separate git **worktrees** for genuinely disjoint tracks.
- The verified API references for upcoming work live in [`reference/`](reference/) (`connectors.md`, `ai-providers.md`, `board-dnd.md`, plus the stack refs). Read the relevant one before implementing — the stack postdates model training data.

## 6. Constraints that never bend

See [CLAUDE.md](CLAUDE.md): three containers, ZQL/mutators only in `packages/schema`, client-minted UUIDv7 at the call site, tokenized styling, row-level permissions, free-means-free, team-level metrics only, sub-100ms, keyboard-first.
