## ADDED Requirements

### Requirement: Every end-to-end test starts from the bootstrapped baseline

The Playwright suite SHALL restore the database to the state the server creates at boot before every
test: exactly one `workspace` row and the bootstrap admin identified by `YAPM_BOOTSTRAP_ADMIN_EMAIL`
(its user, its credential and its workspace membership). No team, invite, project, issue, cycle,
retro, notification, user or work-graph row created by one test SHALL be visible to another.

The restore SHALL derive the set of tables it clears from the live database schema rather than from
a list maintained by hand, subtracting only an explicit, commented set of preserved and
externally-owned tables (migration bookkeeping, the job queue, and anything outside the application
schema). A table introduced by a later change therefore joins the restore with no human step.

The suite SHALL continue to run with a single worker against a single database; this requirement
establishes test isolation, not parallelism.

#### Scenario: A spec cannot see another spec's fixtures

- **WHEN** any end-to-end test begins
- **THEN** the workspace it signs in to holds no team, invite, project or issue created by any other
  test, whichever tests ran before it and in whatever order

#### Scenario: The bootstrap admin stays deterministically the admin

- **WHEN** a test signs in as the account named by `YAPM_BOOTSTRAP_ADMIN_EMAIL`
- **THEN** that account holds the workspace `admin` role, regardless of which accounts any earlier
  test created or which of them signed in first

#### Scenario: A new table cannot silently re-introduce the leak

- **WHEN** a later change adds a table to the application schema and does not update the harness
- **THEN** the restore clears it and the isolation assertion covers it, because both are derived
  from the schema

### Requirement: The isolation contract is enforced by an executable gate

The isolation SHALL be asserted by the suite itself, not documented and trusted. Before each test
body runs, the harness SHALL assert that every non-preserved table is empty, and the suite SHALL
carry one spec, ordered last, that asserts the workspace it inherits from the whole preceding run
holds no accumulated fixtures.

#### Scenario: A broken restore turns CI red

- **WHEN** the restore stops covering a table, or a spec writes rows the restore cannot reach
- **THEN** the isolation assertion fails and the `e2e` job fails, naming the table that was not
  empty

#### Scenario: The last spec inherits a clean workspace

- **WHEN** the suite's final spec runs, after every other spec in the run
- **THEN** it observes no teams, invites, projects or issues from any of them

### Requirement: No end-to-end test encodes fixture size or machine speed as a constant

No test SHALL assert against a hard-coded bound that measures how much fixture data happened to
exist or how fast the machine happened to be. Bounds over page content — tab-stop walks, list
positions, counts — SHALL be derived from the page under test, and a failure message SHALL state the
derived bound it used. A test SHALL NOT select a shared-list entry by position (`first`, `last`,
`nth`) when the list is one other tests append to; it SHALL select by something the test itself
knows.

A raised timeout SHALL be justified by evidence that the wait was genuinely under-provisioned, with
that evidence recorded beside the number. A timeout raised to make an otherwise-failing test pass is
a defect, not a fix.

#### Scenario: A keyboard reach is proven, not budgeted

- **WHEN** a test asserts a control is reachable by keyboard alone
- **THEN** it walks a number of stops derived from the page's own focusable count, so the assertion
  measures reachability rather than how much data the run accumulated

#### Scenario: An assertion is never weakened to reach green

- **WHEN** an end-to-end test fails
- **THEN** it is fixed by repairing the harness or the product, never by deleting, skipping,
  marking as expected-failure, or softening the assertion; and any coverage change at all is
  reported explicitly
