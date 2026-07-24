## MODIFIED Requirements

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

## ADDED Requirements

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
