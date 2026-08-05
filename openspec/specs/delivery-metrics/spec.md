# delivery-metrics Specification

## Purpose
TBD - created by archiving change team-delivery-view. Update Purpose after archive.
## Requirements
### Requirement: A team-level delivery view over a rolling window of completed cycles

Every team SHALL have a **Delivery** view at `/teams/{teamId}/delivery`, sitting beside the team's
other views on the same switcher, showing the same Delivered and Flow metrics the retrospective's
auto-seeded data panel shows — shipped, carried out, carried in, carried twice or more, added
mid-cycle, canceled and total; and median PR cycle time, median time to first review, review rounds,
issues with no linked pull request and CI failing rate — computed over a **rolling window of the
team's most recently completed cycles** rather than over a single cycle.

The window SHALL be measured in completed cycles, SHALL be selectable from a fixed set of sizes with
6 as the default, and SHALL be bounded at 12 cycles. A cycle that has not completed SHALL be excluded
from the window, and the view SHALL say so, so that a partially elapsed cycle never depresses a trend.
The selected window SHALL be carried in the URL so that a view is shareable and the browser's back
button behaves.

Each metric SHALL be presented as a tile carrying: the metric's value **for the window as a whole**;
a trend sparkline whose points are the metric evaluated against each cycle in the window
individually, oldest first; a delta against **the immediately preceding window of the same length**,
suppressed entirely when no full preceding window exists; and a caption that narrates the system.
The window's own aggregate SHALL be computed against the window, not derived by summing the
sparkline's points, so that an issue that touched several cycles in the window is counted once and a
carry inside the window is not reported as a carry out of it.

#### Scenario: The metrics are reachable outside a retrospective

- **WHEN** a member opens a team's Delivery view
- **THEN** the Delivered and Flow metrics are shown for a rolling window of that team's completed cycles, with no retrospective involved and without opening one

#### Scenario: The window aggregates rather than sums

- **WHEN** an issue is carried from one cycle in the window into the next cycle in the same window
- **THEN** the window's "carried out" total does not count it, the sparkline point for the cycle it left does, and the window's "in scope" total counts that issue exactly once

#### Scenario: A repeat rollover inside the window is still counted as one

- **WHEN** an issue the rollover has already moved once is moved again, from one cycle in the window into the next cycle in the same window
- **THEN** the window's "carried twice or more" total counts it, even though it never left the window, and its caption does not report that the plan is holding

#### Scenario: A cycle with nothing to measure is a gap in the trend, not a missing point

- **WHEN** one cycle in the window has no data behind a metric — no linked pull request, say — while the cycles around it do
- **THEN** that metric's sparkline still carries one entry per cycle in the window, the surviving points keep their true spacing, the line breaks across the gap rather than being drawn through it, and the trend's accessible description reports the window's cycle count rather than the number of measured cycles

#### Scenario: The delta compares like with like

- **WHEN** the team has fewer completed cycles than twice the selected window size
- **THEN** the tiles show the window's value and its sparkline and show no delta at all, rather than comparing a full window against a shorter one

#### Scenario: The in-progress cycle is excluded and named

- **WHEN** the team has an active cycle in progress
- **THEN** it contributes to neither the window's value nor its sparkline, and the view states that the window covers completed cycles only

### Requirement: One definition of every metric, shared by every surface

Each metric formula SHALL have exactly one definition in `packages/schema`, evaluated against a
**measurement scope** — a set of cycles and the issues that touched them — rather than against a
single cycle. The retrospective's data panel and the team Delivery view SHALL both be callers of that
one definition; neither SHALL carry a second copy of any formula, a re-derivation, or an
approximation of one. A metric's label, unit, and better-when direction SHALL likewise be declared
once and read by both surfaces.

Evaluating a formula against a scope of exactly one cycle SHALL produce exactly what that formula
produced when it took a cycle, including every null and empty case, so that generalizing the scope
changes no behaviour the retrospective already has. The retrospective's captions, empty-state copy,
metric keys, ordering and rendered markup SHALL be unchanged by this capability existing.

#### Scenario: A one-cycle scope reduces to today's behaviour

- **WHEN** a metric is evaluated against a scope containing exactly one cycle
- **THEN** its value equals the value the retrospective's data panel produced for that cycle before the scope existed, for every metric, including the cases where the metric is absent

#### Scenario: The retrospective's surface does not move

- **WHEN** the retrospective's data panel is rendered
- **THEN** it renders the same tiles, captions, empty states, test selectors and metric keys it rendered before, and its existing tests pass without being edited

#### Scenario: No formula is copied

- **WHEN** the source tree is searched for each metric's arithmetic
- **THEN** exactly one definition of each is found, and none of them is in a second location under `packages/schema` or under `apps/`

### Requirement: Blameless by construction at every entry point

The assembled model of the Delivery view SHALL contain **no per-person dimension at any depth** — no
assignee, author, reviewer, creator, user id, login, email, handle or avatar — so that a per-person
number is not renderable from it, and no identity string present on the synced rows the view reads
SHALL appear anywhere in the assembled model, including inside a caption or a label.

This SHALL be enforced structurally rather than editorially: one shared object-graph walker and one
shared forbidden-key list SHALL be asserted against the **built model** — not against rendered
output — at the retrospective's entry point and at the Delivery view's entry point alike. The view
SHALL offer no per-person filter, breakdown, drill-down, hover or tooltip of any kind.

#### Scenario: A synced GitHub login reaches nothing

- **WHEN** the model is built from issue rows carrying an assignee and a creator, whose linked pull requests carry reviews whose author is a real GitHub login
- **THEN** the built model contains no identity-shaped key at any depth, and none of those names, logins or email addresses appears anywhere in it

#### Scenario: There is no way to ask for a person

- **WHEN** a member operates every control on the Delivery view
- **THEN** no control filters, groups, ranks or breaks any metric down by person, and no per-person number is reachable

### Requirement: Degrades to the data that exists, and never shows hollow numbers

The view SHALL degrade exactly as the retrospective's data panel does. The **Delivered** section
SHALL be fully populated from cycles alone, with no connector configured. The **Flow** section SHALL
appear only when connector-derived delivery data exists for the window and SHALL otherwise render a
single quiet empty state naming what would populate it — never zeros, never an empty chart. A metric
with nothing behind it SHALL be omitted rather than reported as zero.

A team with no completed cycle at all SHALL see one empty state naming what would fill the view,
rather than a grid of zeros or empty sparklines. A window shorter than the selected size SHALL be
labelled with the number of cycles it actually covers.

#### Scenario: A team with no connector

- **WHEN** a team with no connector configured opens the Delivery view
- **THEN** the Delivered section is fully populated with trends across the window, and the Flow section shows one empty state naming the connector that would light it up

#### Scenario: A team with a connector

- **WHEN** the window's issues have linked pull requests, reviews and checks
- **THEN** the Flow section shows median PR cycle time and median time to first review alongside the CI failing rate, each with a window trend and a blameless caption

#### Scenario: A team with no completed cycle

- **WHEN** a team that has completed no cycle opens the Delivery view
- **THEN** the view shows a single empty state naming what would fill it, and shows no metric tiles

### Requirement: Computed client-side from already-synced rows

The view SHALL be a pure function over rows the client has already synced, with **no aggregate query,
no server round trip, no materialized table and no new synced entity**, so that changing the window
size is an in-memory recomputation rather than a fetch. It SHALL read only query surfaces that
already exist for other views; it SHALL add no new query, mutator, permission predicate, migration or
service.

Because the sync engine offers no aggregation, the answer to a window that would require too many
rows SHALL be a **bounded window**, never a server-side aggregate.

#### Scenario: Changing the window costs no network

- **WHEN** a member changes the window size
- **THEN** the view recomputes from rows already in memory and issues no request, and the interaction stays within the sub-100ms budget

#### Scenario: The view works offline

- **WHEN** a member opens the Delivery view with no network connection, having previously synced
- **THEN** the metrics render from the local rows exactly as they do online

### Requirement: Honest about the DORA metrics it does not carry

The view SHALL state plainly, in permanent page copy rather than a dismissible notice, which DORA
metrics it does not show and why. Deployment frequency, change failure rate and time-to-restore SHALL
be named as absent; the lead-time signal SHALL be described as pull-request open-to-merge only, not
as lead time for changes. The copy SHALL distinguish what is coming from what needs an entity that
does not yet exist. No heading, label, caption or tooltip SHALL imply the view carries the four DORA
keys.

#### Scenario: The absences are on the page

- **WHEN** a member reads the Delivery view
- **THEN** it names deployment frequency, change failure rate and time-to-restore as not shown, describes its own cycle-time metric as open-to-merge, and says which of the absences is waiting only on a metric yet to be built over data yapm already records and which is waiting on an entity that does not exist

### Requirement: Keyboard-first and tokenized

The Delivery view SHALL be reachable and fully operable with no pointer: reachable from every team
surface's view switcher by keyboard, its window selector operable by keyboard, and its focus order
visible. It SHALL be reachable from the command palette's navigation group. Every color, spacing and
font value SHALL come from the design tokens, correct in all six theme blocks at AA contrast, and no
information SHALL be carried by color or by a glyph alone — a trend's direction SHALL be stated in
words.

#### Scenario: Reached and operated without a pointer

- **WHEN** a member tabs from a team's issue list to the Delivery view's switcher entry, activates it, and changes the window size using only the keyboard
- **THEN** the view opens, focus is visible at every step, the window changes, and no pointer is required at any point

#### Scenario: The trend is legible without color

- **WHEN** a tile shows a metric that moved
- **THEN** the direction and its meaning are stated in words, with the glyph and the color as reinforcement rather than as the carrier

