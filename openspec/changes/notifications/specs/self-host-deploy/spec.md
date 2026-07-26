## MODIFIED Requirements

### Requirement: Validated configuration and health endpoints

The app SHALL validate all environment variables with Zod at boot and expose `/healthz` (liveness) and `/readyz` (readiness including database connectivity and replication-slot health). Validation SHALL additionally cover the authentication configuration — the better-auth secret and base URL, optional GitHub OAuth credentials, optional OIDC/SSO configuration, the optional bootstrap-admin email — and the **optional email-delivery configuration**: the SMTP URL, the HTTPS sender's API key, the From address, the public base URL used for email deep links, and the notification sweep schedules. Validation SHALL fail fast with the offending variable name and expected format, while leaving unset optional integrations simply disabled. Defaults SHALL be chosen so `docker compose up` still boots with an empty `.env`.

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

#### Scenario: Email left unconfigured boots cleanly

- **WHEN** the app starts with no SMTP URL and no HTTPS sender key
- **THEN** it boots successfully, logs once that email is disabled, registers no email job, and the in-app inbox works fully

#### Scenario: Enabling a transport without its companions fails fast

- **WHEN** the app starts with an email transport configured but no From address or no public base URL
- **THEN** it exits non-zero before listening, naming the missing variable and what it is for

## ADDED Requirements

### Requirement: Outbound email adds no container

Adding outbound email delivery SHALL NOT change the three-container contract. Both transports run in-process inside the existing app container: the SMTP transport is an outbound client, and the HTTPS transport is a single outbound request. Neither SHALL introduce a mail server, a queue service, or any other required container, and the background sweeps SHALL run on the **existing** Postgres-backed job scheduler instance rather than a new one.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected after this change
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no mail or queue container

#### Scenario: No additional job-scheduler instance

- **WHEN** the server's background-job wiring is inspected
- **THEN** the notification sweeps are registered on the already-existing scheduler instance, and the number of job-scheduler instances started by the process is unchanged
