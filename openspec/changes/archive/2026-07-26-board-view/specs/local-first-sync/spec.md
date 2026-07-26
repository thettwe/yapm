## MODIFIED Requirements

### Requirement: Team-scoped work-data sync and mutation

The synced-query and shared-mutator model established for the membership graph SHALL extend to the first product-work entities — `issue`, `label`, `issue_label`, `comment`, and `saved_view` — so that a user syncs work data ONLY for teams they belong to. Each work-data synced query SHALL scope rows by a `whereExists` over the owning team's roster driven by the verified `ctx.userID` (never client args), reusing the team-scoped visibility edge from workspace-auth; a caller who is not a member of a row's team SHALL read nothing, denied by the empty `or()` filter, with no leak of row existence, and authorization SHALL be applied before existence. A `viewer` SHALL read their teams' work data but SHALL be rejected for every work-data write; members and admins of a row's team may write. All work-data writes SHALL go through custom mutators defined once in `packages/schema` and imported by both client (optimistic) and server (authoritative), with created-row UUIDv7 primary keys minted at the call site and owner/creator/author fields set from `ctx`. The `issue` row's nullable `rank` field (the board's fractional-index ordering key) SHALL replicate to clients like any other issue column under this same team scope, and the new `issue.move` mutator SHALL be gated by the same team-scoped `canWrite` rule as the other issue writes — a single-row update of `rank` and optionally `status`, with authorization checked before existence, rejected for viewers and non-members. The hand-written Kysely `DB` interface, the hand-written Zero schema, and the schema-drift test SHALL all include the `rank` column.

Work-graph placement: `issue` hangs off `team` (off the single `workspace`); `label` and `saved_view` hang off `team`; `issue_label` is an `issue`↔`label` edge; `comment` hangs off `issue`. Every one inherits the team-scoped membership predicate; personal or reality-derived axes are computed, not stored, and add no new visibility surface. The `rank` ordering field adds a synced column but no new visibility surface — it rides the existing issue scope. Sync/permission story: membership-scoped via `team_membership`, deny-by-empty, auth-before-existence, viewers read-only, exactly as the identity graph — this is the pattern workspace-auth established "for future work-data changes," now realized.

#### Scenario: A user syncs only their teams' work data

- **WHEN** an authenticated user requests any work-data synced query
- **THEN** the server-side definition returns only rows whose team the user belongs to, and an empty result (with no leak of existence) for every other team's rows

#### Scenario: Client cannot widen a team-scoped work query

- **WHEN** a client supplies args attempting to broaden a work-data query to a team it does not belong to
- **THEN** the re-evaluated server-side query still restricts results to the caller's team memberships

#### Scenario: Viewer reads but never writes work data

- **WHEN** a `viewer` on a team reads that team's issues and then attempts any issue/label/comment/saved-view write
- **THEN** the reads succeed and every write is rejected as not authorized before any existence check

#### Scenario: Rank syncs within team scope

- **WHEN** a member's client syncs their team's issues
- **THEN** each issue row includes its nullable `rank`, and issues from other teams are not synced

#### Scenario: Viewer move is rejected

- **WHEN** a `viewer` attempts `issue.move`
- **THEN** it is rejected as not authorized before any existence check and no row is written

#### Scenario: Drift test covers rank

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** the `issue.rank` column is present in the Kysely `DB` map and the Zero schema and matches the database as nullable `text`
