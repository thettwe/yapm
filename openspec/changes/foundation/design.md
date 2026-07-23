# foundation — design

## Context

Greenfield repo containing only decision docs (VISION.md, TECHSTACK.md) and OpenSpec scaffolding. TECHSTACK.md fixes the architecture (TS7/Node 24, Zero, Postgres-only, Vite SPA, Hono, 3-container compose) and the version baseline; this change turns those decisions into a running walking skeleton. The riskiest dependency is Zero (young 1.0) — it must be proven end-to-end before features are built on it.

## Goals / Non-Goals

**Goals:**
- A contributor goes clone → `pnpm dev` → running app in one command.
- An operator goes `docker compose up` → healthy 3-container deployment.
- One synced entity round-trips: Postgres → zero-cache → ZQL in browser, and back via an optimistic shared mutator.
- CI enforces the quality gates (lint, typecheck, test, build, compose smoke).

**Non-Goals:**
- Product features, real schema design, auth, multi-arch release polish, docs content.

## Decisions

1. **Single app image, single process.** Hono serves `/api/*`, Zero's query/mutate endpoints, and the built SPA's static files. No separate frontend server, no nginx — Postgres, zero-cache, and the app are the only containers. *Alternative rejected:* separate web container (adds a 4th container for zero benefit at this scale).

2. **Boot order: postgres → app (migrate, then serve) → zero-cache.** The app container runs the Kysely `Migrator` before listening; zero-cache starts after the app is healthy so the replicated schema always exists. Compose `depends_on: condition: service_healthy` encodes this. *Alternative rejected:* separate migration job container (Plane's `migrator` pattern — more moving parts, same result).

3. **Walking-skeleton entity: `workspace` (id, name, created_at).** It is real (v1 needs it), minimal, and safe to redesign in `workspace-auth`. The skeleton UI is a single page rendering the workspace name from a ZQL query with an inline rename via shared mutator — touching every layer: Kysely migration → hand-written Zero schema → zero-cache → React binding → mutator → server authz (via `zeroKysely`) → Postgres.

8. **Kysely over Drizzle for the data layer.** Zero (`zeroKysely`), pg-boss (`fromKysely`), and better-auth (Kysely is its native layer, the only one where automatic and programmatic migrations work) all support it first-class. The cost is that the Zero schema is hand-written rather than generated — the same choice Rocicorp made in zbugs — so this change also establishes the **schema-drift test**: introspect the live Postgres schema via `db.introspection.getTables()` and assert the Zero schema matches. Drift becomes a CI failure instead of a runtime surprise.

4. **Zero endpoints live in the app server.** `ZERO_QUERY_URL`/`ZERO_MUTATE_URL` point at Hono routes; query validation and mutator execution import from `packages/schema`. This makes the ElectricSQL-fallback boundary physical from day one.

5. **pnpm catalogs from the first commit.** All versions in `pnpm-workspace.yaml` catalog; workspace `package.json`s reference `catalog:`. CI fails if a dependency bypasses the catalog (simple grep check). Renovate config targets the catalog file.

6. **Compose smoke test in CI.** After image build, CI runs the real `docker/docker-compose.yml`, waits for `/readyz`, and asserts the synced entity renders via a Playwright request. This is the 3-container promise as an executable test, not a README claim.

7. **Dev loop = compose for state, watch for code.** `pnpm dev` runs `docker compose -f docker/docker-compose.dev.yml up -d` (postgres + zero-cache only), then `turbo dev` (Hono via tsx watch, Vite dev server). App code never runs in a container during development.

## Risks / Trade-offs

- [Zero replication misconfig (wal_level, direct connection) is the classic setup trap] → compose sets `wal_level=logical` explicitly; `/readyz` verifies replication slot health; docs page for the error messages we hit ourselves.
- [TS7 edge: some transitive tool still imports the TS Compiler API] → CI installs with `--frozen-lockfile` and the repo bans such tools (TECHSTACK.md rule); if one sneaks in via transitive deps it fails loudly at install, not silently.
- [Walking-skeleton schema churn later] → `workspace` is the one table most likely to survive `workspace-auth` nearly unchanged; migrations are forward-only from the first one so churn is exercised, not avoided.
- [pnpm catalog + shadcn CLI friction (generated deps)] → shadcn additions are reviewed by hand into the catalog; acceptable at our component count.

## Migration Plan

First change — nothing to migrate. Rollback = delete the repo contents (docs and openspec/ survive).

## Decisions made during implementation

### Monorepo scaffold (tasks 1.1–1.6)

1. **Three shared tsconfigs, resolved by package name.** `packages/config` ships `tsconfig/base.json`
   (strict, `moduleResolution: bundler`, `types: []`, no `baseUrl`), `tsconfig/vite.json` (adds
   `jsx: react-jsx` + DOM libs) and `tsconfig/node.json` (`module`/`moduleResolution: nodenext`,
   `types: ["node"]`). Ambiguity: the task list says "shared tsconfig" without saying how packages
   reach it. Chosen: `"extends": "@yapm/config/tsconfig/node"` via the package `exports` map rather
   than `../../packages/config/...` relative paths — verified working under TS 7.0.2 with
   `tsc --showConfig`. Neither shared base declares `paths`; `paths` resolve relative to the file that
   declares them, so each package owns its own.

2. **Biome base is `packages/config/biome.base.json`, not `biome.json`.** Biome 2.x auto-discovers any
   nested `biome.json` as a *nested config* for that folder, which would make the shared base behave as
   a per-package override. Naming it `biome.base.json` keeps it inert, and the root `biome.json`
   consists only of `{"extends": ["./packages/config/biome.base.json"]}`. `rules.preset: "recommended"`
   (not the deprecated `rules.recommended`) and `css.parser.tailwindDirectives: true` are both set.

3. **The catalog guard is strict about all literal versions, not just cataloged names.** The spec
   scenario only requires failing when a *cataloged* dependency is declared literally, but the parent
   requirement is "all external dependency versions SHALL be declared once in the catalog". So
   `scripts/check-catalog.mjs` fails on any dependency spec that is not `catalog:`, `workspace:`,
   `link:` or `file:`, with two distinct messages (bypassed catalog entry vs. missing catalog entry).
   It scans the root manifest too.

4. **Conventional Commits + DCO enforced by `scripts/check-commit-msg.mjs`, not commitlint.**
   commitlint would add a dependency tree and a second config format for a ~40-line rule set, and CI
   (task 6.1) needs to run the same check over pushed commits — a plain Node script is callable from
   both lefthook and Actions. Merge/revert/fixup/squash headers are exempt from the header rule;
   the `Signed-off-by:` requirement applies to every commit.

5. **`prepare` delegates to `scripts/install-git-hooks.mjs`.** `lefthook install` exits 128 when there
   is no `.git` directory, which would break `pnpm install` inside a Docker build context (task 5.1).
   The script skips with a printed reason when `.git` is absent and otherwise propagates lefthook's
   exit code — no silent `|| true`.

6. **`react-email` cataloged at `^6.9.0`.** TECHSTACK.md's baseline row says "react-email 1.x"; the
   published latest is 6.9.0 (verified via `npm view`). The baseline row is stale; the catalog follows
   the "latest stable everything" policy. Same check run for every other cataloged entry — all others
   matched the baseline.

7. **`.node-version` holds `24` (major only) while `engines.node` is `>=24`.** A hard pin (`24.13.3`
   or `"node": "24.x"`) fails install on the dev machine, which runs Node 26. `@types/node` stays on
   the 24 line so the type surface matches the LTS floor rather than the local runtime.

8. **pnpm `minimumReleaseAge` left at the v11 default (1440 min).** It is a supply-chain gate worth
   keeping; the committed lockfile makes CI and local resolution identical regardless. `allowBuilds`
   currently lists only `lefthook` — `@rocicorp/zero-sqlite3` and `sharp` get added when those
   dependencies actually arrive.

9. **Placeholder packages contain `export {}` and a real `typecheck` script.** An empty package with no
   TS files would make `turbo run typecheck` pass vacuously; every one of the seven workspace packages
   is really compiled by `tsc --noEmit` from this task forward. `packages/config` is the exception — it
   holds no TypeScript source.

10. **`apps/docs` is a plain TS placeholder for now.** When Astro/Starlight lands it must switch to
    `typescript@6` (`npm:@typescript/typescript6`), because `astro check` is Volar-based and Volar
    needs the Compiler API that TS 7 does not ship. Flagged here so the docs task does not discover it
    as a surprise.

11. **`packages/config/tailwind/preset.css` is a two-token stub** (`--font-sans`, `--font-mono`). The
    real theme tokens belong to `packages/ui` (task 3.2) where shadcn's `components.json` points; the
    preset exists so the config package owns cross-cutting Tailwind defaults without pre-empting the
    design system.

12. **`kysely` is declared by `packages/schema` at scaffold time, ahead of task 2.3.** A pnpm catalog
    entry is inert: it only reaches `pnpm-lock.yaml`'s `catalogs.default` block once some workspace
    package references it as `catalog:`. With placeholder packages carrying only toolchain deps, 42 of
    the 48 catalog entries — including the load-bearing `kysely: 0.28.17` pin from CLAUDE.md
    constraint 5 — existed only as unresolved strings, so the pin was unverifiable from the committed
    lockfile. Chosen: `@yapm/schema` (the declared owner of the Kysely data layer) declares
    `"kysely": "catalog:"` now, one task early, with no import yet. `pnpm-lock.yaml` therefore records
    `kysely@0.28.17` resolved exactly, which is the artifact CI and reviewers can check. Verified
    against the registry that `@rocicorp/zero@1.8.0` peer-requires `kysely: ^0.28.17`, so the exact pin
    satisfies it. The remaining runtime dependencies stay out until the task that imports them.

13. **Lint is a Turborepo *root* task (`//#lint`), not a per-package task.** The first scaffold declared
    a per-package `lint` task in `turbo.json` while no workspace package defined a `lint` script, so
    `pnpm turbo lint` reported `0 successful, 0 total` and exited 0. Both `pnpm turbo lint typecheck
    test build` (CLAUDE.md) and `pnpm turbo typecheck lint test` (the "Fresh clone bootstrap" scenario)
    were therefore green with arbitrary Biome violations anywhere in the tree — the real lint, the root
    `biome ci .` script, was unreachable from turbo. Two fixes were possible: give every package a
    `lint` script, or promote the existing root script to a turbo root task. Chosen: `"//#lint"` bound
    to the root `"lint": "biome ci ."` script. CLAUDE.md constraint 6 makes Biome the only lint tool,
    and Biome is a single whole-repo pass (~30 ms) that also covers root-level files (`scripts/`,
    `turbo.json`, `*.json`) that no package owns; splitting it into seven package tasks would spawn
    seven processes, still need a root task for those files, and lint every file twice. Verified
    empirically that the root task caches *and* invalidates correctly: introducing a violation in
    `apps/web/src/index.ts` and again in `packages/api/src/index.ts` produced a cache miss and a failing
    run both times, and reverting restored `FULL TURBO`. The per-package `lint` task entry was deleted
    so no task can silently have zero implementers again.

14. **`turbo test` and `turbo build` legitimately execute zero tasks until tasks 2–3 land.** Unlike the
    lint case this is not a false green: there is no source to build and no test to run yet, so zero
    tasks is the accurate answer rather than a gate that skipped real work. The distinction that
    matters is whether checkable content exists and goes unchecked. Both tasks stay declared in
    `turbo.json` so the first package to add a `build`/`test` script is picked up automatically.

15. **The pre-commit hook checks rather than rewrites (`biome ci`, no `--write`, no `stage_fixed`).**
    While verifying the hook, an interrupted `lefthook`/`biome check --write --stage_fixed` run left the
    repository's unstaged tracked-file edits unrestored — lefthook hides unstaged changes around a
    fixing hook, and an interrupted run does not always put them back (recovered here via
    `git fsck --unreachable`). A hook that mutates and re-stages the working tree owns that failure
    mode permanently; a hook that only reads cannot. `biome ci` on `{staged_files}` is also exactly
    what CI runs, so the hook and the pipeline can no longer disagree, and `fail_text` points the
    developer at `pnpm format`. Cost: formatting is no longer fixed silently at commit time.

## Open Questions

- Node base image: `node:24-slim` vs distroless — decide during implementation by image size and sharp compatibility.
- Whether zero-cache health can be probed cheaply for `depends_on` (it exposes a status endpoint; verify during implementation).
