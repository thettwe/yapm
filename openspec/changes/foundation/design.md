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

### Server skeleton and data layer (tasks 2.1–2.5)

16. **Migrations are a hand-maintained static provider, not `FileMigrationProvider`.** `MigrationProvider`
    is a one-method interface, so `packages/schema/src/migrations/index.ts` imports every migration module
    with a real `import` statement and exports `{ '0001_workspace': m0001 }`. `FileMigrationProvider` would
    have to locate a directory at runtime — `import.meta.dirname` points at `src/` under tsx and `dist/`
    after `tsc`, migration files must then be copied or emitted into the image, and a missing folder fails
    at boot rather than at build. With the static provider the module graph *is* the migration list: the
    same code path runs under tsx and from `dist/`, a missing migration is a compile error, and nothing
    depends on CWD or on which files were copied into the container. Cost: adding a migration means
    editing two files. **The object keys are the contract** (they are what lands in `kysely_migration`) —
    never rename or renumber them. Verified both ways: `tsx src/index.ts` from `apps/server` and
    `node dist/index.js` with CWD `/tmp` each applied `0001_workspace` to a fresh database.

17. **`packages/schema` is a compiled package (`dist/` + `exports` → `dist/index.js`), not raw TS.**
    The scaffold pointed `exports` at `./src/index.ts`. That cannot work at runtime: pnpm links workspace
    packages into `node_modules`, and Node refuses to type-strip `.ts` files under `node_modules`. So the
    package builds with `tsc -p tsconfig.build.json` (TS 7.0.2 emits JS **and** `.d.ts` correctly — verified)
    and `turbo`'s `dev` task gained `dependsOn: ["^build"]` so `pnpm dev` cannot start `tsx watch` against a
    missing `dist/`. `packages/schema` also gets a `dev` script (`tsc --watch`) so schema edits propagate
    during development. `build`/`typecheck`/`test` already depended on `^build`.

18. **Env contract lives in one Zod object with a parallel expected-format table.** `loadEnv()` validates
    `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `WEB_DIST_DIR`,
    `SEED_WORKSPACE_NAME`, collects *all* failures, and throws `EnvValidationError` whose message names each
    variable, what was wrong, and the expected format (`DATABASE_URL: is required but not set / expected:
    postgres://user:password@host:5432/database`). Zod 4's own messages describe types, not formats, which is
    what the spec scenario asks for — hence the separate `EXPECTED_FORMAT` map. `main()` prints it to stderr
    and `process.exit(1)` before anything else happens, so a misconfigured process never binds a port.
    `DATABASE_URL` is checked with `z.string().check(ctx => …)` parsing a real `URL` and requiring the
    `postgres:`/`postgresql:` scheme (verified against zod 4.4.3; `z.url({protocol})` was not used because the
    scheme error it produces is less specific).

19. **`WEB_DIST_DIR` defaults relative to the *package* root, not to the source file.** `resolve(import.meta.dirname, '../..')`
    is `apps/server` from both `src/config/env.ts` and `dist/config/env.js`, so the default `../web/dist`
    resolves to `apps/web/dist` in dev and in a `dist/` run. A first attempt anchored on the file itself and
    silently produced `apps/server/web/dist` — caught by running the server, not by types. Container images set
    the variable explicitly. Relative values are resolved against CWD; absolute values pass through.

20. **`/healthz` is dependency-free, `/readyz` is a list of named checks.** Liveness must not fail because
    Postgres is down (Kubernetes/compose would restart-loop a healthy process), so `/healthz` returns
    `{"status":"ok"}` unconditionally. `/readyz` runs `ReadinessCheck[]` and returns
    `{status, checks:[{name, ok, durationMs, reason?}], reason?}` with 200/503. Task 4.5 adds a `replication`
    check to that array and gets its reason string in the aggregate for free. Every check is wrapped in a
    2 s timeout so a hung TCP connection cannot hang the probe.

21. **`pool.on('error')` is mandatory, not defensive.** Discovered by stopping Postgres under a running
    server: node-postgres emits `error` on an idle client, and with no listener Node terminates the process
    (`Unhandled 'error' event`) — readiness could never report not-ready because the server was already dead.
    `createDatabase` now always attaches a listener and forwards it to the optional `onPoolError` callback.
    Re-verified: DB stopped → `/readyz` 503 with `database: connect ECONNREFUSED …`; DB restarted → 200,
    with the process alive throughout.

22. **Seeding takes a transaction-scoped advisory lock.** `insert … select … where not exists` is not
    sufficient on its own: under READ COMMITTED two booting replicas both observe an empty table and both
    insert. Demonstrated against the live database with two overlapping transactions (two rows). The seed now
    runs inside `db.transaction()` behind `pg_advisory_xact_lock(4207331001)`; three server processes booted
    simultaneously against a fresh database produced exactly one migration run and exactly one workspace row.
    The id is minted by the caller (`newId()` in `apps/server/src/index.ts`) rather than inside the seed
    function, matching CLAUDE.md constraint 4.

23. **pino gets a custom `err` serializer.** pino's default serializer copies every own enumerable property
    of an `Error`; a node-postgres `DatabaseError` carries the whole `Client` (connection parameters, type
    tables, socket state) so one dropped connection logged ~4 KB of driver internals per line. `serializeError`
    keeps `type`, `message`, `code`, `stack` and flattens `AggregateError.errors`. The readiness reason string
    unwraps `AggregateError` the same way — otherwise a refused connection reported an empty reason, because
    the aggregate pg throws has `message === ''`.

24. **Static serving: absolute `root`, `path` relative to it, and an explicit placeholder.**
    `@hono/node-server`'s `serveStatic` joins `root` with `path`, so the documented
    `{root:'./public', path:'./public/index.html'}` pairing double-joins; the working form is
    `{root: <abs dir>, path: 'index.html'}` (verified by request tests over a real directory). Mounting is
    `app.use('*', serveStatic({root}))` followed by `app.get('*', …index.html)` for client-side routes, both
    registered *after* the health endpoints so route order — not path exclusion lists — keeps `/healthz` and
    the future `/api` from being shadowed. When `index.html` is absent (no web build yet, task 3.1) the server
    logs a warning and serves a 503 text placeholder instead of pretending to be a broken SPA.

25. **`created_at`/`updated_at` carry `default now()`; `id` deliberately does not.** The task list only
    fixes the id column's lack of a default (client-minted UUIDv7, so `id: string` and not `Generated<string>`
    in the `DB` interface). Timestamps get server defaults so that seeds and future non-mutator writes cannot
    produce null audit columns; mutators will still set them explicitly. Both are `Generated<Timestamp>` in the
    hand-written `DB` interface, which is what the task 4.6 drift test will assert against
    `hasDefaultValue: true`.

26. **Turborepo's strict env mode hides runtime variables from `dev`.** `pnpm turbo dev` started the server
    with an empty environment and it exited with `DATABASE_URL: is required but not set` — turbo 2 runs tasks
    in `envMode: "strict"`, so only declared variables reach the child process. The `dev` task now declares
    `passThroughEnv` for the server's runtime variables (`DATABASE_URL`, `DATABASE_POOL_MAX`, `HOST`,
    `LOG_LEVEL`, `PORT`, `SEED_WORKSPACE_NAME`, `WEB_DIST_DIR`); `passThroughEnv` rather than `env` because
    these are runtime inputs, not cache keys (`dev` is uncached anyway). Task 5.4 must keep this list in sync
    when it adds Zero's variables.

27. **`esbuild` added to pnpm `allowBuilds`.** `tsx` (server dev watch) pulls in esbuild, whose postinstall
    unpacks the platform binary; pnpm 11 blocks it by default and `pnpm install` then fails the workspace with
    `ERR_PNPM_IGNORED_BUILDS`. It joins `lefthook` in the allowlist.

### Web skeleton, design system, and workbench (tasks 3.1–3.3)

28. **`routeTree.gen.ts` is generated by `@tanstack/router-cli`, not committed.** The reference warns that
    `tsc --noEmit` fails on a clean clone with `Cannot find module './routeTree.gen'`, and
    `@tanstack/router-plugin` ships no binary. Committing the file (what the TanStack examples do) makes a
    generated artifact a reviewable diff and lets it drift from the route files. Chosen instead:
    `@tanstack/router-cli` (binary `tsr`) as a devDependency, with `tsr generate &&` prefixing `typecheck`,
    `test` *and* `build` in `apps/web`, and the file gitignored along with `apps/web/.tanstack/`. The version
    skew is only apparent: `@tanstack/router-plugin@1.168.23` depends on `@tanstack/router-generator@1.167.21`
    **exactly**, and `@tanstack/router-cli@1.167.21` depends on the same pinned generator — CLI and plugin emit
    identical output. Generator options live in `tsr.config.json` so the CLI and the Vite plugin cannot
    disagree. Verified: deleting `routeTree.gen.ts` and running `pnpm turbo typecheck lint test build --force`
    gives 13/13 successful.

29. **The dev proxy forwards `/api`, `/healthz` and `/readyz` to `SERVER_ORIGIN` (default
    `http://localhost:3000`).** Proxying only `/api` would leave dev and production disagreeing about which
    paths belong to the server; the app process owns those three prefixes in production (`apps/server/src/app.ts`
    registers health before the SPA wildcard), so dev mirrors it. The origin is read from `process.env.SERVER_ORIGIN`
    because a hardcoded port silently breaks for anyone whose 3000 is occupied — which is exactly what happened
    on this machine (Docker held 3000, and the proxy was observed forwarding to the wrong process). `SERVER_ORIGIN`
    was added to the `dev` task's `passThroughEnv` in `turbo.json`; without it turbo's strict env mode hides it
    (same trap as decision 26). No `rewrite`, so `/api/v1/...` reaches the server unchanged.

30. **shadcn is initialised on `style: base-nova` (Base UI), and the theme file was produced by the real CLI,
    not hand-written.** TECHSTACK.md makes the base irreversible, so it must be exactly what upstream emits.
    `pnpm exec shadcn add button` / `add utils` wrote `packages/ui/src/components/button.tsx` and
    `src/lib/utils.ts` directly, but `shadcn init` refuses to run non-interactively over an existing
    `components.json`, so `src/styles/globals.css` was captured by running `shadcn@4.14.1 init --template vite
    --preset nova --css-variables` in a throwaway project and copying its output verbatim (the `@theme inline`
    token map, the neutral `:root`/`.dark` blocks, `@custom-variant dark`, and the `@layer base` reset). The
    preset id is `nova` on the CLI but `base-nova` in `components.json`; `--preset base-nova` is rejected.

31. **`shadcn` is a runtime dependency of `packages/ui`, and this is not a CLAUDE.md constraint-6 violation.**
    The base-nova style's CSS does `@import "shadcn/tailwind.css"` — the npm package ships 629 lines of
    `@custom-variant`/`@utility` definitions that the components' class strings depend on. So the package must
    be installed, not just `dlx`-ed. It pulls `ts-morph`, which is on the banned list. The ban exists because
    TS 7 has no Compiler API, so tools that *type-check our code* through `import ts from 'typescript'` break;
    `ts-morph` bundles its own TypeScript inside `@ts-morph/common` and here is only reachable through the CLI
    entrypoint, which never runs during `typecheck`, `lint`, `test` or `build`. Nothing in the repo imports it.
    If that ever changes, vendoring `tailwind.css` into `packages/ui` is the escape hatch.

32. **`@source` is declared for both directions, and `packages/config/tailwind/preset.css` is imported rather
    than left dead.** `globals.css` lives in `packages/ui/src/styles`, so it carries `@source '../'` (its own
    components and stories) and `@source '../../../../apps/web/src'` (the consuming app). Verified in the built
    CSS: `whitespace-nowrap` and `bg-clip-padding` come only from `button.tsx` and `max-w-2xl` only from
    `apps/web/src/routes/index.tsx`, and all three are present. The config package's two-token preset (decision
    11) is imported first so `--font-mono` survives while the nova `@theme inline` block's `--font-sans`
    (`Geist Variable`) wins by declaration order — confirmed at runtime: `getComputedStyle(document.documentElement).fontFamily`
    is `"Geist Variable", sans-serif` with the font resolving to `loaded`.

33. **Nothing in `packages/ui` imports types from `@ladle/react`.** Ladle 5.1.1 ships `.tsx` sources *beside*
    the `.d.ts` files in `typings-for-build/`, and TypeScript resolves `./src/ui` to `ui.tsx` before `ui.d.ts`,
    so a single `import type { Story } from '@ladle/react'` drags Ladle's own React-18-era source into the
    program and `tsc --noEmit` fails inside `node_modules` (`skipLibCheck` does not apply — these are not
    declaration files). Rejected: a local ambient shim or a `paths` redirect, both of which hide real API
    changes. Chosen: stories are plain exported functions and `.ladle/components.tsx` types its props
    structurally (`globalState: { theme: string }`). Everything stays inside `tsc`'s program.

34. **`.ladle/components.tsx` may only use `export const`.** Ladle's story discovery
    (`get-components-import.js`) reads `astPath.node.declaration.declarations[0].id.name` for every
    `ExportNamedDeclaration` in that file, so `export function Provider` (and any exported `interface`) crashes
    the build with `TypeError: Cannot read properties of undefined (reading '0')`. The Provider is an arrow
    function assigned to a const and the props interface is not exported.

35. **Ladle runs on its own bundled Vite 6, and that is fine.** `@ladle/react@5.1.1` declares `vite: ^6.0.5` as
    a direct dependency, so the workbench never touches the repo's Vite 8; pnpm's isolated store keeps the two
    apart. `@tailwindcss/vite`'s peer range covers `^6`, so `.ladle/vite.config.ts` (pointed at by
    `viteConfig` in `.ladle/config.mjs`, absolute path — Ladle resolves it with its own `loadConfigFromFile`)
    gives the workbench the same Tailwind pipeline. Verified: `ladle build` emits a 36.9 kB stylesheet
    containing `bg-primary`, `whitespace-nowrap` and `.dark`, and `ladle serve` discovers all three Button
    stories. Ladle also needs `@swc/core` in pnpm `allowBuilds` (`msw` is set to `false` — the addon is off).

36. **The workbench is `pnpm workbench`, not a turbo `dev` task.** `packages/ui` exposes `workbench` /
    `workbench:build` scripts rather than `dev`, so `pnpm dev` (task 5.4) starts only Postgres, zero-cache, the
    Hono server and Vite. A `dev` script here would silently add a fourth long-running process to every
    contributor's onboarding command.

37. **`apps/web` gets Vitest now, one test, crossing the package boundary.** Task 4.7 owns the real test suite,
    but a web package with no `test` script would let `turbo test` pass vacuously over the whole new layer
    (the same failure mode as decision 13). `src/routes.test.tsx` mounts the generated route tree through
    `RouterProvider` with a memory history and asserts the `@yapm/ui` Button renders — which is the only
    automated check that the `exports`-based cross-package `.tsx` consumption actually resolves at runtime.

38. **`packages/ui` publishes subpath `exports` only — no barrel `index.ts`.** `./components/*`, `./lib/*`,
    `./hooks/*` and `./globals.css` map to source files, matching the shadcn monorepo layout and the alias
    table in both `components.json` files (`@yapm/ui/components`, `@yapm/ui/lib/utils`). This is the
    `package.json#imports`/`exports` mechanism the reference recommends specifically because it sidesteps
    `baseUrl`; no tsconfig in the repo declares `baseUrl`, and `apps/web` keeps only `paths: {"@/*": ["./src/*"]}`
    mirrored by `resolve.alias` in `vite.config.ts`. A barrel would also defeat per-component code splitting.

### Local-first sync walking skeleton (tasks 4.1–4.7)

39. **The Zero schema and all sync code live in `packages/schema/src/zero/`, and the Kysely `DB`
    interface stays in `packages/schema/src/db/`.** Both hand-written, in the same package, so a
    migration touches the migration, the `DB` interface and the Zero schema in one commit — the
    coupling the drift test (task 4.6) then enforces. The Zero schema maps `createdAt`/`updatedAt`
    to `number().from('created_at'|'updated_at')` (Zero has no timestamp helper; `timestamptz`
    replicates as epoch-millis `number`, reference §9.1) while the `DB` interface keeps the raw
    snake_case names. `createSchema` is called with `relationships: []` — omitting it made `tsc`
    fail *TS2883 "inferred type cannot be named without a reference to `Relationship`"* because
    the emitted `.d.ts` referenced a non-exported type; the explicit empty array pins it.

40. **`packages/schema` gained a `./db` subpath export.** The server needs the runtime data layer
    (`createDatabase`, `migrateToLatest`, `readReplicationStatus`, the `DB` type) *and* the Zero
    schema/queries/mutators, but the two must not force each other's dependencies onto every
    importer — the browser bundle imports `@yapm/schema` (schema, queries, mutators) and must not
    pull `pg`/`kysely`. Root `@yapm/schema` re-exports the sync surface plus `newId`; `@yapm/schema/db`
    re-exports the Postgres surface. The web app imports only the root; the server imports both.

41. **Query authorization is filter-based, driven by `ctx`, never by args.** `queries.workspace.current`
    returns `zql.workspace.orderBy('createdAt','asc').one()` for a caller with a context and
    `denyAll(q)` (`q.where(({or}) => or())`, the zbugs empty-`or` deny) for an anonymous one. This
    change is single-tenant (all rows visible to any authenticated client), so there is no per-row
    predicate yet, but the deny path and the `ctx`-not-args rule are physical from day one — real
    row permissions in `workspace-auth` slot into this same function. The endpoint re-evaluates the
    named query server-side, so a client cannot widen it: the routes test asserts that passing
    `args` to an argument-less query does not change the emitted AST, and that an unknown query name
    is refused as a structured `app` error rather than executed.

42. **The server derives `ctx` from a `ResolveAuthContext` seam, currently a constant.**
    `apps/server/src/zero/context.ts` exports `resolveAnonymousContext` returning a fixed
    `{userID:'anonymous', role:'member'}`. `workspace-auth` replaces this one function with real
    session/JWT verification (reference §10) without touching the routes. `userID` passed to
    `handleQueryRequest`/`handleMutateRequest` is the same verified id (client-group binding).

43. **The rename mutator normalizes then validates, and the roles model is three-valued.**
    `renameWorkspace` (shared, in `packages/schema`) collapses internal whitespace and trims, rejects
    empty/whitespace-only names *and* names over 200 chars with a `MutationError` (an `ApplicationError`
    subclass carrying `{code, id}` so the client can branch), and rejects `viewer`/absent context with
    `not_authorized` **before** looking at the name (auth-before-existence, reference §5.4). Auth is
    checked before validation so an unauthorized caller never learns whether their input was valid.
    `MutationErrorDetails` is a `type`, not an `interface` — `ApplicationError<T>` constrains `T` to
    `ReadonlyJSONValue`, which an `interface` (no implicit index signature) does not satisfy under TS7.

44. **The editor never disables its input, and rolls back only on an `app` error.** First attempt
    gated the input with a `saving` state and rolled back whenever `write.server` rejected. Both were
    wrong: (a) disabling the input mid-submit blurs it, so the next keystroke/Escape lands on
    `document.body` and the keyboard-only path breaks — the Playwright rename and rejected-write tests
    caught this. `saving` is now a `useRef` re-entrancy guard released the instant the optimistic
    client result resolves, and focus is driven by a ref + `useEffect(…, [editing])`, not `autoFocus`
    (Biome bans it). (b) `write.server` rejecting with `error.type === 'zero'` is a *transport*
    failure — the mutation stays queued and retries on reconnect — so treating it as an authoritative
    rejection reverted an already-applied edit when the socket dropped. The UI rolls back only on
    `error.type === 'app'` (a real server rejection); `zero` errors are surfaced by the connection
    indicator. This is exactly the "disconnection visible, never silently dropped" spec requirement:
    an offline write attempt is blocked at submit (`connection.writable === false`) with the typed
    value **held in the editing surface**, and re-submitting after reconnect succeeds.

45. **Client `disconnectTimeoutMs` is lowered to 5s.** Zero defaults to a full minute in `connecting`
    before admitting `disconnected`, during which writes queue silently. The spec requires
    disconnection to be *visible*; 5s keeps the connection indicator honest without flapping on a
    normal reconnect. The e2e "reads while disconnected" test relies on this to observe the
    `disconnected` state within its window.

46. **The schema-drift test asserts BOTH hand-written descriptions against live Postgres, and is a
    hard failure in CI.** `db.introspection.getTables()` gives columns + nullability + defaults but
    *not* primary keys (reference §8.1), so the test also runs the `pg_index` catalog query for PKs.
    It checks the Kysely `DB` interface (nullability **and** `hasDefaultValue`, so a dropped
    `default now()` or a mis-typed `Generated<>` is caught) and the Zero schema (nullability ↔
    `optional`, PK, and Postgres-type→Zero-type via the reference §9.1 map, keyed off `serverName ?? key`).
    Extra database columns are reported in both directions because Zero replicates whole rows. The
    test `skipIf(DATABASE_URL === undefined)` locally but **throws if `DATABASE_URL` is unset under
    `CI`**, so it can never pass vacuously in the pipeline. `serverName` is read through a structural
    `tableShapes()` helper (`packages/schema/src/zero/introspect.ts`) because `createSchema`'s emitted
    types only expose `serverName` on columns that used `.from()`, defeating a typed walk.

47. **Endpoint→zero-cache auth is an optional `X-Api-Key` check, off by default in dev.**
    `ZERO_QUERY_API_KEY`/`ZERO_MUTATE_API_KEY` are validated env (optional). When set, the route
    returns 403 unless zero-cache presents the matching `X-Api-Key` (reference §10.5). The compose
    stack (task 5.2) will set them; dev omits them so `zero-cache-dev` works with no extra config.

48. **Native/postinstall builds: `@rocicorp/zero-sqlite3: true`, `protobufjs: false` in `allowBuilds`.**
    Zero's native SQLite replica module needs its postinstall to unpack the platform binary (reference
    §1), so pnpm 11 must be told to allow it. `protobufjs` arrives transitively and its postinstall
    only prints a version-scheme warning — blocking it (`false`) is correct and silences the
    `ERR_PNPM_IGNORED_BUILDS` failure. The jose collision (Zero wants 5, better-auth wants 6) is a
    non-issue here: `pnpm peers check` is clean and pnpm's isolated store keeps `jose@5.10.0` and
    `jose@6.2.4` side by side; better-auth is not yet installed.

49. **e2e runs Playwright against the real three-part stack; the config fails fast without a database.**
    `apps/web/playwright.config.ts` starts the yapm server (tsx) and Vite via `webServer`, but Postgres
    and zero-cache must be up already (the sync path needs them) — so it throws a pointed error if
    `DATABASE_URL` is unset rather than launching a suite that would hang on the WebSocket. The four
    specs (round-trip, rejected-write rollback, two-client propagation, offline reads/blocked writes)
    all passed against `postgres:18 -c wal_level=logical` + `zero-cache@1.8.0`. Full misconfiguration
    log is in `openspec/changes/foundation/zero-operations.md` (task 4.5).

### Self-host deployment (tasks 5.1–5.5)

50. **Runtime base is `node:24-slim`, not distroless (open question resolved).** The built image is
    545 MB (measured with `docker images`); ~170 MB of that is the server's own `node_modules` and the
    node:24-slim base is ~200 MB, so distroless-nodejs would shave only the base delta (~40–50 MB, under
    10%) against real costs: distroless ships no shell, so `docker compose exec` debugging and any
    shell-form healthcheck are impossible, and the forward-looking `sharp` dependency (TECHSTACK.md) needs
    glibc + occasionally runtime libs that slim provides and distroless does not guarantee. slim is glibc
    (not musl/alpine), so native prebuilds — including `@rocicorp/zero-sqlite3`, which `pnpm deploy` still
    builds even though the *app* process never opens a replica — resolve without a source rebuild. The
    healthcheck is `node -e "fetch('/readyz')…"` (Node 24 ships global `fetch`), so no `curl` is needed in
    the image regardless.

51. **The image is assembled with `pnpm deploy --prod --legacy`, not a hand-pruned `node_modules`.** The
    build stage runs `pnpm turbo run build --filter=@yapm/server --filter=@yapm/web` (turbo's `^build`
    pulls `@yapm/schema` and `@yapm/ui` in as it needs them), then `pnpm deploy --filter=@yapm/server --prod
    --legacy /app` produces a self-contained directory: `apps/server/dist` plus a flat `node_modules` with
    `@yapm/schema` (and its `./db` subpath) injected as built `dist`, and dev-only deps (`@yapm/config`,
    vite, react, playwright) excluded. `--legacy` is required — pnpm ≥10 refuses the default injected-deploy
    path unless `inject-workspace-packages=true`, which the repo does not set (`ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`).
    The built SPA is copied separately (`COPY --from=build /repo/apps/web/dist /app/web`) because it is
    static files, not a runtime node dependency, and `WEB_DIST_DIR=/app/web` points the server at it.
    Verified: `node dist/index.js` in the image resolves `@yapm/schema/db` (`migrateToLatest` is a function)
    and serves `web/index.html`.

52. **`VITE_ZERO_CACHE_URL` is a build ARG, because the browser connects to zero-cache directly.** The web
    bundle is Vite-built inside the image, and `import.meta.env.VITE_ZERO_CACHE_URL` is frozen at build time.
    Since the browser — not the server — opens the WebSocket to zero-cache, this must be the
    browser-reachable origin (`http://localhost:4848` for a localhost deploy; a real host/domain rebuilds the
    image). It is a Dockerfile `ARG`/`ENV` and a compose `build.args` value defaulting to `http://localhost:4848`.
    This is the one config that cannot be an env var on the running container.

53. **Three services, single source of truth for credentials, defaults that boot with an empty `.env`.**
    `docker/docker-compose.yml` defines exactly `postgres`, `yapm`, `zero-cache` — no Redis/MinIO/pooler/proxy
    (constraint 1, verified by `docker compose config --services`). Operators set `POSTGRES_USER/PASSWORD/DB`
    once; the app's `DATABASE_URL` and zero-cache's `ZERO_UPSTREAM_DB`/`ZERO_CVR_DB`/`ZERO_CHANGE_DB` are
    *derived* inside compose (`postgres://…@postgres:5432/…`). Every documented var uses `${VAR:-default}`, so
    `docker compose up -d` reaches healthy with no `.env` at all (what the task-5.5 smoke test and the
    future CI compose job need) while staying fully overridable. `ZERO_UPSTREAM_DB` is the direct connection
    by construction — there is no pooler in this stack, and the requirement to bypass one is encoded as a
    comment plus the derived-URL pattern so a future pooler addition cannot silently point replication at it.

54. **zero-cache→endpoint auth is ON by default via a shared `X-Api-Key`, because empty strings fail env
    validation.** `ZERO_QUERY_API_KEY`/`ZERO_MUTATE_API_KEY` are `z.string().min(1).optional()` on the server
    (decision 47), so passing an *empty* string (what `${VAR:-}` yields when unset) throws at boot rather than
    disabling the check. Both containers read the same variable, so they can never disagree; the compose
    default is a non-empty placeholder documented as "change in production". Net effect: the endpoints are
    protected by default (defense in depth) and the clean-machine deploy still boots. Verified: `POST
    /api/zero/query` returns 403 without the header and 200 with the matching key.

55. **Boot order is `depends_on: condition: service_healthy`, and `/readyz` is the app's healthcheck (open
    question resolved).** zero-cache's own healthcheck is `curl -f http://localhost:4848/keepalive` (the
    endpoint the Zero docs' compose uses, present in the `rocicorp/zero` image), so it *can* be probed
    cheaply — but it is not on `yapm`'s dependency path; the ordering that matters is the reverse. The app's
    healthcheck hits `/readyz`, which is 200 before zero-cache exists because a *missing* replication slot is
    treated as healthy (zero-operations.md) — so `yapm` becomes healthy on `migrate + DB-ready` alone, and
    `zero-cache depends_on yapm healthy` starts it only after the schema is migrated (Decision 2's boot
    order, now physical). Verified end-to-end: `postgres healthy → yapm healthy (migration applied, workspace
    seeded) → zero-cache healthy`, `/readyz` reporting `slots: zero_0_a (pgoutput, active, wal_status=reserved)`.

56. **`PGDATA` is pinned to `/var/lib/postgresql/data` on `postgres:18`.** The PG18 official image moved its
    default `PGDATA` to `/var/lib/postgresql/18/docker` (verified by inspecting the image); leaving the named
    volume mounted at the old path would put the volume beside the live data dir and lose durability silently.
    Setting `PGDATA` explicitly and mounting `pgdata` there keeps the volume authoritative and identical
    across PG17/18 (≥15 is the requirement).

57. **`pnpm dev` orchestrates through `scripts/dev.mjs`, invoking the turbo binary directly.** The script
    brings up `docker/docker-compose.dev.yml` (postgres via `up -d --wait`, then zero-cache), injects dev
    defaults (`DATABASE_URL → localhost:5440`, `VITE_ZERO_CACHE_URL`, `SERVER_ORIGIN`) only when unset, then
    spawns `node_modules/.bin/turbo run dev` — **not** `pnpm turbo`. Going through the `pnpm` wrapper triggers
    pnpm 11's `verify-deps-before-run` dep-status check, which in a non-TTY child (or after a Docker
    cache-mount install perturbs `node_modules` mtimes) tries to purge and reinstall `--production`, aborting
    with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` and — worse — would strip devDependencies. Calling the
    turbo binary sidesteps that entirely. Dev zero-cache runs in a container and reaches the host-run server
    via `host.docker.internal` (with an `extra_hosts: host-gateway` entry for Linux). Verified from a clean
    state: both dev containers healthy, server migrated/seeded/listening, replica slot active, Vite on 5173
    with `/readyz` proxying 200.

58. **The volume-reset command is `pnpm dev:reset` (`docker compose -f docker/docker-compose.dev.yml down
    -v`).** Named volumes `pgdata` and `zero-replica` are disposable; `dev:reset` removes them so the next
    `pnpm dev` re-runs migrations and re-seeds the workspace against an empty database (dev-environment
    spec). `pnpm dev:down` stops the containers while keeping the data. Both are root `package.json` scripts
    so they are discoverable next to `dev`.

## Open Questions

- (none remaining for this change)
