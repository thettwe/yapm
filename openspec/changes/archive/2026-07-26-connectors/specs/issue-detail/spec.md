## MODIFIED Requirements

### Requirement: Issue detail surface

The system SHALL provide an issue detail surface (a route and/or panel) that displays a single issue's key, title, status, priority, assignee, labels, description, and comment thread, rendered strictly against theme tokens and reading from a team-scoped synced query. The surface SHALL show the reality-strip and divergence-flag seams for the issue: for a linked issue it SHALL show the live PR state, CI health, review age, and any linked deployment state, plus the divergence flag when the human-set status disagrees with git reality; for an unlinked issue it SHALL show the quiet "not linked" state. It SHALL distinguish a still-loading issue from a genuinely-missing one, only showing "not found" once the query result is complete.

Work-graph placement: a view over a single team-scoped `issue`, its related `comment`, `issue_label`, `assignee`, and `creator`, and its linked delivery entities (`pull_request`, `ci_check`, `review`, `deployment` via `issue_link`). Sync/permission story: the detail synced query returns the issue and its team-scoped linked entities only to members of its team, denied by empty query otherwise, so a non-member cannot distinguish a private issue from a nonexistent one.

#### Scenario: Member opens an issue

- **WHEN** a member opens an issue in their team
- **THEN** the detail surface shows its key, title, status, priority, assignee, labels, description, and comments, with the reality-strip and divergence-flag seams rendered

#### Scenario: Member opens a linked issue

- **WHEN** a member opens an issue in their team that is linked to a pull request
- **THEN** the detail surface shows its key, title, status, priority, assignee, labels, description, comments, and the reality strip with live PR state, CI health, review age, and any linked deployment state

#### Scenario: Member opens an unlinked issue

- **WHEN** a member opens an issue with no linked git entities
- **THEN** the detail surface shows the reality strip in its unlinked state

#### Scenario: Missing versus loading is distinguished

- **WHEN** an issue id resolves to no visible row
- **THEN** the surface shows "not found" only after the query result is complete, and shows a loading state before that, never flickering a false 404

#### Scenario: Non-member cannot open another team's issue

- **WHEN** a non-member navigates directly to an issue in a team they do not belong to
- **THEN** the detail query returns empty and the surface shows "not found" without revealing the issue's existence
