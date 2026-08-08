# reality-vocabulary Specification

## Purpose
The one drawn language every yapm surface uses to say what is true about a change: pull request, CI
and deploy reality as a track of stations with a `//` break where the board and git disagree, status
as cycle position, priority as weight. It also owns the shared patterns that language depends on —
the peek, the `how ·` footnote, the phrase dictionary every surface speaks at rest, and the rule
that a provider's mark carries provenance, never meaning. Archived from change
one-reality-vocabulary (PR #32) and extended by issue-list-daylight (PR #34) and
issue-detail-bridge (PR #35).

## Requirements

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

- **WHEN** a surface renders an issue with no linked git entities
- **THEN** the track renders in its empty state, reserving the same space as a populated track, and the surface's alignment does not shift when a signal later arrives

### Requirement: The track composes into every surface's shape from one implementation

The track SHALL be a **single implementation** whose orientation, width and station set are
composable by the calling surface. It SHALL support at minimum: a compact horizontal track on a
dense list row, the same horizontal track at a wider measure, and a **vertical rail** whose stations
each carry a label line and a fact line.

The node kinds, the segment kinds, the station shape and the shape builder SHALL be exported, so a
surface can compose a track from its own station set rather than accepting one fixed widget. The
break SHALL be a property of the computed shape — a segment kind — not a special-cased index and not
a boolean that discards the underlying facts.

There SHALL be exactly one type describing the delivery facts a track is drawn from, shared by the
derivation layer and the drawing layer. Two structurally identical, independently declared types for
the same four facts SHALL NOT exist.

#### Scenario: A dense row and a wide row use the same component

- **WHEN** a dense list row and a wider row each render a track at their own measure
- **THEN** both render from the same track implementation with the same node and segment vocabulary, differing only in the width they are given

#### Scenario: The vertical rail is the same track

- **WHEN** a surface renders the delivery rail as a vertical chain of stations, each with a label and a fact line
- **THEN** it renders from the same track implementation and the same node/segment/break vocabulary as the horizontal track

#### Scenario: A surface composes its own stations

- **WHEN** a surface needs a station set other than the default four
- **THEN** it composes that station set from the exported station and node types, without forking the track implementation

### Requirement: The track draws only these four facts, and never claims what the data cannot say

A track SHALL be drawn from exactly four facts and no others: pull request state (draft, open,
merged or closed, plus an approved state synthesized from the newest review), CI health derived from
the stored check conclusion, review age, and the deployment fact (a deployment carrying the linked
pull request's merge commit, matched on repository **and** merge commit, taking the earliest
success).

The following SHALL NOT be drawn or stated anywhere in this vocabulary, because the stored data
cannot support them:

- **How long checks took.** The stored check row carries no start or finish time — only a last-updated
  moment. How long a check has been red IS computable and MAY be stated; how long a check ran is NOT
  and SHALL NOT be.
- **That a review has been awaited since a specific request.** No review-requested event is stored,
  so "waiting on a reviewer since X" is indistinguishable from "the PR has been open since X".
  Review age SHALL fall back to the pull request's open time, and no station or fact line SHALL
  claim a reviewer was asked.
- **Which environment is production.** The deployment fact SHALL NOT name an environment.

A deployment SHALL NOT be matched by branch head commit. A track SHALL show nothing in the
deployment position when no deployment carried the merge commit, rather than an
absence-of-deployment marker.

#### Scenario: The vocabulary never reports check duration

- **WHEN** a track or its fact lines describe a failing check
- **THEN** they may state how long it has been failing, and they state nothing about how long the check ran

#### Scenario: Review age does not claim a reviewer was asked

- **WHEN** a pull request is open and has received no review
- **THEN** the review age is measured from the pull request's open time and the surface does not say a reviewer is being waited on

#### Scenario: A deployed branch is not a deployed merge

- **WHEN** a deployment carries the branch head commit of a merged pull request but not its merge commit
- **THEN** the deployment position stays empty and the surface asserts nothing about production

### Requirement: Status is cycle position and priority is weight, drawn to one geometry

The status glyph SHALL draw **cycle position** — one loop filled as far as the work has run: backlog
a dashed ring, todo an open ring, in-progress a half arc, in-review a three-quarter arc, and done a
filled disc. The priority mark SHALL draw **weight** as ticks, with unfilled ticks quieted rather
than absent, and with one tick standing alone denoting urgent.

Both SHALL be drawn to a single geometry — round-capped strokes of one weight on one grid — so that
they read as one family. There SHALL be exactly one status glyph component and exactly one priority
mark component in the system; a surface that needs a different size SHALL scale the existing one.

Each SHALL carry an accessible label naming the state or weight it represents, and each SHALL be
distinguishable without color.

#### Scenario: Status reads as progress around one loop

- **WHEN** the status glyph renders across backlog, todo, in-progress, in-review and done
- **THEN** each draws the same loop filled progressively further, so the sequence reads as position in a cycle rather than five unrelated symbols

#### Scenario: Urgent priority is one tick standing alone

- **WHEN** the priority mark renders for urgent
- **THEN** it draws a single standing tick rather than a filled badge, and it carries the urgent token color

#### Scenario: No third glyph set exists

- **WHEN** any surface needs a status or priority mark
- **THEN** it renders the one shared component, and no surface declares its own status or priority drawing

### Requirement: The drawn primitives live in one shared module

The drawn primitives — the day band, the scope band, the check tick bar, the triage dots, the
reality track, and the cadence chart — SHALL live in one shared module that every page imports.
They SHALL take plain structural props and SHALL NOT depend on an application route, a query, or a
page's local state.

No duplicate implementation of any of these primitives SHALL exist anywhere in the repository.

#### Scenario: Every page imports the same primitive

- **WHEN** two different pages render the same drawn primitive
- **THEN** both import it from the one shared module

#### Scenario: No page keeps a private copy

- **WHEN** the repository is searched for a second implementation of any drawn primitive
- **THEN** none exists — the page-local copies are removed rather than left as duplicates or re-export shims

### Requirement: The peek — one open at a time, opened by hover or focus, escapable

Anything drawn with the dotted affordance SHALL open something. The system SHALL provide a **peek**:
a transient panel that answers "what is this?" without leaving the page.

A peek SHALL open on pointer hover **or** on keyboard focus of its trigger. Pressing **Enter** SHALL
navigate to the thing the peek describes; pressing **Escape** SHALL close the peek and leave the
page, returning focus to the trigger.

**At most one peek SHALL be open on a page at any time**, and that SHALL be enforced by the
component's own state rather than by convention: opening a second peek closes the first by
construction.

A peek MAY be elevated. Transients SHALL be the only elevated surfaces in this language.

The peek SHALL be announced honestly to assistive technology: its trigger SHALL expose its expanded
state, and the panel SHALL carry an accessible name identifying what it describes. The peek SHALL
NOT trap focus — the page's focus order is preserved, which is what "Enter goes, Escape stays"
means.

#### Scenario: Keyboard focus opens the peek

- **WHEN** a user moves keyboard focus onto a dotted trigger
- **THEN** its peek opens, with no pointer involved

#### Scenario: Enter goes, Escape stays

- **WHEN** a peek is open and the user presses Enter
- **THEN** the page navigates to the thing the peek describes; and **WHEN** the user presses Escape instead, the peek closes, focus returns to the trigger, and the page does not navigate

#### Scenario: A second peek cannot open

- **WHEN** one peek is open and the user hovers or focuses a second dotted trigger on the same page
- **THEN** the first peek closes as the second opens, and exactly one peek is open

#### Scenario: The peek is the only elevated surface

- **WHEN** a page renders a peek over its work surface
- **THEN** the peek carries elevation and the work surface beneath it does not

### Requirement: The how — a derived number never explains itself at rest

A derived number SHALL NOT carry its derivation as visible text at rest. It SHALL carry a quiet mono
`how ·` affordance instead. Opening the affordance SHALL reveal the derivation; closing it SHALL
return the surface to quiet. Facts stay on the surface; footnotes fold.

The affordance SHALL be a real focusable control, operable and closable from the keyboard alone,
exposing its expanded state to assistive technology, with Escape closing it and returning focus.

#### Scenario: At rest the surface is quiet

- **WHEN** a surface renders a derived number
- **THEN** the number and its unit are visible and its derivation is not — only the mono `how ·` affordance is

#### Scenario: The derivation opens and closes from the keyboard

- **WHEN** a user focuses the `how ·` affordance and activates it, then presses Escape
- **THEN** the derivation appears and then folds away, focus returns to the affordance, and the surface is quiet again

### Requirement: Provenance marks carry source, never meaning

The system's own glyphs carry meaning; a provider's brand mark carries **provenance** and nothing
else. A provenance mark SHALL be monochrome, drawn at 12–14px in the current text color, and placed
**after** the fact it sourced.

A provenance mark SHALL NOT replace a status glyph or any node of the reality track, SHALL NOT be
rendered in a brand color, and SHALL NOT be drawn larger than the text it follows.

Provenance marks SHALL be rendered through one shared component whose interface makes those rules
structural rather than advisory, and whose provider set is additive — adding a second provider SHALL
require no change to any calling surface.

A design artifact that is a **link** SHALL wear its source's mark; a design artifact that was
**uploaded** SHALL carry no mark at all, and the component SHALL offer no way to give it one.

#### Scenario: The mark follows the fact

- **WHEN** a surface states a fact sourced from a connected provider
- **THEN** the provider's monochrome mark is drawn after that fact, in the current text color, no larger than the text

#### Scenario: A mark never carries state

- **WHEN** a surface renders both a status glyph and a provenance mark for the same item
- **THEN** the status glyph carries the state and the provenance mark carries only the source, and the mark is not colored to imply a state

#### Scenario: An upload carries no mark

- **WHEN** a design artifact was uploaded rather than linked
- **THEN** it renders with no provider mark, and no provider value exists that would give it one

### Requirement: The vocabulary is correct in every theme and readable by assistive technology

Every element of this vocabulary SHALL resolve from theme tokens and SHALL be correct in every
theme preset in both light and dark. Drawn, non-text elements SHALL meet the 3:1 non-text contrast
bar and text-sized elements — including the `//` break mark and any mono fact line — SHALL meet the
4.5:1 text bar, against every surface they are drawn on, in every theme block.

A horizontal track SHALL be exposed as a single labelled image whose label states the facts it
draws, including the divergence sentence when the break is present. A vertical rail whose stations
carry real label and fact text SHALL be exposed as a list of stations rather than one opaque image,
so a screen reader reads the stations rather than a summary of them.

#### Scenario: Contrast holds in every theme

- **WHEN** the vocabulary renders under any theme preset in light or dark
- **THEN** every node, segment, break and fact line meets its contrast bar against the surface it is drawn on

#### Scenario: The horizontal track states its facts

- **WHEN** a screen reader reaches a horizontal reality track
- **THEN** it announces one label naming the pull request state, CI health, deployment fact and review age it draws, plus the divergence sentence when the break is present

#### Scenario: The vertical rail reads its stations

- **WHEN** a screen reader reaches a vertical delivery rail
- **THEN** it announces the stations as a list, reading each station's label and fact line, rather than a single summarized image

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
neutral list can speak the same fact in their own voice. Every register SHALL be total over the
key set: a key that exists in one register SHALL exist in every register, and a register MAY
resolve a key to *silence* — a surface with nothing true to say for a row SHALL render nothing
there rather than filler.

A phrase SHALL be real text, never an icon-only signal, so it is readable by assistive
technology and by a reader who cannot distinguish the drawing's hues.

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
- **THEN** every register defines that key — either as text or explicitly as silence — and a
  register missing it is a failure, not a fallback

#### Scenario: A phrase never claims a fact the data lacks

- **WHEN** an issue's review age is measured from the pull request's open time because no
  review has been submitted
- **THEN** the phrase states that the change is awaiting review rather than that a reviewer has
  been waiting, and a returned review is phrased distinctly from an unreviewed one

### Requirement: Only check and deploy phrases carry a provenance mark

A phrase at rest SHALL carry a provenance mark only when the fact it states was **sourced from
a connected provider** — the check facts and the deployment fact. A phrase stating a fact yapm
itself derived — a divergence between a human status and git reality, a review age, a status
position — SHALL carry no mark.

Which phrases carry a mark SHALL be a property of the **dictionary entry**, not a decision each
calling surface makes, so two surfaces cannot disagree about whether a given phrase is sourced.

The mark SHALL be drawn through the shared provenance component under its existing rules:
monochrome, in the current text colour, after the fact it sourced, never replacing a status
glyph or a track node, and never larger than the text it follows.

#### Scenario: The check phrase wears the source's mark

- **WHEN** a surface renders the failing-checks phrase for an issue whose checks came from a
  connected provider
- **THEN** the provider's monochrome mark follows the phrase text, no larger than it, and does
  not replace the row's status glyph

#### Scenario: A derived phrase wears no mark

- **WHEN** a surface renders the divergence phrase for an issue whose status disagrees with git
- **THEN** no provenance mark is drawn beside it, because the divergence is yapm's own
  derivation rather than a provider's fact

#### Scenario: Surfaces cannot disagree about provenance

- **WHEN** the same phrase key is rendered on two different surfaces
- **THEN** both render the same provenance decision, because the decision is carried by the
  dictionary entry rather than by either surface

### Requirement: The vertical rail's stations come from one shared derivation and fold when unbacked

A surface drawing the delivery chain as the **vertical rail** SHALL take each station's sentence
and mono fact line from **one** shared derivation over the work graph, and SHALL NOT compose a
station's facts privately. There SHALL be exactly one such derivation in the product, so two
surfaces — or two regions of one surface — cannot date the same moment differently.

A station SHALL be drawn **only** when a durable stored timestamp supports it. A stage of the
delivery chain that no entity in this product backs SHALL fold away, and any header, chain summary
or accessible description accompanying the rail SHALL name only the stations actually drawn.

The rail SHALL announce itself to assistive technology as the ordered list of the stations it
drew. It SHALL NOT announce a station that folded, and SHALL NOT reduce the chain to a single
summary sentence that hides which stations exist.

A surface mounting the rail SHALL declare the surface it is drawn on, because the rail's node
haloes and its `//` break knock out that colour.

Work-graph placement: a derivation over linked `pull_request`, `review`, `ci_check` and
`deployment` rows plus the issue's own cycle-assignment and creation moments. Permission story:
unchanged — the rail draws rows the caller already syncs.

#### Scenario: A stage with no entity behind it folds

- **WHEN** a surface renders the rail for a chain whose middle stage has no backing entity in this
  product
- **THEN** that station is absent, and neither the rail's header nor its accessible description
  names it

#### Scenario: The rail announces the stations it drew

- **WHEN** a screen-reader user reaches a rail drawing three of its five possible stations
- **THEN** exactly those three stations are announced, in order, each with its own fact

#### Scenario: Two regions of one page agree

- **WHEN** a page draws both the rail and a written list of the same moments
- **THEN** each moment carries the identical timestamp in both, because both read the one
  derivation
