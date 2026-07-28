## ADDED Requirements

### Requirement: Team-scoped, client-read-only retro AI artifact sync

The AI retro draft and its proposals SHALL replicate to clients under the same team-scoped read
predicate as the rest of a team's work data, and SHALL be **client-read-only**: no client mutator
SHALL exist for either table, and every write SHALL go through a server-only helper over the shared
sync transaction that is never registered in the client mutator map. This is the same class as the
cycle-digest artifact and SHALL follow the same shape rather than inventing a second one.

Both tables SHALL carry the owning `team_id` as the permission anchor and SHALL cascade from the
retro they belong to. Scheduling state used only by the background completion pass SHALL NOT be part
of the Zero schema — it SHALL exist in Postgres only, and the schema-drift check SHALL account for
that deliberate asymmetry.

Because the artifact is created lazily at the phase advance rather than in advance, a client synced
to a retro that has not been advanced SHALL receive **no rows at all** for these tables — the rows do
not exist — rather than rows filtered out by a predicate.

Work-graph placement: leaf artifacts off `retro`, which hangs off `team`. Permission story: a member
of the owning team reads them; an authenticated non-member gets an empty result through the existing
team-scoped predicate; nobody writes them from a client.

#### Scenario: A member of the team reads the artifact

- **WHEN** a member of the owning team syncs a retro that has been advanced past `brainstorm`
- **THEN** the draft row and its proposal rows arrive in that member's local replica

#### Scenario: A non-member receives nothing

- **WHEN** an authenticated workspace member who is not on the owning team evaluates both queries for that team's retro
- **THEN** both return zero rows

#### Scenario: No client mutator exists

- **WHEN** the client mutator map is enumerated
- **THEN** it contains no mutator that writes either artifact table, so a client cannot create or alter one even optimistically

#### Scenario: Before the advance there is nothing to sync

- **WHEN** a member syncs a retro still in `brainstorm` on a team that has opted in
- **THEN** their replica holds zero rows for both tables because none have been created

#### Scenario: Scheduling state does not sync

- **WHEN** the Zero schema is compared against the live Postgres schema
- **THEN** the completion pass's claim column is present in Postgres, deliberately absent from the Zero schema, and the drift check passes on that basis
