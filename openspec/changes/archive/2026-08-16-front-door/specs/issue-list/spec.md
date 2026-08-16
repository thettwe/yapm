## MODIFIED Requirements

### Requirement: Status-grouped keyboard-first issue list

The system SHALL present a team's issues as a list grouped by status in the fixed category order
(Backlog, Todo, In Progress, In Review, Done, Canceled), built on the design-system `issue-row`
primitive and rendered strictly against theme tokens so it is correct in all three presets in both
light and dark. Within a status group, issues SHALL be ordered by priority (descending) then
most-recently-updated by default. The list SHALL read from a team-scoped synced query so that
already-synced rows render and filter locally without a network round-trip, meeting the sub-100ms
interaction budget.

The list SHALL open on **live work**: its default lens SHALL exclude the terminal statuses (Done and
Canceled), because a list whose first screen is an archive buries the work it exists to show. The
set of statuses the default admits SHALL be **derived** as every status that is not terminal, so a
status added to the product later joins the default rather than being silently withheld by a fixed
list.

That default SHALL be a **stated value of the status filter axis, not a rule behind it**: the axis
SHALL report how many statuses it admits, its control SHALL name exactly which, and clearing it
SHALL be the same interaction as clearing any other axis. Nothing SHALL narrow the list without
saying so on the surface that narrows it. Asking for a terminal status SHALL return it, and the
fixed category order SHALL be unchanged — a group with no matching issue simply does not render, as
it does for any other filter.

Work-graph placement: the list is a view over team-scoped `issue` rows and introduces no new entity;
the default lens is a value of the existing filter model, adding no axis and no predicate.
Sync/permission story: it renders only the issues the caller may see (their teams' issues); a viewer
sees the same rows read-only, and the default lens changes nothing about which rows sync.

#### Scenario: Issues render grouped by status

- **WHEN** a member opens a team's issue list
- **THEN** issues appear grouped under the status categories in the fixed order, each row rendering
  its status glyph, priority mark, key, title, and assignee from the tokenized primitive

#### Scenario: Opening the list shows live work, not the archive

- **WHEN** a member opens a team's issue list holding fifty-four Done issues, three Canceled ones and
  three in flight
- **THEN** the list shows the three in flight, and the fifty-seven-row archive is not what the page
  opens on

#### Scenario: The default lens says what it is doing

- **WHEN** a member reads the filter bar on a freshly opened list
- **THEN** the status axis states how many statuses it admits and names them when opened, so the
  absence of Done is a stated filter rather than an unexplained gap

#### Scenario: Asking for the archive returns the archive

- **WHEN** a member clears the status axis, or asks for Done, from the keyboard alone
- **THEN** every matching issue renders, including the terminal statuses, under the same fixed group
  order

#### Scenario: A new status is admitted by default rather than hidden

- **WHEN** the product's status set gains a status that is not terminal
- **THEN** the default lens admits it without any edit to the default, because the default is derived
  by excluding the terminal statuses rather than by listing the others

#### Scenario: Local render meets the latency budget

- **WHEN** the list renders issues already present in the client replica
- **THEN** rows appear and re-group from local storage without a network round-trip

#### Scenario: List is correct across themes

- **WHEN** the list is viewed in each preset in light and dark
- **THEN** all colors, fonts, and density come from tokens with no hardcoded values and remain legible
