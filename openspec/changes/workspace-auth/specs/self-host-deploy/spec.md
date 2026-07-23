# self-host-deploy Specification

## ADDED Requirements

### Requirement: Authentication adds no container

Adding authentication SHALL NOT change the three-container contract. better-auth runs in-process inside the existing `yapm` app container and is backed by the existing Postgres — it MUST NOT introduce Redis, an auth service, an SMTP server, or any other required container. SMTP, GitHub OAuth, and OIDC/SSO are optional external integrations configured by env, not services yapm ships.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected after this change
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no auth, cache, or mail container

#### Scenario: Auth works without SMTP

- **WHEN** an operator deploys with no SMTP configured
- **THEN** email/password sign-up, invites (via copyable link), and sign-in all work

## MODIFIED Requirements

### Requirement: Migrations run automatically on boot

The app container SHALL apply pending Kysely migrations (forward-only, transactional) before accepting traffic, and SHALL additionally create/update better-auth's tables at boot via better-auth's `getMigrations()` on the same Postgres, so no separate auth-migration CLI step is required. zero-cache SHALL start only after the app is healthy so the replicated schema always exists. Boot order SHALL be: Kysely `Migrator` (advisory-locked) → better-auth `getMigrations()` → workspace seed → serve.

#### Scenario: Upgrade is pull-and-up

- **WHEN** an operator pulls a newer image tag and runs `docker compose up -d`
- **THEN** both app and auth migrations apply automatically and the app serves traffic without manual migration steps

#### Scenario: Auth tables exist after first boot

- **WHEN** the app boots against a database that has never run auth migrations
- **THEN** better-auth's tables (`user`, `session`, `account`, `verification`, `jwks`) are created before the app accepts sign-in traffic

### Requirement: Validated configuration and health endpoints

The app SHALL validate all environment variables with Zod at boot and expose `/healthz` (liveness) and `/readyz` (readiness including database connectivity and replication-slot health). Validation SHALL additionally cover the authentication configuration — the better-auth secret and base URL, optional GitHub OAuth credentials, optional OIDC/SSO configuration, optional SMTP settings, and the optional bootstrap-admin email — failing fast with the offending variable name and expected format, while leaving unset optional integrations simply disabled. Defaults SHALL be chosen so `docker compose up` still boots with an empty `.env`.

#### Scenario: Misconfiguration fails fast and clearly

- **WHEN** the app starts with a missing or malformed required env var
- **THEN** it exits non-zero before listening, printing the variable name and the expected format

#### Scenario: Readiness reflects sync health

- **WHEN** Postgres logical replication is unavailable to zero-cache
- **THEN** `/readyz` reports not-ready with a reason string identifying replication as the cause

#### Scenario: Optional auth integrations default to disabled

- **WHEN** GitHub OAuth, OIDC/SSO, and SMTP env vars are all unset
- **THEN** the app boots successfully with those integrations disabled and the built-in email/password method available
