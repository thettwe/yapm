# local-first-sync Specification

## Purpose
TBD - created by archiving change foundation. Update Purpose after archive.
## Requirements
### Requirement: Server-controlled synced queries

All client reads SHALL flow through Zero synced queries: the client requests named queries defined in `packages/schema`, and the server endpoint validates and authorizes each query with the caller's auth context before zero-cache executes it. Clients MUST NOT be able to widen a query beyond what the server permits.

Row-level permissions SHALL be enforced inside these server-side query definitions using real joins against the membership graph, so a user syncs ONLY the rows they can see: the single `workspace`, member `user`-profiles and `workspace_member` rows for members, teams and team rosters for members, invites for admins only, and — established here for future work-data changes — rows scoped to the caller's teams via a `team_membership` `whereExists` subquery. The membership/role predicate MUST be driven by the verified `ctx` (`{userID, role}`), never by client-supplied args. Reads for an unauthorized or non-member caller SHALL be denied by returning an empty query (the `denyAll` empty-`or()` filter), never by throwing. Where a query would expose a private row, the authorization filter MUST be applied such that the row's existence is never revealed to callers who cannot see it.

The permission model has two scoping axes. **Membership-scoped** entities (workspace, member, team, team_membership, invite) are gated on workspace role via `isMember`/`canManage` as above. **User-scoped** entities are gated on the caller's identity alone: a query over a user-scoped entity SHALL filter `where('userId', ctx.userID)` off the verified `ctx`, and SHALL be permitted when the caller is authenticated (`ctx` present) regardless of workspace membership, so that a caller who is authenticated but not yet a member can still read their own user-scoped rows; an unauthenticated caller SHALL be denied by an empty query. A user-scoped query MUST NOT return, nor reveal the existence of, any other user's row.

Work-graph placement: this capability now syncs the real identity/access graph — `workspace` (instance root), `user` (identity), `workspace_member` (role edge), `team`, `team_membership`, and `invite` — plus `user_preference`, the first **user-scoped** leaf hanging off `user` (identity), orthogonal to the membership graph. Every future entity (issue, PR link, deploy) hangs off this graph and inherits the membership-scoped pattern; personal, per-user entities inherit the user-scoped pattern. Permission story for this change: membership-scoped and role-scoped as detailed in the workspace-membership, teams, and invitations specs; `user_preference` is owner-only (see "Per-user preference persistence and sync"); the single-tenant "all rows visible to all clients" behavior from foundation remains replaced.

#### Scenario: Local read is instant

- **WHEN** the app renders data already present in the client replica
- **THEN** the read resolves from local storage without a network round-trip

#### Scenario: Remote change propagates

- **WHEN** a second client modifies the workspace name
- **THEN** the first client's UI reflects the change via sync without user action or page reload

#### Scenario: A user syncs only rows they can see

- **WHEN** an authenticated non-member requests any synced query
- **THEN** the server-side definition returns an empty result for every row they cannot see, with no leak of row existence

#### Scenario: Client cannot widen a permissioned query

- **WHEN** a client supplies args attempting to broaden a membership-scoped query beyond its context
- **THEN** the re-evaluated server-side query still restricts results to what the caller's `ctx` permits

#### Scenario: User-scoped read returns only the caller's own rows

- **WHEN** an authenticated caller requests a user-scoped query and another client attempts to widen it to another user's rows
- **THEN** the server-side definition returns only the caller's own `ctx.userID` rows and never reveals the existence of another user's row

### Requirement: Optimistic shared mutators

All writes SHALL go through custom mutators defined once in `packages/schema` and imported by both client (optimistic application) and server (authoritative execution with authz). On server rejection, the client state MUST roll back to the server-authoritative result.

Mutator authorization SHALL enforce the workspace role and, where relevant, team membership from the verified `ctx`, and SHALL check authorization BEFORE any existence check so that a rejection never reveals whether a private row exists. A `viewer` (or a non-member / absent context) SHALL be rejected for every write; role-restricted operations (workspace/member/team/invite management) SHALL be rejected for non-admins. Primary keys for created rows SHALL be client-minted UUIDv7 at the mutator call site, never inside a mutator body.

#### Scenario: Optimistic write with server authority

- **WHEN** a user renames the workspace
- **THEN** the UI updates immediately, and the change persists in Postgres via the server mutator

#### Scenario: Rejected write rolls back

- **WHEN** the server mutator rejects a write (e.g., empty workspace name)
- **THEN** the client state reverts to the authoritative value and the UI surfaces the rejection

#### Scenario: Unauthorized write is rejected before existence check

- **WHEN** a `viewer` or non-member attempts a write against any row
- **THEN** the mutator rejects it as not authorized without revealing whether the target row exists

#### Scenario: Keyboard-only rename

- **WHEN** a user reaches the workspace name via Tab/focus navigation, edits it, and confirms with Enter
- **THEN** the rename completes without any pointer interaction

### Requirement: Disconnection is visible and lossless
Reads SHALL continue to resolve from the local replica while disconnected. Writes are NOT supported offline (Zero rejects them), so the UI SHALL surface connection state and prevent write attempts that would silently lose user input. On reconnect, syncing resumes automatically.

#### Scenario: Reading while disconnected
- **WHEN** the network drops
- **THEN** already-synced data continues to render and navigate without errors

#### Scenario: Writes are blocked, not lost
- **WHEN** a user attempts an edit while disconnected
- **THEN** connection state is visible and the edit is prevented or held in the editing surface — never accepted and silently dropped

#### Scenario: Reconnect resumes sync
- **WHEN** connectivity returns
- **THEN** the client resumes syncing and converges with server state without a page reload

### Requirement: Per-user preference persistence and sync

The system SHALL persist a per-user `{theme, accent}` preference in a `user_preference` entity in the existing Postgres (no new service), synced via Zero. Exactly one preference row SHALL exist per user (`user_id` unique). The row's primary key SHALL be a client-minted UUIDv7 at the mutator call site; the row SHALL carry `theme` (one of the shipped presets) and an optional `accent` (null = the preset default).

The preference SHALL be readable and writable ONLY by its owner. Reads SHALL flow through a user-scoped synced query filtered by the verified `ctx.userID`; writes SHALL flow through a shared mutator in `packages/schema` (imported by client and server) that sets `user_id` from `ctx.userID` (never from args), authorizes the caller as authenticated before any existence check, and validates the `accent` value, rejecting an unparseable color. The gate SHALL be authentication, not workspace membership, so an authenticated non-member may still read and write their own preference. Light/dark mode SHALL NOT be part of this synced entity (it is device-local).

Work-graph placement: `user_preference` is a user-scoped leaf off `user` (identity), orthogonal to the workspace/team membership graph. Sync/permission story: owner-only — a caller reads and writes only their own single row; another user's row is never returned nor its existence revealed; an unauthenticated caller is denied by an empty query and a rejected write.

#### Scenario: Preference syncs to the owner

- **WHEN** a user sets their theme or accent and later loads the app on another device signed in as the same user
- **THEN** the `{theme, accent}` preference syncs and is applied, having persisted in Postgres via the shared mutator

#### Scenario: Preference is owner-only

- **WHEN** an authenticated caller queries `user_preference` or attempts to write another user's preference row
- **THEN** the read returns only the caller's own row (never another user's, nor its existence) and the write is rejected as not authorized before any existence check

#### Scenario: Authenticated non-member can set their own preference

- **WHEN** an authenticated user who is not yet a workspace member sets their theme while on the access gate
- **THEN** the preference read and write succeed for their own row, gated on authentication rather than membership

#### Scenario: Client-minted id and validated accent

- **WHEN** a user creates their first preference row with an invalid accent value
- **THEN** the write is rejected on both client and server, and a valid write carries a client-minted UUIDv7 primary key generated at the call site

#### Scenario: Keyboard-only preference change persists

- **WHEN** a user changes their theme or accent using only the keyboard
- **THEN** the change applies optimistically to the live UI and persists via the shared mutator without any pointer interaction

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

