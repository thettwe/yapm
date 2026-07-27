## ADDED Requirements

### Requirement: A server-only system principal writes through the shared mutators

The system SHALL define exactly one system principal — an `AuthContext` whose user identifier is the
reserved value `system` and whose workspace role is `admin` — in `packages/schema`, and SHALL use it
for every write the instance performs on its own behalf with no human behind it: today the cycle
maintenance pass and the connector-driven status transition. The principal SHALL be used only by
passing it as the `ctx` of a **shared mutator**, so every such write runs the same authorization the
same mutator runs for a person. It SHALL NOT be constructible from, or selectable by, any client
input, SHALL never be minted from a request, and SHALL never appear in a client mutator map. Its
admin role exists so one instance-wide actor can write across every team without a `team_membership`
row; it SHALL NOT be used to bypass any check other than team membership.

Work-graph placement: an authorization context, not an entity; it names no row and appears in no
table. Permission story: writes under the principal are indistinguishable from an admin's writes at
the mutator boundary and are therefore subject to every check an admin's write is; what bounds it is
that it is reachable only from server-side call sites whose input the instance produced.

#### Scenario: One definition, shared by every non-human write

- **WHEN** the codebase is inspected for non-human write paths
- **THEN** each one imports the single exported system principal from `packages/schema` rather than
  defining its own

#### Scenario: A client cannot present the system principal

- **WHEN** a client attempts to invoke a mutator with the reserved system identity
- **THEN** the `AuthContext` used by the sync endpoints is derived from the verified session and can
  never be the system principal, so the attempt has no effect

#### Scenario: The principal still passes through the mutator's checks

- **WHEN** a mutator runs under the system principal
- **THEN** its role capability check and its team-access check execute exactly as they do for a human
  admin, rather than being skipped

### Requirement: Automation state replicates under the scopes its tables already have

The `team.auto_status_since` and `issue.last_human_status_at` columns SHALL replicate under the
scopes their existing rows already use — the team row workspace-wide to members, the issue row
team-scoped — introducing no new synced entity, no new named query, and no new permission predicate.
Both SHALL be present in Postgres, in the hand-written Kysely `DB` interface, and in the Zero schema,
and SHALL be covered by the schema-drift test. Neither SHALL be writable by a client except through
the shared mutators that already govern its row.

Work-graph placement: scalar columns on two existing synced entities. Sync/permission story: a
non-member reads neither, denied by the same empty queries as before; a viewer reads both and writes
neither.

#### Scenario: No new query or predicate is introduced

- **WHEN** the synced query set is inspected after this change
- **THEN** it contains the same queries with the same predicates, the two new columns arriving on
  rows those queries already return

#### Scenario: The drift test covers both columns

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** both columns are present in the database and in the Zero schema with matching shape

#### Scenario: A viewer reads but cannot write

- **WHEN** a viewer on a team syncs its teams and issues and then attempts to write either column
- **THEN** the reads succeed and every write is rejected by the mutator that owns the row
