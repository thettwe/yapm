## MODIFIED Requirements

### Requirement: Both project surfaces state that a project is workspace-scoped

The system SHALL make the scope difference legible on the index and on a project's page: a project
is workspace-scoped while the deck above it is team-scoped, and one project may hold issues from
several teams. Each surface SHALL carry a workspace-marked scope indicator in its masthead, and
SHALL carry, once per surface **behind that surface's `how ·`**, the statement that its counts are
taken over the issues in the reader's own teams.

That statement is a query definition and SHALL NOT be drawn as visible prose at rest — least of all
immediately beside the affordance that already holds it. The masthead's scope indicator is a label,
not a derivation, and SHALL remain visible.

A surface SHALL NOT name, count, or imply the existence of issues in teams the reader does not
belong to, because those rows never sync and the client cannot prove they exist.

#### Scenario: The masthead states the workspace scope

- **WHEN** a member opens the projects index or one project's page
- **THEN** the masthead carries a workspace-marked scope indicator distinct from the team named in the deck

#### Scenario: A cross-team project names only the teams whose issues arrived

- **WHEN** a member of team A but not team B opens a project holding issues from both
- **THEN** only team A is named, with its count, and no statement is made about team B's issues

#### Scenario: The counting rule is folded, not printed

- **WHEN** a member opens the projects index or one project's page
- **THEN** no sentence stating the counting scope is drawn at rest, and the surface's `how ·` states, when opened, that the project is workspace-scoped and that its counts are taken over the issues in the reader's own teams

#### Scenario: One surface, one counting affordance

- **WHEN** either project surface is rendered
- **THEN** exactly one `how ·` carrying the counting rule exists on it, and no copy of that rule is drawn beside it
