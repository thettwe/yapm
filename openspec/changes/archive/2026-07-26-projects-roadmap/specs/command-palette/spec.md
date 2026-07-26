## ADDED Requirements

### Requirement: The command palette can move issues to a project

The system SHALL add a writer-gated "Move to project" action to the command palette, operating on the focused or selected issue(s), offering every workspace project plus a "No project" option, and committing through `issue.setProject`. The action SHALL be hidden and never written for a viewer.

Work-graph placement: a palette action invoking the issue↔project mutator. Permission story: gated to writers via `useMembership().canWrite`.

#### Scenario: Move the focused issue to a project

- **WHEN** a writer opens the palette on a focused issue, chooses "Move to project", and picks a project
- **THEN** the issue's `project_id` is set optimistically and syncs

#### Scenario: Clear an issue's project from the palette

- **WHEN** a writer chooses "No project" for a focused issue
- **THEN** the issue's `project_id` becomes null

#### Scenario: A viewer sees no project action

- **WHEN** a viewer opens the command palette
- **THEN** no "Move to project" action is offered
