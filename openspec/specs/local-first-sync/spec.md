# local-first-sync Specification

## Purpose
TBD - created by archiving change foundation. Update Purpose after archive.
## Requirements
### Requirement: Server-controlled synced queries

All client reads SHALL flow through Zero synced queries: the client requests named queries defined in `packages/schema`, and the server endpoint validates and authorizes each query with the caller's auth context before zero-cache executes it. Clients MUST NOT be able to widen a query beyond what the server permits.

Row-level permissions SHALL be enforced inside these server-side query definitions using real joins against the membership graph, so a user syncs ONLY the rows they can see: the single `workspace`, member `user`-profiles and `workspace_member` rows for members, teams and team rosters for members, invites for admins only, and — established here for future work-data changes — rows scoped to the caller's teams via a `team_membership` `whereExists` subquery. The membership/role predicate MUST be driven by the verified `ctx` (`{userID, role}`), never by client-supplied args. Reads for an unauthorized or non-member caller SHALL be denied by returning an empty query (the `denyAll` empty-`or()` filter), never by throwing. Where a query would expose a private row, the authorization filter MUST be applied such that the row's existence is never revealed to callers who cannot see it.

Work-graph placement: this capability now syncs the real identity/access graph — `workspace` (instance root), `user` (identity), `workspace_member` (role edge), `team`, `team_membership`, and `invite` — and every future entity (issue, PR link, deploy) hangs off it and inherits this same server-side permission pattern. Permission story for this change: membership-scoped and role-scoped as detailed in the workspace-membership, teams, and invitations specs; the single-tenant "all rows visible to all clients" behavior from foundation is replaced.

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

