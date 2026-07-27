## ADDED Requirements

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
