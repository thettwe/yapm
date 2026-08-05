# issue-list Specification

## Purpose
TBD - created by archiving change issue-core. Update Purpose after archive.
## Requirements
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

Each issue row in the list SHALL render the reality-strip slot fed by the delivery-signal computation seam and the divergence-flag slot fed by the divergence computation. With the `connectors` change the delivery signal is real: a row whose issue is linked to a pull request SHALL render live PR state, CI health, and review age in the reality strip, and SHALL render the divergence flag when the human-set status disagrees with git reality; a row whose issue has no linked entities SHALL still show the quiet "not linked" placeholder and no divergence flag.

The strip SHALL additionally render a **deployment signal**: a row whose merged change reached production — a deployment carrying the linked pull request's merge commit that recorded a success — SHALL say so, and a row whose change did not SHALL show nothing in that position rather than an absence-of-deployment marker, because "no deployment recorded" and "not deployed" are not distinguishable from stored data. That signal SHALL be carried by its own glyph and an accessible label, never by hue alone. The unlinked placeholder SHALL reserve the same width as the populated strip, so a row whose signal arrives — including the deployment signal arriving minutes after a merge — SHALL alter no row structure or alignment. All of it SHALL render strictly from theme tokens, correct in all three presets in light and dark.

Work-graph placement: rendering surface for the computation seam defined in issue-tracking, now fed by the linked delivery entities and the team's deployments. Permission story: renders only over already-permitted, team-scoped synced rows.

#### Scenario: Rows show real delivery state for linked issues

- **WHEN** the list renders an issue linked to an open, approved PR with passing checks
- **THEN** that row's reality strip shows PR state, CI health, and review age, without disturbing row alignment

#### Scenario: Rows show the unlinked reality state

- **WHEN** the list renders issues with no linked git entities
- **THEN** every such row shows the quiet "not linked" reality strip and no divergence flag, without disturbing row alignment

#### Scenario: Divergence flag renders on a diverged row

- **WHEN** a listed issue is marked In Progress while its linked PR is merged
- **THEN** that row shows the divergence flag from tokens, correct in every preset in light and dark

#### Scenario: A shipped change says so in the row

- **WHEN** the list renders an issue whose merged PR's merge commit was carried by a deployment that succeeded
- **THEN** that row's reality strip shows the deployment signal with its own glyph and an accessible label, and the row's alignment is unchanged from a row without one

#### Scenario: A merged-but-undeployed row shows no deployment claim

- **WHEN** the list renders an issue whose PR is merged and whose merge commit no deployment carried
- **THEN** the deployment position in that row's strip is empty, asserting nothing about production, and the row's alignment is unchanged

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

The list SHALL let a member filter by status, assignee (including unassigned), label, priority, and free text; sort by a chosen key and direction; and choose a grouping. Filters SHALL evaluate locally over synced rows for instant feedback. A member SHALL be able to save the current filter/grouping/sort as a named `saved_view`, and select a saved view to apply it. With the `connectors` change the delivery signal is real, so reality-derived filters and views (blocked-on-review, failing-CI, merged-not-deployed) evaluate through the delivery-signal seam over linked entities; where a delivery predicate has no data it simply matches nothing rather than being hidden. Filtering, sorting, saving, and view selection SHALL be fully keyboard-operable.

`merged-not-deployed` SHALL evaluate over real data rather than being reserved: it SHALL match an issue whose linked pull request is merged and whose merge commit no successful deployment carried, and SHALL NOT match an issue whose merged change did reach production. It SHALL NOT be an alias for "merged", which would wrongly include merged-and-deployed work. Where a merged change was shipped in a batch under a different commit, the predicate SHALL still match it — the exact-commit rule over-reports rather than claiming a deployment that cannot be proven, and the product SHALL state that limitation where the filter is documented rather than leaving a member to infer it.

Work-graph placement: the filter/view UX consumes the reality-aware filter model and `saved_view` entity from issue-tracking, now backed by real delivery state including deployments. Permission story: any team member reads and applies shared views; viewers cannot create or edit them.

#### Scenario: Filter narrows the list instantly

- **WHEN** a member applies a status/assignee/label/priority/text filter
- **THEN** the list narrows locally without a network round-trip

#### Scenario: Save and apply a view with the keyboard

- **WHEN** a member configures a filter and sort, saves it as a named view, and later selects it, all via the keyboard
- **THEN** the `saved_view` persists and re-applying it restores the filter, grouping, and sort with no pointer interaction

#### Scenario: A reality-derived view narrows to diverged/blocked issues

- **WHEN** a member applies a delivery predicate such as blocked-on-review or failing-CI
- **THEN** the list narrows to issues whose linked delivery state matches, evaluated through the delivery-signal seam

#### Scenario: Delivery predicate with no connector data matches nothing

- **WHEN** a member applies a delivery predicate on an instance with no connector installed, so no issue has linked delivery state
- **THEN** the predicate matches nothing and the list is empty, rather than the control being hidden or a stale reserved view being presented

#### Scenario: Merged-not-deployed excludes a change that shipped

- **WHEN** a member applies `merged-not-deployed` over two merged issues, one whose merge commit a successful deployment carried and one whose did not
- **THEN** the list contains only the issue whose change did not reach production

