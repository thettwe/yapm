## MODIFIED Requirements

### Requirement: Issue detail surface

The system SHALL provide an issue detail surface (a route and/or panel) that displays a single issue's key, title, status, priority, assignee, labels, description, and comment thread, rendered strictly against theme tokens and reading from a team-scoped synced query. The surface SHALL show the delivery seam for the issue drawn as the reality track defined in the reality-vocabulary capability: for a linked issue it SHALL show the live PR state, CI health, review age, the deployment fact, and the recent deployments of the linked pull requests' repositories, with divergence drawn as the `//` break on the track when the human-set status disagrees with git reality; for an unlinked issue it SHALL show the track's quiet "not linked" state. The surface SHALL NOT draw delivery reality as a strip of provider icons, SHALL NOT render a separate warning symbol for divergence, and SHALL NOT declare a CI health drawing of its own — every CI state it shows SHALL be drawn from the shared vocabulary. It SHALL distinguish a still-loading issue from a genuinely-missing one, only showing "not found" once the query result is complete.

Work-graph placement: a view over a single team-scoped `issue`, its related `comment`, `issue_label`, `assignee`, and `creator`, and its linked delivery entities (`pull_request` via `issue_link`, and through it `ci_check` and `review`; `deployment` carries no per-issue edge and is read team-scoped, matched to the issue by the linked pull requests' repositories). Sync/permission story: the detail synced query returns the issue and its team-scoped linked entities only to members of its team, denied by empty query otherwise, so a non-member cannot distinguish a private issue from a nonexistent one.

#### Scenario: Member opens an issue

- **WHEN** a member opens an issue in their team
- **THEN** the detail surface shows its key, title, status, priority, assignee, labels, description, and comments, with the reality track rendered

#### Scenario: Member opens a linked issue

- **WHEN** a member opens an issue in their team that is linked to a pull request
- **THEN** the detail surface shows its key, title, status, priority, assignee, labels, description, comments, and the reality track drawing live PR state, CI health, review age and the deployment fact, alongside the recent deployments of those pull requests' repositories

#### Scenario: Member opens a diverged issue

- **WHEN** a member opens an issue whose human-set status disagrees with git reality
- **THEN** the detail surface draws the `//` break on the track and states the divergence sentence, and renders no warning symbol

#### Scenario: Member opens an unlinked issue

- **WHEN** a member opens an issue with no linked git entities
- **THEN** the detail surface shows the reality track in its quiet unlinked state

#### Scenario: The delivery seam is readable without a pointer

- **WHEN** a member reaches the detail surface's delivery seam using the keyboard alone
- **THEN** every delivery fact it draws is present at rest, with nothing revealed only on hover

#### Scenario: Missing versus loading is distinguished

- **WHEN** an issue id resolves to no visible row
- **THEN** the surface shows "not found" only after the query result is complete, and shows a loading state before that, never flickering a false 404

#### Scenario: Non-member cannot open another team's issue

- **WHEN** a non-member navigates directly to an issue in a team they do not belong to
- **THEN** the detail query returns empty and the surface shows "not found" without revealing the issue's existence
