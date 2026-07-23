# ci-pipeline

## ADDED Requirements

### Requirement: Quality gates on every pull request
CI SHALL run lint (Biome), typecheck (TS7 `tsc --noEmit`), unit tests (Vitest), and production build on every pull request, using Turborepo caching, and MUST pass before merge.

#### Scenario: Failing gate blocks merge
- **WHEN** any of lint, typecheck, test, or build fails on a PR
- **THEN** the PR's required status check fails with the failing task identified

### Requirement: Compose smoke test
CI SHALL build the production image and run the real `docker/docker-compose.yml`, asserting that `/readyz` becomes healthy and the synced workspace renders — making the 3-container promise an executable test.

#### Scenario: Deployment regression is caught in CI
- **WHEN** a change breaks boot ordering, migration-on-boot, or the sync pipeline
- **THEN** the compose smoke test fails before the change can merge

### Requirement: Commit hygiene and release automation
The repository SHALL enforce Conventional Commits and DCO sign-off (lefthook locally, CI check authoritatively), and release-please SHALL maintain a release PR that, when merged, tags a release and builds images to GHCR (`edge` from main, version tags + `stable` from releases).

#### Scenario: Non-conforming commit is rejected
- **WHEN** a commit lacks DCO sign-off or a conventional type prefix
- **THEN** the CI commit check fails, identifying the offending commit

#### Scenario: Release from merged release PR
- **WHEN** a release-please PR is merged
- **THEN** a tagged release with generated changelog exists and tagged multi-arch images are published to GHCR
