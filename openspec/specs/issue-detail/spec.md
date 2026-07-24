# issue-detail Specification

## Purpose
TBD - created by archiving change issue-core. Update Purpose after archive.
## Requirements
### Requirement: Issue detail surface

The system SHALL provide an issue detail surface (a route and/or panel) that displays a single issue's key, title, status, priority, assignee, labels, description, and comment thread, rendered strictly against theme tokens and reading from a team-scoped synced query. The surface SHALL show the reality-strip and divergence-flag seams for the issue (the quiet "not linked" state in this change). It SHALL distinguish a still-loading issue from a genuinely-missing one, only showing "not found" once the query result is complete.

Work-graph placement: a view over a single team-scoped `issue` and its related `comment`, `issue_label`, `assignee`, and `creator`. Sync/permission story: the detail synced query returns the issue only to members of its team, denied by empty query otherwise, so a non-member cannot distinguish a private issue from a nonexistent one.

#### Scenario: Member opens an issue

- **WHEN** a member opens an issue in their team
- **THEN** the detail surface shows its key, title, status, priority, assignee, labels, description, and comments, with the reality strip in its unlinked state

#### Scenario: Missing versus loading is distinguished

- **WHEN** an issue id resolves to no visible row
- **THEN** the surface shows "not found" only after the query result is complete, and shows a loading state before that, never flickering a false 404

#### Scenario: Non-member cannot open another team's issue

- **WHEN** a non-member navigates directly to an issue in a team they do not belong to
- **THEN** the detail query returns empty and the surface shows "not found" without revealing the issue's existence

### Requirement: Rich description editing

The detail surface SHALL edit the issue description in a TipTap-v3 rich-text editor, persisting the document as JSON through the shared update mutator with optimistic application. Editing SHALL be last-write-wins (no real-time collaboration in this change). Description editing SHALL be reachable and operable by keyboard.

Work-graph placement: the description is an attribute of the team-scoped `issue`. Permission story: editing is gated by team-scoped `canWrite`; viewers may read the rendered description but cannot edit it.

#### Scenario: Edit and save the description

- **WHEN** a member edits the description and confirms
- **THEN** the change applies optimistically and persists as a TipTap JSON document via the shared mutator

#### Scenario: Viewer cannot edit the description

- **WHEN** a `viewer` opens an issue
- **THEN** the description renders read-only and no edit affordance accepts a write

### Requirement: Inline metadata editing

The detail surface SHALL allow editing status, priority, assignee, and labels inline, each through the shared mutators with optimistic application, and each fully keyboard-operable. Assignee selection SHALL be limited to members of the issue's team, and label selection to the team's labels.

Work-graph placement: edits to attributes and edges of the team-scoped `issue`. Permission story: each edit is gated by team-scoped `canWrite`; assignee and label choices are constrained to the issue's team.

#### Scenario: Change status, priority, assignee, and labels by keyboard

- **WHEN** a member changes status, priority, assignee, or labels via the inline controls using only the keyboard
- **THEN** each change applies optimistically through the shared mutator with no pointer interaction

#### Scenario: Assignee choices are team-scoped

- **WHEN** a member opens the assignee control
- **THEN** only members of the issue's team are offered as assignees

### Requirement: Comment thread

The detail surface SHALL present the issue's comments in chronological order and allow a member to post, edit (own or as admin), and delete (own or as admin) comments through the shared mutators with optimistic application, fully keyboard-operable. Comment bodies SHALL be edited in the TipTap rich-text editor and stored as JSON.

Work-graph placement: `comment` rows hanging off the open `issue`. Permission story: posting is gated by team-scoped `canWrite`; editing/deleting requires author-or-admin, checked before existence; viewers read but cannot post.

#### Scenario: Post a comment by keyboard

- **WHEN** a member types a comment and submits it with the keyboard
- **THEN** the comment appears optimistically in the thread and persists via the shared mutator with `author` from `ctx`

#### Scenario: Edit restricted to author or admin

- **WHEN** a user who is neither author nor admin attempts to edit or delete a comment
- **THEN** the action is rejected as not authorized without revealing the comment's existence

#### Scenario: Viewer cannot comment

- **WHEN** a `viewer` opens the issue
- **THEN** the comment composer is unavailable and any post attempt is rejected as not authorized

