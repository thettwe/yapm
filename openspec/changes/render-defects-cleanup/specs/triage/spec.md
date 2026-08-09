## MODIFIED Requirements

### Requirement: The issue under decision unfolds in place

Exactly one waiting issue at a time SHALL unfold, in place and below its own row, into a decision panel carrying what makes the next decision fast:

- the issue's **own description**, rendered as written — the one document voice this surface admits;
- a mono line stating the **reporter** and the issue's **created-at**;
- each of the issue's attachments as an upload chip.

The unfolded issue SHALL be the issue the verdict keys act on, so the panel and the keys can never name different issues. On arrival that SHALL be the head of the queue — the oldest waiting issue — and moving the keyboard selection SHALL move the panel with it.

The panel SHALL be **the height of what it has**. When the unfolded issue carries no description, the panel SHALL NOT reserve the prose measure or the height that a description would have occupied: it SHALL fold to a single band carrying the provenance line, any attachment chips, and the verdicts, and SHALL NOT draw an empty region with the verdicts stranded beside it. No placeholder sentence SHALL stand in for the missing description — the product's grammar for a fact a row does not carry is absence, the same grammar the reality track and the vertical rail already follow.

Folding SHALL cost the reader nothing: every verdict, the movement hint and the route transient SHALL remain present, keyboard-reachable and named exactly as they are when a description is drawn.

The panel SHALL render entirely from rows already synced and SHALL introduce no new named query.

Work-graph placement: a rendering surface over the inbox's own rows plus the existing per-issue attachments query. Permission story: read-only; the panel writes nothing.

#### Scenario: The head of the queue arrives unfolded

- **WHEN** a member opens the Triage view for a team with waiting issues
- **THEN** the oldest waiting issue is unfolded, showing its description, its reporter and created-at, and its attachments, and every other waiting issue is a single row

#### Scenario: The panel follows the decision

- **WHEN** the member moves the keyboard selection to another waiting issue
- **THEN** that issue's panel unfolds, the previous one folds, and the verdict keys act on the newly unfolded issue

#### Scenario: An issue with no description or attachments

- **WHEN** the unfolded issue has neither a description nor an attachment
- **THEN** the panel states no placeholder text for either and the verdicts remain available

#### Scenario: A terse issue folds rather than reserving a measure

- **WHEN** the unfolded issue carries no description
- **THEN** the panel draws no prose region at all, folds to a single band carrying the provenance line and the verdicts, and its drawn height is the height of that band rather than the height a description would have taken

#### Scenario: Folding takes nothing away

- **WHEN** a member reaches the folded panel of a description-less issue by keyboard
- **THEN** Accept, Route, Decline, the movement hint and the route transient are all present and operable, each with the same name and key it carries on a panel that draws a description
