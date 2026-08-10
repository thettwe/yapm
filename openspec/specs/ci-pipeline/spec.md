# ci-pipeline Specification

## Purpose
TBD - created by archiving change foundation. Update Purpose after archive.
## Requirements
### Requirement: Quality gates on every pull request
CI SHALL run lint (Biome), typecheck (TS7 `tsc --noEmit`), unit tests (Vitest), and production build on every pull request, using Turborepo caching, and MUST pass before merge.

#### Scenario: Failing gate blocks merge
- **WHEN** any of lint, typecheck, test, or build fails on a PR
- **THEN** the PR's required status check fails with the failing task identified

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

### Requirement: The absence of byte-granting URLs is enforced by a gate, not by review

The pipeline SHALL fail when a change introduces a capability-granting URL into the storage layer or
into stored rich-text content, on the same precedent by which the search layer's exclusion from the
AI data path is asserted by a test rather than reasoned about. The gate SHALL fail on **any** added
member of the storage seam, not only on a list of known names, so a differently-named URL-minting
method is caught too.

#### Scenario: A presigning helper fails the build

- **WHEN** a file under the storage directory introduces `presign`, `signedUrl`, `getSignedUrl`,
  `createPresignedUrl` or `X-Amz-Signature`
- **THEN** the gate fails and names the file

#### Scenario: An added seam member fails the build whatever it is called

- **WHEN** a member is added to the `StorageProvider` interface beyond `kind`, `put`, `get`,
  `delete` and `health`
- **THEN** the gate fails, without needing to recognise the new member's name

#### Scenario: An absolute URL in stored rich-text content fails the build

- **WHEN** a rich-text image node definition or fixture introduces an attribute carrying an
  `http` URL
- **THEN** the gate fails

#### Scenario: The gate is derived, not hand-listed

- **WHEN** the guarded module gains a new export
- **THEN** the gate covers it without the guard file being edited

### Requirement: The E2E suite reports a failure where it happened

Every Playwright action SHALL be bounded by an explicit `actionTimeout` and `navigationTimeout`.
An action that cannot succeed SHALL fail at that action, naming its selector, and SHALL NOT be
allowed to consume the test's whole budget — because a run that reports a teardown error in place
of the action that failed is a run that cannot be diagnosed, and two changes were scoped against
exactly that misreporting.

The bounds SHALL be set with enough margin over the slowest action the suite actually performs that
they cannot convert a slow-but-succeeding action into a failure, and that margin SHALL be recorded
where the bounds are set.

#### Scenario: A hung action fails at itself, not at teardown

- **WHEN** an action can never succeed — an element that will not appear, a keypress that never
  lands
- **THEN** the run fails at that action within its bound, naming the selector, rather than reporting
  the teardown that follows it

#### Scenario: A slow but succeeding action is not newly failed

- **WHEN** an action takes longer than usual but completes
- **THEN** it passes, because the bound is set above the slowest action the suite performs

### Requirement: A transient is asserted open before it is used

A test that reaches a destination through a transient — a menu, a popover, a dialog that has to be
opened — SHALL assert the transient is open before acting inside it. The assertion SHALL key on an
observable that distinguishes open from closed, and retrying the opener SHALL be idempotent: a
retry that re-clicks a toggle closes what it opened and oscillates instead of converging.

The deck's `more▾` is the case this comes from: it is clickable the instant a route change begins,
before the transient behind it can respond, so a click that lands in that window opens nothing.

#### Scenario: The opener is retried without toggling

- **WHEN** the transient has not opened yet and the helper retries
- **THEN** it re-clicks the opener only while the opener reports itself closed, and never closes a
  menu it has already opened

#### Scenario: A genuinely broken transient still fails, and says so

- **WHEN** the transient cannot open at all
- **THEN** the test fails naming the transient and the item it was looking for, within the bound,
  rather than at teardown

### Requirement: The E2E suite runs against the built bundle

The end-to-end suite SHALL serve the production build rather than the dev server. The dev server
optimizes dependencies lazily, and with route-level code splitting a route nobody has visited yet
discovers new dependencies mid-run, re-optimizes, and can serve one page `react` and `react-dom`
from different bundles — which breaks component mounting in whichever client reaches an unvisited
route first, and that is always the second client.

Serving the build removes the optimizer from the run entirely, and has the property that the suite
asserts against the bundle that ships.

#### Scenario: No dependency re-optimization can occur during a run

- **WHEN** the E2E suite runs
- **THEN** no dependency-optimizer artifact is served, so no page can be handed two copies of a
  framework mid-run

### Requirement: A spec file passes alone

Every E2E spec file SHALL pass when run by itself against a freshly bootstrapped database, and
SHALL build the fixtures it needs rather than inheriting a sibling's. A suite whose files depend on
each other's leftovers cannot be bisected, and a failure in it cannot be attributed.

#### Scenario: A spec run alone is green

- **WHEN** any single spec file is run against a freshly bootstrapped database
- **THEN** it passes, without a sibling having run first

### Requirement: The documented startup order is the order CI actually uses

The documentation SHALL describe the startup order the E2E workflow actually performs. Where the
two disagree, the disagreement SHALL be resolved rather than recorded — and it was resolved by
measurement: the workflow brings Postgres and `zero-cache` up together and lets the app server
migrate at boot, the suspected snapshot race does not occur (`SchemaVersionNotSupported` is zero
across the audited CI runs, because `zero-cache` follows migrations through logical replication
after its initial snapshot), so the workflow stands and the documentation that claimed a
migrate-before-zero-cache order was the defect.

#### Scenario: The documentation and the workflow agree

- **WHEN** a reader compares the documented E2E startup order with the workflow's actual order
- **THEN** they are the same order, and the documentation records why that order is safe for the
  sync layer rather than asserting an order the job never performs

