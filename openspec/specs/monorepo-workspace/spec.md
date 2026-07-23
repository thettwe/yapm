# monorepo-workspace Specification

## Purpose
TBD - created by archiving change foundation. Update Purpose after archive.
## Requirements
### Requirement: Workspace layout and package boundaries
The repository SHALL be a pnpm 11 workspace with Turborepo containing `apps/web`, `apps/server`, `apps/docs`, `packages/schema`, `packages/ui`, `packages/api`, and `packages/config`. Packages MUST NOT import from apps, `packages/schema` MUST NOT depend on UI libraries, and all Zero ZQL usage and custom mutators MUST live in `packages/schema`.

#### Scenario: Boundary violation is rejected
- **WHEN** a package imports from an app, or ZQL/mutator code is added outside `packages/schema`
- **THEN** the lint/build pipeline fails with an error naming the violated boundary

#### Scenario: Shared mutator is a single implementation
- **WHEN** a mutator defined in `packages/schema` is used
- **THEN** `apps/web` (optimistic) and `apps/server` (authoritative) import the same exported function

### Requirement: Single-point version management
All external dependency versions SHALL be declared once in the pnpm catalog (`pnpm-workspace.yaml`); workspace package.json files MUST reference `catalog:` instead of literal versions.

#### Scenario: Catalog bypass is caught
- **WHEN** a workspace package declares a literal semver version for a cataloged dependency
- **THEN** CI fails with a message pointing to the catalog

### Requirement: Pinned toolchain
The repository SHALL pin Node 24 LTS (engines + `.node-version`) and pnpm via the `packageManager` field, and use TypeScript 7 with `moduleResolution: "bundler"`, no `baseUrl`, and Biome as the only lint/format tool.

#### Scenario: Fresh clone bootstrap
- **WHEN** a contributor with Node 24 and Corepack enabled runs `pnpm install`
- **THEN** install completes with the pinned pnpm version, no tokens or accounts required, and `pnpm turbo typecheck lint test` passes

### Requirement: Task pipeline
Turborepo SHALL define `build`, `dev`, `typecheck`, `lint`, `test`, and `e2e` tasks with dependency-aware caching using local and GitHub Actions cache only (no hosted remote cache).

#### Scenario: Incremental task execution
- **WHEN** a change touches only `packages/ui`
- **THEN** `turbo build` rebuilds `packages/ui` and its dependents only, with unaffected tasks restored from cache

