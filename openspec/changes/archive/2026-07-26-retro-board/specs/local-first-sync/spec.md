## MODIFIED Requirements

### Requirement: Team-scoped work-data sync and mutation

The synced-query and shared-mutator model established for the membership graph SHALL extend to the product-work entities — `issue`, `label`, `issue_label`, `comment`, `saved_view`, the connector-fed delivery entities `pull_request`, `ci_check`, `review`, `deployment`, the `issue_link` edge, and now the retro entities `retro`, `retro_column`, `retro_card`, `retro_group`, `retro_vote_tally`, `retro_action`, and `retro_presence` — so that a user syncs work data ONLY for teams they belong to. Each work-data synced query SHALL scope rows by a `whereExists` over the owning team's roster driven by the verified `ctx.userID` (never client args), reusing the team-scoped visibility edge from workspace-auth; a caller who is not a member of a row's team SHALL read nothing, denied by the empty `or()` filter, with no leak of row existence, and authorization SHALL be applied before existence. A `viewer` SHALL read their teams' work data but SHALL be rejected for every work-data write; members and admins of a row's team may write. All work-data writes SHALL go through custom mutators defined once in `packages/schema` and imported by both client (optimistic) and server (authoritative), with created-row UUIDv7 primary keys minted at the call site and owner/creator/author fields set from `ctx`. The `issue` row's nullable `rank` field (the board's fractional-index ordering key) SHALL replicate to clients like any other issue column under this same team scope, and the `issue.move` mutator SHALL be gated by the same team-scoped `canWrite` rule as the other issue writes — a single-row update of `rank` and optionally `status`, with authorization checked before existence, rejected for viewers and non-members; the hand-written Kysely `DB` interface, the hand-written Zero schema, and the schema-drift test SHALL all include the `rank` column. The connector-fed delivery entities SHALL be written only through the connector's authoritative shared-mutator path (`WorkGraphMutation`), never by clients directly, and SHALL carry a `team_id` from the connector's repo→team mapping so they inherit exactly this team scope. The connector's own secrets and configuration SHALL be held in **server-only** tables excluded from the Zero schema, so no connector secret ever replicates to a client.

Two retro entities SHALL be narrower than team scope: a retro **draft** SHALL sync only to its author and a retro **vote** SHALL sync only to its voter, each filtered by the verified `ctx.userID` alone, with **no workspace-admin bypass** — a deliberate deviation from the shared team-scoped helper, because these rows carry the identity that the retro's anonymity and vote-privacy guarantees depend on. The **card→author binding SHALL live in a server-only table excluded from the Zero schema**, so no client can name it in any query. The schema-drift test SHALL cover every new table and column added by this change and SHALL assert the server-only tables' absence from the Zero schema.

Work-graph placement: `issue` hangs off `team` (off the single `workspace`); `label` and `saved_view` hang off `team`; `issue_label` is an `issue`↔`label` edge; `comment` hangs off `issue`; `pull_request` and `deployment` hang off `team`; `ci_check` and `review` hang off `pull_request`; `issue_link` is an `issue`↔`pull_request` edge; the `rank` ordering field adds a synced column but no new visibility surface — it rides the existing issue scope; `retro` hangs off `team` and references `cycle` twice (reflected cycle, next cycle); `retro_column`, `retro_draft`, `retro_card`, `retro_group`, `retro_vote`, `retro_action` and `retro_presence` hang off `retro`; `retro_vote_tally` is keyed by its vote target; `retro_action` may reference an `issue`. Every team-scoped one inherits the team-scoped membership predicate; the connector secrets/config surface and the retro card→author table are off-graph and unsynced. Sync/permission story: membership-scoped via `team_membership`, deny-by-empty, auth-before-existence, viewers read-only; connector writes flow through the same mutator authz as human writes; secrets never sync; retro drafts and votes are self-scoped and the anonymous author is unsyncable.

#### Scenario: A user syncs only their teams' work data

- **WHEN** an authenticated user requests any work-data synced query
- **THEN** the server-side definition returns only rows whose team the user belongs to, and an empty result (with no leak of existence) for every other team's rows

#### Scenario: Client cannot widen a team-scoped work query

- **WHEN** a client supplies args attempting to broaden a work-data query to a team it does not belong to
- **THEN** the re-evaluated server-side query still restricts results to the caller's team memberships

#### Scenario: Rank syncs within team scope

- **WHEN** a member's client syncs their team's issues
- **THEN** each issue row includes its nullable `rank`, and issues from other teams are not synced

#### Scenario: Viewer move is rejected

- **WHEN** a `viewer` attempts `issue.move`
- **THEN** it is rejected as not authorized before any existence check and no row is written

#### Scenario: Drift test covers rank

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** the `issue.rank` column is present in the Kysely `DB` map and the Zero schema and matches the database as nullable `text`

#### Scenario: Delivery entities inherit the team scope

- **WHEN** a member reads a PR/check/deploy/link ingested for a repository mapped to one of their teams, and another for a team they do not belong to
- **THEN** only the mapped-team rows replicate to them, and the other team's delivery rows are never synced

#### Scenario: Connector secrets never sync to a client

- **WHEN** any client replica is inspected
- **THEN** it contains no connector secret or webhook secret, because the connector secrets/config tables are excluded from the Zero schema

#### Scenario: Retro drafts and votes are self-scoped with no admin bypass

- **WHEN** a team member — including a workspace admin — runs the retro draft and vote queries for rows they did not author or cast
- **THEN** both results are empty, and only the author's own drafts and the voter's own votes ever replicate

#### Scenario: An anonymous card's author never replicates

- **WHEN** any client replica is inspected after a retro with anonymity enabled has published its cards
- **THEN** it contains no author identity for those cards, because the card→author table is excluded from the Zero schema and the synced card row's author value is null

#### Scenario: Viewer reads but never writes work data

- **WHEN** a `viewer` on a team reads that team's issues, delivery entities and retros and then attempts any issue/label/comment/saved-view/retro write
- **THEN** the reads succeed and every direct client write is rejected as not authorized before any existence check

#### Scenario: The drift test covers the new schema

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts every new table and column (delivery entities, connector surface, and the retro entities) matches the hand-written Kysely and Zero schemas, and that the server-only tables are absent from the Zero schema
