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

Adding the AI layer SHALL NOT change the three-container contract: all model calls SHALL run in-process inside the existing `yapm` app container via the AI SDK, and the cycle-digest pre-compute SHALL run on the existing pg-boss on the existing Postgres — it MUST NOT introduce Redis, a vector store, an inference service, a queue service, or any other required container. AI is BYO-key: the provider (Anthropic/Google/OpenAI) is an optional external integration the operator or an admin configures by env or the admin UI, not a service yapm ships or a capability yapm paywalls. Any AI provider key stored in Postgres SHALL reuse the existing server-only, AES-256-GCM encrypted connector secret surface (never a new store), SHALL never replicate to clients, and SHALL never be logged.

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

### Requirement: Outbound email adds no container

Adding outbound email delivery SHALL NOT change the three-container contract. Both transports run in-process inside the existing app container: the SMTP transport is an outbound client, and the HTTPS transport is a single outbound request. Neither SHALL introduce a mail server, a queue service, or any other required container, and the background sweeps SHALL run on the **existing** Postgres-backed job scheduler instance rather than a new one.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no mail or queue container

#### Scenario: No additional job-scheduler instance

- **WHEN** the server's background-job wiring is inspected
- **THEN** the notification sweeps are registered on the already-existing scheduler instance, and the number of job-scheduler instances started by the process is unchanged

