## ADDED Requirements

### Requirement: A drawing states its own key, on its marks

Every quantity a drawing on this page carries SHALL be named **on the drawing**, in the label
register, so that a reader who has not opened a `how ·` and has not read a legend can say what each
mark counts. A drawing SHALL NOT depend on its `role="img"` label, on a `how ·` panel, or on a
legend elsewhere on the page for a reader to know what its ink means.

A quantity SHALL be named **once**: on the first mark of that kind in the drawing's reading order
**that actually draws the mark the name would point at**. Every remaining mark of that kind SHALL
carry the bare value. A name repeated on every mark of a kind is an ornament, and SHALL NOT be drawn.

This requirement fixes that a name is drawn **once**; it does not have the last word on **which**
mark carries it. Where a requirement for a particular drawing states its own deterministic rule for
choosing the named mark — because the first mark in reading order does not draw what the name would
point at — **that rule governs, and this requirement defers to it**. A selection made under such a
rule SHALL be read as satisfying "once, in reading order" rather than as departing from it. What no
drawing may do under this deferral is name the quantity more than once, or leave a drawn quantity
unnamed because its own rule selected nothing.

A name SHALL be attached to the mark it names — inside the mark's own label, on the mark, or
immediately at it. A **legend** — a key detached from the ink it explains, drawn as its own block,
row or swatch table — SHALL NOT be drawn, and this requirement SHALL NOT be read as licence for one.
An axis unit SHALL ride inside the tick's own label rather than as an axis title.

Where a drawing carries a fact that **no mark on it can state** — most obviously what one whole row,
bar or dot *is* — that fact SHALL be stated in the section's label line, in the label register, and
SHALL NOT be expanded into a sentence. A section whose marks already state it SHALL NOT restate it
there.

Where a scale governs the drawing, that scale SHALL be stated at rest, drawn once, as ticks carrying
their unit rather than as a sentence or an axis title.

Every mark and label this requirement adds SHALL take its colour, size and face from the design
tokens, correct in all six theme blocks at the bars this capability already requires, and SHALL NOT
introduce a token or a ground that is not already asserted for this page's drawings.

#### Scenario: A quantity is named once and then drawn bare

- **WHEN** a drawing carries several marks of one kind — several bars, several ribbons, several caps
- **THEN** the first of them in reading order carries the quantity's name beside its value, every later one carries the value alone, and the name appears nowhere else on the drawing

#### Scenario: A drawing's own selection rule decides which mark is named

- **WHEN** a drawing's own requirement states a deterministic rule that skips the first mark in reading order, because that mark does not draw the thing the name would point at
- **THEN** the name is drawn on the mark that rule selects, it is still drawn exactly once, and no second mark of that kind carries it

#### Scenario: The eye is told what assistive technology is told

- **WHEN** a drawing's `role="img"` label states what one of its marks represents
- **THEN** that fact is also legible at rest without assistive technology — on the marks, or in the section's label line where no mark can carry it — so the two readings do not differ

#### Scenario: No key is drawn away from the ink it explains

- **WHEN** a drawing needs its marks explained
- **THEN** the explanation is drawn on the marks themselves, and no legend block, swatch row, key panel or axis title is drawn beside the drawing

#### Scenario: A scale is stated once, in ticks

- **WHEN** a drawing places its marks against a fixed scale
- **THEN** that scale is drawn once as ticks whose labels carry the unit, and the scale is not left to a `how ·` panel or to the drawing's accessible label alone

#### Scenario: The section label line says only what no mark can

- **WHEN** a section's marks already name every quantity they carry
- **THEN** its label line states nothing further about the marks, and the label line is used only for a fact no mark on the drawing could state

## MODIFIED Requirements

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

"Labels and drawn marks" SHALL be read as **permitting a name drawn on a mark**. A name on a mark —
a bar's count stated with its unit, a tick label carrying its unit, a segment end named where it
falls — is a label, not a legend and not an explanation: it says what the ink *is*, never how the
number behind it was derived. What this requirement forbids beside a drawing is a **detached** key —
a legend block, a swatch row, an axis title, a caption sentence or a derivation footnote — because a
key drawn away from its ink is a second thing to hold in memory, which is the cost the label register
exists to avoid. A section SHALL NOT use this permission to reintroduce a sentence: a name on a mark
is a label, and the standfirst remains the only full sentence the section draws.

#### Scenario: A section states its finding before it draws it

- **WHEN** a member reads a section of the Delivery view that has data
- **THEN** the first thing in it is one sentence stating what the data says, the drawing follows, and no legend, axis title or derivation footnote appears beside the drawing

#### Scenario: A standfirst tracks the data

- **WHEN** the underlying rows change such that the finding a standfirst states is no longer true
- **THEN** the standfirst states the new finding, because it is derived rather than authored

#### Scenario: A derived number explains itself only when asked

- **WHEN** a member activates the `how ·` beside a derived number
- **THEN** its derivation and the constraints it was computed within appear; and **WHEN** the member dismisses it, the number is left with no explanation beside it

#### Scenario: A name on a mark is a label, not a legend

- **WHEN** a drawing names a quantity on the mark that carries it — a count stated with its unit, a tick label carrying its unit, a segment end named where it falls
- **THEN** that is permitted as a label, no detached legend, swatch row or axis title is drawn beside the drawing, and the section still draws exactly one full sentence, its standfirst

### Requirement: Cycle flow is drawn as bars with the carried work flowing between them

The Delivery view SHALL draw one bar per cycle in the window showing what that cycle shipped, with
**carried work drawn as a connection between the cycle it left and the cycle it entered**, and with
work **added after a cycle started** drawn as a distinct cap on that cycle's bar. The section's
standfirst SHALL state the carryover trend the data shows.

Each of the three quantities this drawing carries — what a cycle shipped, what carried between two
cycles, what arrived after a cycle started — SHALL be **named once, on the first mark of its kind
that is actually drawn, in reading order**, and every later mark of that kind SHALL carry the bare
value. The three names are chosen independently, because a window may draw bars with no ribbon and
no cap at all.

A cycle whose shipped count is **zero** SHALL draw a mark at the baseline rather than nothing, so
that a measured zero is distinguishable from a column that drew no ink. That mark is neither a
connection nor a cap.

This section SHALL NOT draw a value axis. Every bar states its own exact count beneath it, and the
bars' heights are scaled by a drawing constant rather than by a measured unit, so an axis would
present a layout choice as a scale and would approximate a number the drawing already states.

#### Scenario: Carried work is drawn as flow, not as a separate number

- **WHEN** a cycle in the window carried work into the next cycle in the window
- **THEN** a connection is drawn between those two bars carrying the count, the receiving cycle's added-after-start work is drawn as a distinct cap, and the standfirst states what the carryover trend is doing

#### Scenario: Nothing to flow

- **WHEN** no cycle in the window carried work and none had work added after it started
- **THEN** the bars are drawn without connections or caps, and no zero-valued connection or empty cap is drawn

#### Scenario: The three quantities name themselves, once each

- **WHEN** a window draws several bars, several connections and several caps
- **THEN** the first bar's count states what it counts, the first connection states what it carries, the first cap states what arrived late, and every later bar, connection and cap carries only its number

#### Scenario: A window with nothing carried still names what its bars count

- **WHEN** no cycle in the window carried work, so no connection is drawn
- **THEN** the first bar still states what its count counts, and no name is drawn for a mark that does not exist

#### Scenario: A cycle that shipped nothing is drawn, not skipped

- **WHEN** one cycle in the window shipped nothing while the cycles around it shipped work
- **THEN** that cycle draws a mark at the baseline under its own label, its stated count reads zero, and the drawing does not present it as a column that failed to render

### Requirement: Review rhythm is drawn as one small multiple per change

The Delivery view SHALL draw, for each merged change in the window up to a stated cap, a small
multiple showing that change's own rhythm: **opened → first review → each subsequent review →
merged**. The section's standfirst SHALL state what the rhythm shows across the window — how quickly
a first look typically arrives and how many rounds typically follow.

The cap SHALL be published with the count drawn, so the section states how many of how many it is
showing rather than silently truncating. **No reviewer SHALL be identified** on any of these
drawings, in any form.

The axis these small multiples are drawn against SHALL be stated **at rest, on the drawing**, as
ticks carrying their unit, drawn once rather than once per row. Stating it only inside the section's
`how ·` or inside the drawing's accessible label SHALL NOT satisfy this.

Exactly one small multiple SHALL be drawn as a **worked example**, naming its own marks where they
fall: where the change opened, and where it merged. That row SHALL be chosen by a stated
deterministic rule over the data, and SHALL be one that actually draws the marks being named — a
change that ran past the axis draws no merge mark and SHALL NOT be chosen for one. **This is the
selection rule the once-named requirement defers to for this drawing**: it decides which small
multiple carries the names, and the once rule decides that only one does. Every other small
multiple SHALL be drawn bare. Where two names on the worked example would not clear a stated minimum
separation, the drawing SHALL drop a name rather than draw two that run together, decided by a single
derivation over the names' drawn positions and estimated widths.

What **one row** represents SHALL be stated at rest in the section's label line, beside the count
drawn, because no mark inside a row can state what the whole row is.

#### Scenario: Each change draws its own rhythm

- **WHEN** the window contains merged changes with reviews
- **THEN** each drawn change shows its open moment, its first review, its subsequent reviews and its merge, and the standfirst states the window's first-review and rounds medians

#### Scenario: The cap is stated

- **WHEN** the window contains more merged changes than the section draws
- **THEN** the section states how many of how many it is showing

#### Scenario: No reviewer is named

- **WHEN** the reviews behind these drawings were submitted by real provider accounts
- **THEN** no name, login, handle or avatar appears on the page, and no drawing is attributable to a person

#### Scenario: The scale is on the page, not only in the fold

- **WHEN** a member reads this section without opening its `how ·`
- **THEN** the axis the small multiples are drawn against is stated on the drawing as ticks carrying their unit, drawn once for the section rather than under every row

#### Scenario: One worked example, and the rest bare

- **WHEN** the section draws several small multiples
- **THEN** exactly one of them carries names at its own marks saying where the change opened and where it merged, that one is selected by a stated rule over the data, and every other row carries no name at all

#### Scenario: A row that ran past the axis is never the worked example

- **WHEN** the newest drawn change ran past the axis, so it draws an arrow and its own duration instead of a merge mark
- **THEN** it is not chosen as the worked example, and the row chosen is one whose named marks are actually drawn

#### Scenario: What one row is, said where the eye can read it

- **WHEN** a member looks at this section at rest
- **THEN** the section's label line states that one row is one merged pull request, beside how many of how many are drawn, rather than leaving that fact to the drawing's accessible label alone
