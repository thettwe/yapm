## ADDED Requirements

### Requirement: Team-scoped decision sync over a table with no identity column

The `decision` entity SHALL replicate under exactly the team scope its sibling work entities use:
each decision's synced query SHALL scope rows by a `whereExists` over the owning team's roster
driven by the verified `ctx.userID` and never by client arguments, a caller who is not a member of
the row's team SHALL read nothing, denied by the empty `or()` filter with no leak of row existence,
and authorization SHALL be applied before existence. A `viewer` SHALL read their teams' decisions
and SHALL be rejected for every decision write. There SHALL be exactly one read path — no
workspace-scoped variant, no second query, and no REST route — so the decision surface is never
wider than the comment thread it was distilled from.

All decision writes SHALL go through custom mutators defined once in `packages/schema` and imported
by both client (optimistic) and server (authoritative), with the row's UUIDv7 primary key minted at
the call site. The decision's `team_id` SHALL be taken from its issue inside the mutator, never
from arguments. The provenance fields SHALL be derived inside the mutator from the issue's own
comments — deterministically, so the optimistic run, the authoritative run and any rebase agree —
and SHALL NOT be accepted from the caller.

The `decision` table SHALL carry **no author, owner, creator or `decided_by` column** in the
database schema or in the Zero schema. The schema-drift test SHALL cover every `decision` column
against live Postgres and SHALL additionally assert that no such identity column exists in either
schema, so the guarantee is a build gate rather than a convention.

Work-graph placement: `decision` hangs off `team` and references `issue` (cascade), `comment` twice
and `cycle` once (both set-null). Sync/permission story: membership-scoped via `team_membership`,
deny-by-empty, auth-before-existence, viewers read-only, and no identity to scope by even if
someone wanted to.

#### Scenario: A user syncs only their teams' decisions

- **WHEN** an authenticated user requests the decisions query for a team they do not belong to
- **THEN** the server-side definition returns an empty result, indistinguishable from that team
  having recorded none

#### Scenario: A client cannot widen the decisions query

- **WHEN** a client supplies arguments naming a team it does not belong to
- **THEN** the re-evaluated server-side query still restricts results to the caller's memberships

#### Scenario: Viewer decision writes are rejected

- **WHEN** a `viewer` attempts to record, revise or retract a decision
- **THEN** each is rejected as not authorized before any existence check and no row is written

#### Scenario: The drift test covers the decision table and the column that is not there

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** every `decision` column is present in the Kysely `DB` map and the Zero schema with
  matching nullability, and both are asserted to contain no author, owner, creator or `decided_by`
  column

#### Scenario: Provenance survives a rebase unchanged

- **WHEN** an optimistic decision write is rebased against concurrent mutations on the same issue
- **THEN** the decision's identifier is the one minted at the call site and its derived provenance
  is recomputed from the thread rather than carried from client arguments
