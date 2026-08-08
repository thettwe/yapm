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

### Requirement: Status is cycle position and priority is weight, drawn to one geometry

The status glyph SHALL draw **cycle position** — one loop filled as far as the work has run: backlog
a dashed ring, todo an open ring, in-progress a half arc, in-review a three-quarter arc, and done a
filled disc **carrying a check**. The priority mark SHALL draw **weight** as ticks, with unfilled
ticks quieted rather than absent, and with one tick standing alone denoting urgent.

Both SHALL be drawn to a single geometry — round-capped strokes of one weight on one grid — so that
they read as one family. The check inside the done disc SHALL be drawn on that same grid with round
caps, SHALL take its ink from a theme token rather than a literal colour, and SHALL remain legible
at the smallest size any surface renders the glyph at. There SHALL be exactly one status glyph
component and exactly one priority mark component in the system; a surface that needs a different
size SHALL scale the existing one.

Each SHALL carry an accessible label naming the state or weight it represents, and each SHALL be
distinguishable without color.

#### Scenario: Status reads as progress around one loop

- **WHEN** the status glyph renders across backlog, todo, in-progress, in-review and done
- **THEN** each draws the same loop filled progressively further, so the sequence reads as position in a cycle rather than five unrelated symbols

#### Scenario: Done carries a check

- **WHEN** the status glyph renders done
- **THEN** it draws a filled disc with a check inside it, drawn on the shared grid with round caps and inked from a theme token, and the check is distinguishable from the disc under every preset in light and dark

#### Scenario: Done reads as done at the smallest size drawn

- **WHEN** the done glyph renders at the smallest size any surface draws it — a dense list row's default, and the smaller chip a transient surface draws
- **THEN** the check is still drawn rather than degrading to a plain disc

#### Scenario: Urgent priority is one tick standing alone

- **WHEN** the priority mark renders for urgent
- **THEN** it draws a single standing tick rather than a filled badge, and it carries the urgent token color

#### Scenario: No third glyph set exists

- **WHEN** any surface needs a status or priority mark
- **THEN** it renders the one shared component, and no surface declares its own status or priority drawing

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

A horizontal track SHALL be exposed as a single labelled image whose label states the facts it
draws, including the divergence sentence when the break is present. A track that draws no ink SHALL
NOT be exposed as an image at all. A vertical rail whose stations carry real label and fact text
SHALL be exposed as a list of stations rather than one opaque image, so a screen reader reads the
stations rather than a summary of them.

#### Scenario: Contrast holds in every theme

- **WHEN** the vocabulary renders under any theme preset in light or dark
- **THEN** every node, segment, break and fact line meets its contrast bar against the surface it is drawn on

#### Scenario: A hue that is both a mark and an ink meets both bars

- **WHEN** a status hue inks both a drawn mark and text-sized type
- **THEN** either that one token meets 4.5:1 in every theme block, or a separate ink token exists that does, and each token meets the bar for the way it is drawn

#### Scenario: The horizontal track states its facts

- **WHEN** a screen reader reaches a horizontal reality track that draws at least one fact
- **THEN** it announces one label naming the pull request state, CI health, deployment fact and review age it draws, plus the divergence sentence when the break is present

#### Scenario: The vertical rail reads its stations

- **WHEN** a screen reader reaches a vertical delivery rail
- **THEN** it announces the stations as a list, reading each station's label and fact line, rather than a single summarized image
