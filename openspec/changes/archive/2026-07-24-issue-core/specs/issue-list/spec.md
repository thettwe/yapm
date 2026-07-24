## ADDED Requirements

### Requirement: Status-grouped keyboard-first issue list

The system SHALL present a team's issues as a list grouped by status in the fixed category order (Backlog, Todo, In Progress, In Review, Done, Canceled), built on the design-system `issue-row` primitive and rendered strictly against theme tokens so it is correct in all three presets in both light and dark. Within a status group, issues SHALL be ordered by priority (descending) then most-recently-updated by default. The list SHALL read from a team-scoped synced query so that already-synced rows render and filter locally without a network round-trip, meeting the sub-100ms interaction budget.

Work-graph placement: the list is a view over team-scoped `issue` rows and introduces no new entity. Sync/permission story: it renders only the issues the caller may see (their teams' issues); a viewer sees the same rows read-only.

#### Scenario: Issues render grouped by status

- **WHEN** a member opens a team's issue list
- **THEN** issues appear grouped under the six fixed status categories in order, each row rendering its status glyph, priority mark, key, title, and assignee from the tokenized primitive

#### Scenario: Local render meets the latency budget

- **WHEN** the list renders issues already present in the client replica
- **THEN** rows appear and re-group from local storage without a network round-trip

#### Scenario: List is correct across themes

- **WHEN** the list is viewed in each preset in light and dark
- **THEN** all colors, fonts, and density come from tokens with no hardcoded values and remain legible

### Requirement: Reality strip and divergence flag in every row

Each issue row in the list SHALL render the reality-strip slot fed by the delivery-signal computation seam and the divergence-flag slot fed by the divergence computation. In this change the delivery signal is always null, so every row SHALL show the quiet "not linked" reality-strip placeholder and no divergence flag. The row layout SHALL reserve these slots so that `connectors` populating the signal changes no row structure.

Work-graph placement: rendering surface for the computation seam defined in issue-tracking. Permission story: renders only over already-permitted synced rows.

#### Scenario: Rows show the unlinked reality state

- **WHEN** the list renders issues with no linked git entities
- **THEN** every row shows the quiet "not linked" reality strip and no divergence flag, without disturbing row alignment

### Requirement: Pending issue number in the list

When an issue is created optimistically and its server-assigned number has not yet replicated, the list SHALL render a pending key (the team key with a quiet pending indicator) rather than a fabricated number, and SHALL settle to the real key when the number arrives, with no reload and no row reordering jump beyond the natural sort.

Work-graph placement: a UI reflection of the server-authoritative numbering in issue-tracking. Permission story: unchanged from the list's team scope.

#### Scenario: New issue shows a pending key then settles

- **WHEN** a member creates an issue from the list
- **THEN** the new row appears immediately with a pending key, and the key settles to `<team key>-<number>` once the authoritative number replicates, without a reload

### Requirement: Full keyboard model for the list

The list SHALL be fully operable without a pointer. `j` and `k` SHALL move the focused row down and up; `x` SHALL toggle selection of the focused row for multi-select; ArrowUp/ArrowDown SHALL also move focus; Enter (or ArrowRight) SHALL open the focused issue; and single-key shortcuts SHALL change status, assign, and add a label for the focused row or the current selection, each invoking the shared mutators. Focus SHALL be visible via the accent focus indicator at all times, and all shortcuts SHALL be discoverable (e.g. via the palette or a shortcuts hint).

Work-graph placement: interaction surface over team-scoped issues. Permission story: shortcut-triggered writes are gated exactly as the underlying mutators (viewers rejected).

#### Scenario: Navigate and open with the keyboard only

- **WHEN** a user presses `j`/`k` to move the focused row and Enter to open it
- **THEN** focus moves and the issue opens with no pointer interaction and a visible accent focus indicator throughout

#### Scenario: Change status from the list with the keyboard

- **WHEN** a user focuses a row and triggers the change-status shortcut, then picks a status with the keyboard
- **THEN** the issue's status updates optimistically via the shared mutator with no pointer interaction

#### Scenario: Multi-select and bulk act with the keyboard

- **WHEN** a user presses `x` on several rows and triggers an assign or label shortcut
- **THEN** the action applies to every selected issue through the shared mutators without a pointer

#### Scenario: Viewer keyboard write is rejected

- **WHEN** a `viewer` triggers a status/assign/label shortcut
- **THEN** the underlying mutator rejects the write as not authorized and the list surfaces no unauthorized change

### Requirement: Filtering, sorting, and saved views

The list SHALL let a member filter by status, assignee (including unassigned), label, priority, and free text; sort by a chosen key and direction; and choose a grouping. Filters SHALL evaluate locally over synced rows for instant feedback. A member SHALL be able to save the current filter/grouping/sort as a named `saved_view`, and select a saved view to apply it. Reality-derived views SHALL NOT be shipped, and reserved delivery filter controls SHALL remain hidden until real delivery data exists. Filtering, sorting, saving, and view selection SHALL be fully keyboard-operable.

Work-graph placement: the filter/view UX consumes the reality-aware filter model and `saved_view` entity from issue-tracking. Permission story: any team member reads and applies shared views; viewers cannot create or edit them.

#### Scenario: Filter narrows the list instantly

- **WHEN** a member applies a status/assignee/label/priority/text filter
- **THEN** the list narrows locally without a network round-trip

#### Scenario: Save and apply a view with the keyboard

- **WHEN** a member configures a filter and sort, saves it as a named view, and later selects it, all via the keyboard
- **THEN** the `saved_view` persists and re-applying it restores the filter, grouping, and sort with no pointer interaction

#### Scenario: No empty reality views are shown

- **WHEN** a member opens the views and filter controls in this change
- **THEN** no blocked-on-review, failing-CI, or merged-not-deployed view or filter chip is presented, since delivery data does not yet exist
