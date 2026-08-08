## MODIFIED Requirements

### Requirement: Status glyphs and priority marks as themed components

`packages/ui` SHALL provide status glyph components (backlog, todo, in-progress, in-review, done, canceled) and priority mark components (no-priority, low, medium, high, urgent) as themed components that draw their colors from the semantic status/signal tokens, kept separate from the brand accent so the accent never denotes status. Each glyph MUST carry an accessible label describing the state it represents.

Both SHALL be drawn to the reality vocabulary's single geometry — round-capped strokes of one weight on one grid — so that the whole drawn set reads as one family: the status glyph draws **cycle position** (one loop filled as far as the work has run) and the priority mark draws **weight as ticks**, with one tick standing alone denoting urgent. The `done` glyph SHALL be a filled disc **carrying a check**, drawn on the same grid with the same cap style, its ink taken from a theme token that is distinguishable from every hue the glyph is inked with under every preset in light and dark. There SHALL be exactly one status glyph component and exactly one priority mark component in the system; a surface needing a different size scales the existing one rather than declaring its own.

#### Scenario: Status colors come from status tokens

- **WHEN** a status glyph or priority mark renders under any preset
- **THEN** its color resolves from the semantic status/signal tokens, never from the brand accent token

#### Scenario: Done is a disc with a check in it

- **WHEN** the done status glyph renders at any size a surface draws it
- **THEN** it draws a filled disc with a check inside, the check inked from a theme token rather than a literal color, and no surface substitutes a plain disc for it

#### Scenario: Glyphs are labelled for assistive tech

- **WHEN** a status glyph or priority mark is rendered
- **THEN** it exposes an accessible label naming the status or priority it represents

#### Scenario: The glyphs share one geometry

- **WHEN** a status glyph and a priority mark render beside each other
- **THEN** both are drawn with the same stroke weight, the same cap style and on the same grid, so they read as one family rather than two borrowed sets

### Requirement: Issue-row primitive with reserved reality-track slot

`packages/ui` SHALL provide an issue-row primitive styled to the Warm mockup's density and layout (priority · status · key · title · a reserved reality-track slot · labels · cycle · date · assignee), reading tokens only. The reality-track slot SHALL be a first-class slot the primitive always lays out; with nothing to draw it SHALL render **reserved and inkless**, and the issue-list and issue-detail surfaces populate it from the delivery-signal computation seam, which the connector-fed work-graph entities make non-null. The row MUST support hover, keyboard-focus, and selected states drawn from the accent tokens, and MUST be focusable and operable by keyboard.

The primitive SHALL NOT carry a separate divergence-flag slot: divergence is drawn as the `//` break on the track itself (see the reality-vocabulary capability), and the primitive SHALL NOT render a warning symbol for it.

`packages/ui` SHALL NOT declare any provider-icon rendering of delivery reality — no pull-request lifecycle icon set, no CI check/cross/spinner icon set, and no deploy icon. Where a surface previously drew those, it draws the track.

#### Scenario: Reserved slots are present but quiet

- **WHEN** an issue-row primitive renders with no linked delivery data
- **THEN** the reality-track slot occupies its reserved measure in the layout, draws no ink at all, and the row layout does not shift when it is populated

#### Scenario: Divergence needs no second slot

- **WHEN** an issue-row primitive renders an issue whose status diverges from git reality
- **THEN** the divergence is visible as the break on the row's track, and the row lays out no separate divergence-flag slot and draws no warning symbol

#### Scenario: Row states use accent tokens

- **WHEN** an issue row is hovered, keyboard-focused, or selected
- **THEN** its hover fill, focus rail, and selected tint/border resolve from the accent tokens under the active preset

#### Scenario: Row is keyboard-focusable

- **WHEN** a user moves focus to an issue-row primitive via the keyboard
- **THEN** the row receives a visible accent focus indicator and is operable without a pointer
