# projects Specification

## Purpose
TBD - created by archiving change projects-roadmap. Update Purpose after archive.
## Requirements
### Requirement: Projects are workspace-level, readable by any member

The system SHALL model a project as a workspace-level entity (a `workspace_id`, no `team_id`) with a name, an optional lead (a workspace user), a status (planned / active / completed / cancelled), and an optional target date. Every project SHALL be readable by any workspace member — including viewers — through the `isMember` gate; a non-member SHALL get an empty result (deny by empty query). An issue from any team SHALL be assignable to any project.

Work-graph placement: a workspace-level grouping node that issues (of any team) point at via a nullable `issue.project_id`. Permission story: reads gated by `isMember`; the roadmap is a genuine cross-team overview.

#### Scenario: A member reads every workspace project

- **WHEN** a workspace member queries projects
- **THEN** the query returns every project in the workspace

#### Scenario: A non-member is denied

- **WHEN** a user who is not a workspace member queries projects
- **THEN** the synced query returns nothing (deny by empty query)

#### Scenario: A viewer reads projects but cannot write

- **WHEN** a viewer opens the projects view
- **THEN** every project is visible and no create/edit/delete control is offered or accepted

### Requirement: A workspace-level project query never widens issue reads

The system SHALL surface a project's issues only through the team-scoped predicate: the issues related in `projects.all` / `projects.get` SHALL be filtered so a caller sees only the project's issues in teams they belong to. A workspace-level project query SHALL NOT sync issues from teams the caller is not a member of.

Work-graph placement: project (workspace-level) → related issues (team-scoped). Permission story: the `isMember` project read composes with the `teamScoped` issue read; the team boundary on issues is never crossed.

#### Scenario: Related issues are team-scoped

- **WHEN** a member of team A (but not team B) reads a project that spans both teams
- **THEN** only the project's team-A issues are synced to them, and progress is computed over those

### Requirement: Project writes are canWrite-gated; the lead is a workspace member

The system SHALL provide `project.create`, `project.update`, and `project.delete` shared mutators, each gated by `canWrite` (member, non-viewer), rejecting viewers and non-members before any existence check. A project SHALL default to `planned` when no status is given. When a lead is supplied it SHALL be validated to be a workspace member. Deleting a project SHALL unassign its issues (`project_id → null`) without deleting them.

Work-graph placement: lifecycle mutators on the workspace-level project. Permission story: any writer manages any project; a viewer cannot.

#### Scenario: A member creates a planned project

- **WHEN** a member creates a project with only a name
- **THEN** it is stored with status `planned`, no lead, and no target date

#### Scenario: A viewer cannot create a project

- **WHEN** a viewer attempts to create a project
- **THEN** the mutation is rejected before any write

#### Scenario: A non-member lead is rejected

- **WHEN** a project is created or updated with a lead who is not a workspace member
- **THEN** the mutation is rejected

#### Scenario: Deleting a project unassigns its issues

- **WHEN** a project with assigned issues is deleted
- **THEN** the project is removed and its issues survive with `project_id = null`

### Requirement: Assigning an issue to a project respects the issue's team-scoped permission

The system SHALL provide `issue.setProject`, which sets or clears an issue's `project_id` and SHALL run the issue's team-scoped write gate (auth-before-existence, `canWrite`, member of the issue's team or workspace admin). The referenced project SHALL be required only to exist in the workspace; no cross-team rejection SHALL apply because a project spans teams.

Work-graph placement: the issue↔project edge, written under the issue's permission. Permission story: identical to every other issue write.

#### Scenario: A writer assigns their team's issue to a project

- **WHEN** a writer on the issue's team moves the issue to a project
- **THEN** the issue's `project_id` is set

#### Scenario: An issue from any team may join any project

- **WHEN** a writer assigns an issue to a project that also holds another team's issues
- **THEN** the assignment succeeds (no cross-team rejection)

#### Scenario: A viewer cannot assign an issue to a project

- **WHEN** a viewer attempts to set an issue's project
- **THEN** the mutation is rejected before any write

### Requirement: Project progress is computed from Done issues

The system SHALL compute a project's progress as the share of its (readable) issues at status Done, never storing it. A project with no readable issues SHALL report 0% (never NaN). Canceled issues SHALL count toward the total but not toward Done.

Work-graph placement: a derived view over the project's related issues. Permission story: computed over exactly the team-scoped issues the caller can read.

#### Scenario: Progress reflects Done share

- **WHEN** a project has four readable issues, two of them Done
- **THEN** its progress reads 2/4 (50%)

#### Scenario: An empty project is 0%

- **WHEN** a project has no readable issues
- **THEN** its progress reads 0/0 (0%), not NaN

### Requirement: A roadmap timeline places projects by target date

The system SHALL provide a Roadmap view that lays projects out on a time axis by target date without a Gantt/chart dependency, built from the design system. Dated projects SHALL be positioned on a month axis; projects without a target date SHALL be listed separately. The view SHALL be keyboard-navigable (move focus between projects, open the focused project) and correct in all three presets in light and dark, using only theme tokens.

Work-graph placement: a temporal view over workspace projects. Permission story: reads via the same `isMember` project query.

#### Scenario: Dated projects appear on the axis in date order

- **WHEN** the roadmap renders projects with target dates
- **THEN** each is positioned by its target date and an earlier target sits left of a later one

#### Scenario: Undated projects are held aside

- **WHEN** a project has no target date
- **THEN** it is listed in a separate "no target date" area, not on the axis

#### Scenario: The roadmap is keyboard-navigable

- **WHEN** a user moves focus with the keyboard and presses Enter on a project
- **THEN** focus moves between project rows and Enter opens the focused project

### Requirement: Projects group and filter the issue list; the palette assigns

The system SHALL let the issue list group by project and filter by project (including a "No project" bucket) as a web-only axis, and SHALL offer a writer-gated command-palette action to move the targeted issue(s) to a project or clear it.

Work-graph placement: a list axis over `issue.project_id` and a palette action invoking `issue.setProject`. Permission story: the action is hidden and rejected for viewers.

#### Scenario: Group the list by project

- **WHEN** a user groups the issue list by project
- **THEN** issues are bucketed by their project with a "No project" bucket for the unassigned

#### Scenario: Move an issue to a project from the palette

- **WHEN** a writer selects "Move to project" on a focused issue and picks a project
- **THEN** the issue's `project_id` is set optimistically and syncs

