## ADDED Requirements

### Requirement: An issue can belong to a project

The system SHALL add a nullable `project_id` to `issue`, referencing a workspace-level project with `ON DELETE SET NULL`, written only through the `issue.setProject` shared mutator. Setting or clearing the project SHALL be `canWrite`-gated and run the issue's team-scoped write gate; the referenced project SHALL only be required to exist in the workspace. Existing issues SHALL be unaffected (`project_id` null).

Work-graph placement: the issue↔project edge, orthogonal to team, cycle, status, and triage. Permission story: written under the issue's existing team-scoped write permission; the project entity itself is workspace-level.

#### Scenario: An issue starts with no project

- **WHEN** the migration adds `project_id`
- **THEN** every existing issue has `project_id = null` and behaves exactly as before

#### Scenario: Assigning and clearing a project

- **WHEN** a writer sets an issue's project and later clears it
- **THEN** `project_id` is set then returns to null, each write gated by the issue's team-scoped permission

#### Scenario: A deleted project unassigns the issue

- **WHEN** an issue's project is deleted
- **THEN** the issue's `project_id` becomes null and the issue is otherwise unchanged
