## ADDED Requirements

### Requirement: Issue carries a nullable cycle reference

An issue SHALL carry a nullable `cycleId` referencing a cycle in the same team. It SHALL be settable and clearable through the shared `issue.setCycle` mutator, which SHALL reject a cycle in a different team and SHALL be gated exactly as other issue writes (viewers rejected). Deleting a cycle SHALL null the `cycleId` of its issues (`ON DELETE SET NULL`), never deleting the issues.

Work-graph placement: a nullable `issue.cycle_id` edge to `cycle`. Permission story: `canWrite` + team access; cross-team assignment rejected.

#### Scenario: An issue can be assigned to and cleared from a cycle

- **WHEN** a member assigns an issue to a same-team cycle and later clears it
- **THEN** the issue's `cycleId` is set then unset, and a cross-team cycle is rejected

#### Scenario: Deleting a cycle preserves its issues

- **WHEN** a cycle that has issues is deleted
- **THEN** those issues remain and their `cycleId` becomes null
