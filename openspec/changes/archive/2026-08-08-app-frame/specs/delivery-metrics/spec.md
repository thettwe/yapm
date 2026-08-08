## MODIFIED Requirements

### Requirement: A team-level delivery view over a rolling window of completed cycles

Every team SHALL have a **Delivery** view at `/teams/{teamId}/delivery`, reached from the application
frame's Delivery destination on every team surface, showing the same Delivered and Flow metrics the retrospective's
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

### Requirement: Keyboard-first and tokenized

The Delivery view SHALL be reachable and fully operable with no pointer: reachable by keyboard from
the application frame's Delivery destination — present on every team surface — or by its `g d`
shortcut, its window selector operable by keyboard, and its focus order visible. It SHALL be reachable from the command palette's navigation group. Every color, spacing and
font value SHALL come from the design tokens, correct in all six theme blocks at AA contrast, and no
information SHALL be carried by color or by a glyph alone — a trend's direction SHALL be stated in
words.

#### Scenario: Reached and operated without a pointer

- **WHEN** a member tabs from a team's issue list to the deck's Delivery destination, activates it, and changes the window size using only the keyboard
- **THEN** the view opens, focus is visible at every step, the window changes, and no pointer is required at any point

#### Scenario: The trend is legible without color

- **WHEN** a tile shows a metric that moved
- **THEN** the direction and its meaning are stated in words, with the glyph and the color as reinforcement rather than as the carrier

