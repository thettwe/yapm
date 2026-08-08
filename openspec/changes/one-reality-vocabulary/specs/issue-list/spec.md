## RENAMED Requirements

- FROM: `### Requirement: Reality strip and divergence flag in every row`
- TO: `### Requirement: The reality track in every row`

## MODIFIED Requirements

### Requirement: The reality track in every row

Each issue row in the list SHALL render the reality-track slot fed by the delivery-signal computation seam and by the divergence computation. A row whose issue is linked to a pull request SHALL draw live PR state, CI health, review age and the deployment fact as the reality track defined in the reality-vocabulary capability; a row whose issue has no linked entities SHALL draw the track's quiet empty state.

Divergence SHALL be drawn as the `//` break on that row's track, positioned by which divergence fired. The list SHALL NOT render a separate warning symbol for divergence, and SHALL NOT draw delivery reality as a strip of provider icons.

The strip's four facts are unchanged. A row whose merged change reached production — a deployment carrying the linked pull request's merge commit that recorded a success — SHALL say so through the track's deployment station; a row whose change did not SHALL leave that station empty rather than drawing an absence-of-deployment marker, because "no deployment recorded" and "not deployed" are not distinguishable from stored data. The deployment fact SHALL be carried by the station's own shape and by the track's accessible label, never by hue alone.

The empty track SHALL reserve the same space as a populated track, so a row whose signal arrives — including the deployment signal arriving minutes after a merge — SHALL alter no row structure or alignment. All of it SHALL render strictly from theme tokens, correct in all three presets in light and dark.

Work-graph placement: rendering surface for the computation seam defined in issue-tracking, now fed by the linked delivery entities and the team's deployments. Permission story: renders only over already-permitted, team-scoped synced rows.

#### Scenario: Rows show real delivery state for linked issues

- **WHEN** the list renders an issue linked to an open, approved PR with passing checks
- **THEN** that row's reality track draws PR state, CI health and review age, without disturbing row alignment

#### Scenario: Rows show the unlinked reality state

- **WHEN** the list renders issues with no linked git entities
- **THEN** every such row draws the track's quiet empty state and no break, without disturbing row alignment

#### Scenario: The `//` break renders on a diverged row

- **WHEN** a listed issue is marked In Progress while its linked PR is merged
- **THEN** that row's track carries the `//` break drawn from tokens, correct in every preset in light and dark, and the row draws no warning symbol

#### Scenario: A shipped change says so in the row

- **WHEN** the list renders an issue whose merged PR's merge commit was carried by a deployment that succeeded
- **THEN** that row's track draws the deployment station as reached and the track's accessible label states it, with the row's alignment unchanged from a row without one

#### Scenario: A merged-but-undeployed row shows no deployment claim

- **WHEN** the list renders an issue whose PR is merged and whose merge commit no deployment carried
- **THEN** the deployment station in that row's track is empty, asserting nothing about production, and the row's alignment is unchanged

#### Scenario: The list is navigable without a pointer

- **WHEN** a user moves through the list with the keyboard alone
- **THEN** each row's track renders in place with no hover required to read it, and no delivery fact is reachable only by pointer
