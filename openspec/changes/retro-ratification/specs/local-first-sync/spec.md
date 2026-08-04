## ADDED Requirements

### Requirement: Self-scoped AI-reaction sync with no admin bypass, written by a client mutator

The `retro_ai_reaction` entity SHALL replicate through Zero under a **self-scoped** synced query
filtered on the verified `ctx.userID`, never on an argument, gated on workspace membership and
denied by an empty query otherwise. It SHALL NOT use the team-scoped predicate and SHALL NOT carry
that predicate's workspace-admin bypass: a workspace admin reads every issue in the workspace and
**zero** of another member's reactions. The query SHALL carry an explicit comment naming this
deviation, in the same words the equivalent retro-draft and retro-vote queries carry, because
written as team-scoped it would look entirely ordinary in review.

Its primary key SHALL be the **compound natural key** `(proposal_id, user_id)`, so nothing is minted
at a call site or inside a mutator body and the client-minted-UUIDv7 constraint is not engaged.
Unlike the notification entity, whose rows only the server writes, this entity's rows SHALL be
written by an **ordinary optimistic shared mutator** — the same function imported by client and
server — with the user component taken from the verified context, so that a rebase re-applies the
same upsert onto the same key and can neither duplicate nor fabricate a row.

The derived verdict and counts on the AI proposal SHALL be written **only** by the
server-authoritative phase-advance pass through the existing server-only artifact write path, and
SHALL NOT be reachable from any client mutator.

The synced set SHALL be bounded by construction: the query is scoped to one retro and to one user,
so it holds at most one row per proposal in that retro.

Work-graph placement: a per-member leaf off an AI proposal, off `retro`, off `team`.
Sync/permission story: exactly one person reads a given row — its author. `retro_id` and `team_id`
are present for the server's one-shot count and for membership cleanup and are **not** sync scopes;
no relationship exists that could widen a read past the author.

The CI schema-drift test SHALL cover the new table — its columns and its compound primary key — and
the new columns on the AI proposal and retro action tables, asserting the migration, the
hand-written Kysely `DB` interface and the hand-written Zero schema all agree with the live Postgres
schema.

#### Scenario: An admin syncs none of another member's reactions

- **WHEN** a workspace admin's client is fully synced for a team whose members have reacted to AI proposals
- **THEN** its local store contains zero reaction rows authored by anyone else

#### Scenario: A non-member is denied by empty query

- **WHEN** an authenticated non-member subscribes to the reaction query
- **THEN** the query resolves to an empty result rather than an error that reveals anything

#### Scenario: Rebase cannot duplicate a reaction

- **WHEN** the reaction mutator is re-run on the client during rebase
- **THEN** no second row is created, because the compound natural key absorbs the re-applied upsert and no identifier was minted anywhere

#### Scenario: A reaction is an optimistic shared mutator

- **WHEN** a member records a reaction
- **THEN** the change applies optimistically through a shared `packages/schema` mutator imported by both client and server, within the sub-100ms budget

#### Scenario: No client mutator writes a verdict

- **WHEN** the client mutator map is enumerated
- **THEN** it contains no mutator that writes a proposal's verdict or counts, so only the server-authoritative phase advance can set them

#### Scenario: Drift test covers the compound key and the new columns

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts the reaction table's compound primary key and columns, and the new proposal and action columns, match the Zero schema and the hand-written `DB` interface, and fails if any of the three drifts
