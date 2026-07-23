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

2. **Boot order: postgres → app (migrate, then serve) → zero-cache.** The app container runs `drizzle-kit migrate` before listening; zero-cache starts after the app is healthy so the replicated schema always exists. Compose `depends_on: condition: service_healthy` encodes this. *Alternative rejected:* separate migration job container (Plane's `migrator` pattern — more moving parts, same result).

3. **Walking-skeleton entity: `workspace` (id, name, created_at).** It is real (v1 needs it), minimal, and safe to redesign in `workspace-auth`. The skeleton UI is a single page rendering the workspace name from a ZQL query with an inline rename via shared mutator — touching every layer: Drizzle schema → drizzle-zero → zero-cache → React binding → mutator → server authz → Postgres.

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

## Open Questions

- Node base image: `node:24-slim` vs distroless — decide during implementation by image size and sharp compatibility.
- Whether zero-cache health can be probed cheaply for `depends_on` (it exposes a status endpoint; verify during implementation).
