## MODIFIED Requirements

### Requirement: Commit hygiene and release automation

The repository SHALL enforce Conventional Commits and DCO sign-off (lefthook locally, CI check
authoritatively), and release-please SHALL maintain a release PR that, when merged, tags a release
with a generated changelog.

**Image publishing SHALL be independent of the release job.** Every push to `main` SHALL publish
multi-arch images to GHCR tagged `edge` and `sha-<short-sha>`, whether or not the release job
succeeded, so that a repository setting or a release-automation failure can never leave the project
with no published artifact. Version, `stable` and `latest` tags SHALL still be published only when a
release is actually cut.

Published-artifact claims elsewhere in the repository SHALL describe only what the pipeline actually
does: no signing, provenance or vulnerability-scanning claim SHALL be made unless the pipeline
performs it.

#### Scenario: Non-conforming commit is rejected

- **WHEN** a commit lacks DCO sign-off or a conventional type prefix
- **THEN** the CI commit check fails, identifying the offending commit

#### Scenario: Edge images publish independently of release automation

- **WHEN** a commit lands on `main` and the release job fails
- **THEN** multi-arch `edge` and `sha-<short-sha>` images are still published to GHCR

#### Scenario: Release from merged release PR

- **WHEN** a release-please PR is merged
- **THEN** a tagged release with generated changelog exists and tagged multi-arch images are published to GHCR

#### Scenario: Version tags require an actual release

- **WHEN** a commit lands on `main` that does not cut a release
- **THEN** no version, `stable` or `latest` tag is published, and `edge` and the sha tag are

### Requirement: Compose smoke test

CI SHALL build the production image and run the real `docker/docker-compose.yml`, asserting that
`/readyz` becomes healthy and the synced workspace renders — making the 3-container promise an
executable test. The smoke test SHALL boot the stack through the **same env-file mechanism the
quickstart documents**, so that a quickstart command which does not read the operator's environment
file is a CI failure rather than a silent production defect.

#### Scenario: Deployment regression is caught in CI

- **WHEN** a change breaks boot ordering, migration-on-boot, or the sync pipeline
- **THEN** the compose smoke test fails before the change can merge

The smoke test SHALL also assert the **boot composition** that no unit test can reach: that the
running instance's readiness report carries the configuration entry and reports no shipped defaults
in use, and that a container started with a shipped-default secret under `NODE_ENV=production` exits
refusing to start.

#### Scenario: The documented quickstart mechanism is the tested one

- **WHEN** the documented quickstart stops passing the operator's environment file to Compose
- **THEN** the smoke path no longer receives the generated secrets and CI fails

#### Scenario: The shipped-default gate is wired into boot, not merely implemented

- **WHEN** the configuration readiness entry or the boot-time refusal is dropped from the server's
  composition while its pure functions still pass their unit tests
- **THEN** the compose smoke test fails
