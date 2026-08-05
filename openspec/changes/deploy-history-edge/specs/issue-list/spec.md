## MODIFIED Requirements

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
