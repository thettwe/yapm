## MODIFIED Requirements

### Requirement: The project entity replicates workspace-wide; the issue reference replicates under team scope

The system SHALL replicate the `project` table to every workspace member under the `isMember` gate, and SHALL replicate `issue.project_id` under the existing team scope. A workspace-level project query SHALL re-scope its related issues with the `teamScoped` predicate so that no issue outside the caller's teams is ever synced. Project mutators SHALL sync under `canWrite`; viewers SHALL NOT write. The schema-drift test SHALL cover the new `project` table and the new `issue.project_id` column.

Work-graph placement: a workspace-level table plus a nullable edge on the team-scoped `issue`. Permission story: `isMember` for projects, `teamScoped` for issues, composed so the team boundary holds.

#### Scenario: Projects sync to every member

- **WHEN** a workspace member connects
- **THEN** every project in the workspace replicates to their client

#### Scenario: A project's related issues never cross a team boundary

- **WHEN** a member reads a project spanning teams they are not all in
- **THEN** only the project's issues in the member's teams are replicated

#### Scenario: A viewer cannot write a project or an issue's project

- **WHEN** a viewer attempts any project mutator or `issue.setProject`
- **THEN** the mutation is rejected

#### Scenario: The drift test covers the new schema

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts the `project` table and `issue.project_id` match the hand-written Kysely and Zero schemas
