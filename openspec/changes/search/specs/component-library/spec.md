## ADDED Requirements

### Requirement: Search result row and snippet renderer as strictly-tokenized components

The component library SHALL provide a search result row and a snippet renderer, both strictly
tokenized — no hardcoded colour, font, radius or spacing — and both data-agnostic, taking already
resolved display values so the library stays ignorant of queries, teams and permissions.

The result row SHALL render an entity glyph, an issue key in the mono token face, a title, an optional
snippet, and optional state labels (for example triage or canceled), truncating rather than wrapping,
at the same row density as the issue-row primitive. Its active state SHALL use the established
selection idiom — a soft accent wash plus an accent rule — with body ink rather than accent-coloured
text, because accent ink over the soft accent wash measures below AA in several preset and mode
combinations.

The snippet renderer SHALL take text carrying non-markup highlight delimiters and render it as
**segmented text**. It SHALL NOT interpolate its input as HTML under any circumstance.

#### Scenario: A snippet containing markup is rendered literally

- **WHEN** a snippet's text contains characters that look like markup
- **THEN** they are displayed as literal characters and no markup is interpreted

#### Scenario: Highlighted terms are emphasised and readable

- **WHEN** a snippet's highlighted segment is rendered in each of the three presets, light and dark
- **THEN** the emphasis is visible and both the emphasised and unemphasised text meet AA contrast
  against the row background, active and inactive

#### Scenario: The row appears in the themed showcase

- **WHEN** the component showcase is opened
- **THEN** the search result row and snippet renderer appear in every preset in both light and dark,
  including their active, snippet-bearing and state-labelled variants
