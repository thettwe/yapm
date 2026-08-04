# connectors Specification

## Purpose
TBD - created by archiving change connectors. Update Purpose after archive.
## Requirements
### Requirement: Provider-neutral connector framework

The system SHALL define a provider-neutral `ConnectorDefinition` interface in `packages/schema` that isolates the three provider-specific concerns — auth/config (a Zod `configSchema` for non-secret settings, a Zod `secretSchema` for encrypted settings, and a `verifySignature(raw, headers, secrets)`), synchronous ingest (`parseDelivery(raw, headers)` returning an installation key, event type, delivery id, and payload), and asynchronous ingest/reconcile (`ingest(event, ctx)` and `reconcile(installation, ctx)`) — each returning a provider-neutral `WorkGraphMutation[]`. The `WorkGraphMutation` union SHALL be the only shape feature code consumes, so a second connector (e.g. GitLab) can be added by implementing the interface with **no** change to reality-strip, divergence, **status-automation**, query, or row code. GitHub SHALL be the single v1 implementation of this interface; its octokit/webhook code SHALL live in `apps/server` and SHALL call shared mutators, never raw ZQL.

The union's pull-request variant SHALL additionally be the sole trigger for opt-in status automation: the decision to transition a linked issue SHALL be taken in `packages/schema` from that variant's state, its own source timestamp, and the rows it names — never from a provider payload — so the automation is inherited by any connector that emits it. The connector SHALL NOT write anything back to the provider as a result of a transition, and SHALL NOT require an additional provider permission scope.

Work-graph placement: the interface and `WorkGraphMutation` union define the write path into the linked delivery entities, and now also the trigger for the derived issue-status write. Permission story: every `WorkGraphMutation` is applied through the existing shared server mutators, so connector writes obey the same server-side authorization as human writes; the derived status write goes through the shared issue status mutator under a system principal subject to that mutator's own checks.

#### Scenario: A connector produces only WorkGraphMutations

- **WHEN** a delivery is ingested by any connector
- **THEN** its effect on the work graph is expressed solely as a `WorkGraphMutation[]`, applied through the shared mutators, with no provider-specific write path

#### Scenario: A second connector needs no feature-code change

- **WHEN** a new provider is added by implementing `ConnectorDefinition`
- **THEN** the reality strip, divergence, status automation, queries, and rows are unchanged because they depend only on the `WorkGraphMutation` union and the synced entities, not on the provider

#### Scenario: Connector code does not leak ZQL

- **WHEN** the GitHub connector writes to the work graph
- **THEN** it invokes shared mutators (not raw ZQL), keeping the sync layer swappable

#### Scenario: Provider-specific code is unaware of status automation

- **WHEN** the GitHub connector's mapping, worker, and reconciliation code is inspected
- **THEN** it contains no reference to issue status, to the team automation setting, or to any transition, because the decision lives entirely behind the mutation union

### Requirement: Shared encrypted-secrets and connector-config surface

The system SHALL provide a shared, provider-neutral secrets/config surface in Postgres, held in **server-only** tables that are excluded from the Zero schema so no secret ever replicates to a client: `connector_config` (per-workspace, per-provider — an enabled flag, non-secret config, and status), `connector_secret` (secret material encrypted at rest), and `connector_installation` (installation id, a repo→team mapping, and per-resource ETags). Secret material SHALL be encrypted with AES-256-GCM using a `SECRETS_ENCRYPTION_KEY`, stored as a version-prefixed `iv‖tag‖ciphertext` blob, and SHALL never be logged. Installation access tokens SHALL NOT be persisted. The surface SHALL be designed provider-neutral so the AI change can reuse it for provider API keys. All reads/writes of this surface SHALL be confined to `apps/server` and admin-gated.

Work-graph placement: an off-graph configuration surface that authorizes and parameterizes ingestion; it holds no synced work-graph rows. Permission story: server-only and admin-gated; never synced, never logged.

#### Scenario: Secrets are encrypted at rest and never synced

- **WHEN** a webhook secret or App private key is stored
- **THEN** it is persisted as an AES-256-GCM version-prefixed blob in a server-only table that is not part of the Zero schema, so it never reaches a client replica

#### Scenario: Tampered ciphertext is rejected

- **WHEN** a stored secret blob is altered or decrypted with the wrong key
- **THEN** decryption fails (the GCM auth tag check throws) rather than returning corrupt plaintext

#### Scenario: Installation tokens are never persisted

- **WHEN** the connector needs an installation access token
- **THEN** it is minted on demand and cached in memory, never written to the database

#### Scenario: Non-admin cannot read the secrets surface

- **WHEN** a non-admin requests connector configuration or secrets
- **THEN** the request is rejected and no secret material is returned

### Requirement: HMAC-verified webhook ingestion, serialized per installation

The system SHALL expose a webhook endpoint that verifies the GitHub `X-Hub-Signature-256` HMAC-SHA256 over the **raw** request body using the stored webhook secret (constant-time comparison, with fallback-secret support for rotation), rejecting an invalid signature. On a valid signature it SHALL enqueue the raw delivery to a pg-boss queue **serialized per installation** (`key_strict_fifo` with `singletonKey = installation-<id>`) on the existing Postgres — introducing no new container or service — and return `202` immediately. A worker SHALL map each delivery to `WorkGraphMutation[]` and apply them through the shared mutators, deduplicating on the `X-GitHub-Delivery` id. All of this SHALL be tested against mocked GitHub (recorded webhook fixtures and a mocked octokit), with no live GitHub App and no network I/O.

Work-graph placement: the ingestion pipeline that turns provider deliveries into work-graph mutations. Permission story: mutations apply through the shared mutators under the installation's mapped team scope.

#### Scenario: Invalid signature is rejected

- **WHEN** a webhook arrives with a missing or wrong `X-Hub-Signature-256` for the raw body
- **THEN** the endpoint rejects it and enqueues nothing

#### Scenario: Valid delivery is verified fast and processed async

- **WHEN** a webhook arrives with a valid signature
- **THEN** the endpoint returns `202` after enqueuing, and the worker maps the payload to `WorkGraphMutation[]` applied via the shared mutators

#### Scenario: Deliveries for one installation are processed in order

- **WHEN** multiple deliveries for the same installation are enqueued
- **THEN** they are processed serially in FIFO order on the `installation-<id>` key, never concurrently

#### Scenario: A redelivered event is idempotent

- **WHEN** the same `X-GitHub-Delivery` id is received twice
- **THEN** the second delivery does not double-apply, converging to the same work-graph state

#### Scenario: Ingestion is tested without a live GitHub App

- **WHEN** the connector test suite runs
- **THEN** it verifies HMAC, parsing, mapping, and reconciliation against recorded fixtures and a mocked octokit, performing no network I/O

### Requirement: ETag reconciliation and first-install backfill

The system SHALL run a periodic reconciliation that re-polls PR, check, and deployment state using stored per-resource ETags (conditional requests, so unchanged resources cost nothing against the rate limit) to heal any dropped or missed webhook, and SHALL perform a REST/GraphQL **backfill** sweep on first install because webhooks are future-only. Reconciliation and backfill SHALL emit the same `WorkGraphMutation[]` as webhook ingest, so the work-graph state is identical regardless of path.

Work-graph placement: the safety-net path that keeps linked entities consistent with the provider. Permission story: same mutator write path and team scope as webhook ingest.

#### Scenario: Unchanged resources are reconciled cheaply

- **WHEN** reconciliation re-polls a resource whose ETag is unchanged
- **THEN** the provider returns not-modified and no mutation is applied

#### Scenario: A missed event is healed by reconciliation

- **WHEN** a webhook was dropped and a resource's state has since changed
- **THEN** reconciliation detects the new state and applies the corresponding mutation

#### Scenario: First install backfills existing state

- **WHEN** the App is installed on a repository with pre-existing PRs and checks
- **THEN** a backfill sweep populates the linked entities so the reality strip reflects state that predates the install

### Requirement: Admin connector settings and status

The system SHALL provide an admin-only connector settings surface to enable/configure the GitHub connector and view its connection and installation status (enabled flag, installation id, repo→team mapping, last sync/error), served over a server-only admin REST surface that returns redacted status and never the secret material. The same surface SHALL additionally offer a **per-team status-automation** section listing each team with its current automation state and a control to enable or disable it, together with copy stating which transitions fire, that automation never moves an issue backward and never touches Canceled or untriaged issues, and that enabling it does not change existing issues. Unlike the connector's own configuration, the automation setting is a synced column on `team` written through the shared admin-gated mutator, so the control is optimistic and costs no round trip. The surface SHALL be fully keyboard-operable and rendered strictly against theme tokens (correct in all three presets in light and dark). A non-admin SHALL NOT see or mutate connector settings or the automation setting.

Work-graph placement: an admin configuration view over the off-graph connector surface, plus the on-graph `team` automation column. Permission story: admin-gated reads and writes; secrets never leave the server; the automation column is readable by any member through the existing team sync scope but writable only by an admin.

#### Scenario: Admin views connection status

- **WHEN** an admin opens the connector settings
- **THEN** the connection state, installation id, and repo→team mapping are shown, with no secret material displayed

#### Scenario: Admin toggles status automation for one team

- **WHEN** an admin activates the automation control for one team
- **THEN** only that team's automation state changes, and it is visible as enabled immediately without waiting for a round trip

#### Scenario: Non-admin cannot access connector settings

- **WHEN** a member or viewer navigates to connector settings
- **THEN** the surface is not offered and any status/config request is rejected, including the automation section and any attempt to write the automation setting

#### Scenario: Settings are keyboard-operable across themes

- **WHEN** an admin configures the connector and toggles a team's status automation using only the keyboard in each preset in light and dark
- **THEN** every control is reachable and operable without a pointer and renders from tokens with no hardcoded values

### Requirement: Absent GitHub App configuration disables the connector cleanly

The GitHub connector SHALL be enabled when the GitHub App configuration (App ID, private key, webhook secret) is present; `SECRETS_ENCRYPTION_KEY` is required only to store secrets entered via the admin UI (it is optional and shape-validated — base64 → 32 bytes — when present, and its absence does not disable an env-configured connector). When the App triplet is absent the connector SHALL be disabled — the webhook endpoint SHALL NOT accept deliveries, no ingestion queue or reconciliation cron SHALL be created, and the settings UI SHALL show a "not configured" state naming the variables to set — and boot SHALL NOT crash. A partially-configured App triplet (some but not all of the three App values) SHALL fail fast at boot with the name of the missing variable, so it never silently half-runs.

Work-graph placement: gates whether the ingestion pipeline exists at all. Permission story: unchanged — a disabled connector writes nothing.

#### Scenario: No connector env boots cleanly with the connector off

- **WHEN** the App id/private key/webhook secret and encryption key are all unset
- **THEN** the app boots normally, the connector is disabled, and the webhook endpoint does not process deliveries

#### Scenario: Partial config fails fast by name

- **WHEN** an App id is set but the private key is missing
- **THEN** boot exits non-zero naming the missing variable rather than starting a half-configured connector

#### Scenario: Disabled connector is inert

- **WHEN** the connector is disabled and a webhook is received
- **THEN** nothing is enqueued or written and the reality strip stays in its unlinked state

### Requirement: Transient changed-file metadata under the already-granted permissions

The narrow, hand-written REST client interface SHALL be extended with a `pulls.listFiles`
operation, used **only** to read the set of files a pull request touched. It SHALL run under the
GitHub App permissions the connector already documents and installers have already granted
(**Pull requests: Read-only** and **Contents: Read-only**), so the change SHALL NOT require a new
App permission and SHALL NOT force installers to re-approve the installation.

The result SHALL be used transiently inside the digest job and then discarded. The system SHALL
NOT persist any part of a `listFiles` response — no new column, no cache table, no jsonb blob, and
no derived value keyed to it.

Work-graph placement: a read-only provider call that produces no `WorkGraphMutation` and writes no
row. Permission story: performed by the server under the installation token, exactly like
reconciliation; it exposes nothing to any client.

#### Scenario: No new App permission is required

- **WHEN** an existing installation whose granted permissions are the documented read-only set is
  used to list a pull request's files
- **THEN** the call succeeds without any permission change and installers are not asked to
  re-approve

#### Scenario: Nothing from the response is persisted

- **WHEN** the digest job lists the files of every pull request in a cycle
- **THEN** no row is inserted or updated in any table as a result, and a subsequent read of the
  database finds no filename, path, or file-metadata value anywhere

### Requirement: The changed-file projection drops content and content pointers at the boundary

`GET /pulls/{n}/files` returns a `patch` field per file whether or not it is requested, alongside
`blob_url`, `raw_url` and `contents_url`. The system SHALL project each response entry down to
exactly `{ path, status, changes }` **at the client seam** — in the function that performs the
call, before any value is returned to a caller — and SHALL discard `patch`, `blob_url`, `raw_url`,
`contents_url`, `sha` and every other field.

The projected type SHALL have no field capable of carrying patch content, so a later change that
attempted to carry it would fail to compile rather than fail quietly.

Test doubles for this call SHALL return a response **containing** a `patch` field, so the
guarantee is proven by assertion rather than asserted by omission.

Work-graph placement: the single boundary function between the provider's response and everything
downstream. Permission story: unchanged — the projection narrows what the server itself holds in
memory.

#### Scenario: A patch field in the response never survives the seam

- **WHEN** the provider returns a file entry carrying `patch`, `blob_url`, `raw_url` and
  `contents_url`
- **THEN** the value returned by the client seam contains only `path`, `status` and `changes`, and
  none of the dropped fields appears in it or anywhere downstream of it

#### Scenario: The mock proves the guard

- **WHEN** the test double for `pulls.listFiles` is inspected
- **THEN** it returns a `patch` field, and a test asserts that no patch content reaches the object
  handed to the model

### Requirement: The changed-file draw on the rate limit is bounded and stated

Listing files for every pull request in a cycle is a new draw on the same installation rate limit
that reconciliation depends on. The system SHALL bound it four ways: it SHALL make **zero**
provider calls when the workspace has configured no area rules; it SHALL make **zero** provider
calls when the digest that would consume the result cannot run — evaluated by asking the same
gateway predicate the digest run itself uses, so the AI toggle, the provider, the key and the
spend cap are one condition and not a re-derived copy of one; it SHALL cap the number of
per-cycle `listFiles` calls at a fixed constant, enriching pull requests in a deterministic order
so a truncated run is reproducible; and it SHALL stop enriching for the remainder of a run when
the installation's reported remaining rate-limit quota falls below a floor, recording that it did
so. Calls SHALL be made serially, not concurrently, consistent with the provider's stated guidance
and with how reconciliation already serializes per installation. A truncated or skipped enrichment
SHALL degrade the digest to its pre-area content, never fail it.

Work-graph placement: a bound on a read-only provider call inside an existing background job.
Permission story: unchanged.

#### Scenario: An unconfigured workspace spends nothing

- **WHEN** a cycle closes in a workspace with no area rules configured
- **THEN** no `listFiles` call is made and the rate-limit consumption is unchanged from before this
  capability existed

#### Scenario: A workspace whose digest will end `ai_off` spends nothing

- **WHEN** a cycle closes in a workspace that has area rules but no model the gateway can resolve —
  AI switched off, no provider chosen, or no key configured
- **THEN** no `listFiles` call is made, and the same is true once the workspace is over its spend cap

#### Scenario: A large cycle is capped, not unbounded

- **WHEN** a cycle contains more pull requests than the per-cycle call cap
- **THEN** exactly the cap's worth of calls are made in a deterministic order, the remaining pull
  requests carry no area data, and the digest is still produced

#### Scenario: A low remaining quota stops the enrichment, not the reconciliation

- **WHEN** the provider reports remaining quota below the floor partway through a run
- **THEN** enrichment stops for that run, the event is recorded, the digest is produced from what
  was gathered, and reconciliation's own budget is left intact

