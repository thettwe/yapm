## MODIFIED Requirements

### Requirement: Validated configuration and health endpoints

The app SHALL validate all environment variables with Zod at boot and expose `/healthz` (liveness) and `/readyz` (readiness including database connectivity and replication-slot health). Validation SHALL additionally cover the authentication configuration — the better-auth secret and base URL, optional GitHub OAuth credentials, optional OIDC/SSO configuration, optional SMTP settings, and the optional bootstrap-admin email — the optional connector configuration — the GitHub App id, App private key, and webhook secret, plus the `SECRETS_ENCRYPTION_KEY` used to encrypt connector and AI secrets at rest — and the optional AI configuration — instance-default provider API keys, a default provider, and the cycle-close digest pre-compute toggle — failing fast with the offending variable name and expected format, while leaving unset optional integrations simply disabled. Defaults SHALL be chosen so `docker compose up` still boots with an empty `.env`. AI SHALL be disabled cleanly when no AI key is configured (via env or the admin UI); a malformed instance-default AI value SHALL fail fast by name, while a per-workspace key entered via the UI is validated at use, never crashing boot.

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

## ADDED Requirements

### Requirement: The AI layer adds no container and runs in-process

Adding the AI layer SHALL NOT change the three-container contract: all model calls SHALL run in-process inside the existing `yapm` app container via the AI SDK, and the cycle-digest pre-compute SHALL run on the existing pg-boss on the existing Postgres — it MUST NOT introduce Redis, a vector store, an inference service, a queue service, or any other required container. AI is BYO-key: the provider (Anthropic/Google/OpenAI) is an optional external integration the operator or an admin configures by env or the admin UI, not a service yapm ships or a capability yapm paywalls. Any AI provider key stored in Postgres SHALL reuse the existing server-only, AES-256-GCM encrypted connector secret surface (never a new store), SHALL never replicate to clients, and SHALL never be logged.

Work-graph placement: deployment/config surface for the AI pipeline. Permission story: AI keys are server-only, admin-gated, never synced or logged; the model call carries the invoking user's context.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected after this change
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no inference, cache, vector, or queue container for AI

#### Scenario: AI runs within the existing app process

- **WHEN** an admin configures a provider key and a cycle closes
- **THEN** the digest is pre-computed by an in-process AI-SDK call on the existing pg-boss, with no new container

#### Scenario: AI keys reuse the encrypted connector surface

- **WHEN** a provider key is entered via the admin UI
- **THEN** it is stored AES-256-GCM-encrypted in the existing server-only connector secret table, never synced, and never logged
