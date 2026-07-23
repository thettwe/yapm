# foundation — tasks

## 1. Monorepo scaffold

- [ ] 1.1 Init pnpm workspace: root package.json (packageManager, engines), pnpm-workspace.yaml with catalog holding the full TECHSTACK.md version baseline, .node-version, .gitignore, .editorconfig
- [ ] 1.2 Add Turborepo with build/dev/typecheck/lint/test/e2e task graph in turbo.json
- [ ] 1.3 Create packages/config: shared tsconfig (TS7, moduleResolution bundler, strict, no baseUrl), Biome config, Tailwind preset stub
- [ ] 1.4 Create empty workspace packages (apps/web, apps/server, apps/docs, packages/schema, packages/ui, packages/api) each with package.json using catalog: refs and passing typecheck
- [ ] 1.5 Add lefthook: pre-commit Biome on staged files, commit-msg Conventional Commits + DCO check
- [ ] 1.6 Add catalog-bypass CI guard script (fails on literal versions for cataloged deps)

## 2. Server skeleton

- [ ] 2.1 apps/server: Hono on Node with pino logging and Zod-validated env config module (fail-fast with named variable and expected format)
- [ ] 2.2 Add /healthz and /readyz endpoints (readyz checks Postgres connectivity; replication-slot check added in task 4)
- [ ] 2.3 packages/schema: Kysely 0.28.17 setup (PostgresDialect + pg Pool), first migration creating the workspace table (client-supplied uuid PK — no DB default, name, created_at, updated_at), and a hand-written `DB` interface (NOT kysely-codegen — it is broken under TS7)
- [ ] 2.4 Migration-on-boot runner: Kysely `Migrator` applies pending migrations before listening (must resolve migration files when running compiled from dist/); seed one workspace row if table is empty
- [ ] 2.5 Static file serving of the built SPA from the app process

## 3. Web skeleton

- [ ] 3.1 apps/web: Vite 8 + React 19 + TanStack Router skeleton with a single index route
- [ ] 3.2 packages/ui: Tailwind v4 + shadcn/ui init on the **default Base UI base** (irreversible choice — see TECHSTACK.md), theme tokens file, one Button as proof; wire into apps/web. Do NOT add `baseUrl` to tsconfig even though shadcn's Vite guide says to — it is a hard TS7 error; use `paths` only
- [ ] 3.3 Ladle workbench running against packages/ui

## 4. Local-first sync walking skeleton

- [ ] 4.1 packages/schema: hand-written Zero schema for workspace (zbugs pattern, `createSchema`/`table`), `createBuilder` export, and a named synced query via `defineQuery`/`defineQueries`
- [ ] 4.2 Server: Zero query endpoint (validates/authorizes named queries) and mutate endpoint wired to shared mutators
- [ ] 4.3 Shared mutator renameWorkspace in packages/schema with validation (non-empty name), imported by client and server
- [ ] 4.4 Web: Zero client setup (IndexedDB), workspace name rendered from synced query, inline rename via shared mutator, keyboard-only path (focus, edit, Enter)
- [ ] 4.5 /readyz replication-slot health check; document the common Zero misconfig errors encountered
- [ ] 4.6 Schema-drift test: introspect live Postgres via `db.introspection.getTables()` and assert BOTH the hand-written Kysely `DB` interface and the Zero schema match it (tables, columns, nullability, types) — fails CI on drift
- [ ] 4.7 Vitest coverage: mutator validation (shared), query authorization; Playwright: rename round-trip, rejected-write rollback, two-client propagation, and reads continuing to work while disconnected

## 5. Self-host deployment

- [ ] 5.1 docker/Dockerfile: multi-stage build → single app image (server + built SPA), pick node:24-slim vs distroless by size/sharp compatibility
- [ ] 5.2 docker/docker-compose.yml: postgres (wal_level=logical, healthcheck) → yapm (migrate-then-serve, healthcheck) → zero-cache (depends_on healthy), named volumes, documented env vars only
- [ ] 5.3 docker/docker-compose.dev.yml: postgres + zero-cache only, for pnpm dev
- [ ] 5.4 pnpm dev orchestration: compose dev deps up + turbo dev (tsx watch + Vite); documented volume reset command
- [ ] 5.5 Verify clean-machine deploy: compose up -d with only documented env vars reaches healthy and serves the synced workspace

## 6. CI pipeline

- [ ] 6.1 .github/workflows/ci.yml: lint → typecheck → test → build with Turborepo + Actions cache, catalog guard, commit check (Conventional Commits + DCO)
- [ ] 6.2 Compose smoke test job: build image, run docker/docker-compose.yml, wait for /readyz, assert workspace renders (Playwright request)
- [ ] 6.3 release-please workflow + GHCR image publish on release (edge from main; multi-arch wiring, polish deferred)

## 7. Verification

- [ ] 7.1 Fresh-clone test on a second machine/VM: pnpm install && pnpm dev works with zero tokens; record time-to-running-app
- [ ] 7.2 Run full spec scenario pass (all five capability specs) and check off against implementation; fix gaps
- [ ] 7.3 README quickstart: the 3-container deploy and the dev loop, honestly measured (containers, RAM, minutes)
