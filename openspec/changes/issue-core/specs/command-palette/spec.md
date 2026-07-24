## ADDED Requirements

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
