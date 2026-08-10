## ADDED Requirements

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

### Requirement: The stack starts in an order the sync layer survives

The documented startup order — Postgres, then migrations, then `zero-cache`, then the web server —
SHALL be the order CI actually uses, so the sync cache never snapshots a schema-less database.
Where the documentation and the workflow disagree, the disagreement SHALL be resolved rather than
recorded.

#### Scenario: The sync cache never snapshots an unmigrated database

- **WHEN** the E2E job starts its containers
- **THEN** the schema is in place before `zero-cache` begins replicating, and the job asserts this
  rather than assuming it
