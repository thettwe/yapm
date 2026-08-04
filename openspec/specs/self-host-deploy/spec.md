# self-host-deploy Specification

## Purpose
TBD - created by archiving change foundation. Update Purpose after archive.
## Requirements
### Requirement: Three-container deployment
Production self-hosting SHALL consist of exactly three containers — `yapm` (app: API + Zero endpoints + static SPA in one process), `zero-cache`, and `postgres` (≥15, `wal_level=logical`) — defined in `docker/docker-compose.yml` with no additional required services.

#### Scenario: Clean-machine deploy
- **WHEN** an operator runs `docker compose up -d` with only the documented env vars set
- **THEN** all three containers reach healthy state and the app serves the UI with a working synced workspace

#### Scenario: Container count is the contract
- **WHEN** the compose file is inspected
- **THEN** it defines exactly three services, and no Redis, Elasticsearch, MinIO, or reverse proxy is required

### Requirement: Migrations run automatically on boot

The app container SHALL apply pending Kysely migrations (forward-only, transactional) before accepting traffic, and SHALL additionally create/update better-auth's tables at boot via better-auth's `getMigrations()` on the same Postgres, so no separate auth-migration CLI step is required. zero-cache SHALL start only after the app is healthy so the replicated schema always exists. Boot order SHALL be: Kysely `Migrator` (advisory-locked) → better-auth `getMigrations()` → workspace seed → serve.

#### Scenario: Upgrade is pull-and-up

- **WHEN** an operator pulls a newer image tag and runs `docker compose up -d`
- **THEN** both app and auth migrations apply automatically and the app serves traffic without manual migration steps

#### Scenario: Auth tables exist after first boot

- **WHEN** the app boots against a database that has never run auth migrations
- **THEN** better-auth's tables (`user`, `session`, `account`, `verification`, `jwks`) are created before the app accepts sign-in traffic

### Requirement: Validated configuration and health endpoints

The app SHALL validate all environment variables with Zod at boot and expose `/healthz` (liveness) and `/readyz` (readiness including database connectivity and replication-slot health). Validation SHALL additionally cover the authentication configuration — the better-auth secret and base URL, optional GitHub OAuth credentials, optional OIDC/SSO configuration, the optional bootstrap-admin email — the optional connector configuration — the GitHub App id, App private key, and webhook secret, plus the `SECRETS_ENCRYPTION_KEY` used to encrypt connector and AI secrets at rest — the optional AI configuration — instance-default provider API keys, a default provider, and the cycle-close digest pre-compute toggle — and the **optional email-delivery configuration**: the SMTP URL, the HTTPS sender's API key, the From address, the public base URL used for email deep links, and the notification sweep schedules. Validation SHALL fail fast with the offending variable name and expected format, while leaving unset optional integrations simply disabled. Defaults SHALL be chosen so `docker compose up` still boots with an empty `.env`. AI SHALL be disabled cleanly when no AI key is configured (via env or the admin UI); a malformed instance-default AI value SHALL fail fast by name, while a per-workspace key entered via the UI is validated at use, never crashing boot.

Email configuration SHALL be conditionally required rather than globally required: the From address and the public base URL SHALL be required **only when** an email transport is configured, and their absence in that case SHALL fail boot naming them — so that an operator enabling email is told what is missing instead of silently sending mail containing localhost links.

The public base URL SHALL be a distinct variable from the authentication base URL and from the SPA's trusted browser origin, and the documented meaning of each SHALL make clear why they may legitimately differ between a development stack and a single-container deployment.

#### Scenario: Misconfiguration fails fast and clearly

- **WHEN** the app starts with a missing or malformed required env var
- **THEN** it exits non-zero before listening, printing the variable name and the expected format

#### Scenario: Readiness reflects sync health

- **WHEN** Postgres logical replication is unavailable to zero-cache
- **THEN** `/readyz` reports not-ready with a reason string identifying replication as the cause

#### Scenario: Optional auth integrations default to disabled

- **WHEN** GitHub OAuth, OIDC/SSO, and SMTP env vars are all unset
- **THEN** the app boots successfully with those integrations disabled and the built-in email/password method available

#### Scenario: Optional connector config defaults to disabled

- **WHEN** the GitHub App id/private key/webhook secret and the `SECRETS_ENCRYPTION_KEY` are all unset
- **THEN** the app boots successfully with the GitHub connector disabled and no webhook ingestion running

#### Scenario: Partial connector config fails fast by name

- **WHEN** the GitHub App id is set but the private key or webhook secret is missing
- **THEN** the app exits non-zero naming the missing variable rather than starting a half-configured connector

#### Scenario: Optional AI config defaults to disabled

- **WHEN** no AI provider key env var is set and no workspace has configured a key
- **THEN** the app boots successfully with AI disabled, no agent tools mount, and the cycle-digest pre-compute does not run

#### Scenario: Malformed AI default value fails fast by name

- **WHEN** an instance-default AI provider is named but is not one of the supported providers
- **THEN** the app exits non-zero naming the offending variable rather than starting with an ambiguous default

#### Scenario: Email left unconfigured boots cleanly

- **WHEN** the app starts with no SMTP URL and no HTTPS sender key
- **THEN** it boots successfully, logs once that email is disabled, registers no email job, and the in-app inbox works fully

#### Scenario: Enabling a transport without its companions fails fast

- **WHEN** the app starts with an email transport configured but no From address or no public base URL
- **THEN** it exits non-zero before listening, naming the missing variable and what it is for

### Requirement: Authentication adds no container

Adding authentication SHALL NOT change the three-container contract. better-auth runs in-process inside the existing `yapm` app container and is backed by the existing Postgres — it MUST NOT introduce Redis, an auth service, an SMTP server, or any other required container. SMTP, GitHub OAuth, and OIDC/SSO are optional external integrations configured by env, not services yapm ships.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no auth, cache, or mail container

#### Scenario: Auth works without SMTP

- **WHEN** an operator deploys with no SMTP configured
- **THEN** email/password sign-up, invites (via copyable link), and sign-in all work

### Requirement: The GitHub connector adds no container and encrypts secrets at rest

Adding the GitHub connector SHALL NOT change the three-container contract: webhook ingestion SHALL run in-process inside the existing `yapm` app container with pg-boss on the existing Postgres — it MUST NOT introduce Redis, a queue service, a webhook relay, or any other required container. The GitHub App (App id, private key, webhook secret) is an optional external integration the operator registers and configures by env, not a service yapm ships. Any connector secret stored in Postgres SHALL be encrypted at rest with `SECRETS_ENCRYPTION_KEY` and held in server-only tables that never replicate to clients, and SHALL never be logged.

Work-graph placement: deployment/config surface for the connector pipeline. Permission story: connector secrets are server-only, admin-gated, and never synced or logged.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no queue, cache, or relay container for connectors

#### Scenario: Connector works within the existing app process

- **WHEN** an operator configures the GitHub App and installs it
- **THEN** webhook ingestion, serialized-per-installation processing, and reconciliation all run inside the `yapm` container on the existing Postgres

#### Scenario: Stored secrets are encrypted and unlogged

- **WHEN** a webhook secret or App private key is persisted
- **THEN** it is stored AES-256-GCM-encrypted in a server-only table and never appears in logs

### Requirement: The AI layer adds no container and runs in-process

Adding the AI layer SHALL NOT change the three-container contract: all model calls SHALL run in-process inside the existing `yapm` app container via the AI SDK, and every AI pre-compute SHALL run on the existing pg-boss on the existing Postgres — it MUST NOT introduce Redis, a vector store, an inference service, a queue service, or any other required container. AI is BYO-key: the provider (Anthropic/Google/OpenAI) is an optional external integration the operator or an admin configures by env or the admin UI, not a service yapm ships or a capability yapm paywalls. Any AI provider key stored in Postgres SHALL reuse the existing server-only, AES-256-GCM encrypted connector secret surface (never a new store), SHALL never replicate to clients, and SHALL never be logged.

**Each AI consumer SHALL be an independently gated block on the one shared job runner.** A second consumer SHALL NOT construct a second job-runner instance or call its start routine a second time, and SHALL be switchable instance-wide by its own optional environment variable, so that disabling one consumer never silently disables another. Any such variable SHALL be Zod-validated at boot and documented, and its absence SHALL leave a safe default.

Work-graph placement: deployment/config surface for the AI pipeline. Permission story: AI keys are server-only, admin-gated, never synced or logged; the model call carries the invoking user's context.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no inference, cache, vector, or queue container for AI

#### Scenario: AI runs within the existing app process

- **WHEN** an admin configures a provider key and a cycle closes
- **THEN** the digest is pre-computed by an in-process AI-SDK call on the existing pg-boss, with no new container

#### Scenario: AI keys reuse the encrypted connector surface

- **WHEN** a provider key is entered via the admin UI
- **THEN** it is stored AES-256-GCM-encrypted in the existing server-only connector secret table, never synced, and never logged

#### Scenario: A second AI consumer adds no runner

- **WHEN** a second AI consumer is registered
- **THEN** it is one more block on the existing job runner with no second instance and no second start call, and the container count is unchanged

#### Scenario: Consumers are switched independently

- **WHEN** the operator disables one AI consumer by its environment variable
- **THEN** the other AI consumers continue to run, and disabling all of them leaves the app booting cleanly with no AI job registered

### Requirement: Outbound email adds no container

Adding outbound email delivery SHALL NOT change the three-container contract. Both transports run in-process inside the existing app container: the SMTP transport is an outbound client, and the HTTPS transport is a single outbound request. Neither SHALL introduce a mail server, a queue service, or any other required container, and the background sweeps SHALL run on the **existing** Postgres-backed job scheduler instance rather than a new one.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no mail or queue container

#### Scenario: No additional job-scheduler instance

- **WHEN** the server's background-job wiring is inspected
- **THEN** the notification sweeps are registered on the already-existing scheduler instance, and the number of job-scheduler instances started by the process is unchanged

### Requirement: Search adds no container, no extension, and no second scheduler

Adding search SHALL NOT change the three-container contract. Full-text search SHALL be Postgres's own,
running in the existing database container, and SHALL NOT require `CREATE EXTENSION` of any kind — no
trigram, no vector, no third-party module — because some managed-Postgres self-hosters cannot grant
that privilege. Index maintenance SHALL run on the **existing** Postgres-backed job-scheduler
instance, not a new one; the process SHALL start the same number of scheduler instances as before.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no
  search, index, cache or queue container

#### Scenario: No database extension is required

- **WHEN** the migrations are applied to a Postgres instance where the connecting role cannot create
  extensions
- **THEN** they succeed, and search works

#### Scenario: No additional job-scheduler instance

- **WHEN** the server's background-job wiring is inspected
- **THEN** the search index passes are registered on the already-existing scheduler instance, and the
  number of job-scheduler instances started by the process is unchanged

### Requirement: Search configuration is env-only, validated, and safe to leave alone

Search SHALL be configured entirely by environment variables, all optional with working defaults, all
validated at startup by the existing schema-validation pattern and failing fast **by variable name**.
The operator SHALL be able to control: whether index maintenance runs at all, how often the
incremental pass runs, how often the full reconcile runs, which text-search configuration is used, and
the per-request statement timeout. Every one of them SHALL be documented, and the documented set SHALL
match the validated set with no drift.

Nothing about search SHALL require configuration for it to work on a fresh instance.

#### Scenario: An empty configuration still searches

- **WHEN** an instance boots with none of the search variables set
- **THEN** indexing runs on its defaults, the language-neutral text configuration is used, and search
  answers

#### Scenario: An invalid value fails fast by name

- **WHEN** a search variable is set to a value the schema rejects
- **THEN** boot fails immediately with a message naming that variable and describing the accepted
  shape

#### Scenario: Documented configuration matches validated configuration

- **WHEN** the environment example and the configuration reference are compared against the validated
  schema
- **THEN** every search variable appears in all three with no drift

### Requirement: Index freshness is observable and a reindex is a documented operation

An operator SHALL be able to tell whether the search index is keeping up without reading application
logs: the readiness report SHALL carry a **non-gating** search entry exposing the indexed document
count, the source row count, and the age of the oldest un-indexed row. It SHALL be non-gating because
a stale index must never take an instance out of rotation.

Forcing a full reindex, and changing the text-search configuration, SHALL each be a documented,
supported operation that does not require editing the database by hand.

#### Scenario: A stale index is visible but not fatal

- **WHEN** indexing has fallen behind
- **THEN** the readiness report shows the gap and the instance still reports ready

#### Scenario: An operator can force a full reindex

- **WHEN** an operator follows the documented reindex procedure
- **THEN** the index is rebuilt from the source rows in bounded batches while the application keeps
  serving, and search results converge with no data loss

### Requirement: Status automation adds no container and no configuration

Opt-in status automation SHALL add no container, no service, no job queue, no scheduled task, no
environment variable, and no provider permission scope. Its entire configuration surface SHALL be one
nullable column per team, set from the admin UI. `.env.example` and the configuration reference
SHALL be unchanged by it, and an operator SHALL need to read no runbook to adopt or abandon it:
enabling is one control, disabling is the same control, and disabling restores the previous behaviour
exactly. Upgrading an instance SHALL leave every team's automation off, so the upgrade changes no
issue and no flag.

Work-graph placement: none — this is a deployment property of the status-automation capability.
Permission story: unchanged; the setting is admin-gated and holds no secret.

#### Scenario: The container count does not move

- **WHEN** the deployment is inspected after this change
- **THEN** it is still exactly `app`, `zero-cache`, and `postgres`

#### Scenario: No new environment variable

- **WHEN** the validated configuration schema and `.env.example` are compared before and after this
  change
- **THEN** they are identical, and the feature is configured entirely from the database

#### Scenario: Upgrading changes nothing until someone opts in

- **WHEN** an existing instance is upgraded and the migration runs
- **THEN** every team has automation off, no issue's status changes, and every divergence flag reads
  as it did before

#### Scenario: Turning it off restores the previous behaviour exactly

- **WHEN** an admin disables automation for a team that had it on
- **THEN** no further transition occurs for that team and the divergence flag resumes being the only
  response to a status that disagrees with git

### Requirement: Attachment storage adds no container and defaults to a local volume

The system SHALL provide attachment storage without adding a fourth service to the self-hosting
deployment. The default provider SHALL be the local filesystem backed by a named volume on the
existing application service; object storage SHALL be optional and SHALL never be a prerequisite.
The application image SHALL create the storage directory owned by the application user, so a
bind-mounted host path is not silently unwritable.

#### Scenario: Still exactly three containers

- **WHEN** the published compose file is brought up with attachments in use
- **THEN** exactly three services run: the app, zero-cache and Postgres
- **AND** no object-storage service is present

#### Scenario: Files survive a container restart

- **WHEN** a file is uploaded and the application container is recreated
- **THEN** the file is still served, because the storage directory is a named volume

#### Scenario: The storage directory is writable by the application user

- **WHEN** the image starts as the non-root application user
- **THEN** the configured storage directory exists and is writable by that user

### Requirement: Storage configuration is validated at boot and reported by the readiness check

The system SHALL validate storage configuration with the rest of the environment at startup, failing
fast and naming the offending variable. Selecting object storage SHALL require its full variable set
all-or-nothing, on the same rule the connector credentials already follow. Readiness SHALL include a
storage probe, so an unreachable bucket or an unwritable directory is visible before the first
upload.

#### Scenario: A partial object-storage configuration fails boot by name

- **WHEN** object storage is selected with one required variable missing
- **THEN** boot fails and the message names that variable

#### Scenario: Unset storage variables mean the local default, never a failure

- **WHEN** no storage variables are set
- **THEN** the instance boots using the local provider at the documented default directory

#### Scenario: Readiness reflects storage health

- **WHEN** the configured storage is unreachable or unwritable
- **THEN** the readiness endpoint reports not-ready and names the storage check

### Requirement: The runtime image carries a native image-processing module

The system SHALL generate thumbnails using a native module in the application image. The image build
SHALL resolve that module's prebuilt platform binaries in a stage whose base image matches the
runtime stage, and the constraint this places on cross-architecture builds SHALL be documented.

#### Scenario: Thumbnails work in the published image

- **WHEN** an image is uploaded to an instance running the published image
- **THEN** a thumbnail is generated and served

#### Scenario: Cross-architecture builds are documented, not discovered

- **WHEN** a maintainer builds the image for an architecture other than the build host's
- **THEN** the documented build instructions state what is required for the native module's
  binaries to match the target

### Requirement: Backup covers attachments, and its contents differ per provider

The system's documented one-command backup SHALL state exactly what it captures under each storage
provider: with the local provider, a database dump **and** an archive of the storage directory; with
object storage, the database dump only, with the attachment table serving as the manifest against
which an operator verifies their own bucket backup.

Capture ordering SHALL be documented so that no captured row can reference bytes that were never
captured: because an upload writes its object before its row, the database SHALL be dumped before
the files are captured, making the file capture a superset of what the dump refers to. Restore
ordering SHALL be documented separately, as a statement about intermediate states rather than about
completeness: the database SHALL be restored before the files, so the only state a partial restore
can be in is one the running application already handles.

#### Scenario: Local-provider backup includes the files

- **WHEN** a backup is taken on an instance using the local provider
- **THEN** the documented output contains both the database dump and an archive of the storage
  directory

#### Scenario: Object-storage backup names the operator's responsibility

- **WHEN** a backup is taken on an instance using object storage
- **THEN** the documentation states that the bucket is the operator's own backup domain
- **AND** states that the attachment table is the manifest for verifying it

#### Scenario: Capture ordering never dumps a row whose bytes were not captured

- **WHEN** the documented backup procedure is followed
- **THEN** the database is dumped before the files are captured, so every row in the dump names
  bytes that were already on disk when the dump ran
- **AND** the file capture may contain objects with no row in the dump, which are the orphans the
  nightly sweep already collects

#### Scenario: Restore ordering leaves only states the application already handles

- **WHEN** the documented restore procedure is followed
- **THEN** the database is restored before the files, so a row whose bytes have not landed yet
  serves the ordinary refusal rather than leaving unreachable bytes

