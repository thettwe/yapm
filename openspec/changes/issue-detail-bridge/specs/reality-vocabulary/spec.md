## ADDED Requirements

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
