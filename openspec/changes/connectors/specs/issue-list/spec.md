## MODIFIED Requirements

### Requirement: Reality strip and divergence flag in every row

Each issue row in the list SHALL render the reality-strip slot fed by the delivery-signal computation seam and the divergence-flag slot fed by the divergence computation. With the `connectors` change the delivery signal is real: a row whose issue is linked to a pull request SHALL render live PR state, CI health, and review age in the reality strip, and SHALL render the divergence flag when the human-set status disagrees with git reality; a row whose issue has no linked entities SHALL still show the quiet "not linked" placeholder and no divergence flag. The row layout SHALL be unchanged from issue-core — populating the signal SHALL alter no row structure or alignment — and all of it SHALL render strictly from theme tokens, correct in all three presets in light and dark.

Work-graph placement: rendering surface for the computation seam defined in issue-tracking, now fed by the linked delivery entities. Permission story: renders only over already-permitted, team-scoped synced rows.

#### Scenario: Rows show real delivery state for linked issues

- **WHEN** the list renders an issue linked to an open, approved PR with passing checks
- **THEN** that row's reality strip shows PR state, CI health, and review age, without disturbing row alignment

#### Scenario: Rows show the unlinked reality state

- **WHEN** the list renders issues with no linked git entities
- **THEN** every such row shows the quiet "not linked" reality strip and no divergence flag, without disturbing row alignment

#### Scenario: Divergence flag renders on a diverged row

- **WHEN** a listed issue is marked In Progress while its linked PR is merged
- **THEN** that row shows the divergence flag from tokens, correct in every preset in light and dark

### Requirement: Filtering, sorting, and saved views

The list SHALL let a member filter by status, assignee (including unassigned), label, priority, and free text; sort by a chosen key and direction; and choose a grouping. Filters SHALL evaluate locally over synced rows for instant feedback. A member SHALL be able to save the current filter/grouping/sort as a named `saved_view`, and select a saved view to apply it. With the `connectors` change the delivery signal is real, so reality-derived filters and views (e.g. blocked-on-review, failing-CI, merged-not-deployed) MAY be offered and evaluate through the delivery-signal seam over linked entities; where a delivery predicate has no data it simply matches nothing rather than being hidden. Filtering, sorting, saving, and view selection SHALL be fully keyboard-operable.

Work-graph placement: the filter/view UX consumes the reality-aware filter model and `saved_view` entity from issue-tracking, now backed by real delivery state. Permission story: any team member reads and applies shared views; viewers cannot create or edit them.

#### Scenario: Filter narrows the list instantly

- **WHEN** a member applies a status/assignee/label/priority/text filter
- **THEN** the list narrows locally without a network round-trip

#### Scenario: Save and apply a view with the keyboard

- **WHEN** a member configures a filter and sort, saves it as a named view, and later selects it, all via the keyboard
- **THEN** the `saved_view` persists and re-applying it restores the filter, grouping, and sort with no pointer interaction

#### Scenario: A reality-derived view narrows to diverged/blocked issues

- **WHEN** a member applies a delivery predicate such as blocked-on-review or failing-CI
- **THEN** the list narrows to issues whose linked delivery state matches, evaluated through the delivery-signal seam
