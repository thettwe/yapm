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
| **UI system** | Tailwind CSS v4 + **Base UI**, scaffolded with **shadcn/ui** (default base) | shadcn 4.x defaults to Base UI and explicitly recommends it for new projects ("Base UI is stable, 1.6.0, 6M+ weekly downloads — the community already made the call"). Radix and React Aria remain one flag away, but staying on the blessed default means upstream components and blocks keep working without divergence. The base is **irreversible after init**. shadcn CLI bootstraps `packages/ui` (MIT, copied-in, zero lock-in; its command component is cmdk) for the boring 80% — dialogs, dropdowns, forms, toasts. Guardrail: stock shadcn look is instantly recognizable; the signature surfaces (issue list, board, command palette, keyboard flows, density/typography) get a bespoke theme and custom components — Linear-grade polish is the bar, scaffold the plumbing, design the soul. |
| **Backend HTTP** | Hono on Node | Lightweight, TS-first, no framework lock-in. Serves: Zero's query/mutate endpoints, auth, GitHub webhooks, public REST API, static SPA. *Rejected: NestJS* (ceremony without payoff at this size). |
| **Data layer** | **Kysely** (query builder, not an ORM) | First-class across the whole stack: Zero ships `zeroKysely`, pg-boss ships `fromKysely`, and better-auth *is* Kysely internally — the only adapter where its automatic and programmatic migrations work. Type-safe SQL without an ORM abstraction, and window functions/percentiles for Phase 2 metrics read naturally. Migrations via Kysely's `Migrator`, applied at boot; `DB` types via kysely-codegen from the live schema. *Rejected: Drizzle* — its one real advantage was `drizzle-zero` generating the Zero schema, but Rocicorp's own zbugs hand-writes that schema, and drift is catchable with a CI test (below). |
| **Types & Zero schema** | Both hand-written, both drift-tested in CI | Migrations are the source of truth; the Kysely `DB` interface and the Zero schema are hand-written against them (the zbugs pattern). `kysely-codegen` is not an option — it silently emits uncompilable output under TS7, since TS7's main export no longer includes the Compiler API. One CI test introspects Postgres (`db.introspection.getTables()`) and asserts **both** artifacts match the live schema, so drift is a build failure rather than a runtime surprise. |
| **Jobs / queue** | **pg-boss** (Postgres-backed) | Keeps the container count at 3 — no Redis. First used by `cycles` for the scheduled cycle auto-rollover; later handles webhook processing, reconciliation syncs, digests. Per-installation serialized processing (the Mergify lesson: GitHub secondary rate limits punish concurrency per install). *Redis only if/when scale demands.* |
| **Auth** | better-auth | Open-source TS auth: email/password, OAuth, and **OIDC/SAML SSO free** — the SSO tax is a vision-level refusal, so SSO cannot live in a paid tier or a second service. |
| **GitHub integration** | GitHub App + webhooks (octokit) | Never polling. Webhook → HMAC verify (`X-Hub-Signature-256`, constant-time) → pg-boss queue (`key_strict_fifo`, `singletonKey: installation-<id>`) → worker maps to a provider-neutral `WorkGraphMutation[]` applied through the shared mutators → work-graph edges. Periodic ETag reconciliation (free 304s) heals missed events. GitLab later via the same interface. |
| **Connector framework** | Provider-neutral `ConnectorDefinition` + `WorkGraphMutation` firewall in `packages/schema` | The only shape feature code sees is the mutation union, so a second connector (GitLab) needs no reality-strip/query/row change. The GitHub octokit/webhook code lives in `apps/server` and calls shared mutators, never raw ZQL. |
| **Encrypted secrets & connector config** | Server-only Postgres tables, AES-256-GCM (Node stdlib) | `connector_config`/`connector_secret`/`connector_installation` are **excluded from the Zero schema** so secrets never sync to a client. Secrets are `v1.iv.tag.ciphertext` blobs under a `SECRETS_ENCRYPTION_KEY`; installation tokens are minted on demand, never persisted. Admin-gated REST (`/api/v1/connectors/...`) returns only redacted status. The `ai` change reuses this surface for BYO provider keys. *Rejected: pgcrypto* (key leaks into SQL/logs). |
| **AI gateway** | **Vercel AI SDK v7** (`ai`, Apache-2.0) behind a thin `apps/server` seam | BYO-key, provider-agnostic (Anthropic/Gemini/OpenAI adapters, all Apache-2.0 → AGPL-safe) unifying text + tool-calling + typed structured output. Wrapped exactly like Zero — a narrow `resolveModel`/`generateStructured`/`runAgent` interface so no `ai`-package type leaks into feature code and the provider is one swappable seam (raw first-party SDK is the documented escape hatch). **In-process only** — the SDK call runs in the app container (no new service, no Redis; pre-compute rides the existing pg-boss), keeping the count at 3. Per-workspace provider+key+model **reuse the connector encrypted-secrets surface** (one `provider="ai"` config row + per-provider secret) — no second store; the key is decrypted only in `apps/server`, never synced, never in the SPA bundle. **Agent-as-actor**: one tool per yapm mutator (`inputSchema` = the mutator's own Zod args), `execute` under the invoking user's `AuthContext` (the role ceiling is the primary injection defense), writes `needsApproval`-gated, loop bounded by `stepCountIs`. Model IDs/prices are **runtime config, never hardcoded** (volatile); tests use the SDK mock provider (no live call). Optional env disables AI cleanly; absent = off. **Shared AI-over-work-graph substrate** every feature reuses: a team-scoped narrowed query (team-level aggregates only, no `assignee/author/reviewer/user_id` dimension — so the model *structurally cannot name a person*) → grounded typed structured output with **cite-evidence-or-omit** (a validator drops any item lacking a real yapm-computed evidence id) + a deterministic name-validator backstop → evidence links to issue/PR/CI/deploy entities → a graceful **AI-off raw-evidence fallback**; the injection architecture is structural (no egress tools, structured-only, numbers computed by yapm, delimited untrusted text). First flagship consumer: a **team-internal, read-only cycle digest** pre-computed at cycle close on the existing pg-boss, rendered on the cycle view with a raw-evidence fallback. *Rejected: managed/hosted agent loops, OpenAI-compat shims, LangChain* (break the self-hosted, acts-via-yapm-mutators thesis or drag heavy trees). |
| **Public API** | REST + OpenAPI, webhooks out | Linear's GraphQL-only API is a documented user complaint. Generated from the same schema; full API is a vision commitment ("escape hatches"). |
| **Collaborative text** | Yjs (phase 2+) | For issue descriptions/comments only — Linear's own split: LWW for structured data, CRDT for prose. Not before it's needed. |
| **Testing** | Vitest + Playwright | Unit/integration + the keyboard-driven E2E flows that are the product's soul. |
| **Lint/format** | Biome | One fast tool; zero config debates in an OSS repo. |
| **Monorepo** | pnpm workspaces + Turborepo | Full layout, boundaries, and workflow in [Repository structure](#repository-structure--engineering-workflow) below. |
| **CI** | GitHub Actions | Also dogfoods the CI-ingestion feature later. |
| **Attachments** | Local filesystem volume; optional S3-compatible | MinIO-as-requirement is how Plane/Huly bloat their compose. `STORAGE_*` env flips to any S3-compatible endpoint for cloud/scale. |
| **Search** | Postgres FTS (`tsvector` + `pg_trgm`) | No Elasticsearch, ever (Huly's sprawl). Bonus: recent data is already client-side via Zero — instant local filtering for free. |
| **Rich text** | TipTap (MIT core) | ProseMirror family (what Linear uses); markdown shortcuts; Yjs-ready for Phase 2 collaborative prose. *Rejected: Lexical* (weaker Yjs story). |
| **Email** | Provider-neutral `Mailer` seam + two transports (SMTP via nodemailer, Resend via `fetch`); react-email templates in `packages/email` | Same framework-plus-implementations shape as the connector `ConnectorDefinition`: the interface is *"send this rendered message to these recipients"* — no `Transporter`, no envelope, no MIME — so a third transport is one file. `SMTP_URL` already reaches Mailgun/Resend/Mailjet/Postmark/SendGrid/SES (they all issue relay credentials) and is the default; the HTTPS transport exists because **some hosts block outbound SMTP ports entirely**, where SMTP cannot be made to work at all — one authenticated JSON POST, **no vendor SDK** (`resend` drags postal-mime + standardwebhooks for a dozen lines of `fetch`). Templates render **once**, above the transport, in `packages/email` — which imports no transport and reads no env, so its JSX/DOM compiler settings never enter `apps/server`. Both transports take an injectable send mechanism, so CI needs no SMTP server and no API key. Sending rides the existing pg-boss instance — no new container, no second scheduler. Absent config = cleanly off, never a boot failure. *Rejected: the Resend SDK; a mail container.* |
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
| Kysely | **0.28.17 — pinned** | Zero 1.8.0 peer-requires `kysely@^0.28.17`; **do not take 0.29.x** (breaking: `Migrator` moved to a `kysely/migration` subpath, CJS dropped). `pg` 8.x driver. `DB` types are hand-written, not generated — `kysely-codegen` is broken under TS7 |
| @rocicorp/zero | 1.8.x | |
| Zod | 4.4.x | Real v4 package — no `zod/v4` compat-shim imports |
| pnpm / Turborepo | 11.x / 2.10.x | |
| Vitest / Playwright | 4.1.x / 1.61.x | Vitest ≥4.1 required for Vite 8 |
| Biome | 2.5.x | |
| pg-boss / better-auth | 12.x / 1.6.x | |
| cron-parser | 5.6.x | pg-boss's own cron parser, promoted from transitive to a **direct** dependency of `apps/server` and pinned to the same range, so every `*_CRON` env var is validated at boot by exactly the parser that will later run it. Without it a typo boots a healthy instance whose sweeps are silently unregistered — pg-boss only parses at `schedule()` time. No new runtime weight: it is already installed |
| ai (Vercel AI SDK) | **7.0.x** | `@ai-sdk/{anthropic,google,openai}` 4.0.x adapters; all Apache-2.0; server-only |
| TipTap | **3.28.0 — pinned exactly, all five catalog entries together** | `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-mention`, `@tiptap/suggestion` — one exact version, never a caret range. The mention and suggestion packages carry **exact** peer ranges on `@tiptap/core`/`@tiptap/pm`, so a split resolution duplicates `prosemirror-model` and throws `RangeError: Adding different instances of a keyed plugin` **at runtime** — invisible to `typecheck` and to `build`. v3 extensions only; never mix v2/v3 packages. `@tiptap/core` is a *peer*, not a catalog entry, and is therefore **not resolvable from `packages/ui`** under pnpm's strict layout: import `Editor` and the core types from `@tiptap/react`, which re-exports them. `@floating-ui/dom` ^1.8.0 is a direct dependency because `@tiptap/suggestion` peer-requires it. Verified API notes: [`reference/frontend-build.md` §11](reference/frontend-build.md) |
| Astro / Starlight | 7.x / 0.41.x | |
| react-email | **`@react-email/render` 2.1.x** (runtime) + `react-email` 6.9.x (dev-only) | react-email **v6 folded every component into the single `react-email` package**, and the whole split `@react-email/*` component family (`@react-email/components` and its ~20 sub-packages) is **deprecated on npm**. `packages/email` therefore depends on `@react-email/render` alone — the renderer, not deprecated — and writes intrinsic JSX directly; `react-email` stays a devDependency for `email dev` preview only, since at runtime it would drag esbuild, socket.io, chokidar and prismjs in to render two messages. `render()` returns a **`Promise<string>`**; plain text comes from `toPlainText(html)` on that same string, not a second render pass |
| nodemailer | 9.0.x | MIT-0, **zero runtime dependencies**. `@types/nodemailer` 8.0.x — its major trails the runtime's, and the pair is verified compatible; no local `.d.ts` needed |
| Others | latest stable | octokit 5.x, pino 10.x, sharp 0.35.x, zustand 5.x, cmdk 1.1.x |

**TypeScript 7 adoption notes** (why it's a clean win for this stack):
- Vite/Rolldown and Vitest strip types themselves — TS7 touches only `tsc --noEmit` type-checks and the editor LSP, not the build pipeline. Biome has its own parser; Kysely/Zod/Hono/TanStack Router ship plain `.d.ts` — all unaffected.
- The Go build has **no JS Compiler API** — `require('typescript')` returns only `{version, versionMajorMinor}`. Never add tools that import `typescript` programmatically (vite-plugin-dts, ts-morph, knip, typescript-eslint). Biome covers lint; if such a tool becomes unavoidable, alias it to the `@typescript/typescript6` package.
- tsconfig hygiene from day one: no `baseUrl` (use `paths` — note shadcn's own Vite guide tells you to add `baseUrl`, which is a hard TS7 error), `moduleResolution: "bundler"`, no `target: es5`, no `outFile`, `esModuleInterop` stays true. (`preserveConstEnums` survives — it was *not* removed, contrary to common claims.) Fresh TS7 codebase = zero migration debt.
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
│  ├─ schema/       # THE data layer: Kysely migrations + generated DB types,
│  │                #   hand-written Zero schema, Zod validators, shared mutators
│  ├─ ui/           # design-system components (Radix + Tailwind), keyboard primitives
│  ├─ api/          # OpenAPI spec + typed client, generated from server routes
│  ├─ email/        # react-email templates → {subject, html, text}. No transport, no env,
│  │                #   no schema dep — which is what keeps its JSX/DOM tsconfig out of server/
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
- Auto-migrations on boot (Kysely `Migrator` for app tables, better-auth `getMigrations()` for auth tables; forward-only, transactional) — `docker compose pull && up -d` is the entire upgrade.
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
5. **`jose` version collision between Zero and better-auth**: Zero 1.8 depends on `jose@5`, `@better-auth/core` 1.6 needs `jose@6`. Under npm's flat hoisting this crashes better-auth at import (`SyntaxError: … 'customFetch'`). pnpm's isolated `node_modules` should keep both copies separate — but verify at install time, and if it leaks, pin per-package resolutions rather than forcing a single version.

## What v1 explicitly does not include

Mobile and desktop apps, GitLab/Jira import, plugin system, AI features, horizontal scaling of zero-cache. Sequencing lives in the roadmap, not here.
