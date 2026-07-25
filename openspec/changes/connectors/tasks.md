# connectors — tasks

## 1. Encrypted-secrets + connector-config surface

- [x] 1.1 Migration `0009_connectors` (part A): server-only `connector_config`, `connector_secret`, `connector_installation` tables (per-workspace/provider config, encrypted blobs, installation id + repo→team mapping + per-resource ETags) — excluded from the Zero schema
- [x] 1.2 AES-256-GCM secret codec in `packages/schema` (Node stdlib `crypto`, version-prefixed `iv‖tag‖ciphertext`) + unit tests (roundtrip, tamper/ wrong-key rejection, never-logged)
- [x] 1.3 `SECRETS_ENCRYPTION_KEY` + `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`/`GITHUB_APP_WEBHOOK_SECRET` in the server Zod env schema (all optional; partial-config fast-fail by name) + env tests
- [x] 1.4 Server-only Kysely accessors for the connector surface (admin-gated); confirm these tables are absent from the Zero schema

## 2. Connector framework (provider-neutral)

- [ ] 2.1 `ConnectorDefinition<Config, Secrets>` interface + `WorkGraphMutation` union in `packages/schema` (no UI/octokit deps)
- [ ] 2.2 `applyWorkGraphMutation` — apply a `WorkGraphMutation[]` through the existing shared server mutators (same authz path) + unit tests
- [ ] 2.3 `parseIssueRefs` pure function (magic-word `<TEAM_KEY>-<NUMBER>` from branch/body, case-insensitive, word-boundary) + unit tests

## 3. Work-graph entities + seam

- [ ] 3.1 Migration `0009_connectors` (part B): team-scoped `pull_request`, `ci_check`, `review`, `deployment`, `issue_link` tables + indexes
- [ ] 3.2 Kysely `DB` interface + Zero schema (tables, relationships to `team`/`issue`/`pull_request`) for the five synced entities
- [ ] 3.3 Team-scoped synced queries for the delivery entities + issue detail/list `.related` linked entities; extend `LinkedEntities` assembler
- [ ] 3.4 Wire real linked entities into `computeDeliverySignal`/`computeDivergence` (bodies + inputs only; signatures unchanged) + unit tests for state/divergence
- [ ] 3.5 Extend the schema-drift test to every new table/column; verify against live Postgres

## 4. GitHub connector (apps/server)

- [ ] 4.1 Add `octokit` (catalog) to `apps/server`; build the `App` (auth-app) client factory, enabled only when the App triplet + encryption key are present
- [ ] 4.2 Webhook Hono route: raw-body capture, `X-Hub-Signature-256` HMAC verify (with fallback-secret rotation), enqueue + `202`; disabled-connector returns not-found/unavailable
- [ ] 4.3 pg-boss `github-webhook` queue (`key_strict_fifo`, `singletonKey: installation-<id>`, dead-letter) + worker (`batchSize: 1`, dedupe on `X-GitHub-Delivery`) driving `ingest`→`applyWorkGraphMutation`
- [ ] 4.4 GitHub `parseDelivery` + `ingest`: map `pull_request`/`pull_request_review`/`check_suite`/`check_run`/`status`/`deployment_status`/`push`/`installation` payloads to `WorkGraphMutation[]`; resolve repo→team; merged-vs-closed
- [ ] 4.5 `reconcile` cron (ETag/304 conditional requests) + first-install backfill sweep, emitting the same `WorkGraphMutation[]`
- [ ] 4.6 Admin connector REST surface (`/api/v1/connectors/...`): redacted status + enable/configure/map, admin-gated

## 5. Web UI

- [ ] 5.1 Admin connector settings view (enable GitHub, connection + installation status, repo→team mapping), keyboard-first, tokenized, all three presets light/dark
- [ ] 5.2 Reality strip renders real PR state / CI health / review age on issue rows; divergence flag renders on diverged rows
- [ ] 5.3 Issue detail shows linked PR/CI/review/deploy state + divergence
- [ ] 5.4 Unhide reality-derived filters/views (blocked-on-review, failing-CI) now that the signal is non-null

## 6. Documentation

- [ ] 6.1 `apps/docs`: self-hoster **GitHub connector** setup page (register the App, permissions, subscribed events, the four optional env vars + `SECRETS_ENCRYPTION_KEY`, clean-disable behavior) under Self-hosting + sidebar
- [ ] 6.2 `apps/docs`: user-facing **Delivery signals / reality strip** feature page + sidebar + home link; `pnpm --filter @yapm/docs build` passes
- [ ] 6.3 Root docs: README (status + feature list), ROADMAP (#8 status), TECHSTACK (connector/encrypted-secrets decisions), `.env.example` (new optional vars) — no stale docs

## 7. Tests + CI gates

- [ ] 7.1 Unit: secret codec, `parseIssueRefs`, `WorkGraphMutation` mapping, delivery-signal/divergence over linked entities, env disable/partial-config
- [ ] 7.2 Integration (live Postgres): HMAC verify (mocked octokit + recorded webhook fixtures), serialized-per-installation ordering + idempotency, ingest→mutator authz + team scope, reconcile 304 path, drift test
- [ ] 7.3 E2E (Playwright): admin enables the connector (mocked GitHub); a linked PR fixture lights up the reality strip on row + detail; divergence flag appears; viewer read-only; keyboard-first
- [ ] 7.4 Add the full Playwright e2e suite to `.github/workflows/ci.yml` (fresh DB per run, `YAPM_HOST_PORT=3210`, boot order postgres → migrate → zero-cache → vite)
- [ ] 7.5 `pnpm turbo lint typecheck test build` green; compose smoke green; docs build green
