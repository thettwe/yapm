## ADDED Requirements

### Requirement: Every browser context an end-to-end test opens is owned by the harness

The end-to-end suite SHALL create every additional browser context through a harness fixture whose
teardown the test runner owns, so that the context is closed on the passing path and the failing
path alike, exactly once, without the spec body managing the lifecycle.

A spec body SHALL NOT open a browser context directly, and SHALL NOT close one in a `finally` block:
a close that races the runner's own teardown reports a secondary protocol error over the real
failure, which misdirects diagnosis.

#### Scenario: A test that times out still releases its contexts

- **WHEN** an end-to-end test that opened a second browser context exceeds its time budget
- **THEN** every context it opened is closed by the harness, and the reported failure is the timeout
  itself with no secondary context-disposal error attached

#### Scenario: A new multi-client spec cannot re-introduce hand-rolled lifecycle

- **WHEN** a spec file calls the browser's context factory directly instead of the harness fixture
- **THEN** an executable repository gate fails, naming the file and line

### Requirement: An unrequested page reload during an end-to-end test is a reported failure

A page that reloads itself while a test is running destroys the elements the test is waiting on and
produces a time-budget failure with no assertion disagreeing — a failure shape that is unreadable.

The harness SHALL observe each page for reloads it did not request, and a test whose page reloads
without the test navigating or reloading it SHALL fail with that reload and its reported reason
named, rather than timing out silently.

#### Scenario: A self-reloading page is named as the cause

- **WHEN** the sync client reloads the page under a running test
- **THEN** the test fails identifying the unrequested reload and the reason the client gave for it,
  not "test timeout exceeded"

#### Scenario: A test's own navigation is not a failure

- **WHEN** a test calls the page's own navigate or reload
- **THEN** no unrequested-reload failure is raised

### Requirement: An end-to-end spec file passes when run alone

Every end-to-end spec file SHALL pass when it is the only file in the run, against a database that
holds nothing but what the server creates at boot. A spec that needs a team, an invite, a second
member or any other fixture SHALL create it, and SHALL NOT rely on one a different spec file
happened to create earlier in the run.

#### Scenario: A single spec file is runnable in isolation

- **WHEN** any one end-to-end spec file is run alone against a freshly bootstrapped database
- **THEN** every test in it passes, whatever order the rest of the suite would have run in

### Requirement: An end-to-end time budget is derived from measurement, not from a guess

A time budget that differs from the suite default SHALL carry, in the code beside it, the measured
distribution that justifies it — the observed duration of successful runs of that test. A budget
SHALL NOT be raised in response to a failure whose cause has not been identified, and no test SHALL
be skipped, marked expected-to-fail, or have an assertion weakened or removed to reach a passing
run.

#### Scenario: A budget change carries its evidence

- **WHEN** a test's time budget is raised above the suite default
- **THEN** the measured successful-run durations that justify the new budget are recorded beside it

#### Scenario: Coverage cannot shrink silently

- **WHEN** a change to the end-to-end suite removes, skips or weakens an assertion
- **THEN** the change states the coverage delta explicitly and gives the reason

### Requirement: The end-to-end stack is started in an order the sync layer can survive

The sync cache replicates the application schema, and the application schema is created by the
server at boot. The end-to-end pipeline SHALL therefore not require the sync cache to have snapshotted
the database before the schema exists: it SHALL either start the sync cache after the first
migration has run, or wait for the sync cache to report the application tables as replicated before
the first test runs.

A run in which clients are told the application tables are not replicated is a pipeline failure with
that cause named, not a suite of timeouts.

#### Scenario: A fresh database does not produce a schema-less replica

- **WHEN** the end-to-end pipeline starts from empty volumes
- **THEN** the first test runs only once the sync cache is replicating the application tables, and no
  client is served a schema-version error
