# self-host-deploy

## ADDED Requirements

### Requirement: Three-container deployment
Production self-hosting SHALL consist of exactly three containers — `yapm` (app: API + Zero endpoints + static SPA in one process), `zero-cache`, and `postgres` (≥15, `wal_level=logical`) — defined in `docker/docker-compose.yml` with no additional required services.

#### Scenario: Clean-machine deploy
- **WHEN** an operator runs `docker compose up -d` with only the documented env vars set
- **THEN** all three containers reach healthy state and the app serves the UI with a working synced workspace

#### Scenario: Container count is the contract
- **WHEN** the compose file is inspected
- **THEN** it defines exactly three services, and no Redis, Elasticsearch, MinIO, or reverse proxy is required

### Requirement: Migrations run automatically on boot
The app container SHALL apply pending Kysely migrations (forward-only, transactional) before accepting traffic, and zero-cache SHALL start only after the app is healthy so the replicated schema always exists.

#### Scenario: Upgrade is pull-and-up
- **WHEN** an operator pulls a newer image tag and runs `docker compose up -d`
- **THEN** migrations apply automatically and the app serves traffic without manual migration steps

### Requirement: Validated configuration and health endpoints
The app SHALL validate all environment variables with Zod at boot and expose `/healthz` (liveness) and `/readyz` (readiness including database connectivity and replication-slot health).

#### Scenario: Misconfiguration fails fast and clearly
- **WHEN** the app starts with a missing or malformed required env var
- **THEN** it exits non-zero before listening, printing the variable name and the expected format

#### Scenario: Readiness reflects sync health
- **WHEN** Postgres logical replication is unavailable to zero-cache
- **THEN** `/readyz` reports not-ready with a reason string identifying replication as the cause
