## ADDED Requirements

### Requirement: Team-scoped, client-read-only cycle-digest sync

The cycle-digest artifact SHALL extend the team-scoped synced-query model to a new `cycle_digest` entity: a user SHALL sync a cycle's digest ONLY for a team they belong to, scoped by the same `whereExists` over the owning team's roster driven by the verified `ctx.userID` (never client args), denied by the empty `or()` filter for other teams with no leak of row existence, and readable by viewers. Unlike the human-authored work-data entities, `cycle_digest` SHALL be **client-read-only**: no client Zero mutator SHALL create or edit it. It SHALL be written only by the server-side pre-compute job over the authoritative write path (the same server-only write mechanism connector work-graph mutations use), so a client can never forge or alter a digest. AI provider keys and AI config SHALL reuse the existing **server-only** connector secret/config surface (excluded from the Zero schema) and SHALL never sync to a client. The schema-drift test SHALL cover the new `cycle_digest` table.

Work-graph placement: `cycle_digest` is a team-scoped leaf off `cycle` (off `team`); its content references existing synced issue/PR/check/deploy entities as evidence and adds no per-person visibility surface. Sync/permission story: membership-scoped read via `team_membership`, deny-by-empty, auth-before-existence, viewers read; writes are server-only and never client-reachable; AI secrets/config stay server-only and unsynced.

#### Scenario: A user syncs only their teams' digests

- **WHEN** an authenticated user requests the cycle-digest synced query
- **THEN** the server-side definition returns only digests for teams the user belongs to, and an empty result (with no leak of existence) for every other team

#### Scenario: A client cannot write a digest

- **WHEN** a client attempts to create or edit a `cycle_digest` row
- **THEN** no client mutator applies the write; only the server-side pre-compute job writes the row

#### Scenario: AI keys never sync

- **WHEN** any client requests any synced query
- **THEN** no AI provider key or AI config secret is returned, because AI secrets reuse the server-only connector surface excluded from the Zero schema

#### Scenario: Drift test covers the new table

- **WHEN** the schema-drift test runs
- **THEN** it verifies the `cycle_digest` table matches the hand-written `DB` interface and Zero schema
