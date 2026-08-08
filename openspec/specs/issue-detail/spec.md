# issue-detail Specification

## Purpose
TBD - created by archiving change issue-core. Update Purpose after archive.
## Requirements
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

### Requirement: Rich description editing

The detail surface SHALL edit the issue description in a TipTap-v3 rich-text editor, persisting the document as JSON through the shared update mutator with optimistic application. Editing SHALL be last-write-wins; there is no real-time collaborative editing of a description. Description editing SHALL be reachable and operable by keyboard.

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

### Requirement: Mentioning teammates from the description and the comment thread

The detail surface SHALL support `@`-mentions in the description editor, the comment composer and
the comment editor, supplying candidates from the team member list the surface already builds for
the assignee control — no additional query and no network request on the keystroke.

Mentions SHALL be inserted, navigated and dismissed by keyboard alone. Dismissing the mention popup
SHALL NOT discard the draft being written or close the detail surface.

Rendered mentions in a saved description or comment SHALL display the mentioned person's current
name, resolved from synced data, and SHALL be non-interactive text rather than a link or a tab stop
— there is no person route in this version, and a link would inject focus stops into the middle of
prose.

Work-graph placement: mentions live inside the existing team-scoped `issue.description` and
`comment.body` documents; no new entity is introduced on this surface. Permission story: mention
candidates and mention notifications are constrained to people who can already read the issue, and
the constraint is enforced server-side rather than by the control.

#### Scenario: Mention a teammate in a comment by keyboard

- **WHEN** a member types `@`, types part of a teammate's name, and presses Enter
- **THEN** a mention is inserted into the draft with no pointer interaction, and posting the comment
  notifies that teammate once

#### Scenario: Dismissing the popup preserves the draft

- **WHEN** a member has typed a comment, opens the mention popup, and presses Escape
- **THEN** the popup closes while the drafted comment text and the detail surface both remain

#### Scenario: A mention chip is not a tab stop

- **WHEN** a member tabs through a rendered description containing mentions
- **THEN** focus does not stop on the mentions

#### Scenario: A viewer sees mentions but cannot write them

- **WHEN** a `viewer` opens an issue
- **THEN** rendered mentions display normally and no editor is available in which to create one —
  while the follow control remains available to them, because a viewer can be mentioned and must be
  able to stop following

### Requirement: Following an issue is visible and reversible from the issue itself

The detail surface SHALL show whether the viewer currently follows the issue and SHALL let them
toggle it, fully keyboard-operable, with its state exposed to assistive technology.

When the viewer follows the issue, the surface SHALL make clear that they will receive updates and
how to stop, so that a subscription created automatically by a mention is discoverable and
reversible from the thing it subscribes them to.

The control SHALL reflect only the viewer's own subscription. No follower count and no list of who
follows the issue SHALL be shown to anyone, including a workspace admin.

#### Scenario: A mentioned person finds and uses the unfollow control

- **WHEN** a person who was auto-subscribed by a mention opens the issue and reaches the control by
  keyboard
- **THEN** the control shows that they are following, and activating it stops further updates for
  them

#### Scenario: Following state updates within the interaction budget

- **WHEN** the control is activated
- **THEN** its state changes optimistically without waiting on the network

#### Scenario: No follower list is exposed

- **WHEN** any user, including a workspace admin, opens the issue
- **THEN** no follower count and no subscriber list is rendered

### Requirement: Issue Files section

The issue detail surface SHALL show a Files section listing the attachments belonging to that issue,
read from the existing team-scoped synced attachment query. Each row SHALL show the filename, its
size, who uploaded it and when, a download affordance, and — for a member with write access — a
remove affordance. Removal SHALL go over the existing authenticated file route; there is no
attachment mutator and this change adds none.

Files uploaded from inside the description or a comment SHALL appear in this list, because they are
rows in the same table anchored to the same issue.

Work-graph placement: `attachment` rows anchored to a team and to this issue. Sync/permission story:
unchanged — rows reach a client only through the team-scoped synced query, so a non-member's list is
empty rather than forbidden, and byte access is decided by the file route, not by the list.

#### Scenario: A member sees the issue's files

- **WHEN** a member opens an issue that has attachments
- **THEN** the Files section lists each one with its filename, size, uploader and upload time

#### Scenario: An image inserted in the description appears in Files

- **WHEN** a member pastes an image into the description and it uploads successfully
- **THEN** that file appears in the Files section for the same issue

#### Scenario: A viewer can download but not remove

- **WHEN** a `viewer` opens an issue with attachments
- **THEN** each file is downloadable and no remove affordance accepts a write

#### Scenario: The empty state is quiet and actionable

- **WHEN** an issue has no attachments
- **THEN** the Files section shows a single quiet line and an upload control, rather than an empty
  box or nothing at all

#### Scenario: The section is fully keyboard-operable

- **WHEN** a user with no pointer tabs into the Files section
- **THEN** every row's download and remove controls are reachable and activatable by keyboard, each
  with an accessible name identifying its file, and remove asks for confirmation before deleting

#### Scenario: A non-member's direct navigation reveals nothing

- **WHEN** a non-member navigates directly to an issue in a team they do not belong to
- **THEN** the attachment query returns empty and the Files section reveals no filename, count or
  existence

### Requirement: A description the local bundle cannot hold is read-only and says so

The detail surface's description editor SHALL refuse to autosave when the loaded description
contains content the running bundle cannot represent, and SHALL show a reload affordance in place of
the editor. Because the description autosaves on a debounce, this refusal is what stops a stale tab
from overwriting the stored description with a pruned copy.

#### Scenario: A stale tab cannot overwrite a newer description

- **WHEN** a tab running an older bundle has an issue open whose description has since gained content
  that bundle does not know, and the user types in that tab
- **THEN** no debounced autosave runs, no update mutator is called, and the stored description is
  unchanged

#### Scenario: The reason and the remedy are on screen

- **WHEN** the description is in that refused state
- **THEN** the surface explains that the description was edited in a newer version and offers a
  reload control, reachable and activatable by keyboard

#### Scenario: Every other field still saves

- **WHEN** the description is refused but the issue's status, priority, assignee or labels are edited
- **THEN** those edits apply and persist as normal — the refusal is scoped to the description
  document, not to the issue

