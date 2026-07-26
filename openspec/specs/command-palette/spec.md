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

