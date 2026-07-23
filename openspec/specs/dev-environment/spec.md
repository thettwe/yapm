# dev-environment Specification

## Purpose
TBD - created by archiving change foundation. Update Purpose after archive.
## Requirements
### Requirement: One-command development loop
`pnpm dev` SHALL start the complete development environment: Postgres and zero-cache via `docker/docker-compose.dev.yml`, the Hono server in watch mode, and the Vite dev server — on any machine with Docker, Node 24, and Corepack, with no additional setup steps.

#### Scenario: Clone to running app
- **WHEN** a contributor runs `pnpm install && pnpm dev` on a fresh clone
- **THEN** the web app is reachable on the printed local URL with live data from the local Postgres within one command's output

#### Scenario: Hot reload on both sides
- **WHEN** a file in `apps/web` or `apps/server` is edited during `pnpm dev`
- **THEN** the affected process reloads automatically without restarting `pnpm dev`

### Requirement: Development state is disposable
Development containers SHALL use named volumes that can be reset with a documented single command, and the server SHALL seed a minimal workspace row on first boot against an empty database.

#### Scenario: Reset development database
- **WHEN** a contributor runs the documented reset command
- **THEN** volumes are recreated, migrations re-run on next `pnpm dev`, and the seeded workspace appears in the app

