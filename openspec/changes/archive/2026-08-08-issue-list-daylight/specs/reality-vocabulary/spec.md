## ADDED Requirements

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
