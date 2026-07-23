# foundation

## Why

yapm has finished its decision phase (VISION.md, TECHSTACK.md) but has zero code. Every v1 feature — issues, cycles, triage, GitHub sync — depends on the same substrate: the monorepo, the 3-container deployment, the dev loop, CI, and a proven end-to-end Zero sync path. This change builds that substrate as a walking skeleton so the riskiest architectural bet (Zero) is validated before any feature is built on it.

Serves vision principles: **#6 Deployable in minutes** (the 3-container promise is born here) and **#1 Speed is the feature** (the local-first sync pipeline is the speed mechanism, proven first).

## What Changes

- Scaffold the pnpm 11 + Turborepo monorepo: `apps/{web,server,docs}`, `packages/{schema,ui,api,config}`, with pnpm catalogs pinning the TECHSTACK.md version baseline.
- Toolchain: TypeScript 7 (native tsc), Biome, lefthook (Biome pre-commit; Conventional Commits + DCO commit-msg), Corepack/engines pinning Node 24.
- `apps/server`: Hono skeleton with Zod-validated env config, `/healthz` + `/readyz`, pino logging, static SPA serving.
- `apps/web`: Vite 8 + React 19 + TanStack Router skeleton; Tailwind v4 + shadcn/ui initialized in `packages/ui`.
- **Walking skeleton for local-first sync**: one trivial synced entity (workspace name is enough) flowing Postgres → zero-cache → ZQL query in the web app, plus one optimistic custom mutator writing back through the server. Proves the whole pipeline before features depend on it.
- `docker/`: Dockerfile (single app image) + `docker-compose.yml` with exactly 3 containers (app, zero-cache, postgres with `wal_level=logical`); Drizzle auto-migration on boot.
- CI: GitHub Actions — lint → typecheck → test → build (+ compose smoke test); release-please wiring for later.
- One-command dev loop: `pnpm dev` starts Postgres + zero-cache (compose) and server + web in watch mode.

## Non-goals

- No product features: no issues, teams, auth, or GitHub integration (each is its own change).
- No real schema design — the walking-skeleton entity is deliberately throwaway-simple; the work-graph schema arrives with `workspace-auth` and `issue-core`.
- No published docs content in `apps/docs` (Starlight scaffold only).
- No multi-arch release pipeline polish (wired, not perfected).

## Capabilities

### New Capabilities
- `monorepo-workspace`: repo layout, package boundary rules, version catalogs, task pipeline, toolchain pinning
- `dev-environment`: one-command dev loop with hot reload and containerized dependencies
- `self-host-deploy`: 3-container compose deployment, single app image, boot-time migration, health endpoints, Zod-validated env config
- `ci-pipeline`: lint/typecheck/test/build pipeline with compose smoke test and release automation wiring
- `local-first-sync`: end-to-end Zero pipeline — server-validated synced queries, optimistic custom mutators shared client/server via `packages/schema`

### Modified Capabilities

(none — first change)

## Impact

- Creates the entire repo structure; every subsequent change builds inside it.
- New external dependencies: everything in the TECHSTACK.md version baseline (Zero 1.8, Vite 8, Hono 4.12, Drizzle 0.45, etc.).
- Establishes the boundary rules later changes must obey (mutators/ZQL confined to `packages/schema`; packages never import apps).
- `local-first-sync` becomes the capability every feature change extends via delta specs.
