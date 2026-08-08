# command-palette Specification

## Purpose
TBD - created by archiving change issue-core. Update Purpose after archive.
## Requirements
### Requirement: Command palette wired to real issue actions

The system SHALL provide a command palette, built on the design-system `cmdk` shell and rendered strictly against theme tokens, that is opened by keyboard from anywhere in the app and exposes real actions — not placeholders. The palette SHALL offer at minimum: navigate (jump to a team, an issue by key/title, or a surface), create issue, change status, assign, and add label. Action-executing commands SHALL invoke the shared `packages/schema` mutators, so a palette write applies optimistically within the sub-100ms budget and is authorized identically to any other write.

Work-graph placement: the palette is an interaction surface over team-scoped entities; it introduces no new entity. Sync/permission story: it can act only on issues the caller may see, and its writes are gated by the same team-scoped role checks as the mutators (viewers are rejected).

#### Scenario: Create an issue from the palette

- **WHEN** a member opens the palette, chooses create issue, supplies a title, and confirms
- **THEN** an issue is created via the shared mutator with a client-minted id and a pending number, all from the keyboard

#### Scenario: Palette action authorizes like any mutator

- **WHEN** a `viewer` invokes a change-status or assign command from the palette
- **THEN** the underlying mutator rejects the write as not authorized and no change is applied

### Requirement: Palette actions scoped to the focused or selected issue

Context-dependent commands (change status, assign, add label) SHALL target the currently focused issue in the list, the current multi-selection, or the open issue in the detail surface, and the palette SHALL make the target clear. When no issue is in context, such commands SHALL be unavailable rather than acting on an arbitrary issue.

Work-graph placement: scoping reflects the current issue context within a team. Permission story: unchanged — the target must be an issue the caller may act on.

#### Scenario: Change status of the focused issue

- **WHEN** a member focuses an issue in the list, opens the palette, chooses change status, and picks a status
- **THEN** the focused issue's status changes via the shared mutator with no pointer interaction

#### Scenario: Assign the open issue from detail

- **WHEN** a member has an issue open in the detail surface, opens the palette, and chooses assign
- **THEN** the assignment targets the open issue and applies via the shared mutator

#### Scenario: Context command is unavailable without a target

- **WHEN** no issue is focused, selected, or open and a member opens the palette
- **THEN** the change-status/assign/add-label commands are not offered

### Requirement: Palette is fully keyboard-native

The palette SHALL open, filter, navigate, execute, and dismiss entirely by keyboard: a shortcut opens it, typing filters, Arrow keys move the active item with an accent highlight, Enter executes, and Escape closes it and restores focus to the prior surface. It SHALL trap focus while open and never require a pointer.

Work-graph placement: interaction-only. Permission story: unchanged.

#### Scenario: Open, filter, execute, and dismiss with the keyboard

- **WHEN** a user opens the palette by shortcut, types to filter, moves with Arrow keys, and presses Enter
- **THEN** the highlighted command executes, and pressing Escape instead closes the palette and returns focus to the previously focused element, with no pointer interaction

### Requirement: Command palette offers triage actions

The command palette SHALL offer Accept, Decline, Route, and Send-to-triage on the focused or selected issue(s), gated to writers. These actions SHALL dispatch the corresponding shared mutators and SHALL be absent for viewers.

Work-graph placement: palette actions over the ambient issue target. Permission story: rendered and dispatched only for `canWrite`.

#### Scenario: Writer triages from the palette

- **WHEN** a writer opens the palette on an inbox issue and picks Accept
- **THEN** the issue is accepted and leaves the inbox

#### Scenario: Viewer sees no triage actions

- **WHEN** a viewer opens the palette on an issue
- **THEN** no triage actions are offered

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

### Requirement: The palette reaches the inbox

The command palette SHALL offer, in its existing navigate and action groups, a command to go to the
inbox and a command to mark all of the caller's notifications read. Both SHALL be reachable and
executable entirely by keyboard, through the palette's existing open-filter-move-execute flow, and
the mark-all command SHALL invoke the same shared `packages/schema` mutator the inbox surface uses,
so it is authorized and applied identically.

These commands SHALL be self-scoped like every notification surface: they act on the caller's own
inbox and offer no way to view or act on anyone else's.

Work-graph placement: interaction-only; the palette introduces no entity. Permission story: the
navigate command exposes nothing, and the mark-all command is gated by the same self-scoped mutator
authorization as any other notification write.

#### Scenario: Reach the inbox from the palette by keyboard

- **WHEN** a member opens the palette, types to filter to the inbox command, and presses Enter
- **THEN** the inbox surface opens, with no pointer interaction

#### Scenario: Mark everything read from the palette

- **WHEN** a member with unread notifications executes the mark-all-read command from the palette
- **THEN** every unread notification of theirs becomes read via the shared mutator, the unread badge
  clears, and no other user's notifications are affected

### Requirement: The palette's issue jump becomes the search result groups

The palette's title-and-key jump list SHALL be **replaced** by search's two result groups rather than
sitting beside them — two title-only matchers in one palette is two mental models for one question.
The first group SHALL be fed entirely by the on-device pass, rendering on the keystroke with no
request in its path, and SHALL therefore find a token that appears only in an issue's description,
which the previous jump list could not. The second group SHALL be appended below a labelled divider
after the debounced server pass resolves. Each group SHALL be capped at a small number of rows, with a
persistent row that opens the full search route carrying the same query.

Work-graph placement: an interaction surface over team-scoped entities; it introduces no entity.
Permission story: the on-device group can only show rows the caller's synced queries already
delivered; the server group carries search's own team-scoped predicate and is limited to the team
whose list is open, so both groups mean the same scope.

#### Scenario: A description-only token is found from the palette

- **WHEN** a member opens the palette and types a token that appears only in the description of an
  issue in the open team
- **THEN** the issue appears in the on-device group in the same frame, with no request issued

#### Scenario: The old jump list is gone, not duplicated

- **WHEN** a member types a query that matches an issue by key
- **THEN** the issue appears exactly once, in the on-device results group, and no separate jump group
  is rendered

#### Scenario: Escalate to the full route from the palette

- **WHEN** a member activates the persistent "search everything" row with Enter
- **THEN** the full search route opens carrying the query, with no pointer interaction

### Requirement: The palette owns its own filtering, ordering and cursor

The palette SHALL NOT delegate filtering or ordering to the command primitive's built-in scorer, which
re-sorts items within a group and groups by their best item's score — appending a group would then
re-sort everything above it. Filtering and ordering SHALL be deterministic and applied by the
application to **every** group, action rows included, over a stable declaration order.

The active item SHALL be **controlled by the palette and keyed to a row identity**, not to a list
index, so appending late results cannot move it. When the active row leaves the list because the query
narrowed, the cursor SHALL fall to the first row of the first group.

Every behaviour the palette already guarantees — a shortcut opens it, typing filters, Arrow keys move
the active item with an accent highlight, Enter executes, Escape closes and restores focus, focus is
trapped while open — SHALL be unchanged.

#### Scenario: The cursor survives the server answering

- **WHEN** a member arrows down to the third row and the server group then arrives below
- **THEN** the same row remains active and in the same position, and Enter activates it

#### Scenario: Existing palette actions still filter and execute

- **WHEN** a member types to narrow to a status, assign, label, project, triage or inbox action and
  presses Enter
- **THEN** that action executes exactly as before, through the same shared mutator

#### Scenario: Ordering does not depend on typing history

- **WHEN** a member types a query, deletes it, and types the same query again
- **THEN** the rows appear in the same order both times

### Requirement: One global owner of the palette keybinding

The application SHALL have exactly one owner of the command-palette shortcut, mounted above
every authenticated surface, and exactly one palette instance. No individual surface SHALL
bind the palette shortcut itself. Because the frame advertises the shortcut on every page,
the shortcut SHALL open a palette on every authenticated page — including pages that
register no commands of their own, where the palette offers the always-present set (the six
destinations, the notification inbox, search everything, and theme selection).

Surfaces that contribute commands SHALL **register** a command source with the global owner
while they are mounted and SHALL unregister it when they unmount, so the palette offers the
union of the always-present set and the sources currently mounted. Registration SHALL NOT
change what any surface offers: every command reachable from the palette before this
requirement SHALL remain reachable, with the same targeting rules and the same mutators.
Surface-local shortcuts that are not the palette shortcut SHALL be unaffected.

Work-graph placement: interaction surface only; no entity. Permission story: unchanged —
registered commands are authorized by the same team-scoped mutator checks as before, and the
always-present set contains no writes.

#### Scenario: The shortcut works on a page that registers nothing

- **WHEN** a member presses the palette shortcut on the delivery surface, which contributes
  no commands of its own
- **THEN** the palette opens and offers the destinations, inbox, search and theme commands

#### Scenario: A surface's commands appear only while it is mounted

- **WHEN** a member opens the palette on the issue list, then navigates to a surface that
  registers no issue commands and opens it again
- **THEN** the issue commands are offered on the first surface and absent on the second

#### Scenario: Exactly one palette responds to the shortcut

- **WHEN** a member presses the palette shortcut on a surface that contributes commands
- **THEN** exactly one palette opens

#### Scenario: Every previously reachable command survives

- **WHEN** the palette is opened on the issue list, the board, and a retro
- **THEN** each surface's full command set — including create, status, assign, label,
  project, triage and the retro and board actions — is offered exactly as before

#### Scenario: Surface shortcuts other than the palette are untouched

- **WHEN** a member uses the board's and inbox's row-movement keys and the retro's own
  shortcuts
- **THEN** each behaves exactly as before

