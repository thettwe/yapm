## MODIFIED Requirements

### Requirement: Validated configuration and health endpoints

The app SHALL validate all environment variables with Zod at boot and expose `/healthz` (liveness) and `/readyz` (readiness including database connectivity and replication-slot health). Validation SHALL additionally cover the authentication configuration — the better-auth secret and base URL, optional GitHub OAuth credentials, optional OIDC/SSO configuration, optional SMTP settings, and the optional bootstrap-admin email — and the optional connector configuration — the GitHub App id, App private key, and webhook secret, plus the `SECRETS_ENCRYPTION_KEY` used to encrypt connector secrets at rest — failing fast with the offending variable name and expected format, while leaving unset optional integrations simply disabled. Defaults SHALL be chosen so `docker compose up` still boots with an empty `.env`.

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

## ADDED Requirements

### Requirement: The GitHub connector adds no container and encrypts secrets at rest

Adding the GitHub connector SHALL NOT change the three-container contract: webhook ingestion SHALL run in-process inside the existing `yapm` app container with pg-boss on the existing Postgres — it MUST NOT introduce Redis, a queue service, a webhook relay, or any other required container. The GitHub App (App id, private key, webhook secret) is an optional external integration the operator registers and configures by env, not a service yapm ships. Any connector secret stored in Postgres SHALL be encrypted at rest with `SECRETS_ENCRYPTION_KEY` and held in server-only tables that never replicate to clients, and SHALL never be logged.

Work-graph placement: deployment/config surface for the connector pipeline. Permission story: connector secrets are server-only, admin-gated, and never synced or logged.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected after this change
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no queue, cache, or relay container for connectors

#### Scenario: Connector works within the existing app process

- **WHEN** an operator configures the GitHub App and installs it
- **THEN** webhook ingestion, serialized-per-installation processing, and reconciliation all run inside the `yapm` container on the existing Postgres

#### Scenario: Stored secrets are encrypted and unlogged

- **WHEN** a webhook secret or App private key is persisted
- **THEN** it is stored AES-256-GCM-encrypted in a server-only table and never appears in logs
