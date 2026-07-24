## ADDED Requirements

### Requirement: Team-scoped work-data sync and mutation

The synced-query and shared-mutator model established for the membership graph SHALL extend to the first product-work entities — `issue`, `label`, `issue_label`, `comment`, and `saved_view` — so that a user syncs work data ONLY for teams they belong to. Each work-data synced query SHALL scope rows by a `whereExists` over the owning team's roster driven by the verified `ctx.userID` (never client args), reusing the team-scoped visibility edge from workspace-auth; a caller who is not a member of a row's team SHALL read nothing, denied by the empty `or()` filter, with no leak of row existence, and authorization SHALL be applied before existence. A `viewer` SHALL read their teams' work data but SHALL be rejected for every work-data write; members and admins of a row's team may write. All work-data writes SHALL go through custom mutators defined once in `packages/schema` and imported by both client (optimistic) and server (authoritative), with created-row UUIDv7 primary keys minted at the call site and owner/creator/author fields set from `ctx`.

Work-graph placement: `issue` hangs off `team` (off the single `workspace`); `label` and `saved_view` hang off `team`; `issue_label` is an `issue`↔`label` edge; `comment` hangs off `issue`. Every one inherits the team-scoped membership predicate; personal or reality-derived axes are computed, not stored, and add no new visibility surface. Sync/permission story: membership-scoped via `team_membership`, deny-by-empty, auth-before-existence, viewers read-only, exactly as the identity graph — this is the pattern workspace-auth established "for future work-data changes," now realized.

#### Scenario: A user syncs only their teams' work data

- **WHEN** an authenticated user requests any work-data synced query
- **THEN** the server-side definition returns only rows whose team the user belongs to, and an empty result (with no leak of existence) for every other team's rows

#### Scenario: Client cannot widen a team-scoped work query

- **WHEN** a client supplies args attempting to broaden a work-data query to a team it does not belong to
- **THEN** the re-evaluated server-side query still restricts results to the caller's team memberships

#### Scenario: Viewer reads but never writes work data

- **WHEN** a `viewer` on a team reads that team's issues and then attempts any issue/label/comment/saved-view write
- **THEN** the reads succeed and every write is rejected as not authorized before any existence check

### Requirement: Server-authoritative per-team issue numbering in the mutator pass

The per-team issue number SHALL be assigned exclusively in the server-authoritative mutator pass and never in the shared client mutator body, so that optimistic client execution and rebase never fabricate or change a number. The shared `packages/schema` mutator set SHALL be extended on the server (via the base-plus-overrides mutator mechanism) so the authoritative pass claims the next per-team number atomically and writes it onto the issue; the client optimistic pass SHALL leave the number unset until the authoritative row replicates back.

Work-graph placement: the per-team counter is a server-only entity off `team`, excluded from the Zero schema so it never syncs. Permission story: the counter is written only by the server mutator pass and never exposed to clients.

#### Scenario: Client optimistic create carries no number

- **WHEN** the shared issue-create mutator runs on the client optimistically
- **THEN** the created issue has no number, and the number is populated only after the server-authoritative pass replicates back

#### Scenario: Number assignment is atomic per team

- **WHEN** the server-authoritative pass assigns numbers to concurrent creates in one team
- **THEN** each issue receives a distinct sequential number with no collision, and the counter never syncs to any client
