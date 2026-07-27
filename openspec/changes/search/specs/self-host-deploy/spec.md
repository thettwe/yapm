## ADDED Requirements

### Requirement: Search adds no container, no extension, and no second scheduler

Adding search SHALL NOT change the three-container contract. Full-text search SHALL be Postgres's own,
running in the existing database container, and SHALL NOT require `CREATE EXTENSION` of any kind — no
trigram, no vector, no third-party module — because some managed-Postgres self-hosters cannot grant
that privilege. Index maintenance SHALL run on the **existing** Postgres-backed job-scheduler
instance, not a new one; the process SHALL start the same number of scheduler instances as before.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no
  search, index, cache or queue container

#### Scenario: No database extension is required

- **WHEN** the migrations are applied to a Postgres instance where the connecting role cannot create
  extensions
- **THEN** they succeed, and search works

#### Scenario: No additional job-scheduler instance

- **WHEN** the server's background-job wiring is inspected
- **THEN** the search index passes are registered on the already-existing scheduler instance, and the
  number of job-scheduler instances started by the process is unchanged

### Requirement: Search configuration is env-only, validated, and safe to leave alone

Search SHALL be configured entirely by environment variables, all optional with working defaults, all
validated at startup by the existing schema-validation pattern and failing fast **by variable name**.
The operator SHALL be able to control: whether index maintenance runs at all, how often the
incremental pass runs, how often the full reconcile runs, which text-search configuration is used, and
the per-request statement timeout. Every one of them SHALL be documented, and the documented set SHALL
match the validated set with no drift.

Nothing about search SHALL require configuration for it to work on a fresh instance.

#### Scenario: An empty configuration still searches

- **WHEN** an instance boots with none of the search variables set
- **THEN** indexing runs on its defaults, the language-neutral text configuration is used, and search
  answers

#### Scenario: An invalid value fails fast by name

- **WHEN** a search variable is set to a value the schema rejects
- **THEN** boot fails immediately with a message naming that variable and describing the accepted
  shape

#### Scenario: Documented configuration matches validated configuration

- **WHEN** the environment example and the configuration reference are compared against the validated
  schema
- **THEN** every search variable appears in all three with no drift

### Requirement: Index freshness is observable and a reindex is a documented operation

An operator SHALL be able to tell whether the search index is keeping up without reading application
logs: the readiness report SHALL carry a **non-gating** search entry exposing the indexed document
count, the source row count, and the age of the oldest un-indexed row. It SHALL be non-gating because
a stale index must never take an instance out of rotation.

Forcing a full reindex, and changing the text-search configuration, SHALL each be a documented,
supported operation that does not require editing the database by hand.

#### Scenario: A stale index is visible but not fatal

- **WHEN** indexing has fallen behind
- **THEN** the readiness report shows the gap and the instance still reports ready

#### Scenario: An operator can force a full reindex

- **WHEN** an operator follows the documented reindex procedure
- **THEN** the index is rebuilt from the source rows in bounded batches while the application keeps
  serving, and search results converge with no data loss
