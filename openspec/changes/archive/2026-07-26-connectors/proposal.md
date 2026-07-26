## Why

issue-core built the reality strip and the divergence seam as pure functions (`computeDeliverySignal` / `computeDivergence`) that always return null, because no linked git entities exist yet. This change — roadmap #8, `connectors` — is the **wedge**: it lights up that dormant seam with real PR ↔ CI ↔ deploy state from GitHub, so an issue row shows delivery **reality**, not just the intention a human typed. It is delivered not as a GitHub special case but as a first-party **connector framework** whose first (and only v1) connector is GitHub, so GitLab and others slot in later with no feature-code change.

This serves VISION principle #3 (**reality over ritual** — facts that can come from git are never asked of a human), the one-work-graph wedge (`issue ↔ PR ↔ CI run ↔ deploy` become first-class linked entities), and #5/#6 (**free + deployable in minutes** — no new container, an optional GitHub App the operator registers, absent env cleanly disables it).

## What Changes

- **A provider-neutral connector framework** in `packages/schema`: a `ConnectorDefinition` interface (config + secret schemas, `verifySignature`, `parseDelivery`, `ingest`, `reconcile`) and a `WorkGraphMutation` union that is the **firewall** — the only shape feature code sees. GitHub's payloads and a future GitLab's both normalize to it, so the reality strip and divergence logic are written once.
- **A shared encrypted-secrets + connector-config surface** in Postgres (server-only, never Zero-synced): `connector_config` (per-workspace, per-provider: enabled flag, non-secret config, status), `connector_secret` (AES-256-GCM at rest via Node stdlib `crypto`), `connector_installation` (installation id, repo→team mapping, per-resource ETags). Designed provider-neutral so the `ai` change reuses it for BYO provider keys.
- **The work-graph linked entities**, team-scoped and Zero-synced: `pull_request`, `ci_check`, `deployment`, `review`, and an `issue_link` edge (issue ↔ PR). These feed `computeDeliverySignal` / `computeDivergence`, which now return **real** signals — the visible payoff on every row and the detail surface.
- **Issue ↔ PR magic-word linking**: a branch name or PR body containing an issue key (`ENG-142`, case-insensitive) creates the `issue_link`, so a PR drives its issue's reality strip automatically.
- **GitHub ingestion in `apps/server`**: `@octokit/auth-app` App auth; a Hono webhook endpoint that verifies the HMAC `X-Hub-Signature-256` over the raw body, enqueues to pg-boss **serialized per installation** (`key_strict_fifo` on `installation-<id>`), and returns `202`; a worker maps payloads to `WorkGraphMutation[]` applied through the **shared server mutators** (same authz as human writes); ETag/304 reconciliation as the safety net + first-install backfill. All tested against **mocked GitHub** (recorded webhook fixtures + a mocked octokit) — there is no real GitHub App in v1; the operator wires it at deploy.
- **An admin connector settings UI** to configure/enable GitHub and show connection + installation status (over a server-only admin REST surface, since secrets never sync).
- **The reality strip + divergence flag render real state** on issue rows and detail; reality-derived views (blocked-on-review, failing-CI) become available now that the signal is non-null.
- **CI gains the full Playwright e2e suite** (a tracked gap — `ci.yml` currently runs only `scripts/smoke.mjs`).

## Capabilities

### New Capabilities

- `connectors`: the provider-neutral connector framework (`ConnectorDefinition` + `WorkGraphMutation` firewall), the shared encrypted-secrets/connector-config surface, the GitHub connector (App auth, HMAC-verified webhook → pg-boss serialized-per-installation → worker → mutators, ETag reconciliation + backfill), the admin settings UI, and the clean-disable behavior when the optional GitHub App env is absent.
- `work-graph`: the linked delivery entities (`pull_request`, `ci_check`, `deployment`, `review`) and the `issue_link` edge, their team-scoped sync + permissions, the magic-word issue↔PR linking rule, and how they feed the delivery-signal/divergence seam.

### Modified Capabilities

- `issue-tracking`: the reality-strip/divergence computation seam now consumes real linked entities and returns non-null signals; the issue↔PR link is described.
- `issue-list`: reality strip and divergence flag render **real** state; reality-derived views/filters (blocked-on-review, failing-CI) become available now that the signal exists.
- `issue-detail`: the detail surface shows the issue's linked PR/CI/deploy state and any divergence.
- `local-first-sync`: the new work-graph entities replicate under the team scope with row-level permissions; the schema-drift test covers the new tables. Connector secrets/config are explicitly **server-only** (never synced).
- `self-host-deploy`: the optional GitHub App env (App ID, private key, webhook secret) and the `SECRETS_ENCRYPTION_KEY`, all Zod-validated and optional — absent env disables the connector and never crashes boot; adds no container.

## Impact

- **Schema** (`packages/schema`): forward-only migration `0009_connectors` (`pull_request`, `ci_check`, `deployment`, `review`, `issue_link`, plus server-only `connector_config`, `connector_secret`, `connector_installation`); the `DB` interface + Zero schema for the synced work-graph tables (secrets tables excluded from Zero); the `ConnectorDefinition` interface + `WorkGraphMutation` union + `applyWorkGraphMutation` mutators; `computeDeliverySignal`/`computeDivergence` bodies + the linked-entity queries; the AES-256-GCM secret codec; drift test extended.
- **Server** (`apps/server`): the GitHub connector (octokit App, webhook route, HMAC verify, pg-boss `github-webhook` queue serialized per installation, ingest worker, reconcile cron, backfill); the admin connector REST surface; env schema extended.
- **Web** (`apps/web`): the admin connector settings view; the reality strip + divergence flag rendering real state on rows and detail; the reality-derived views/filters unhidden.
- **Dependencies**: `octokit` (already pinned `^5.0.5` in the catalog) added to `apps/server`; no other new dependency (encryption is Node stdlib).
- **CI**: `.github/workflows/ci.yml` gains a Playwright e2e job (fresh DB, `YAPM_HOST_PORT=3210`).

Docs (`apps/docs`): a self-hoster **GitHub connector** setup page (register the App, permissions, events, the four env vars + `SECRETS_ENCRYPTION_KEY`) under Self-hosting, and a user-facing **Delivery signals / reality strip** feature page; both linked from the sidebar/home; `pnpm --filter @yapm/docs build` passes. Root docs updated: README (status + feature list), ROADMAP (#8 status), TECHSTACK (connector/secrets decisions), `.env.example` (new optional vars). New env vars: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `SECRETS_ENCRYPTION_KEY` (all optional; absent disables the connector).

## Non-goals

- **GitLab or any other connector.** Only the framework is provider-neutral; GitHub is the single v1 implementation. GitLab is a later change that implements the same interface with no feature-code change.
- **Live GitHub verification.** There is no real GitHub App in v1; every test runs against recorded webhook fixtures + a mocked octokit. The operator registers and wires the real App at deploy (documented in `apps/docs`).
- **Writing back to GitHub.** v1 is read-only: it ingests PR/CI/deploy state and drives issue reality; it does not post comments, set statuses, or open PRs (permissions start read-only, escalation deferred).
- **AI.** The secrets/config surface is designed provider-neutral so the `ai` change reuses it, but no AI is built here.
- **DORA / delivery-metrics dashboards.** The entities that make those computable land here; the metric views themselves are Phase 2.
- **Incidents** and the deploy→incident edge (Phase 3).
