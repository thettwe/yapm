# connectors — design

The verified API surface (octokit versions, signatures, HMAC header, pg-boss `key_strict_fifo`, ETag/304, AES-256-GCM stdlib) is in [`reference/connectors.md`](../../../reference/connectors.md); this document decides how yapm assembles those primitives. Read the reference first — it is the source of truth for every GitHub/octokit fact cited here.

## Context

issue-core shipped the reality strip and the divergence flag as a **pure computation seam** in `packages/schema/src/zero/delivery.ts`: `computeDeliverySignal(issue, linkedEntities)` and `computeDivergence(status, signal)`, both returning null because `LinkedEntities` is empty. Rows render the quiet "not linked" state; the divergence glyph is dormant. The entire visible payoff of this change is making those two functions return real values by supplying real linked entities — **without changing the row layout, the filter model, or the seam's signatures**, exactly as issue-core's design promised ("only this function's body and its `linked` input change").

The work data model is team-scoped: every product row carries `team_id` and syncs under the two-hop `teamScoped` predicate (`queries.ts`). Writes flow through shared mutators in `packages/schema` imported by client and server; the server can extend them with an authoritative pass (per-team numbering already does this). pg-boss already runs on the existing Postgres for cycle maintenance (`apps/server/src/jobs`), proving the no-new-container job pattern.

## Goals / Non-Goals

**Goals:**
- A provider-neutral connector framework whose only provider-specific concerns are auth/config, `parseDelivery`+`ingest`, and `reconcile`; everything downstream sees only a `WorkGraphMutation`.
- Real PR/CI/deploy/review entities, team-scoped and synced, feeding the existing seam so the reality strip and divergence flag light up.
- GitHub ingestion inside the existing app process (pg-boss, no new service), verify-fast/process-async, serialized per installation, self-healing via ETag reconciliation.
- Secrets encrypted at rest, admin-gated, never logged, never synced to clients.
- The optional GitHub App env absent ⇒ connector cleanly disabled ⇒ boot never crashes.
- Everything tested against mocked GitHub (fixtures + mocked octokit); no live App required.

**Non-Goals:**
- GitLab/other connectors (framework only), live GitHub verification (operator wires the App at deploy), writing back to GitHub (read-only v1), AI, DORA dashboards, incidents. See proposal Non-goals.

## Decisions

### 1. Encrypted-secrets scheme — AES-256-GCM, Node stdlib, server-only tables

A single `SECRETS_ENCRYPTION_KEY` (32 random bytes, base64), Zod-validated at boot, drives `crypto.createCipheriv('aes-256-gcm', ...)` with a random 12-byte IV; the stored blob is `v1.<iv>.<tag>.<ciphertext>` (base64 parts, version prefix for lazy re-encryption on future key rotation). Node stdlib only — no dependency (PRINCIPLES: stdlib over deps; reference §6 verified the roundtrip). AES-GCM's 16-byte auth tag makes it tamper-evident; `final()` throws on a wrong/rotated key or tampered ciphertext.

Three **server-only** tables (Kysely-managed, **excluded from the Zero schema** so secrets never replicate to IndexedDB): `connector_config` (per-workspace, per-provider — enabled flag, non-secret JSON config, status, last-sync/error), `connector_secret` (the encrypted blobs — App private key + webhook secret when entered via UI rather than env), `connector_installation` (installation id, repo→team mapping rows, per-`(installation, resource)` ETags). Installation **tokens are never persisted** — octokit's `auth-app` mints and caches them in memory on demand.

*Alternatives considered:* `pgcrypto` (rejected — key leaks into SQL/logs, couples to a PG extension); a userland lib like libsodium/`@47ng/cloak` (rejected — stdlib AES-GCM covers it). *Why env for the master key:* acceptable per GitHub's own private-key docs for single-instance self-host; losing it makes stored secrets unrecoverable (documented in the backup guide); a KMS path is the cloud upgrade.

### 2. Connector interface + WorkGraphMutation firewall

`ConnectorDefinition<Config, Secrets>` lives in `packages/schema` (zero UI deps, holds the mutators): `id`, `displayName`, `configSchema`/`secretSchema` (Zod), `verifySignature(raw, headers, secrets)`, `parseDelivery(raw, headers) → { installationKey, eventType, deliveryId, payload }`, `ingest(event, ctx) → WorkGraphMutation[]`, `reconcile(installation, ctx) → WorkGraphMutation[]`. The GitHub **implementation** (octokit, webhook parsing) lives in `apps/server` — ZQL/mutators must not leak into it; the connector calls mutators, not raw ZQL.

`parseDelivery` is split from `ingest` so the HTTP handler can verify+enqueue in <10ms and the pg-boss worker does the heavy mapping; the returned `installationKey` is the pg-boss `singletonKey`. `WorkGraphMutation` is a discriminated union (`upsertPR` / `upsertCheck` / `upsertReview` / `upsertDeploy` / `linkBranch`) — the **only** shape feature code sees. GitHub's `check_run.conclusion` and a future GitLab pipeline status both normalize to it, so the reality strip is written once. Crucially, mutations are **applied through the existing shared server mutators** (`applyWorkGraphMutation` wraps the same write path human edits use), so connector writes obey the same server-side authz — the identical safety story the `ai` change will want.

*Alternative considered:* a bespoke GitHub-shaped ingest writing rows directly. Rejected — it would rebuild the reality strip per provider and bypass the mutator authz firewall.

### 3. Work-graph entities and how they feed the seam

Five new synced tables, all team-scoped (`team_id`, `teamScoped` predicate): `pull_request` (external id, repo, number, `state` draft/open/approved/changes_requested/merged/closed, `head_sha`, url, timestamps), `ci_check` (fk pull_request, `conclusion`, head sha), `review` (fk pull_request, `state`, `submitted_at`), `deployment` (repo, ref, environment, `state`), and `issue_link` (issue ↔ pull_request edge, with `source` = branch|body). A `connectors`-owned assembler builds a `LinkedEntities` for an issue from its linked PRs + their checks/reviews and passes it to the **unchanged** `computeDeliverySignal`; `computeDivergence` consumes the result. Only `delivery.ts`'s internal mapping and the `LinkedEntities` producer change — the exported signatures, the row, the queries over `issue`, and the filter model are untouched. No git-shaped columns are added to `issue`; delivery reality stays modeled as linked entities behind the seam.

Ingested rows get their `team_id` from the `connector_installation` repo→team mapping; a webhook for an unmapped repo is a no-op (dropped, logged), which keeps every synced row inside a team boundary and preserves team-scoped visibility.

### 4. Issue ↔ PR magic-word linking rule

An issue is linked to a PR when a **branch name** or the **PR body** contains the issue's human key `<TEAM_KEY>-<NUMBER>` (e.g. `ENG-142`), matched case-insensitively with a word boundary (`/\b([A-Z][A-Z0-9]*)-(\d+)\b/i`). The candidate key is resolved against the mapped team's key + the issue number; a match that resolves to no issue in that team is ignored (no fabricated links). Branch matches arrive via `push`/`pull_request` payloads (`head.ref`), body matches via `pull_request` `body`. The link is the `issue_link` edge (`source` records which rule fired); one PR may link several issues and vice-versa. This is a pure function (`parseIssueRefs`) unit-tested independently of GitHub.

*Alternative considered:* only branch-name linking. Rejected — PR-body references (`Closes ENG-142`) are the common human habit; both are cheap.

### 5. Mocked-GitHub test strategy

There is no real App in v1, so every tier mocks GitHub. **Fixtures:** recorded webhook JSON payloads (typed by `@octokit/openapi-webhooks-types`) for `pull_request` (opened/synchronize/closed+merged/ready_for_review), `pull_request_review`, `check_suite`/`check_run`, `status`, `deployment_status`, `push`, and `installation`, checked in under the connector's test dir. **Mocked octokit:** `app.getInstallationOctokit()` returns a stub whose `rest.*` and `graphql` return canned bodies (and a `304`/ETag path for reconcile). HMAC tests sign a fixture with a known test secret and assert verify passes, and a tampered body/signature fails. The worker/ingest tests feed a fixture through `parseDelivery`→`ingest` and assert the resulting `WorkGraphMutation[]` and the rows the mutators write. No test performs network I/O.

### 6. Optional GitHub App env disables cleanly

`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, and `SECRETS_ENCRYPTION_KEY` are all **optional** (the existing `optionalString` preprocess treats empty/whitespace as absent). At boot the server builds the GitHub connector **only if** the App triplet is present *and* a `SECRETS_ENCRYPTION_KEY` exists; otherwise the connector is disabled: the webhook route returns `404`/`503`, no pg-boss `github-webhook` queue or reconcile cron is created, and the admin settings UI shows "not configured" with the exact env vars to set. Boot never crashes on absent connector env — matching how GitHub OAuth and SMTP already degrade. Partial config (e.g. App ID without a private key) is a fast-fail Zod error naming the missing variable, so a half-configured connector never silently misbehaves.

### 7. Webhook path: verify-fast, serialize per installation, reconcile as safety net

The Hono handler captures the **raw body** (before any JSON parse — re-`JSON.stringify` breaks HMAC), verifies `X-Hub-Signature-256` via octokit's `verifyWithFallback` (supporting webhook-secret rotation), enqueues `{ deliveryId, eventType, payload, installationKey }` to the `github-webhook` pg-boss queue with `singletonKey: installation-<id>` and `policy: 'key_strict_fifo'`, and returns `202`. The worker (`batchSize: 1`) dedupes on `X-GitHub-Delivery` (idempotency), runs `ingest`, and applies the mutations. A pg-boss cron `reconcile` re-polls PR/check/deploy state with stored ETags (free `304`s) to heal dropped/redelivered events, and a first-install **backfill** does a REST/GraphQL sweep since webhooks are future-only. `key_strict_fifo` means a permanently-failed job blocks its installation key — the operator monitors `getBlockedKeys` (documented); ordering (opened→synchronize→closed) is why FIFO is chosen over `groupConcurrency`.

### 8. Settings UI and status over a server-only admin REST surface, not Zero

Because secrets and connector config are server-only (never synced), the admin settings UI cannot read them via Zero. It talks to a small **admin-gated REST surface** (`/api/v1/connectors/...`) that returns a **redacted** status (enabled?, installation id, repo→team mapping, last sync/error — never the secret material) and accepts enable/configure/map actions. This keeps IndexedDB free of secrets while the visible **work-graph** entities still sync normally through Zero.

## Risks / Trade-offs

- **[Failed webhook job blocks an installation's FIFO key]** → monitor `boss.getBlockedKeys('github-webhook')`, dead-letter after `retryLimit`, and document the clear-via-retry/deleteJob runbook; the reconcile cron heals state regardless.
- **[Raw-body capture in Hono is the HMAC risk]** → capture bytes before parsing and unit-test that a re-serialized body fails verification; prototype `createWebMiddleware` vs manual verify (reference §2.3, flagged UNVERIFIED).
- **[Master-key loss makes stored secrets unrecoverable]** → the version-prefixed blob supports rotation; the backup guide documents `SECRETS_ENCRYPTION_KEY` as a must-back-up value; single-instance self-host may prefer env-provided App credentials so nothing sensitive is DB-resident.
- **[Team-scoped visibility of ingested rows depends on the repo→team mapping]** → unmapped-repo webhooks are dropped (never written un-scoped); the mapping is admin-gated and defaults to no team (safe: no leak) rather than a catch-all.
- **[octokit is ESM-only, Node ≥20]** → yapm's server is already ESM on Node 24; authored as ESM with `moduleResolution: bundler` (reference intro).
- **[304-as-thrown-vs-returned is unverified in octokit]** → the reconcile code catches `err.status === 304` and treats a normal 200-with-etag path too; both handled (reference §3.4).

## Migration Plan

Forward-only migration `0009_connectors` adds the five synced work-graph tables and the three server-only connector tables; all new columns/tables are additive and nullable where they hang off existing rows, so existing issues are unaffected (no links ⇒ null signal ⇒ unchanged "not linked" render). No data backfill on migrate; a connector's first-install backfill populates rows only after an operator registers and installs the App. Rollback is dropping the new tables (no existing behavior depends on them). With the App env absent — the default — the change is inert: identical behavior to pre-connectors.

## Open Questions

- Exact Hono wiring for `@octokit/webhooks` `createWebMiddleware` vs manual raw-body HMAC (reference §7-#4) — resolve at implementation, unit-tested either way.
- Whether per-check granularity (`check_run`) is shown or only the rolled-up `check_suite.completed` conclusion — start with the rolled-up conclusion; the entity holds either.
- GraphQL vs REST for the reconcile sweep (one round-trip for PR+reviews+checks vs simpler REST) — reference §3.2/§7-#6; start REST, optimize only if rate limits bite.

## Decisions made during implementation

### Secrets phase (encrypted-secrets + connector-config surface)

1. **Installation modeling — jsonb maps, not child rows.** `connector_installation` holds the admin `repo_mapping` (repo full name → team id) and the reconcile `etags` (resource → ETag) as two jsonb columns rather than separate mapping/ETag tables. This keeps the surface provider-neutral and small; admin-gated setters (`setInstallationRepoTeam`/`removeInstallationRepoTeam`) and system setters (`setInstallationEtag`) merge into the jsonb (`||` / `-`) via raw SQL so a lifecycle-event upsert never clobbers them. `repo_mapping` values are ids with **no FK to `team`** (it is a routing cache): a deleted team leaves a stale entry that `resolveTeamForRepo` still returns, but ingest then finds no team and drops the row — safe, no leak. Revisit as rows only if per-repo metadata grows.

2. **Timestamp typing — plain `Timestamp`, not `Generated<Timestamp>`.** kysely 0.28.17 defines `Generated<S> = ColumnType<S, S|undefined, S>` (no unwrapping), so `Generated<Timestamp>` mis-types both the select value (branded `ColumnType`, not `Date`) and the update value, which breaks the server-only accessors that set/bump `created_at`/`updated_at`. The three connector tables type these DB-defaulted columns as plain `Timestamp` (omittable on insert, settable on update, correct `Date` on select). The drift test is unaffected (it reads the hand-written `hasDefault` map, not the TS wrapper). The same applies to the defaulted jsonb columns, expressed via a local `JsonWithDefault<T>` alias.

3. **Admin-gating split.** Writes originating from the settings UI (`upsertConnectorConfig`, `setConnectorSecret`/`deleteConnectorSecret`, `setInstallationRepoTeam`/`removeInstallationRepoTeam`, and the redacted-status read) assert `canManage(ctx)` and throw `ConnectorAuthorizationError`. System operations that run **without a user** (webhook ingest, reconcile, `recordConnectorSync` telemetry, `getConnectorSecret` decryption for auth, `upsertConnectorInstallation`, ETag get/set, `getConnectorConfig`) are intentionally un-gated so the worker path stays usable. This mirrors how Zero mutators embed authz while keeping non-Zero server infra callable.

4. **Env policy — triplet all-or-nothing, encryption key independent.** The `GITHUB_APP_*` triplet fast-fails on a partial config (naming the missing var, per task 1.3). `SECRETS_ENCRYPTION_KEY` is validated for shape (base64→32 bytes) only when present and does **not** fast-fail when absent: env-provided App credentials do not need it (only UI-entered secrets do). This refines design decision 6 (which required the key alongside the triplet) toward the simpler env-only self-host path; the later connector-build phase decides whether UI-entered secrets are available based on the key's presence. `githubAppEnv(env)` returns the complete triplet or null for that phase.

5. **Server-only exclusion is enforced at the Zero-schema layer.** The three tables are absent from `schema.ts` (asserted by the drift test), so they never reach a client's IndexedDB — the exact guarantee design decision 1 makes, matching the existing `issue_sequence`/`cycle_sequence` precedent. Zero's default `FOR TABLES IN SCHEMA public` publication still replicates them into zero-cache's **trusted** internal replica; that is acceptable (trusted container, and secrets are AES-256-GCM at rest). A custom publication to exclude them from the replica entirely is deferred (it would resync the replica and is out of scope for this phase).

6. **Codec placement keeps `node:crypto` out of the web bundle.** The AES-GCM codec lives in `packages/schema/src/secrets/codec.ts` and is re-exported only from the server-only `@yapm/schema/db` subpath (which `apps/web` never imports); the provider-neutral constants/types (`CONNECTOR_STATUSES`, `ConnectorConfigData`, …) live in `context.ts` and are exported from the root for the settings UI. The web build passes, confirming no `node:crypto` leak.

### Work-graph phase (framework firewall + linked entities + seam)

1. **PR `state` stores the raw lifecycle; `approved` is review-derived, never stored.** `pull_request.state ∈ {draft, open, merged, closed}` — faithful to any provider's PR/MR object (GitHub has no "approved" PR state). The reality strip's `approved` `PrState` is computed in `computeDeliverySignal` from the newest linked `review` (an approving review upgrades an `open` PR to `approved`; a `changes_requested` keeps it `open` → still "blocked-on-review"). This diverges from reference §5's sketch (which put `approved`/`changes_requested` on the PR mutation) in favor of a normalized model: review status lives on the `review` entity, which also feeds the review-age signal. The exported `PrState`, `DeliverySignal`, and `computeDivergence` signatures are UNCHANGED; only `computeDeliverySignal`'s body and the `LinkedEntities` input (gaining `reviews`) changed, exactly as issue-core promised. `computeDivergence` needed no change — its status-vs-reality rules already read the real signal.

2. **`WorkGraphMutation` is server-only, applied over the Zero `Transaction` write path — not a client-callable Zero mutator.** `applyWorkGraphMutation(tx, ctx, mutation)` uses the same `tx.mutate.<table>` / `tx.run(zql…)` abstraction human mutators use (so it is unit-testable with the existing `fakeTx` harness and honors the team-scoped model), but it is deliberately NOT registered in the client `mutators` map — a client can never forge a work-graph write. Each variant carries a client-minted `id` used only if the upsert inserts; upserts dedupe on the provider external id (`(installation_id, external_id)` for PR/deploy, `(pull_request_id, external_id)` for check/review), making webhook redelivery idempotent. A check/review whose parent PR is not yet stored is dropped (the reconcile sweep backfills). The `apps/server` phase wires this into the pg-boss worker.

3. **`installation_id` is a synced column with a DB cascade, but no Zero relationship.** The five work-graph tables hang off the server-only `connector_installation` via a real `ON DELETE CASCADE` FK (an uninstall drops the work graph), yet no Zero relationship targets that server-only table — the synced rows stay inside the team-scoped boundary and only the internal installation UUID (not secret) rides along. Team-scoping: PR/deploy take `team_id` from the worker's repo→team resolution (`ctx.teamId`); check/review inherit the parent PR's `team_id`; `issue_link` is only ever created within the PR's mapped team (a magic-word ref whose `TEAM_KEY` ≠ the mapped team's key is dropped, and one resolving to no issue is dropped), so no edge widens past the team.

4. **Deployment is stored but not part of the fixed `DeliverySignal` shape.** `deployment` is repo/ref/environment-anchored (no clean per-issue edge), so it is a team-scoped synced entity for the issue-detail deploy view (later phase) but is NOT fed into `computeDeliverySignal` — the exported signal shape (`pr`/`ciHealth`/`reviewAgeMs`) is fixed and adding a deploy axis would change it. It has a `team` relationship only; a per-issue/per-team deployment query is deferred to the UI phase.

5. **`ConnectorDefinition` built now as a type-only contract.** Task 2.1's interface is added in `packages/schema/src/zero/connector-framework.ts` alongside the `WorkGraphMutation` union (design decision 2 places it here). It is type-only — `ConnectorHeaders` (a minimal `{ get }` reader) avoids a DOM/HTTP-framework dependency, `client` is `unknown` to stay provider-neutral, and it carries no octokit/UI import — so the `apps/server` GitHub implementation has a contract to satisfy with zero rework risk.

### Ingestion phase (GitHub connector in apps/server)

1. **HMAC verify uses `@octokit/webhooks`'s `Webhooks` class, not `@octokit/webhooks-methods`.** The reference recommended `verifyWithFallback` from `@octokit/webhooks-methods`, but that package is not exposed in the installed tree (octokit 5 inlines it). `verifyGithubSignature` instead caches one `Webhooks` instance per secret and tries the primary then each fallback secret; octokit's `verify` does the constant-time compare over the raw bytes. This preserves zero-downtime webhook-secret rotation (the fallback list) using only the cataloged `@octokit/webhooks`. Added `@octokit/auth-app` + `@octokit/webhooks` (and `octokit`, already pinned) to the catalog + `apps/server`.

2. **Connector enabled by the App env triplet alone; `SECRETS_ENCRYPTION_KEY` not required for env-provided credentials.** Refining design decision 6, the connector builds when `githubAppEnv(env)` is non-null (App id + private key + webhook secret from env). The encryption key is only needed for UI-entered secrets (a later phase); env-based self-host needs nothing DB-resident. Absent triplet ⇒ `createGithubConnector` returns an inert connector (no pg-boss queue, no cron, webhook route 404), so boot is unaffected — the default.

3. **`installationId` on a mutation is the EXTERNAL id from `ingest`; the worker rewrites it to the internal `connector_installation` id.** `ingest` is pure and offline (no DB, no network), so it stamps `installationId` with the payload's `installation.id`. The worker resolves the internal record via `findConnectorInstallation(provider, externalId)`, then rewrites every mutation's `installationId` (a per-variant `switch` keeps the discriminated union intact) before applying — the work-graph FK references the internal id. `reconcile` already holds the `InstallationRecord`, so it stamps the internal id directly. The webhook path therefore never mints an installation token; only `reconcile` uses the network.

4. **Team resolution is per delivery (webhook) and per repo (reconcile).** A webhook delivery is about one repository, so the worker resolves one `teamId` (`resolveTeamForRepo`) and applies the whole batch under `{ teamId, now }`; an unknown installation or unmapped repo drops the delivery (never an un-scoped write). `reconcile` can span repos/teams, so the reconcile driver iterates the installation's `repo_mapping` one entry at a time, handing `reconcileInstallation` a single-repo `repoMapping` and applying its mutations under that repo's team — so every PR/deploy lands in the correct team even though `check`/`review` still inherit their parent PR's team in `applyWorkGraphMutation`.

5. **`push`/`status`/`issues` are acknowledged but produce no work-graph mutation in v1.** The issue↔PR edge model (`issue_link`) is PR-anchored, and `applyWorkGraphMutation`'s check/review upserts key off `prExternalId`. A bare `push` carries no PR; `status` (legacy commit-status) carries only a commit SHA with no PR reference, which the prExternalId-keyed model can't link without a head-SHA→PR lookup; `issues` mirrors external GitHub issues, which yapm does not model (its issues are first-class). Modern CI flows through `check_run`/`check_suite` (which carry `pull_requests[]`) and the reconcile sweep's `checks.listForRef`, so CI health is fully covered without touching the committed work-graph write path. Revisit `status` if a repo's CI predates the Checks API.

6. **Reconcile gates on the pulls-list ETag and re-derives PR + CI + review per changed PR.** `reconcileInstallation` sends `if-none-match` with the stored per-`(installation, resource)` ETag; a `304` (thrown `RequestError` with `status: 304` OR a `304` response — both handled) yields no mutations and no rate-limit cost. On a change it stores the new ETag and re-derives each open PR plus its `checks.listForRef` and `pulls.listReviews`. This is also the first-install backfill. A pg-boss cron (`GITHUB_RECONCILE_CRON`, default `*/15 * * * *`) drives it; the sweep is the safety net for dropped/redelivered webhooks.

7. **Integration tests provision the better-auth `user` table.** The Zero server-schema check (`getServerSchema`) validates the whole synced schema on the first mutator transaction, including better-auth's `user` table (created at boot by its migrations, not Kysely's). The live-Postgres ingest/service tests create a minimal `user` table in setup — mirroring the schema-drift test — so `applyWorkGraphMutations` runs. Fixtures (`__fixtures__/*.json`) are recorded webhook payloads; a mocked `GithubRestClient` drives reconcile; no test performs network I/O.
