## ADDED Requirements

### Requirement: Triage state replicates under the team scope

The `issue.needs_triage` column SHALL replicate under the same team-scoped predicate as the rest of the issue, and the triage mutators (`flagTriage`, `acceptTriage`, `declineTriage`, `routeIssue`) SHALL sync under that scope with viewers denied writes. The schema-drift test SHALL cover the new column in both the Kysely `DB` interface and the Zero schema.

Work-graph placement: one boolean column on an existing synced entity. Permission story: viewers read the flag, cannot write it.

#### Scenario: Drift test covers the triage column

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** `issue.needs_triage` is present in the Kysely DB interface and the Zero schema and matches the database (not null, has default)

#### Scenario: A viewer syncs but cannot mutate triage

- **WHEN** a viewer syncs a team's issues and attempts a triage mutation
- **THEN** the flag replicates read-only and the mutation is rejected before any write
