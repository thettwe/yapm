## ADDED Requirements

### Requirement: Cycles replicate under the team scope

The `cycle` table SHALL replicate to a client under the same team scope as issues: a user syncs only their teams' cycles, and the sync is denied by an empty query otherwise. Cycle mutators (`cycle.create`, `cycle.update`, `cycle.activate`, `cycle.complete`, `issue.setCycle`) SHALL sync under that scope, with viewers unable to write. The server-only `cycle_sequence` counter SHALL NOT be part of the Zero schema and SHALL never replicate, and the schema-drift test SHALL cover the new `cycle` table, the `issue.cycle_id` column, and the `cycle_sequence` exclusion.

Work-graph placement: `cycle` replicates like any team-scoped work table; `cycle_sequence` is server-only. Permission story: read scoped to the caller's teams; writes gated by the shared mutators.

#### Scenario: A user syncs only their teams' cycles

- **WHEN** a user with membership in one team but not another queries cycles
- **THEN** only the cycles of teams they belong to replicate

#### Scenario: The cycle sequence never syncs and drift is guarded

- **WHEN** the schema-drift test runs against the migrated database
- **THEN** `cycle` and `issue.cycle_id` match the hand-written Kysely and Zero schemas, and `cycle_sequence` is present in the Kysely interface but absent from the Zero schema
