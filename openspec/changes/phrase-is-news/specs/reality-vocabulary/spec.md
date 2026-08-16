## MODIFIED Requirements

### Requirement: Delivery reality is drawn as one track-and-node language on every surface

The system SHALL draw delivery reality — pull request state, CI health, review age, and whether a
change reached production — as a **track of stations**: a node per station, a connector segment
between consecutive stations, and a mono `//` **break** on the segment where the board and git
disagree. This vocabulary SHALL be the only way any surface draws delivery reality. No surface
SHALL draw delivery reality as a strip of provider icons, and divergence SHALL NOT be drawn as a
warning symbol.

The node kinds SHALL be exactly: a completed station, an open station, a station waiting on review,
a failed station, an empty station, and an empty station under an urgent condition. The segment
kinds SHALL be exactly: solid, review, dotted, and broken. Every node and segment color SHALL
resolve from the semantic status/signal tokens, never from the brand accent.

A station's node SHALL state what the stored facts say about **that station** and no more. A
station SHALL NOT be drawn as completed for a change that has not reached it: a pull request that
has been approved but not merged has not landed, so the change station SHALL distinguish it from a
merged one rather than drawing both the same way. Where two classifications of the same four facts
differ, the drawn stations SHALL differ, so a reader can tell them apart without a phrase beside
the track.

Divergence SHALL be expressed by the position of the break, derived from **which** divergence fired
rather than drawn at a fixed position, so a reader can see where reality and the board parted.

An issue with **no linked git entities** produces a track carrying no fact and no break. In a dense
row context — the issue list row, the team home's rows, a board card — such a track SHALL **reserve
its full measure and draw no ink**: no station, no segment, no age text. Nothing on the surface
SHALL shift when a fact later arrives, so the reserved measure of an inkless track SHALL equal the
reserved measure of a populated one on the same surface, age column included. A track that carries
**any** fact or a break SHALL draw its empty stations and dotted segments as scaffolding between the
facts it does draw.

Because an inkless track states nothing, it SHALL state nothing to assistive technology either: it
SHALL NOT be exposed as an image and SHALL NOT carry an accessible label. The composed label
describing an absent signal remains available to surfaces that state that absence in words.

The **vertical rail** is excluded from this rule. A rail is drawn on a surface whose subject is the
change itself, so an issue with no linked change SHALL keep an explicit station saying so rather
than rendering blank.

#### Scenario: A linked change draws as a track, not as icons

- **WHEN** any surface renders an issue linked to a pull request
- **THEN** its delivery reality is drawn as nodes joined by segments, and no provider icon and no warning symbol is drawn in its place

#### Scenario: Divergence is the break

- **WHEN** a rendered issue's human-set status disagrees with git reality
- **THEN** the track carries the `//` break on the segment where the disagreement occurred, and no separate warning glyph is rendered

#### Scenario: The break moves with the reason

- **WHEN** a diverged issue's divergence is that the board is behind a merge, versus that the board claims done past a failing check
- **THEN** the break is drawn on a different segment in each case, reflecting where reality and the board parted

#### Scenario: An approved change is not drawn as a landed one

- **WHEN** two rows are drawn, one whose pull request is approved and unmerged and one whose pull request is merged with no deployment carrying its merge commit
- **THEN** their change stations draw different node kinds, and neither track can be mistaken for the other by its stations alone

#### Scenario: An unlinked issue draws the quiet empty track

- **WHEN** a dense row renders an issue with no linked git entities
- **THEN** the track's quiet empty state reserves its full measure and draws no ink — no station, no segment, no age text — and it is not exposed to assistive technology as an image

#### Scenario: A blank slot reserves exactly what a populated one does

- **WHEN** a row with no delivery signal and a row with a fully populated track are rendered at the same measure
- **THEN** both reserve the same width, age column included, and the row's layout is unchanged when a signal later arrives

#### Scenario: One fact is enough to draw the scaffolding

- **WHEN** a row renders an issue whose pull request is open but which has no deployment
- **THEN** the track draws the facts it has together with the empty stations and dotted segments between them, because the scaffolding joins facts rather than standing in for their absence

#### Scenario: The rail still says an unlinked issue is unlinked

- **WHEN** the issue detail renders an issue with no linked change
- **THEN** its vertical rail states that in a station rather than rendering blank

### Requirement: Phrases at rest come from one shared dictionary

A surface that states delivery reality in words SHALL take those words from **one** shared
phrase dictionary. There SHALL be exactly one such dictionary in the product, and it SHALL live
beside the delivery-signal seam rather than in any surface's own module, so no surface can
declare a second vocabulary for the same facts.

The dictionary SHALL be keyed by a **classifier over real predicates only** — the delivery
signal and the divergence computation — and SHALL NOT admit a phrase that no stored fact can
support. A classification with no supporting fact SHALL yield the quiet state, never an
invented sentence.

The dictionary MAY render one key in more than one **register**, so a personal digest and a
neutral list can speak the same fact in their own voice. A register is a voice **and** a policy
about when that voice speaks. Every register SHALL be total over the key set: a key that exists in
one register SHALL exist in every register, and a register SHALL resolve every key to exactly one
of three states:

- **drawn** — the register has words for this key and the surface renders them at rest;
- **quiet** — the register has words for this key and the surface does **not** render them, because
  the drawing beside them already carries the same fact. The words SHALL still exist, and SHALL be
  carried by the accessible name of that drawing, identical to the text the register would have
  drawn;
- **silent** — the register has nothing true to add for this key. A surface with nothing true to say
  for a row SHALL render nothing there rather than filler, and nothing is spoken either.

A register SHALL NOT resolve a key to **quiet** unless, on every surface that speaks that register,
the drawing beside the phrase distinguishes that key from every other key the register resolves to
quiet or silent. A phrase may only be taken off a surface where the drawing can say what it said;
where the drawing cannot, the register SHALL draw the words.

A phrase SHALL be real text — drawn, or spoken by the drawing that replaced it — and never an
icon-only signal, so it is readable by assistive technology and by a reader who cannot distinguish
the drawing's hues. Which of the three states a key takes SHALL be a property of the **dictionary
entry** for that register, never a decision a calling surface makes, so two surfaces speaking one
register cannot disagree about whether a fact is worth saying.

#### Scenario: Two surfaces speaking the same fact use the same dictionary

- **WHEN** the team home and the issue list both state that an issue's checks are failing
- **THEN** both phrases resolve from the same dictionary keyed by the same classifier, and no
  second phrase table exists in the product for that fact

#### Scenario: A register that has nothing to say says nothing

- **WHEN** a surface renders a row whose delivery signal supports no phrase in that surface's
  register
- **THEN** that row's phrase slot renders empty, with no placeholder text and no change to the
  row's alignment

#### Scenario: A register cannot go missing a key

- **WHEN** the dictionary is extended with a new phrase key
- **THEN** every register defines that key — as drawn text, as quiet words, or explicitly as
  silence — and a register missing it is a failure, not a fallback

#### Scenario: A quiet key keeps its words

- **WHEN** a register resolves a key to quiet and a surface renders a row classified to that key
- **THEN** the row draws no phrase, and the words the register holds for that key are stated by the
  accessible name of the drawing beside it, in exactly the text the register would have drawn

#### Scenario: Quiet is not silence

- **WHEN** every key of a register is enumerated
- **THEN** the keys resolved to quiet are distinguishable from the keys resolved to silence, and a
  key moving from quiet to silence — losing its words rather than only its ink — is a failure
  rather than an equivalent outcome

#### Scenario: A key the drawing cannot carry is never quieted

- **WHEN** two classifications produce the same drawing and a register would resolve both to quiet
- **THEN** that register is invalid: at least one of the two SHALL be drawn as text, because
  quieting both would leave the two rows saying nothing that tells them apart

#### Scenario: A phrase never claims a fact the data lacks

- **WHEN** an issue's review age is measured from the pull request's open time because no
  review has been submitted
- **THEN** the phrase states that the change is awaiting review rather than that a reviewer has
  been waiting, and a returned review is phrased distinctly from an unreviewed one

### Requirement: The vocabulary is correct in every theme and readable by assistive technology

Every element of this vocabulary SHALL resolve from theme tokens and SHALL be correct in every
theme preset in both light and dark. Drawn, non-text elements SHALL meet the 3:1 non-text contrast
bar and text-sized elements — including the `//` break mark and any mono fact line — SHALL meet the
4.5:1 text bar, against every surface they are drawn on, in every theme block.

Where **one status hue** is used both as non-text drawing and as text-sized ink, it SHALL either
meet the stricter of the two bars in every theme block, or SHALL be split into a drawn hue and a
separate ink token, each meeting its own bar. Which of the two was chosen SHALL be recorded with the
measurements that decided it. A contrast assertion SHALL NOT be written at a bar below the one the
usage requires in order to record a known failure; a measured failure is either fixed or the drawing
changes so the failing pair no longer carries the fact.

Contrast is not separability. The horizontal track's node kinds SHALL be told apart **without
colour**: for any two node kinds, at least one non-colour channel — whether the node is filled or
outlined, the form it is drawn in, or its stroke style — SHALL differ. Colour MAY reinforce a
distinction; it SHALL NOT be the only channel carrying one. The kinds' drawn forms SHALL be declared
as values the drawing derives from, so the property is asserted over the vocabulary rather than over
rendered pixels. The **vertical rail is excluded**: its stations carry a label line and a mono fact
line in text, so no reader depends on telling its nodes apart by eye.

A horizontal track SHALL be exposed as a single labelled image whose label states the facts it
draws, including the divergence sentence when the break is present. A track that draws no ink SHALL
NOT be exposed as an image at all. A vertical rail whose stations carry real label and fact text
SHALL be exposed as a list of stations rather than one opaque image, so a screen reader reads the
stations rather than a summary of them.

Where the surface's register resolved that row's phrase to **quiet**, the track's label SHALL lead
with the register's words for that key before the facts it draws, so the words a sighted reader no
longer sees are the first thing a screen reader hears. Where the register **drew** the phrase, the
label SHALL NOT repeat the register's words for it: a phrase stated in visible text beside the track
is heard once, not twice. The divergence sentence the break carries is a different sentence about a
different aspect and SHALL still be stated in the label; no surface SHALL pass a drawn phrase off as
that sentence. Where an explicit accessible name on an enclosing control suppresses the track's own
label, that enclosing name SHALL carry the register's words under the same two rules.

#### Scenario: Contrast holds in every theme

- **WHEN** the vocabulary renders under any theme preset in light or dark
- **THEN** every node, segment, break and fact line meets its contrast bar against the surface it is drawn on

#### Scenario: A hue that is both a mark and an ink meets both bars

- **WHEN** a status hue inks both a drawn mark and text-sized type
- **THEN** either that one token meets 4.5:1 in every theme block, or a separate ink token exists that does, and each token meets the bar for the way it is drawn

#### Scenario: No two node kinds are told apart by colour alone

- **WHEN** the horizontal track's six node kinds are compared pairwise with colour removed
- **THEN** each pair still differs in fill, form or stroke style, and a reader who cannot distinguish the hues can name every station

#### Scenario: The horizontal track states its facts

- **WHEN** a screen reader reaches a horizontal reality track that draws at least one fact
- **THEN** it announces one label naming the pull request state, CI health, deployment fact and review age it draws, plus the divergence sentence when the break is present

#### Scenario: The track speaks what the row went quiet about

- **WHEN** a screen reader reaches a row whose register resolved its phrase to quiet
- **THEN** the track's label leads with that register's words for the row's key, followed by the facts the track draws

#### Scenario: A drawn phrase is not heard twice

- **WHEN** a screen reader reaches any surface whose register drew its phrase as visible text beside the track — a list row, a board card, or a panel opened over one issue
- **THEN** the track's label states the facts it draws, together with the divergence sentence when the break is present, and nowhere repeats the register's words for the drawn phrase, so the phrase is announced once

#### Scenario: The vertical rail reads its stations

- **WHEN** a screen reader reaches a vertical delivery rail
- **THEN** it announces the stations as a list, reading each station's label and fact line, rather than a single summarized image
