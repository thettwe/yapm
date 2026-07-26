## ADDED Requirements

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
