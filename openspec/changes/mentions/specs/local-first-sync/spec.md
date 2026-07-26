## ADDED Requirements

### Requirement: Self-scoped, issue-scoped subscription sync with no admin bypass

The `issue_subscription` entity SHALL replicate through Zero under a synced query that is **both**
self-scoped on the verified `ctx.userID` and scoped to a single issue supplied as an argument, gated
on workspace membership and denied by an empty query otherwise. It SHALL NOT use the team-scoped
predicate and SHALL NOT carry that predicate's workspace-admin bypass.

Because the query is scoped to one issue and one user, it SHALL return **at most one row**, so the
synced set is bounded without a row limit and without a retention sweep.

No synced query SHALL return another user's subscriptions. There SHALL be no watcher list, no
follower count and no "who follows this issue" read available to any client, including a workspace
admin's. The subscriber set exists only as a server-side read inside the notification fan-out.

Work-graph placement: an edge from a `user` to a team-scoped `issue` recording a standing intent.
Sync/permission story: exactly one person can read a given row — the person it belongs to — and only
while they have that issue open. `team_id` is present for cleanup and indexing and is not a sync
scope.

#### Scenario: An admin syncs none of another user's subscriptions

- **WHEN** a workspace admin's client is fully synced and viewing an issue
- **THEN** its local store contains no other user's subscription rows for that issue or any other

#### Scenario: A non-member is denied by empty query

- **WHEN** an authenticated non-member subscribes to the subscription query
- **THEN** the query resolves to an empty result rather than an error that reveals anything

#### Scenario: The synced set is one row

- **WHEN** a user with subscriptions to many issues opens one of them
- **THEN** their client syncs at most their own single subscription row for that issue

### Requirement: A second synced entity keyed by a compound natural key

`issue_subscription` SHALL be the second synced entity whose primary key is a **compound natural
key** rather than a client-minted UUIDv7. Because both key components are known at the call site —
the issue being viewed and the verified caller — no identifier is minted at a call site or inside a
mutator body, and the client-minted-UUIDv7 constraint is not engaged by this entity.

Follow and unfollow SHALL be ordinary optimistic shared mutators defined in `packages/schema` and
imported by both client and server, addressing a row by its natural key with the user component
taken from the verified context and never from arguments — so a caller is structurally unable to
address another person's subscription.

Auto-subscription SHALL be written **only** in the server-authoritative mutator pass, so a
client-location transaction creates none and a rebase cannot fabricate one.

The CI schema-drift test SHALL cover the new table — its columns, its compound primary key and its
constrained state column — asserting the migration, the hand-written Kysely `DB` interface and the
hand-written Zero schema all agree with the live Postgres schema.

#### Scenario: A caller cannot address another user's subscription

- **WHEN** a follow or unfollow mutation is invoked with arguments naming a different user
- **THEN** the user component is taken from the verified context regardless, so only the caller's
  own subscription can be affected

#### Scenario: Rebase cannot fabricate a subscription

- **WHEN** a mutator that triggers auto-subscription is re-run on the client during rebase
- **THEN** no subscription row is created, because only the server-authoritative pass writes them

#### Scenario: Drift test covers the compound key and the state constraint

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts the subscription table's compound primary key and its state check constraint
  match the Zero schema and the hand-written `DB` interface, and fails if any of the three drifts

#### Scenario: Following applies within the interaction budget

- **WHEN** a member toggles the follow control
- **THEN** the change applies optimistically through the shared mutator and the surface updates
  without waiting on the network
