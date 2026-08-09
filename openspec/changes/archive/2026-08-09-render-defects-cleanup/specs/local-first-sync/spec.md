## MODIFIED Requirements

### Requirement: Optimistic shared mutators

All writes SHALL go through custom mutators defined once in `packages/schema` and imported by both client (optimistic application) and server (authoritative execution with authz). On server rejection, the client state MUST roll back to the server-authoritative result.

Mutator authorization SHALL enforce the workspace role and, where relevant, team membership from the verified `ctx`, and SHALL check authorization BEFORE any existence check so that a rejection never reveals whether a private row exists. A `viewer` (or a non-member / absent context) SHALL be rejected for every write; role-restricted operations (workspace/member/team/invite management) SHALL be rejected for non-admins. Primary keys for created rows SHALL be client-minted UUIDv7 at the mutator call site, never inside a mutator body.

A UUIDv7's **leading characters are a millisecond timestamp**, not entropy. No value whose purpose is uniqueness SHALL be derived from a **prefix** of an id — a prefix repeats for every id minted in the same time bucket, and the bucket widens as the prefix shortens. A short unique value SHALL instead be minted from cryptographic randomness by one shared derivation in `packages/schema`, so a caller cannot reinvent the prefix.

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

#### Scenario: Short unique values survive rapid succession

- **WHEN** many short unique values are minted from the shared derivation inside one millisecond
- **THEN** every value is distinct, because none of them is a prefix of an id
