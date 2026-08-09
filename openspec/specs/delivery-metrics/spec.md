# delivery-metrics Specification

## Purpose
A team-level reading of how work actually flows, over a rolling window of completed cycles. It is
written as a journalism cut: each section states in one sentence what the data says and then draws
the evidence for it, every derived number carries its derivation behind a quiet `how ·` and nothing
else, and what the page does not measure is stated on its surface rather than left to silence. The
binding rule — team-level only, never a per-person number — is said here, once in the product.
Archived from change team-delivery-view (PR #29) and rebuilt by delivery-journalism (PR #36).

## Requirements

### Requirement: A team-level delivery view over a rolling window of completed cycles

Every team SHALL have a **Delivery** view at `/teams/{teamId}/delivery`, reached from the application
frame's Delivery destination on every team surface, computing the same Delivered and Flow metrics the
retrospective's auto-seeded data panel computes — shipped, carried out, carried in, carried twice or
more, added mid-cycle, canceled and total; and median PR cycle time, median time to first review,
review rounds, issues with no linked pull request and CI failing rate — over a **rolling window of
the team's most recently completed cycles** rather than over a single cycle.

The window SHALL be measured in completed cycles, SHALL be selectable from a fixed set of sizes with
6 as the default, and SHALL be bounded at 12 cycles. A cycle that has not completed SHALL be excluded
from the window, and the view SHALL say so, so that a partially elapsed cycle never depresses a trend.
The selected window SHALL be carried in the URL so that a view is shareable and the browser's back
button behaves, and changing it SHALL leave one history entry so that Back returns to the previous
reading.

The window's numbers SHALL be presented as **four stat readings** — what the window shipped, the
median open-to-merged duration, the failing-check rate and the count of issues not linked to a
change — each carrying: the value **for the window as a whole**; a small drawn mini of that value's
own history or shape; a delta against **the immediately preceding window of the same length**,
suppressed entirely when no full preceding window exists and stated in words as well as in a glyph;
and a `how ·` carrying its derivation. Every other metric definition SHALL be drawn in one of the
page's sections under the totality rule. The window's own aggregate SHALL be computed against the
window, not derived by summing a per-cycle series, so that an issue that touched several cycles in
the window is counted once and a carry inside the window is not reported as a carry out of it.

#### Scenario: The metrics are reachable outside a retrospective

- **WHEN** a member opens a team's Delivery view
- **THEN** the Delivered and Flow readings are shown for a rolling window of that team's completed cycles, with no retrospective involved and without opening one

#### Scenario: The window aggregates rather than sums

- **WHEN** an issue is carried from one cycle in the window into the next cycle in the same window
- **THEN** the window's "carried out" total does not count it, the flow band's connection between those two cycles does, and the window's "in scope" total counts that issue exactly once

#### Scenario: A repeat rollover inside the window is still counted as one

- **WHEN** an issue the rollover has already moved once is moved again, from one cycle in the window into the next cycle in the same window
- **THEN** the window's "carried twice or more" total counts it, even though it never left the window, and nothing on the page reports that the plan is holding

#### Scenario: A cycle with nothing to measure is a gap in the trend, not a missing point

- **WHEN** one cycle in the window has no data behind a metric — no linked pull request, say — while the cycles around it do
- **THEN** that metric's per-cycle series still carries one entry per cycle in the window, the surviving points keep their true spacing, the drawing breaks across the gap rather than being drawn through it, and the accessible description reports the window's cycle count rather than the number of measured cycles

#### Scenario: The delta compares like with like

- **WHEN** the team has fewer completed cycles than twice the selected window size
- **THEN** the stat readings show the window's value and its mini and show no delta at all, rather than comparing a full window against a shorter one

#### Scenario: The in-progress cycle is excluded and named

- **WHEN** the team has an active cycle in progress
- **THEN** it contributes to neither the window's value nor its per-cycle series, the standfirst names it as the cycle in progress and names the window as completed cycles only, and the annotated timeline — which is the cycle in progress — is the one drawing scoped to it

### Requirement: One definition of every metric, shared by every surface

Each metric formula SHALL have exactly one definition in `packages/schema`, evaluated against a
**measurement scope** — a set of cycles and the issues that touched them — rather than against a
single cycle. The retrospective's data panel and the team Delivery view SHALL both be callers of that
one definition; neither SHALL carry a second copy of any formula, a re-derivation, or an
approximation of one. A metric's label, unit, and better-when direction SHALL likewise be declared
once and read by both surfaces.

The **population** a formula is evaluated over SHALL likewise be defined once: a pull request that is
linked to more than one issue in scope is **one change**, counted once in every median, rate and
drawing, so that a number stated on the page and a drawing beside it can never describe two
different populations.

Evaluating a formula against a scope of exactly one cycle SHALL produce exactly what that formula
produced when it took a cycle, including every null and empty case, so that generalizing the scope
changes no behaviour the retrospective already has. The retrospective's captions, empty-state copy,
metric keys, ordering and rendered markup SHALL be unchanged by this capability existing.

#### Scenario: A one-cycle scope reduces to today's behaviour

- **WHEN** a metric is evaluated against a scope containing exactly one cycle whose pull requests are each linked to one issue
- **THEN** its value equals the value the retrospective's data panel produced for that cycle before the scope existed, for every metric, including the cases where the metric is absent

#### Scenario: A change linked twice is counted once

- **WHEN** one merged pull request is linked to two issues that both touched the scope
- **THEN** every median, rate and count over pull requests treats it as one change, and the page's drawings and its stated numbers are computed over that same single population

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

The view SHALL degrade to the data that exists, section by section. The readings computed **from
cycles alone** SHALL be populated with no connector configured. Any section whose data does not
exist SHALL **not render at all** — no heading, no axis, no empty chart, no zero and no placeholder
mark. A metric with nothing behind it SHALL be omitted rather than reported as zero.

Where a whole family of readings is missing because no connector has fed anything in, the view SHALL
say so **once**, in one quiet statement naming what would populate it, rather than once per absent
drawing.

A team with no completed cycle at all SHALL see one empty state naming what would fill the view,
rather than a grid of zeros or empty drawings. A window shorter than the selected size SHALL be
labelled with the number of cycles it actually covers.

#### Scenario: A team with no connector

- **WHEN** a team with no connector configured opens the Delivery view
- **THEN** the readings computed from cycles alone are populated across the window, the sections that need linked changes do not render at all, and one quiet statement names the connector that would light them up

#### Scenario: A team with a connector

- **WHEN** the window's issues have linked pull requests, reviews and checks
- **THEN** the open-to-merged distribution, the failing-check rate and the review rhythm are all drawn, each stating what one mark represents

#### Scenario: A section with no data draws nothing

- **WHEN** the window contains no merged change
- **THEN** the open-to-merged and review-rhythm sections do not render at all, rather than drawing an empty axis or a median of zero

#### Scenario: A team with no completed cycle

- **WHEN** a team that has completed no cycle opens the Delivery view
- **THEN** the view shows a single empty state naming what would fill it, and shows no readings and no drawings

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

The view SHALL state plainly, in permanent page copy rather than a dismissible notice, which
delivery metrics it does not show and why. The statement SHALL be **collapsed to one line** carrying
the absences, with the remainder available behind a quiet `more ·` affordance; it SHALL NOT be a
bordered panel of bulleted prose.

The statement SHALL name as absent: **change failure rate** and **time to restore**, both of which
need an incident record that does not exist; and **deployment frequency as a rate** — deployments are
drawn on this page as they happened, and are not normalised into a rate.

The statement SHALL NOT claim that anything the product can already derive is unmeasured. In
particular it SHALL NOT state that merged-to-live is unmeasured: whether a merged change reached
production is derivable from the exact merge-commit join and is stated per change elsewhere in the
product, and the statement SHALL say where instead.

The statement SHALL also disclose the page's real **coverage limit**: pull requests reach this page
only through the issue subtree, so a pull request linked to no issue is invisible in every reading
and every drawing on it.

No heading, label, standfirst or `how ·` on the page SHALL imply the view carries the four DORA keys.

#### Scenario: The absences are on the page

- **WHEN** a member reads the foot of the Delivery view
- **THEN** one line names change failure rate, time to restore and deployment frequency as a rate as not shown, a quiet `more ·` unfolds the rest, and nothing about it can be dismissed

#### Scenario: Nothing derivable is called unmeasured

- **WHEN** a member reads that statement
- **THEN** it does not say that merged-to-live is unmeasured, and it names where in the product whether a merged change reached production is stated

#### Scenario: The coverage limit is disclosed

- **WHEN** a member reads that statement
- **THEN** it says that a pull request linked to no issue does not appear anywhere on this page

### Requirement: Keyboard-first and tokenized

The Delivery view SHALL be reachable and fully operable with no pointer: reachable by keyboard from
the application frame's Delivery destination — present on every team surface — or by its `g d`
shortcut, its window selector operable by keyboard, and its focus order visible. It SHALL be
reachable from the command palette's navigation group, and SHALL register its commands with the
frame that owns the palette rather than binding a key listener of its own.

Every `how ·` on the page and the page's one peek SHALL be reachable by keyboard focus, operable
without a pointer, and dismissible with Escape, returning focus to the affordance that opened them.
No information on the page SHALL be reachable only by hover.

Every color, spacing and font value SHALL come from the design tokens, correct in all six theme
blocks at AA contrast, and no information SHALL be carried by color or by a glyph alone — a trend's
direction SHALL be stated in words, and an outlier's status SHALL be stated in words. Every drawn
chart SHALL carry a truthful `role="img"` accessible label naming what it shows, the population it
was drawn over, and **what one mark represents**.

#### Scenario: Reached and operated without a pointer

- **WHEN** a member tabs from a team's issue list to the deck's Delivery destination, activates it, and changes the window size using only the keyboard
- **THEN** the view opens, focus is visible at every step, the window changes, and no pointer is required at any point

#### Scenario: The derivations and the peek are keyboard surfaces

- **WHEN** a member tabs through the page and activates a `how ·`, then presses Escape, then focuses the timeline's issue chip
- **THEN** the derivation opens and closes with focus returning to its affordance, the peek opens on focus alone, and no information required a pointer to reach

#### Scenario: The trend is legible without color

- **WHEN** a stat reading shows a metric that moved
- **THEN** the direction and its meaning are stated in words, with the glyph and the color as reinforcement rather than as the carrier

#### Scenario: Every drawing says what it is

- **WHEN** assistive technology reads the page's drawings
- **THEN** each states what it shows, the population it covers and what one of its marks represents

### Requirement: The page is a journalism cut — a sentence, then the evidence

The Delivery view SHALL be composed of sections, each of which leads with **one sentence stating
what the data says** and then draws the evidence for it. Those section standfirsts SHALL be the only
place on this work surface where a full sentence is allowed; everywhere else the page SHALL speak in
labels and drawn marks.

A standfirst SHALL be derived from the data it introduces, and SHALL never be a fixed string that
outlives the fact it states. A section whose data cannot support a sentence SHALL not render one.

Every **derived number** on the page SHALL carry a quiet `how ·` affordance and SHALL carry no other
explanation at rest: no caption sentence, no legend, no footnote, no tooltip. Opening a `how ·` SHALL
reveal the derivation of that number — how it was computed and the constraints it was computed
within — and closing it SHALL return the surface to silence. The derivation text SHALL be produced
by the same layer that produces the number, not by the rendering surface.

#### Scenario: A section states its finding before it draws it

- **WHEN** a member reads a section of the Delivery view that has data
- **THEN** the first thing in it is one sentence stating what the data says, the drawing follows, and no legend, axis title or derivation footnote appears beside the drawing

#### Scenario: A standfirst tracks the data

- **WHEN** the underlying rows change such that the finding a standfirst states is no longer true
- **THEN** the standfirst states the new finding, because it is derived rather than authored

#### Scenario: A derived number explains itself only when asked

- **WHEN** a member activates the `how ·` beside a derived number
- **THEN** its derivation and the constraints it was computed within appear; and **WHEN** the member dismisses it, the number is left with no explanation beside it

### Requirement: The binding team-level rule is stated on this page, once in the product

The Delivery view SHALL carry a standfirst under its title naming the cycle in progress, the window
being read, and the binding rule **team-level only — never a per-person number**. That rule SHALL
appear exactly once in the entire product, on this page, in the label register rather than as a
paragraph — because this is the only surface that could tempt a per-person reading.

#### Scenario: The rule is said here and nowhere else

- **WHEN** a member opens the Delivery view
- **THEN** the standfirst under the title states the current cycle, the window it is reading, and that the metrics are team-level only and never a per-person number

### Requirement: An annotated timeline of the cycle in progress, with derived annotations only

The Delivery view SHALL draw a timeline of the **cycle in progress** — a different scope from the
completed-cycle window that governs the page's numbers, and named as such in the standfirst. The
timeline SHALL run from that cycle's start to its end and SHALL carry:

- one mark per **successful deployment** within the cycle's span, positioned by the moment it
  reached production;
- a called-out deployment, selected by a **stated deterministic rule** over the data, naming what
  the row actually carries and how many deployments went out in the same week;
- a mark at each **retrospective closed** within the span, naming that retrospective and the moment
  it closed;
- a **today** marker stating the day of the cycle out of its length, and how many days remain.

Every annotation SHALL be derived from stored facts. The view SHALL NOT carry a hand-authored
annotation, SHALL NOT name a release the data does not name, and SHALL NOT assert that one event
caused another — a comparison either side of a date is permitted only as a neutral count, with no
causal claim in the words.

When the team has **no cycle in progress**, the timeline SHALL not render at all.

#### Scenario: Deployments and rituals are drawn where they happened

- **WHEN** a team with a cycle in progress has deployed several times during it and closed a retrospective inside it
- **THEN** the timeline draws one mark per successful deployment at its own moment, a mark at the retrospective's close naming that retrospective, a called-out deployment naming what the deployment row carries and how many went out that week, and a today marker stating the day of the cycle and the days remaining

#### Scenario: No annotation is invented

- **WHEN** a deployment row carries no reference or name
- **THEN** the call-out says only that a deployment went out, and no release name, version or title is asserted

#### Scenario: No causal claim is made

- **WHEN** the timeline reports deployment counts either side of a closed retrospective
- **THEN** the words state the two counts and the date, and claim no effect of the retrospective on them

#### Scenario: No cycle in progress

- **WHEN** the team has no cycle in progress
- **THEN** the timeline does not render, and the page's numbers still read

### Requirement: Open to merged is drawn as a distribution, with the median where it falls

The Delivery view SHALL draw the open→merged durations of the window's merged changes as a
**distribution** on a linear axis from zero to the largest observed duration: one mark per merged
change, positioned by its own duration.

The **median SHALL be drawn at its own position on that axis** and SHALL be the same value the page
states as a number elsewhere — never a second computation, and never a figure quoted from a summary
while the marks are drawn from another population.

The chart SHALL state **what one mark represents**, and one mark SHALL be one merged pull request: a
pull request linked to more than one issue in scope SHALL be drawn once and counted once. Marks at
the extreme of the axis SHALL be called out with the count and the fact, stated in words.

The axis SHALL remain linear and SHALL include the extremes; no mark SHALL be clipped, bucketed or
rescaled away.

The chart's callouts SHALL stay **legible at every data shape**. Two callouts SHALL NOT be drawn on
one baseline unless a stated minimum separation holds between them; where it does not, a callout
SHALL be drawn on its own baseline instead. Separation SHALL be decided by a single derivation over
the callouts' drawn positions and estimated widths, and that estimate SHALL NOT under-measure any
type face the product's presets bind to the mono role. This SHALL hold when the median sits close to
the outlier group, when the population has no outliers, when the crowd is compressed at the left of
the axis, and when a callout would otherwise read off the edge of the drawing.

#### Scenario: The median is a position, not a quotation

- **WHEN** a member reads the distribution
- **THEN** the median is drawn at its own place on the axis, and the value drawn there is the same value the page's number states

#### Scenario: One mark is one merged change

- **WHEN** a merged pull request is linked to two issues that both touched the window
- **THEN** the distribution draws exactly one mark for it, the chart states that one mark is one merged pull request, and the number of marks equals the number of distinct merged pull requests in the window

#### Scenario: The outliers are named rather than hidden

- **WHEN** the window contains changes that took far longer than the rest
- **THEN** they are drawn at their true position on a linear axis and called out in words with their count, and the axis is neither clipped nor rescaled to hide them

#### Scenario: Two callouts never run together

- **WHEN** the crowd callout and the outlier callout would be drawn closer than the stated minimum separation on one baseline — including when a long axis pushes the median callout and the outlier callout to nearly touch
- **THEN** the outlier callout is drawn on its own baseline, and neither callout's text overlaps or abuts the other's

#### Scenario: A population with no outliers draws one callout, undisturbed

- **WHEN** no merged change in the window qualifies as an outlier
- **THEN** exactly one callout is drawn, on the drawing's own baseline, and it is not displaced by a separation rule with nothing to separate it from

### Requirement: Cycle flow is drawn as bars with the carried work flowing between them

The Delivery view SHALL draw one bar per cycle in the window showing what that cycle shipped, with
**carried work drawn as a connection between the cycle it left and the cycle it entered**, and with
work **added after a cycle started** drawn as a distinct cap on that cycle's bar. The section's
standfirst SHALL state the carryover trend the data shows.

#### Scenario: Carried work is drawn as flow, not as a separate number

- **WHEN** a cycle in the window carried work into the next cycle in the window
- **THEN** a connection is drawn between those two bars carrying the count, the receiving cycle's added-after-start work is drawn as a distinct cap, and the standfirst states what the carryover trend is doing

#### Scenario: Nothing to flow

- **WHEN** no cycle in the window carried work and none had work added after it started
- **THEN** the bars are drawn without connections or caps, and no zero-valued connection or empty cap is drawn

### Requirement: Review rhythm is drawn as one small multiple per change

The Delivery view SHALL draw, for each merged change in the window up to a stated cap, a small
multiple showing that change's own rhythm: **opened → first review → each subsequent review →
merged**. The section's standfirst SHALL state what the rhythm shows across the window — how quickly
a first look typically arrives and how many rounds typically follow.

The cap SHALL be published with the count drawn, so the section states how many of how many it is
showing rather than silently truncating. **No reviewer SHALL be identified** on any of these
drawings, in any form.

#### Scenario: Each change draws its own rhythm

- **WHEN** the window contains merged changes with reviews
- **THEN** each drawn change shows its open moment, its first review, its subsequent reviews and its merge, and the standfirst states the window's first-review and rounds medians

#### Scenario: The cap is stated

- **WHEN** the window contains more merged changes than the section draws
- **THEN** the section states how many of how many it is showing

#### Scenario: No reviewer is named

- **WHEN** the reviews behind these drawings were submitted by real provider accounts
- **THEN** no name, login, handle or avatar appears on the page, and no drawing is attributable to a person

### Requirement: One peek on the page, answering "what is this?"

The Delivery view SHALL draw at most **one** peek, and among the product's pages it is the page that
draws one. Its trigger SHALL be an issue chip on the timeline drawn for a change whose reality and
whose board state disagree, and the peek SHALL answer *what is this?* using that issue's own phrase
from the shared dictionary and its reality drawing — introducing no new sentence of its own.

Pressing **Enter** SHALL navigate to the issue; pressing **Escape** SHALL close the peek, return
focus to the chip and leave the reader on the page.

#### Scenario: The chip answers the question without leaving the page

- **WHEN** a member focuses or hovers the issue chip on the timeline
- **THEN** one peek opens carrying that issue's phrase and its reality drawing, and no other peek is open on the page

#### Scenario: Enter goes, Escape stays

- **WHEN** the peek is open and the member presses Enter
- **THEN** the page navigates to that issue; and **WHEN** the member presses Escape instead, the peek closes, focus returns to the chip, and the page does not navigate

### Requirement: Every metric definition keeps exactly one home on the page

Every metric defined in the shared measurement layer SHALL be rendered somewhere on the Delivery
view — as a stated number, as a drawn mark, as a section standfirst's subject, or inside a `how ·`
derivation — and the mapping from definition to place SHALL be **total**: no definition may be
absent, and none may be drawn in two places as two different readings.

A redraw of this page SHALL NOT drop a metric definition silently. If a definition is genuinely
retired, it SHALL be removed from the shared measurement layer rather than left defined and
undrawn.

#### Scenario: The redraw loses no signal

- **WHEN** the set of metric definitions in the shared measurement layer is compared against the assembled page
- **THEN** every definition is accounted for exactly once, and no definition is defined but undrawn
