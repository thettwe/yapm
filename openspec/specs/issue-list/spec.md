# issue-list Specification

## Purpose
TBD - created by archiving change issue-core. Update Purpose after archive.

## Requirements

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

### Requirement: The reality track in every row

Each issue row in the list SHALL render the reality-track slot fed by the delivery-signal computation seam and by the divergence computation. A row whose issue is linked to a pull request SHALL draw live PR state, CI health, review age and the deployment fact as the reality track defined in the reality-vocabulary capability; a row whose issue has no linked entities SHALL render that slot **reserved and blank** — no station, no segment, no age text, and no placeholder of any kind.

Divergence SHALL be drawn as the `//` break on that row's track, positioned by which divergence fired. The list SHALL NOT render a separate warning symbol for divergence, and SHALL NOT draw delivery reality as a strip of provider icons.

The strip's four facts are unchanged. A row whose merged change reached production — a deployment carrying the linked pull request's merge commit that recorded a success — SHALL say so through the track's deployment station; a row whose change did not SHALL leave that station empty rather than drawing an absence-of-deployment marker, because "no deployment recorded" and "not deployed" are not distinguishable from stored data. The deployment fact SHALL be carried by the station's own shape and by the track's accessible label, never by hue alone.

The blank slot SHALL reserve the same space as a populated track, so a row whose signal arrives — including the deployment signal arriving minutes after a merge — SHALL alter no row structure or alignment. All of it SHALL render strictly from theme tokens, correct in all three presets in light and dark.

Work-graph placement: rendering surface for the computation seam defined in issue-tracking, now fed by the linked delivery entities and the team's deployments. Permission story: renders only over already-permitted, team-scoped synced rows.

#### Scenario: Rows show real delivery state for linked issues

- **WHEN** the list renders an issue linked to an open, approved PR with passing checks
- **THEN** that row's reality track draws PR state, CI health and review age, without disturbing row alignment

#### Scenario: Rows show the unlinked reality state

- **WHEN** the list renders issues with no linked git entities
- **THEN** every such row's reality slot is reserved and blank — no node, no segment, no dotted placeholder and no age text — and the row's alignment is identical to a row whose track is populated

#### Scenario: A list of mostly-unlinked issues carries no repeated ornament

- **WHEN** most rows on a page of the list have no linked change
- **THEN** the page draws delivery ink only on the rows that have a delivery fact

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

The list SHALL let a member filter by status, assignee (including unassigned), label, priority,
free text, cycle, project, and the reality-derived delivery predicates; sort by a chosen key and
direction; and choose a grouping. Filters SHALL evaluate locally over synced rows for instant
feedback. A member SHALL be able to save the current filter/grouping/sort as a named
`saved_view`, and select a saved view to apply it. Reality-derived filters and views
(blocked-on-review, failing-CI, merged-not-deployed) evaluate through the delivery-signal seam
over linked entities; where a delivery predicate has no data it simply matches nothing rather
than being hidden. Filtering, sorting, saving, and view selection SHALL be fully
keyboard-operable.

These controls SHALL be presented in the quiet register the work surface uses: a filter mark
followed by the axes as **plain text labels**, with the current grouping and sort stated quietly
at the trailing edge. They SHALL NOT be presented as a row of outlined buttons competing with
the work for attention. **The register is the only thing this requirement changes: every filter
axis, the search input, every grouping, every sort key, the sort direction control, and every
saved-view behaviour SHALL keep working exactly as before.** A control that loses a capability in
the re-registering is a regression, not a simplification.

Each control SHALL keep an accessible name naming the axis it controls, so it is operable and
identifiable without sight of the drawing.

`merged-not-deployed` SHALL evaluate over real data rather than being reserved: it SHALL match
an issue whose linked pull request is merged and whose merge commit no successful deployment
carried, and SHALL NOT match an issue whose merged change did reach production. It SHALL NOT be
an alias for "merged", which would wrongly include merged-and-deployed work. Where a merged
change was shipped in a batch under a different commit, the predicate SHALL still match it — the
exact-commit rule over-reports rather than claiming a deployment that cannot be proven, and the
product SHALL state that limitation where the filter is documented rather than leaving a member
to infer it.

Work-graph placement: the filter/view UX consumes the reality-aware filter model and
`saved_view` entity from issue-tracking, backed by real delivery state including deployments.
Permission story: any team member reads and applies shared views; viewers cannot create or edit
them.

#### Scenario: Filter narrows the list instantly

- **WHEN** a member applies a status/assignee/label/priority/text filter
- **THEN** the list narrows locally without a network round-trip

#### Scenario: Every axis survives the quiet register

- **WHEN** a member opens each of the filter axes, the grouping control, the sort control and
  the sort direction control in turn
- **THEN** each offers exactly the options it offered before the register changed, and applying
  any of them produces the same result

#### Scenario: Save and apply a view with the keyboard

- **WHEN** a member configures a filter and sort, saves it as a named view, and later selects
  it, all via the keyboard
- **THEN** the `saved_view` persists and re-applying it restores the filter, grouping, and sort
  with no pointer interaction

#### Scenario: A reality-derived view narrows to diverged/blocked issues

- **WHEN** a member applies a delivery predicate such as blocked-on-review or failing-CI
- **THEN** the list narrows to issues whose linked delivery state matches, evaluated through the
  delivery-signal seam

#### Scenario: Delivery predicate with no connector data matches nothing

- **WHEN** a member applies a delivery predicate on an instance with no connector installed, so
  no issue has linked delivery state
- **THEN** the predicate matches nothing and the list is empty, rather than the control being
  hidden or a stale reserved view being presented

#### Scenario: Merged-not-deployed excludes a change that shipped

- **WHEN** a member applies `merged-not-deployed` over two merged issues, one whose merge commit
  a successful deployment carried and one whose did not
- **THEN** the list contains only the issue whose change did not reach production

#### Scenario: A grouping the schema does not persist downgrades on save

- **WHEN** a member groups by cycle or project and saves the view
- **THEN** the saved view persists the default grouping rather than an unpersistable one, and
  applying it restores the filter and sort intact

### Requirement: The row states its reality in words, in a reserved slot

Each issue row SHALL render, left to right: the priority tick, the status arc, the mono issue
key, the title, a spring, the **phrase at rest**, the reality track, the track's mono age
column, the issue's labels as dot + name, the mono last-updated age, and the assignee avatar.

The phrase SHALL be drawn from the shared phrase dictionary defined in the reality-vocabulary
capability, in that capability's neutral register. A row with nothing true to say SHALL render
its phrase slot **genuinely empty** — no placeholder, no dash, no filler.

Every slot right of the title SHALL occupy a **reserved measure**, so a row whose signal
populates — checks going red, a merge landing, a deployment arriving — SHALL NOT reflow itself
or any neighbouring row. The title SHALL be the element that yields space; the phrase SHALL NOT
be truncated ahead of the title.

The phrase SHALL be real text rather than an icon-only signal, and SHALL render correctly from
theme tokens in every preset in light and dark, meeting the text contrast bar against every
surface a row is drawn on — including the selected row's tinted ground.

Work-graph placement: rendering surface over the existing delivery-signal seam; no new entity,
query or mutator. Permission story: unchanged — the phrase derives from rows the caller already
syncs.

#### Scenario: A failing-checks row says so

- **WHEN** the list renders an issue whose linked pull request's checks are failing
- **THEN** that row states the failing-checks phrase in its reserved slot, beside a reality
  track drawing the same fact, and the row's alignment matches every other row's

#### Scenario: A quiet row stays blank

- **WHEN** the list renders an issue with no linked delivery entities, or one whose signal
  supports no phrase in the neutral register
- **THEN** the row's phrase slot renders empty and the row's slots occupy exactly the same
  measures as a row that carries a phrase

#### Scenario: A populating signal does not move the list

- **WHEN** an issue's checks turn red while its row is on screen
- **THEN** the phrase appears in the already-reserved slot and no row's columns shift position

#### Scenario: The divergent row shows its phrase and its broken track together

- **WHEN** the list renders an issue marked in progress whose linked pull request is merged
- **THEN** the row states the divergence phrase **and** draws the `//` break on its track, and
  the row does not draw a second warning symbol for the same fact

### Requirement: The selected row carries an accent rail and a tinted ground

The row under selection SHALL be marked by a left accent rail and a tinted ground drawn from
theme tokens. The marking SHALL be visible without hover and SHALL NOT depend on hue alone — the
rail is a position as well as a colour.

The selected row's mono issue key SHALL take the primary text ink rather than the accent ink: on
the selected tint the accent ink cannot hold the text contrast bar in every preset, so the rail
and the tinted ground carry the selection state and the key stays readable (DI-2).

Selection marking SHALL meet the non-text contrast bar against the row's ground and the text
contrast bar for every string drawn on the tinted ground, in every preset in light and dark.

#### Scenario: Selection reads without a pointer

- **WHEN** a member selects a row using the keyboard
- **THEN** that row shows the accent rail and tinted ground, and its key is drawn in the primary
  text ink, with no pointer interaction and no hover required

#### Scenario: The tinted ground stays legible

- **WHEN** a selected row carries an urgent phrase in any preset, light or dark
- **THEN** the phrase meets the text contrast bar against the selected row's tinted ground

### Requirement: Check and deploy phrases carry the source's mark

A row's phrase SHALL carry the GitHub provenance mark when — and only when — it states a check
fact or a deployment fact. The mark SHALL be monochrome, drawn after the phrase text, no larger
than that text, and SHALL NOT replace the row's status arc or any node of its reality track.

#### Scenario: The mark suffixes the sourced fact

- **WHEN** the list renders the failing-checks phrase and the built-but-not-live phrase
- **THEN** each carries the monochrome GitHub mark after its text, and neither row's status arc
  is replaced or recoloured by it

#### Scenario: A derived phrase carries no mark

- **WHEN** the list renders the divergence phrase or the in-review phrase
- **THEN** no provenance mark is drawn beside them

### Requirement: Group headers draw the grouping's own mark, label and count

Each group SHALL render a quiet tinted band carrying the grouping's own mark — the status arc
when grouping by status, the priority tick when grouping by priority, a label dot when grouping
by label, and no mark for a grouping that has none — followed by the group label and the group's
member count in mono. The count SHALL be the number of rows in that group after filtering.

The header SHALL remain a labelled region so a keyboard or screen-reader user can identify which
group a row belongs to, and SHALL render from theme tokens in every preset, light and dark.

#### Scenario: A status group draws its arc

- **WHEN** the list is grouped by status
- **THEN** each group header shows that status's arc, its label, and its filtered row count in
  mono on a tinted band

#### Scenario: The count follows the filter

- **WHEN** a filter narrows a group from nine rows to two
- **THEN** that group's header count reads two

### Requirement: The fold states the true remaining count and is keyboard-operable

When a filtered result is longer than the list's rendered page, the list SHALL render a **fold**
at the end stating how many matching issues are **not** currently rendered. That number SHALL be
computed from the filtered result's real length, and SHALL never be a constant, an estimate, or
a decorative truncation.

The fold SHALL be a focusable control reachable and operable without a pointer: keyboard
movement from the last rendered row SHALL reach it, and activating it SHALL render the next page
of rows with focus landing on the first newly revealed row. When every matching issue is
rendered, the fold SHALL NOT render at all.

The masthead's issue count SHALL remain the full filtered count, not the rendered count, so the
page never understates how much work matches.

#### Scenario: The fold counts what is hidden

- **WHEN** a filtered result holds more issues than one rendered page
- **THEN** the fold states exactly the number of matching issues not rendered, and the masthead
  count states the full filtered total

#### Scenario: The fold opens from the keyboard

- **WHEN** a member moves down from the last rendered row and activates the fold with the
  keyboard alone
- **THEN** the next page of rows renders and focus lands on the first newly revealed row

#### Scenario: A short result has no fold

- **WHEN** every matching issue is rendered
- **THEN** no fold is drawn and no count of hidden rows is stated

### Requirement: The list surface carries no explanatory sentence

The issue list SHALL hold to the word diet: chrome is labels, and the work surface speaks only
dictionary phrases at rest. No explanatory sentence SHALL render on this page — including its
empty, loading and missing-team states, which SHALL be labels rather than sentences. Derived
numbers SHALL NOT explain themselves at rest.

#### Scenario: An empty result is a label

- **WHEN** a filter matches no issue
- **THEN** the list states a short label in a status role, not a sentence explaining the filter

#### Scenario: The chrome states no sentence

- **WHEN** the list renders with its masthead, filter bar and group headers
- **THEN** every string in that chrome is a label or a value, and none is a sentence
