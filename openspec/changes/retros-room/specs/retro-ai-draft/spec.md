## MODIFIED Requirements

### Requirement: A keyboard-operable draft section that is absent when AI is off

The retro SHALL render the AI's proposals in a section adjacent to the auto-seeded data panel and
SHALL NOT interleave them into the retro format's own columns, because two of the shipped formats do
not map onto wins, losses and improvements. The section SHALL render only when an artifact row
exists and is either in progress or ready with at least one proposal; a run that ended `ai_off` or
`failed`, or produced no surviving proposal, SHALL render nothing at all, leaving the seeded data
panel as the raw-evidence fallback. The section SHALL state plainly that its content is AI-drafted
and, until the team has decided, that it has not been agreed by the team.

The section SHALL be placed **below the retro's own cards**, so the team's own material is read
first and the draft is subordinate by position and not only by label.

The section SHALL state on its own surface what its input was allowed to read — that it reads the
work graph only and never a card — because that sentence is the table allowlist stated in words,
and a reader cannot otherwise tell an anonymous board was not the model's input.

Every rendered proposal SHALL draw at least one of its citations on the surface: a work-graph
entity, or a yapm-computed value carrying the existing explanation affordance where the value is
derived. A proposal with no surviving citation SHALL NOT be rendered. No figure SHALL be rendered
as the model's own prose — a proposal points at a computed value, it never states one.

Every proposal's evidence references SHALL be activatable: a work-graph reference SHALL open the
entity, and a metric reference SHALL reveal the seeded panel and move focus to that metric's tile.
Where the retro's phase permits it, each proposal SHALL additionally carry the caller's own
agree/disagree control, and once the team's decision has been recorded the proposal SHALL carry that
decision instead. The whole section SHALL be operable with the keyboard alone, every color and font
SHALL resolve from a semantic token, and it SHALL be correct and AA-contrast in the Warm, Focused
and Editorial presets in both light and dark. Reading the section SHALL NOT newly wait on the
network, and neither SHALL recording a reaction.

#### Scenario: The section is absent when AI is off

- **WHEN** a member opens a retro on a team that has opted in but whose workspace has no AI configured
- **THEN** the artifact is recorded `ai_off`, nothing renders in place of the section, no error is surfaced, and the seeded data panel is unchanged

#### Scenario: Drafting in progress is visible and quiet

- **WHEN** the facilitator has just advanced to `group` and the background pass has not finished
- **THEN** the section shows a single unobtrusive in-progress line and replaces it with the proposals when they arrive, with no reload, and both transitions are announced through one persistent live region rather than by inserting a status node

#### Scenario: An in-progress state that will never resolve stands down

- **WHEN** the completion pass is disabled instance-wide, so a stamped row is never completed
- **THEN** the in-progress line stops rendering after a bounded interval and the seeded data panel is the whole surface again, with no error and nothing left claiming to be in progress

#### Scenario: The whole section works from the keyboard

- **WHEN** a member tabs from the seeded data panel into the draft section and activates a proposal's issue reference, then a metric reference, then its reaction control, using no pointer
- **THEN** focus is visible at every step, the issue opens, the metric reference reveals the data panel and focuses that metric's tile, and the reaction control reports its pressed state

#### Scenario: It is correct in every theme

- **WHEN** the section is rendered in Warm, Focused and Editorial, in light and dark
- **THEN** the category chips, evidence chips, reaction controls, verdict badges and body text resolve from tokens and meet AA contrast, with no hardcoded color

#### Scenario: The draft is labelled as unratified

- **WHEN** proposals are shown before the team's decision has been recorded
- **THEN** the section states that they are AI-drafted and not agreed, so no reader mistakes them for a team conclusion; once the decision is recorded, each proposal shows what the team decided

#### Scenario: The draft is read after the room's own cards

- **WHEN** a member reads a retro whose board holds cards and whose draft is ready
- **THEN** the team's own cards are placed before the draft section on the surface, and the draft carries its unratified label at its head

#### Scenario: The section states what it was allowed to read

- **WHEN** a member reads a ready draft section
- **THEN** the section states on the surface that it reads the work graph only and never a card, which is the same boundary its input assembly's table allowlist enforces

#### Scenario: A proposal shows its citation, never its own number

- **WHEN** a proposal derived from a computed value is rendered
- **THEN** the value is drawn as a citation chip carrying its explanation affordance, and the proposal's own sentence contains no figure the reader cannot trace to a citation

#### Scenario: An uncited proposal is not drawn

- **WHEN** a proposal survives to the surface with no reference the reader can activate
- **THEN** it is not rendered at all, and the remaining proposals render unchanged
