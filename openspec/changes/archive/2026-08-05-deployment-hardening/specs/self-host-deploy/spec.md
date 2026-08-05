## ADDED Requirements

### Requirement: A shipped default for a security-relevant variable is detected and named

The application SHALL know the literal values it ships as defaults for security-relevant
configuration and SHALL detect at boot when a running instance is still using one. The detected set
SHALL cover every such variable the server process can observe: the better-auth secret, the Zero
query and mutate API keys, and the database password carried in the connection string.

Under `NODE_ENV=production` a detected shipped default SHALL be **fatal**: the process SHALL exit
non-zero before listening, naming every offending variable and the remedy, following the same
fail-fast-by-name precedent as a partial GitHub App triplet. Outside production it SHALL be a warning
logged at `warn` naming every offending variable.

A single documented escape hatch SHALL downgrade the production refusal to a warning, for evaluation
and demo instances. Setting it SHALL be an explicit act recorded in the operator's own environment,
and the warning SHALL still name every variable it is permitting. There SHALL be no other way to run
in production on a shipped default.

Work-graph placement: none — this is a deployment property. Permission story: the detector reads
configuration only, holds no secret beyond what the process already holds, and SHALL NOT log any
secret's value — only its variable name.

#### Scenario: A defaulted secret refuses to boot in production

- **WHEN** the app starts with `NODE_ENV=production`, the escape hatch unset, and the better-auth
  secret still at its shipped default
- **THEN** it exits non-zero before listening, and the message names `BETTER_AUTH_SECRET`

#### Scenario: Every offending variable is named, not just the first

- **WHEN** two or more security-relevant variables are simultaneously at their shipped defaults
- **THEN** the refusal names all of them in one message, so the operator fixes them in one pass

#### Scenario: A secret's value never appears in the signal

- **WHEN** a shipped default is detected and reported, whether as a refusal or as a warning
- **THEN** the message contains the variable's name and contains no configured value

#### Scenario: Evaluation instances boot with an explicit opt-in

- **WHEN** the app starts in production on shipped defaults with the escape hatch set to true
- **THEN** it boots, and it logs a warning naming every variable still at a shipped default

#### Scenario: Development boots and warns

- **WHEN** the app starts outside production on shipped defaults
- **THEN** it boots without the escape hatch, and logs a warning naming every offending variable

#### Scenario: A configured instance says nothing

- **WHEN** every security-relevant variable has been changed from its shipped default
- **THEN** boot emits no shipped-default warning at all

### Requirement: Shipped defaults in use are visible in the readiness report

The readiness report SHALL carry a **non-gating** `configuration` entry reporting whether any
security-relevant variable is still at its shipped default — so an operator who missed the boot log
can discover the state of a running instance without shell access to it. It SHALL be non-gating,
following the search-freshness precedent: a defaulted secret is a security problem, not a reason to
take an instance out of load-balancer rotation, and making it gating would turn a warning into an
outage.

The readiness entry SHALL report **how many** variables are affected and SHALL NOT name them:
`/readyz` is unauthenticated and the deployment guidance places it behind a catch-all public reverse
proxy, so naming them would confirm to an anonymous caller which published secrets a host is running
on. The **names** SHALL be available on an operator-only surface — an admin-gated endpoint under
`/api/v1` that refuses a non-admin before reading anything — so the operator still gets them without
shell access. Neither surface SHALL ever return a value.

#### Scenario: Defaults are counted without failing readiness

- **WHEN** an instance is running with one or more shipped defaults still in place
- **THEN** `/readyz` reports how many in the `configuration` entry, names none of them, and the
  instance still reports ready

#### Scenario: An admin can read which variables are affected

- **WHEN** a workspace admin requests the configuration endpoint on that instance
- **THEN** every offending variable is named with its remedy, and no value is returned

#### Scenario: A non-admin learns nothing

- **WHEN** an anonymous caller, a member or a viewer requests the configuration endpoint
- **THEN** the request is refused before any configuration is read, and no variable is named

#### Scenario: A configured instance reports clean

- **WHEN** no security-relevant variable is at its shipped default
- **THEN** the `configuration` entry reports that fact and names nothing

### Requirement: The browser-facing sync origin is runtime configuration

The origin the browser opens its sync WebSocket to SHALL be resolved at **runtime**, served by the
app process, and SHALL NOT be a build-time constant compiled into the web bundle. A prebuilt image
SHALL therefore sync correctly against any host and any domain with **no rebuild** — changing the
served value SHALL change where the client connects.

The app SHALL serve the value from a single unauthenticated endpoint under `/api`, uncacheable, so
that it is reachable through the existing development proxy and inspectable with an HTTP client. The
value SHALL come from a validated environment variable whose default is the local development origin,
so that the development loop is unchanged and requires no configuration.

The SPA SHALL NOT construct its sync client until the origin is known: it SHALL hold a neutral boot
state while the value is in flight rather than rendering an error, and SHALL name the endpoint only
after retries are exhausted.

Work-graph placement: none — deployment surface of the sync capability. Permission story: the
endpoint discloses only the sync origin, which is already public to every browser that connects.

#### Scenario: Changing the served origin changes the connection, with no rebuild

- **WHEN** the served sync origin is changed and a browser loads the same unchanged bundle
- **THEN** the sync client connects to the new origin

#### Scenario: No build-time sync origin survives on the connection path

- **WHEN** the web application's sources are searched for a compile-time sync-origin constant
- **THEN** none appears anywhere on the path that constructs the sync client

#### Scenario: The pre-config paint is deliberate

- **WHEN** the SPA is loading and the runtime configuration request has not yet resolved
- **THEN** the application renders a neutral boot state, renders no error, and constructs no sync
  client

#### Scenario: An unreachable configuration endpoint is eventually named

- **WHEN** the runtime configuration request fails repeatedly
- **THEN** the application surfaces a failure that names the configuration endpoint, rather than an
  empty workspace or a silent sync failure

#### Scenario: The development loop needs no configuration

- **WHEN** a contributor runs the development stack with no sync-origin variable set
- **THEN** the served origin is the local development default and sync works

### Requirement: Upgrade and rollback are specified operations with an honest rollback answer

Upgrading SHALL be documented for **both** shapes the project ships: a locally-built stack and a
prebuilt-image stack, each with the exact command that works against `docker/docker-compose.yml`. No
document SHALL print an upgrade command that does not work against the shipped compose file.

Rollback SHALL be documented truthfully. Because migrations are forward-only and apply at boot,
rolling an image back after a migration has applied SHALL be documented as **unrecoverable without a
database restore** — the documentation SHALL state that there is no down-migration, name the restore
procedure, and SHALL NOT imply that re-running an older tag is safe.

The documentation SHALL state which upgrades are operationally breaking, including that an instance
previously running on shipped defaults will refuse to boot until its secrets are set, and that
changing the better-auth secret invalidates existing sessions and the stored key material.

#### Scenario: The documented upgrade command works for a locally-built stack

- **WHEN** an operator who built the image locally follows the documented upgrade steps
- **THEN** the new image is built and the stack restarts with migrations applied at boot

#### Scenario: The documented upgrade command works for a prebuilt-image stack

- **WHEN** an operator running a published image tag follows the documented upgrade steps
- **THEN** the newer image is pulled and the stack restarts with migrations applied at boot

#### Scenario: Rollback is documented as a restore, not as a downgrade

- **WHEN** an operator reads the rollback documentation after a failed upgrade whose migrations
  applied
- **THEN** it states that there is no down-migration and directs them to restore the database from
  backup alongside the older image

### Requirement: Deployment, hardening and configuration are documented for self-hosters

The self-hosting documentation SHALL cover installation and production deployment, not only
individual features. It SHALL include: the exact variables an operator must change before exposing an
instance and what each one protects; TLS termination and reverse-proxying, given that the compose
file publishes both the app port and the zero-cache port on all interfaces; resource and disk sizing;
and a first-run checklist.

It SHALL additionally include a **configuration reference** enumerating every environment variable
the server validates, its default, and what it does. That reference SHALL be checked mechanically
against the validated schema so it cannot drift, on the same footing as the environment example.

#### Scenario: An operator can find how to deploy, not only how to use a feature

- **WHEN** the self-hosting documentation is inspected
- **THEN** it contains a production deployment and hardening page, an upgrade and rollback page, and
  a configuration reference

#### Scenario: The configuration reference cannot drift

- **WHEN** the environment example, the configuration reference and the validated schema are compared
- **THEN** every variable appears in all three, and a variable added to one but not the others fails
  the check by name

#### Scenario: Both published ports are addressed

- **WHEN** an operator reads the hardening page
- **THEN** it states that the app port and the zero-cache port are both published on all interfaces
  by default and gives the terminating-proxy shape for each, without adding a required container

## MODIFIED Requirements

### Requirement: Validated configuration and health endpoints

The app SHALL validate all environment variables with Zod at boot and expose `/healthz` (liveness) and `/readyz` (readiness including database connectivity and replication-slot health). Validation SHALL additionally cover the authentication configuration — the better-auth secret and base URL, optional GitHub OAuth credentials, optional OIDC/SSO configuration, the optional bootstrap-admin email — the optional connector configuration — the GitHub App id, App private key, and webhook secret, plus the `SECRETS_ENCRYPTION_KEY` used to encrypt connector and AI secrets at rest — the optional AI configuration — instance-default provider API keys, a default provider, and the cycle-close digest pre-compute toggle — the **browser-facing sync origin** served to the SPA at runtime — and the **optional email-delivery configuration**: the SMTP URL, the HTTPS sender's API key, the From address, the public base URL used for email deep links, and the notification sweep schedules. Validation SHALL fail fast with the offending variable name and expected format, while leaving unset optional integrations simply disabled. AI SHALL be disabled cleanly when no AI key is configured (via env or the admin UI); a malformed instance-default AI value SHALL fail fast by name, while a per-workspace key entered via the UI is validated at use, never crashing boot.

Defaults SHALL be chosen so that a stack boots with an empty `.env` **for evaluation** — every
variable that governs behaviour rather than security SHALL have a working default. Security-relevant
variables SHALL also have shipped defaults so that nothing is undefined, but running in production on
one SHALL require the explicit opt-in described under "A shipped default for a security-relevant
variable is detected and named". An empty `.env` therefore boots a development stack unconditionally,
and boots a production stack only when insecure defaults have been explicitly permitted.

Email configuration SHALL be conditionally required rather than globally required: the From address and the public base URL SHALL be required **only when** an email transport is configured, and their absence in that case SHALL fail boot naming them — so that an operator enabling email is told what is missing instead of silently sending mail containing localhost links.

The public base URL SHALL be a distinct variable from the authentication base URL and from the SPA's trusted browser origin, and the documented meaning of each SHALL make clear why they may legitimately differ between a development stack and a single-container deployment.

#### Scenario: Misconfiguration fails fast and clearly

- **WHEN** the app starts with a missing or malformed required env var
- **THEN** it exits non-zero before listening, printing the variable name and the expected format

#### Scenario: An empty environment file boots a development stack

- **WHEN** a contributor starts the development stack with no `.env` at all
- **THEN** every variable takes its documented default and the stack comes up

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

### Requirement: Migrations run automatically on boot

The app container SHALL apply pending Kysely migrations (forward-only, transactional) before accepting traffic, and SHALL additionally create/update better-auth's tables at boot via better-auth's `getMigrations()` on the same Postgres, so no separate auth-migration CLI step is required. zero-cache SHALL start only after the app is healthy so the replicated schema always exists. Boot order SHALL be: Kysely `Migrator` (advisory-locked) → better-auth `getMigrations()` → workspace seed → serve.

Because migrations are forward-only and apply at boot, an image downgrade after a migration has
applied SHALL be treated as unrecoverable without a database restore, and the deployment
documentation SHALL say so rather than implying that a previous tag can simply be re-run.

#### Scenario: Upgrade applies migrations without a manual step

- **WHEN** an operator follows the documented upgrade path for their deployment shape — a rebuild for
  a locally-built stack, a pull for a prebuilt-image stack — and brings the stack back up
- **THEN** both app and auth migrations apply automatically at boot and the app serves traffic with
  no manual migration command

#### Scenario: A downgrade after a migration is not silently attempted

- **WHEN** an operator consults the documentation about returning to a previous image
- **THEN** it states that the newer schema is not readable by the older image, that no down-migration
  exists, and that the database must be restored from backup

#### Scenario: Auth tables exist after first boot

- **WHEN** the app boots against a database that has never run auth migrations
- **THEN** better-auth's tables (`user`, `session`, `account`, `verification`, `jwks`) are created before the app accepts sign-in traffic
