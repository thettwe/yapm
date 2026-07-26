## ADDED Requirements

### Requirement: Self-scoped notification sync with no admin bypass

The `notification` entity SHALL replicate through Zero under a **self-scoped** synced query filtered
on the verified `ctx.userID`, never on an argument, gated on workspace membership and denied by an
empty query otherwise. It SHALL NOT use the team-scoped predicate, and SHALL NOT carry that
predicate's workspace-admin bypass: a workspace admin reads every issue in the workspace and
**zero** of another user's notifications.

Work-graph placement: `notification` is a per-recipient leaf addressed at a `user` and derived from
work-graph events on an issue in a `team`. Sync/permission story: exactly one person receives a
given row — its recipient. `team_id` is present for membership cleanup and indexing and is **not** a
sync scope; no relationship from `notification` to `issue` exists, so no query can widen a read past
the team boundary through it.

The synced set SHALL be bounded by a row limit on the query and by a scheduled retention sweep, so
that a monotonically growing per-user table cannot become an unbounded hydration cost on every
client.

#### Scenario: An admin syncs none of another user's notifications

- **WHEN** a workspace admin's client is fully synced
- **THEN** its local store contains none of any other user's notification rows

#### Scenario: A non-member is denied by empty query

- **WHEN** an authenticated non-member subscribes to the notification query
- **THEN** the query resolves to an empty result rather than an error that reveals anything

#### Scenario: The synced set stays bounded

- **WHEN** a user has accumulated far more notifications than the query limit
- **THEN** their client syncs at most the limit, and rows past the retention window no longer exist
  to sync

### Requirement: A synced entity keyed by a compound natural key, written only by the server

`notification` SHALL be the first synced entity whose primary key is a **compound natural key**
rather than a client-minted UUIDv7, and whose rows are created **only** by the server-authoritative
mutator pass. Because every key component is derived from the triggering mutation's own arguments,
no identifier is minted at a call site or inside a mutator body, and the client-minted-UUIDv7
constraint is not engaged by this entity at all.

A client-location transaction SHALL create no `notification` row, so a mutator re-run during rebase
can neither duplicate nor fabricate one. Read-state writes SHALL remain ordinary optimistic shared
mutators addressing a row by its natural key, with the recipient component taken from the verified
context.

The CI schema-drift test SHALL cover the new table — its columns, its compound primary key, and the
new `user_preference` column — asserting the migration, the hand-written Kysely `DB` interface and
the hand-written Zero schema all agree with the live Postgres schema.

#### Scenario: Rebase cannot duplicate a notification

- **WHEN** a mutator that triggers a fan-out is re-run on the client during rebase
- **THEN** no notification row is created or duplicated, because only the server-authoritative pass
  writes them and its writes are absorbed by the primary key

#### Scenario: Drift test covers the compound key

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts the notification table's compound primary key matches the Zero schema and the
  hand-written `DB` interface, and fails if any of the three drifts

#### Scenario: Read state is still an optimistic shared mutator

- **WHEN** a recipient marks a notification read
- **THEN** the change applies optimistically through a shared `packages/schema` mutator imported by
  both client and server, within the sub-100ms budget
