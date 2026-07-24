## ADDED Requirements

### Requirement: Status-grouped keyboard-first board

The system SHALL present a team's issues as a kanban board of six fixed columns in the status category order (Backlog, Todo, In Progress, In Review, Done, Canceled) at a `/board` route that is a peer to the issue list. The board SHALL read the same team-scoped synced query the list uses, so already-synced rows render and re-arrange locally without a network round-trip, meeting the sub-100ms budget. Each card SHALL render the tokenized status/priority/key/title/assignee visuals and the reserved reality-strip and divergence slots, correct in all three presets in both light and dark with no hardcoded colors or fonts. A viewer SHALL see the board read-only.

Work-graph placement: a view over team-scoped `issue` rows; introduces no new entity. Permission story: renders only the caller's teams' issues; viewers read but cannot move.

#### Scenario: Board renders issues in fixed status columns

- **WHEN** a member opens a team's board
- **THEN** the six fixed status columns appear in order and each issue renders as a card in its status column with its status glyph, priority mark, key, title, and assignee

#### Scenario: Board and list are peer views of the same data

- **WHEN** a member switches between the list and the board for a team
- **THEN** both show the same team-scoped issues and a change made in one is reflected in the other without a reload

#### Scenario: Board is correct across themes

- **WHEN** the board is viewed in each preset in light and dark
- **THEN** all card and column colors, fonts, and density come from tokens and remain legible

### Requirement: Move a card by drag or keyboard within and across columns

The board SHALL let a card be moved with a pointer (drag and drop) and, equivalently, without a pointer: a focused card SHALL be picked up with Space or Enter, moved within its column and to adjacent columns with the arrow keys, dropped with Space or Enter, and the move cancelled with Escape restoring the original position. A move that lands the card in a different column SHALL change the issue's status to that column; a move within a column SHALL reorder it. Each move SHALL be announced to assistive technology via a live region, and focus SHALL return to the moved card in its new location.

Work-graph placement: a status and/or ordering change on one `issue`. Permission story: the move is gated exactly as the underlying mutator — viewers are rejected.

#### Scenario: Keyboard move across columns changes status

- **WHEN** a member focuses a card, picks it up with Space, presses ArrowRight to an adjacent column, and drops it with Space
- **THEN** the issue's status changes to the target column optimistically with no pointer interaction, and focus returns to the moved card

#### Scenario: Drag reorders within a column

- **WHEN** a member drags a card above another card in the same column and drops it
- **THEN** the card settles into the new position optimistically and the order persists across a reload

#### Scenario: Escape cancels a pick-up

- **WHEN** a member picks up a card and presses Escape
- **THEN** the card returns to its original position and no change is written

### Requirement: Command-palette move to status

The board SHALL expose a "Move to status…" action in a keyboard-opened command palette that moves the focused card to a chosen status column via the same move mutator, appending it to that column. This SHALL be available regardless of pointer capability and SHALL be gated so viewers cannot invoke it.

#### Scenario: Move via the command palette

- **WHEN** a member focuses a card, opens the board command palette, and chooses "Move to In Review"
- **THEN** the issue's status becomes In Review, the card appears in that column, and the change persists

#### Scenario: Viewer cannot move via the palette

- **WHEN** a viewer opens the board command palette
- **THEN** no move action writes a change; the board stays read-only

### Requirement: Single-write fractional ordering

Reordering SHALL be backed by a nullable fractional-index `rank` on the issue. Moving a card SHALL write only that card's `rank` (and `status` when the column changed) and SHALL NOT renumber any sibling. The fractional index SHALL be computed at the mutator call site from the destination neighbours' current ranks and passed to the mutator, so a rebase of the mutator does not recompute or jump the card. Issues SHALL be densely ranked from creation — the create call site mints a rank appended after the destination column's current maximum — so a drop always lands position-faithfully; a null rank SHALL be tolerated only as a transient pre-sync value and SHALL sort last deterministically.

Work-graph placement: an ordering field on `issue`. Permission story: unchanged from the issue's team scope.

#### Scenario: A move writes exactly one row

- **WHEN** a card is moved between two neighbours
- **THEN** only the moved issue's `rank` (and `status` if the column changed) is written; sibling ranks are unchanged

#### Scenario: Large columns virtualize lazily

- **WHEN** a status column grows past roughly one hundred cards
- **THEN** the column virtualizes its cards while remaining fully drag- and keyboard-movable, and stays plain below that threshold
