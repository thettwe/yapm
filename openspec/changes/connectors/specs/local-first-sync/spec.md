## MODIFIED Requirements

### Requirement: Team-scoped work-data sync and mutation

The synced-query and shared-mutator model established for the membership graph SHALL extend to the product-work entities — `issue`, `label`, `issue_label`, `comment`, `saved_view`, and now the connector-fed delivery entities `pull_request`, `ci_check`, `review`, `deployment`, and the `issue_link` edge — so that a user syncs work data ONLY for teams they belong to. Each work-data synced query SHALL scope rows by a `whereExists` over the owning team's roster driven by the verified `ctx.userID` (never client args), reusing the team-scoped visibility edge from workspace-auth; a caller who is not a member of a row's team SHALL read nothing, denied by the empty `or()` filter, with no leak of row existence, and authorization SHALL be applied before existence. A `viewer` SHALL read their teams' work data but SHALL be rejected for every work-data write; members and admins of a row's team may write. All work-data writes SHALL go through custom mutators defined once in `packages/schema` and imported by both client (optimistic) and server (authoritative), with created-row UUIDv7 primary keys minted at the call site and owner/creator/author fields set from `ctx`. The connector-fed delivery entities SHALL be written only through the connector's authoritative shared-mutator path (`WorkGraphMutation`), never by clients directly, and SHALL carry a `team_id` from the connector's repo→team mapping so they inherit exactly this team scope. The connector's own secrets and configuration SHALL be held in **server-only** tables excluded from the Zero schema, so no connector secret ever replicates to a client. The schema-drift test SHALL cover every new table and column added by this change.

Work-graph placement: `issue` hangs off `team` (off the single `workspace`); `label` and `saved_view` hang off `team`; `issue_label` is an `issue`↔`label` edge; `comment` hangs off `issue`; `pull_request` and `deployment` hang off `team`; `ci_check` and `review` hang off `pull_request`; `issue_link` is an `issue`↔`pull_request` edge. Every synced one inherits the team-scoped membership predicate; the connector secrets/config surface is off-graph and unsynced. Sync/permission story: membership-scoped via `team_membership`, deny-by-empty, auth-before-existence, viewers read-only; connector writes flow through the same mutator authz as human writes; secrets never sync.

#### Scenario: A user syncs only their teams' work data

- **WHEN** an authenticated user requests any work-data synced query
- **THEN** the server-side definition returns only rows whose team the user belongs to, and an empty result (with no leak of existence) for every other team's rows

#### Scenario: Delivery entities inherit the team scope

- **WHEN** a member reads a PR/check/deploy/link ingested for a repository mapped to one of their teams, and another for a team they do not belong to
- **THEN** only the mapped-team rows replicate to them, and the other team's delivery rows are never synced

#### Scenario: Connector secrets never sync to a client

- **WHEN** any client replica is inspected
- **THEN** it contains no connector secret or webhook secret, because the connector secrets/config tables are excluded from the Zero schema

#### Scenario: Viewer reads but never writes work data

- **WHEN** a `viewer` on a team reads that team's issues and delivery entities and then attempts any issue/label/comment/saved-view write
- **THEN** the reads succeed and every direct client write is rejected as not authorized before any existence check

#### Scenario: The drift test covers the new schema

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts every new table and column (delivery entities and connector surface) matches the hand-written Kysely and Zero schemas
