# local-first-sync

## ADDED Requirements

### Requirement: Server-controlled synced queries
All client reads SHALL flow through Zero synced queries: the client requests named queries defined in `packages/schema`, and the server endpoint validates and authorizes each query with the caller's auth context before zero-cache executes it. Clients MUST NOT be able to widen a query beyond what the server permits.

Work-graph placement: this change syncs the `workspace` entity (instance root; every future entity — team, issue, PR link, deploy — hangs off it). Permission story for this change: single-tenant instance, all rows visible to all clients; real row-level permissions arrive with `workspace-auth` and MUST be expressed in these same server-side query definitions.

#### Scenario: Local read is instant
- **WHEN** the app renders data already present in the client replica
- **THEN** the read resolves from local storage without a network round-trip

#### Scenario: Remote change propagates
- **WHEN** a second client modifies the workspace name
- **THEN** the first client's UI reflects the change via sync without user action or page reload

### Requirement: Optimistic shared mutators
All writes SHALL go through custom mutators defined once in `packages/schema` and imported by both client (optimistic application) and server (authoritative execution with authz). On server rejection, the client state MUST roll back to the server-authoritative result.

#### Scenario: Optimistic write with server authority
- **WHEN** a user renames the workspace
- **THEN** the UI updates immediately, and the change persists in Postgres via the server mutator

#### Scenario: Rejected write rolls back
- **WHEN** the server mutator rejects a write (e.g., empty workspace name)
- **THEN** the client state reverts to the authoritative value and the UI surfaces the rejection

#### Scenario: Keyboard-only rename
- **WHEN** a user reaches the workspace name via Tab/focus navigation, edits it, and confirms with Enter
- **THEN** the rename completes without any pointer interaction

### Requirement: Offline tolerance and recovery
The client SHALL keep rendering local data when the network drops, queue local mutations, and reconcile automatically on reconnect.

#### Scenario: Reconnect reconciliation
- **WHEN** a client goes offline, performs a rename, and later reconnects
- **THEN** the queued mutation is pushed, executed authoritatively, and both clients converge on the same state
