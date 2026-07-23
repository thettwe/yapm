# yapm — Tech Stack

Decision record, July 2026. Each choice lists the reason and the rejected alternative. Constraints inherited from [VISION.md](VISION.md): sub-100ms interactions (principle #1), ≤3-container self-host (principle #6), 100% AGPL-compatible dependencies, solo-founder velocity, widest OSS contributor funnel.

## The architecture in one picture

```
docker-compose.yml
├─ yapm        — Node: API + auth + GitHub ingestion + serves static SPA
├─ zero-cache  — Zero sync engine (Apache-2.0, Rocicorp)
└─ postgres    — ≥15, wal_level=logical  (source of truth, job queue, everything)

≈ 3 containers, ~1GB RAM   (Plane: 13 containers / 4–8GB · Huly: 14 services)
```

Client reads run as ZQL queries against a local IndexedDB replica — instant, and they keep working while disconnected. Writes are optimistic custom mutators validated server-side, rebased on the server-ordered log; Zero rejects writes while offline, so disconnection must be visible in the UI rather than silently queued. This is Linear's architecture shape (local object graph + server-authoritative delta log + LWW) without building Linear's engine (6–12+ engineer-months to harden).

## Core decisions

| Layer | Choice | Why / rejected alternative |
|---|---|---|
| **Language** | **TypeScript 7** (native Go compiler, GA 2026-07-08) on **Node 24 LTS** | One language across client/server/shared schema; widest OSS contributor funnel (Cal.com 438+ contributors). TS7's native `tsc` type-checks 8–12x faster — a real DX win for an OSS repo (fast CI, fast editor). *Rejected: Go single-binary* — best ops halo (Gitea), but forces building the sync engine ourselves or abandoning local-first; sacrifices vision principle #1 to over-serve #6. *Bun*: revisit when boring. |
| **Sync engine** | **Zero** (Rocicorp) | Apache-2.0 client *and* server; Postgres-native; +1 container with first-class self-host docs; synced queries solve multi-tenant permissioned partial sync **with joins** ("issues in projects I'm a member of"); custom mutators give server-authoritative authz. *Rejected: ElectricSQL* (write path + permission denormalization DIY), *PowerSync/Convex* (FSL servers — not open source; unacceptable under an AGPL flagship), *roll-your-own* (Linear has a dedicated team on theirs). |
| **Database** | Postgres ≥15, only | Required by Zero (logical replication); also the job queue and search — one stateful service to back up. *Rejected: SQLite default* — beloved for solo self-host, but single-writer limits at team scale and incompatible with the sync engine. A ~1GB VPS still runs the whole stack. |
| **Frontend** | React 19 + **Vite SPA** | First-class Zero bindings; what Linear uses; largest component ecosystem and contributor pool. **Deliberately not Next.js**: Zero needs no SSR, and Next.js self-host build pain (OOM under 4GB on Cal.com/Documenso threads) is a documented complaint in exactly our audience. *Rejected: Solid* (faster fine-grained reactivity, smaller funnel), *Svelte 5* (community-maintained Zero glue). |
| **Routing** | TanStack Router | Type-safe, SPA-first, pairs naturally with query-driven UI. |
| **UI system** | Tailwind CSS v4 + Radix, scaffolded with **shadcn/ui** | shadcn CLI bootstraps `packages/ui` (MIT, copied-in, zero lock-in; its command component is cmdk) for the boring 80% — dialogs, dropdowns, forms, toasts. Guardrail: stock shadcn look is instantly recognizable; the signature surfaces (issue list, board, command palette, keyboard flows, density/typography) get a bespoke theme and custom components — Linear-grade polish is the bar, scaffold the plumbing, design the soul. |
| **Backend HTTP** | Hono on Node | Lightweight, TS-first, no framework lock-in. Serves: Zero's query/mutate endpoints, auth, GitHub webhooks, public REST API, static SPA. *Rejected: NestJS* (ceremony without payoff at this size). |
| **ORM / schema** | Drizzle | TS-first schema as single source of truth; community `drizzle-zero` converter generates Zero schemas from it. Migrations via drizzle-kit. |
| **Jobs / queue** | **pg-boss** (Postgres-backed) | Keeps the container count at 3 — no Redis. Handles webhook processing, reconciliation syncs, digests. Per-installation serialized processing (the Mergify lesson: GitHub secondary rate limits punish concurrency per install). *Redis only if/when scale demands.* |
| **Auth** | better-auth | Open-source TS auth: email/password, OAuth, and **OIDC/SAML SSO free** — the SSO tax is a vision-level refusal, so SSO cannot live in a paid tier or a second service. |
| **GitHub integration** | GitHub App + webhooks (octokit) | Never polling. Webhook → pg-boss queue (serialized per installation) → work-graph edges. Periodic reconciliation with conditional requests (free 304s) to catch missed events. GitLab later via the same ingestion interface. |
| **Public API** | REST + OpenAPI, webhooks out | Linear's GraphQL-only API is a documented user complaint. Generated from the same schema; full API is a vision commitment ("escape hatches"). |
| **Collaborative text** | Yjs (phase 2+) | For issue descriptions/comments only — Linear's own split: LWW for structured data, CRDT for prose. Not before it's needed. |
| **Testing** | Vitest + Playwright | Unit/integration + the keyboard-driven E2E flows that are the product's soul. |
| **Lint/format** | Biome | One fast tool; zero config debates in an OSS repo. |
| **Monorepo** | pnpm workspaces + Turborepo | Full layout, boundaries, and workflow in [Repository structure](#repository-structure--engineering-workflow) below. |
| **CI** | GitHub Actions | Also dogfoods the CI-ingestion feature later. |
| **Attachments** | Local filesystem volume; optional S3-compatible | MinIO-as-requirement is how Plane/Huly bloat their compose. `STORAGE_*` env flips to any S3-compatible endpoint for cloud/scale. |
| **Search** | Postgres FTS (`tsvector` + `pg_trgm`) | No Elasticsearch, ever (Huly's sprawl). Bonus: recent data is already client-side via Zero — instant local filtering for free. |
| **Rich text** | TipTap (MIT core) | ProseMirror family (what Linear uses); markdown shortcuts; Yjs-ready for Phase 2 collaborative prose. *Rejected: Lexical* (weaker Yjs story). |
| **Email** | Bring-your-own SMTP + react-email | Self-hosters expect SMTP env vars; templates in React like everything else; sending via pg-boss jobs. |
| **Validation** | Zod | One schema language for env config, API bodies, and OpenAPI generation (hono zod-openapi). |
| **Client UI state** | Zustand, sparingly | Zero owns all data state; Zustand only for ephemeral UI (palette, selection, panels). |
| **Images** | sharp | Avatar/attachment thumbnails in the app container. |
| **Charts (Phase 2)** | uPlot / Observable Plot | Lightweight canvas/SVG rendering for metrics views; no charting-framework lock-in. |

## Version baseline (verified against npm/official sources, 2026-07-23)

**Policy: latest stable everything, kept there by Renovate.** New majors adopted when stable (not RC/beta); Node majors adopted when they reach Active LTS.

| Dependency | Version | Notes |
|---|---|---|
| Node.js | **24.x LTS** ("Krypton", EOL 2028-04) | Node 26 becomes LTS ~Oct 2026 — adopt then |
| TypeScript | **7.0.2** | Native Go compiler in the standard `typescript` package; binary is still `tsc`. TS 6.0.3 was the final JS-based release |
| React / react-dom | 19.2.x | |
| Vite | 8.1.x | Rolldown-based since 8.0 (Mar 2026); `@vitejs/plugin-react` 6.x |
| TanStack Router | 1.170.x | SPA only — no TanStack Start (no SSR by design) |
| Tailwind CSS | 4.3.x | `tailwindcss` + `@tailwindcss/vite` on the same minor |
| Hono | 4.12.x | `@hono/zod-openapi` 1.x (Zod 4 line) |
| Drizzle | orm 0.45.x / kit 0.31.x | **Pin stable — do not install 1.0.0-beta dist-tags** |
| @rocicorp/zero | 1.8.x | |
| Zod | 4.4.x | Real v4 package — no `zod/v4` compat-shim imports |
| pnpm / Turborepo | 11.x / 2.10.x | |
| Vitest / Playwright | 4.1.x / 1.61.x | Vitest ≥4.1 required for Vite 8 |
| Biome | 2.5.x | |
| pg-boss / better-auth | 12.x / 1.6.x | |
| TipTap | 3.x | v3 extensions only — never mix v2/v3 packages |
| Astro / Starlight | 7.x / 0.41.x | |
| Others | latest stable | react-email 1.x, octokit 5.x, pino 10.x, sharp 0.35.x, zustand 5.x, cmdk 1.1.x |

**TypeScript 7 adoption notes** (why it's a clean win for this stack):
- Vite/Rolldown and Vitest strip types themselves — TS7 touches only `tsc --noEmit` type-checks and the editor LSP, not the build pipeline. Biome has its own parser; Drizzle/Zod/Hono/TanStack Router ship plain `.d.ts` — all unaffected.
- The Go build has **no JS Compiler API** — so never add tools that import `typescript` programmatically (vite-plugin-dts, ts-morph, knip, typescript-eslint). Biome covers lint; if such a tool ever becomes necessary, alias it to `npm:typescript@^6`.
- tsconfig hygiene from day one: no `baseUrl` (use `paths`), `moduleResolution: "bundler"`, no `target: es5`, `esModuleInterop` stays true. Fresh TS7 codebase = zero migration debt.
- VS Code: TS7 language server via the "TypeScript (Native Preview)" extension until built-in support lands (announced "coming weeks" at GA).

## Repository structure & engineering workflow

```
yapm/
├─ apps/
│  ├─ web/          # React 19 + Vite SPA — TanStack Router, Zero client, cmdk
│  ├─ server/       # Hono on Node — auth, Zero query/mutate endpoints, webhooks,
│  │                #   pg-boss workers, public REST API; serves built SPA in prod
│  └─ docs/         # Astro Starlight
├─ packages/
│  ├─ schema/       # THE source of truth: Drizzle tables → Zero schema (drizzle-zero),
│  │                #   Zod validators, shared mutators, shared domain types
│  ├─ ui/           # design-system components (Radix + Tailwind), keyboard primitives
│  ├─ api/          # OpenAPI spec + typed client, generated from server routes
│  └─ config/       # shared tsconfig, Biome config, Tailwind preset
├─ docker/          # Dockerfile + docker-compose.yml — the 3-container promise lives here
├─ .github/         # ci.yml (lint → typecheck → test → e2e), release.yml (multi-arch GHCR)
└─ turbo.json
```

**Boundary rules** (enforced, not aspirational):
- Apps import packages; packages never import apps; `schema` has zero UI dependencies.
- **Shared mutators live in `packages/schema`** — client and server import the *same function*, which is the Zero correctness model made structural. ZQL stays inside `schema`'s data layer (the ElectricSQL fallback guard).
- All packages are `private: true` — internal only, nothing published to npm. One repo-wide semver for the app.
- **pnpm catalogs**: every dependency version is declared once in `pnpm-workspace.yaml` — the "latest stable everywhere" policy becomes mechanically enforceable, and Renovate updates one file.

**Task pipeline.** Turborepo graph: `build` / `typecheck` (TS7 `tsc --noEmit`) / `lint` (Biome) / `test` (Vitest) / `e2e` (Playwright against the compose stack). Caching via Turborepo local + GitHub Actions cache — deliberately no hosted remote-cache dependency: an OSS contributor's clone must build with zero tokens or accounts.

**Dev experience.** `pnpm dev` is the entire onboarding: starts Postgres + zero-cache via compose, the server in watch mode, and Vite — one command from clone to running app, on any machine with Docker and Node. Toolchain is pinned: `packageManager` field + Corepack for pnpm, `engines`/`.node-version` for Node 24.

**Git hygiene.** lefthook hooks: pre-commit runs Biome on staged files (fast enough to never annoy), commit-msg enforces Conventional Commits + DCO `Signed-off-by`. Conventional Commits feed release automation.

**Releases.** release-please generates the changelog and version PR from commit history; merging it tags the release, and Actions builds the multi-arch images to GHCR (`stable` + version tags; `edge` builds from main). Public REST API is versioned under `/api/v1` with additive-only changes inside a major.

**Component workbench.** Ladle (Vite-native, lighter than Storybook) for developing `packages/ui` in isolation — same Vite pipeline, no second build system.

**Schema conventions** (the ones the architecture forces early):
- **Client-generated UUIDv7 primary keys** — optimistic mutations mean the client mints IDs before the server ever sees them; UUIDv7 is time-ordered so Postgres B-tree indexes don't fragment like UUIDv4.
- `created_at` / `updated_at` on every table; soft-delete only where the product needs undo (issues, projects), hard delete elsewhere — keeps the export/erasure story honest.

## Self-host operations — the reputation layer

**Upgrades are a feature.** Plane's worst reviews are broken minor-version upgrades. Commitments:
- Auto-migrations on boot (drizzle-kit, forward-only, transactional) — `docker compose pull && up -d` is the entire upgrade.
- Strict semver; breaking config changes only in majors, announced loudly in the changelog.
- Image channels: `stable` and `edge`, plus version-pinned tags.
- One-command backup/restore (`yapm backup` → pg_dump + attachments tarball), documented from day one.

**Distribution.** Multi-arch images (amd64 + arm64) on GHCR; single `docker compose up` quickstart; Renovate for dependency updates.

**Observability.** pino structured logs, `/healthz` + `/readyz`, optional Prometheus `/metrics`, optional operator-supplied Sentry-compatible DSN. Nothing reports anywhere by itself.

**Configuration.** Env vars only, Zod-validated at boot with actionable error messages; one reference docs page; no config files to drift.

**Telemetry: ask at setup.** Onboarding explicitly asks yes/no for anonymous usage stats (version, instance-size bucket, enabled features — never content, never IPs). Every field is documented on a public docs page; `TELEMETRY=off` always wins. No silent phone-home — consistent with "free means free."

**Access model.** The schema ships admin / member / **viewer (free, unlimited)** roles from day one — the free-stakeholder-seat promise is a schema decision, not a pricing-page decision.

## Project infrastructure

| Concern | Choice | Why |
|---|---|---|
| **Docs** | Astro Starlight | Open source, self-hostable, docs-as-code in the repo — consistent with the 100%-open stance. |
| **Governance** | **DCO** (`Signed-off-by`) | Permanently forecloses relicensing without every contributor's consent — the legal teeth behind "never relicense." *Rejected: CLA* — the optionality it preserves is exactly what communities read as rug-pull insurance. |
| **Security** | SECURITY.md + private disclosure; webhook signature verification; rate limiting at the Hono layer | Table stakes for a tool holding a team's roadmap. |
| **Spec process** | **OpenSpec** (`openspec/` in repo, `/opsx:*` commands) | Spec-driven development for AI-assisted work: propose → spec with scenarios → apply → archive into living specs. VISION.md = why, TECHSTACK.md = with what, `openspec/specs/` = what precisely. Threshold rule: user-visible behavior or schema changes get a spec; mechanical changes don't. Project context + artifact rules live in `openspec/config.yaml`. |
| **i18n** | Deferred post-v1 | But no hardcoded string literals in components — keep strings extractable so retrofitting isn't a rewrite. |

## Risks and mitigations

1. **Zero is a young 1.0** (June 2026; thin third-party production record). Mitigation: our exposure is a set of named synced queries and custom mutators — a narrow, swappable interface. Fallback path is ElectricSQL + TanStack DB (same Postgres, same optimistic-write shape). Do not let ZQL leak throughout feature code; access it through the data layer in `packages/schema`.
2. **Zero constraints**: Postgres ≥15 + `wal_level=logical`, direct replication connection (no pgbouncer on that path), no PG views/arrays in synced tables, ~232KB gzip client, no SSR. All acceptable; schema design must respect the type limits from day one.
3. **Postgres-only alienates the "runs on a Pi" crowd.** Accepted trade-off: 3 containers on a 1GB VPS is still a category-best story vs 13/14-container incumbents; the wedge is the work graph, not minimal RAM.
4. **pg-boss ceiling**: if GitHub event volume outgrows Postgres queuing, promote to Redis Streams (Mergify's pattern) — an ops upgrade, not a rewrite.

## What v1 explicitly does not include

Mobile and desktop apps, GitLab/Jira import, plugin system, AI features, horizontal scaling of zero-cache. Sequencing lives in the roadmap, not here.
