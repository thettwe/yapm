## MODIFIED Requirements

### Requirement: ETag reconciliation and first-install backfill

The system SHALL run a periodic reconciliation that re-polls PR, check, and deployment state using stored per-resource ETags (conditional requests, so unchanged resources cost nothing against the rate limit) to heal any dropped or missed webhook, and SHALL perform a REST/GraphQL **backfill** sweep on first install because webhooks are future-only. Reconciliation and backfill SHALL emit the same `WorkGraphMutation[]` as webhook ingest, so the work-graph state is identical regardless of path.

Because the deployment sweep reads only a deployment's **newest** status, it SHALL be structurally incapable of regressing a durable delivery fact the work graph has already recorded: the sweep MAY correct current state, and SHALL NOT clear or move a recorded first-success instant. The sweep SHALL also carry the deployment's commit SHA on every mutation it emits, so that it doubles as the backfill for deployments ingested before the commit was stored — with the limitation that it heals only what the provider still lists, and that a success it never observed stays unknown rather than being invented.

Work-graph placement: the safety-net path that keeps linked entities consistent with the provider. Permission story: same mutator write path and team scope as webhook ingest; no additional provider permission is required to read the deployment commit, which arrives in the payload already granted.

#### Scenario: Unchanged resources are reconciled cheaply

- **WHEN** reconciliation re-polls a resource whose ETag is unchanged
- **THEN** the provider returns not-modified and no mutation is applied

#### Scenario: A missed event is healed by reconciliation

- **WHEN** a webhook was dropped and a resource's state has since changed
- **THEN** reconciliation detects the new state and applies the corresponding mutation

#### Scenario: First install backfills existing state

- **WHEN** the App is installed on a repository with pre-existing PRs and checks
- **THEN** a backfill sweep populates the linked entities so the reality strip reflects state that predates the install

#### Scenario: The sweep backfills a missing deployment commit

- **WHEN** reconciliation polls a deployment stored before the commit SHA was recorded
- **THEN** the emitted mutation carries the provider's commit SHA and the stored row acquires it

#### Scenario: The sweep sees only the newest status and regresses nothing

- **WHEN** reconciliation polls a deployment whose newest status is `inactive` but which had previously recorded a success
- **THEN** the emitted mutation updates current state and the recorded success instant is unchanged

### Requirement: HMAC-verified webhook ingestion, serialized per installation

The system SHALL expose a webhook endpoint that verifies the GitHub `X-Hub-Signature-256` HMAC-SHA256 over the **raw** request body using the stored webhook secret (constant-time comparison, with fallback-secret support for rotation), rejecting an invalid signature. On a valid signature it SHALL enqueue the raw delivery to a pg-boss queue **serialized per installation** (`key_strict_fifo` with `singletonKey = installation-<id>`) on the existing Postgres — introducing no new container or service — and return `202` immediately. A worker SHALL map each delivery to `WorkGraphMutation[]` and apply them through the shared mutators, deduplicating on the `X-GitHub-Delivery` id. All of this SHALL be tested against mocked GitHub (recorded webhook fixtures and a mocked octokit), with no live GitHub App and no network I/O.

Mapping SHALL preserve every payload field a stored work-graph column exists for; in particular a deployment delivery's commit SHA SHALL be mapped rather than dropped, and a pull-request delivery's merge commit SHA SHALL be mapped alongside its head SHA. Idempotency SHALL hold for durable delivery facts as well as for current state: reprocessing a delivery SHALL leave a recorded first-success instant exactly where it was.

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
- **THEN** the second delivery does not double-apply, converging to the same work-graph state, and any recorded first-success instant is unmoved

#### Scenario: Ingestion is tested without a live GitHub App

- **WHEN** the connector test suite runs
- **THEN** it verifies HMAC, parsing, mapping, and reconciliation against recorded fixtures and a mocked octokit, performing no network I/O

#### Scenario: A deployment payload's commit survives mapping

- **WHEN** a `deployment_status` fixture carrying a commit SHA is mapped
- **THEN** the resulting mutation carries that SHA, and the row written from it stores it
