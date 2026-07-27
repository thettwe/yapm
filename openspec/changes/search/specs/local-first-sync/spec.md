## ADDED Requirements

### Requirement: A derived server-only table that the replica must not notice

The search index SHALL be a **server-only** table: present in Postgres and in the hand-written Kysely
`DB` interface, and **absent from the Zero schema**, joining the existing server-only set
(`issue_sequence`, `cycle_sequence`, the connector tables, and the retrospective card→author binding)
in the drift test's assertion. Because it is absent from the sync schema, no synced query can name it
and no relationship can reach it.

Its text columns SHALL be plain `text`. The full-text vector SHALL exist **only inside a GIN
expression index**, never as a stored column on this table or on any synced table, so no exotic column
type enters the logical-replication path toward the sync replica. Adding the table SHALL NOT require
changing the publication configuration, because a publication change forces a full replica resync on
every self-hosted upgrade.

Work-graph placement: a derived projection of issues and comments that owns no truth and can be
dropped and rebuilt. Sync/permission story: never synced; every read carries the team-scoped
predicate; its denormalised team reference is sound only because an issue can never change team.

#### Scenario: Drift test covers the new table on both sides

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it finds the search index table in Postgres and in the hand-written `DB` interface, finds
  its compound primary key and its constraints unchanged, and asserts it is **not** present in the
  Zero schema

#### Scenario: The replica is undisturbed by the new table and its index

- **WHEN** the three-container stack is brought up from empty volumes with the migration applied
- **THEN** the sync service starts, replicates, and serves synced queries normally, with no
  publication change and no replica resync

#### Scenario: No synced query can name the index

- **WHEN** the synced query registry is inspected
- **THEN** no query's abstract syntax tree names the search index table

### Requirement: The server pass degrades against the existing connection state

The search surfaces SHALL read the **existing** sync connection state to decide whether the server
pass is available, rather than introducing a second notion of "online". When the connection is not
established the server group SHALL be replaced by an explicit on-device-only state and the on-device
group SHALL be unaffected.

#### Scenario: Connection loss degrades search rather than breaking it

- **WHEN** the sync connection drops while a member is searching
- **THEN** the on-device group keeps answering on the keystroke and the server group states that only
  on-device results are shown

#### Scenario: Recovery restores the server group without a reload

- **WHEN** the connection recovers
- **THEN** the next query populates the server group again, with no page reload
