## MODIFIED Requirements

### Requirement: The how — a derived number never explains itself at rest

A derived number SHALL NOT carry its derivation as visible text at rest, **on any surface in the
product**. It SHALL carry a quiet mono `how ·` affordance instead. Opening the affordance SHALL
reveal the derivation; closing it SHALL return the surface to quiet. Facts stay on the surface;
footnotes fold.

A **derivation** is any statement of how a rendered fact was computed, or of the rows it was
computed over: a caption sentence, a legend, a footnote, a tooltip, or a mono clause line of the
`key = clause · clause · clause` shape. A surface SHALL NOT render one at rest, and SHALL NOT render
one beside the very `how ·` built to hold it.

The obligation runs one way only. A surface is **not** required to attach a `how ·` to every number
it draws; a count nobody explains needs no affordance, and adding one to every mono figure in the
product would be chrome, not relief. What binds every surface is the **prohibition**: where an
explanation exists, it lives behind exactly one `how ·` for that fact and nowhere else at rest.

The affordance SHALL be a real focusable control, operable and closable from the keyboard alone,
exposing its expanded state to assistive technology, with Escape closing it and returning focus.
Because the panel exists only while it is open, its text is absent from the surface at rest for
**every** reader, not merely quiet for a sighted one. The trigger SHALL therefore carry an
accessible name identifying the derivation it holds, so the fold is discoverable without sight and
without a pointer.

The derivation text SHALL be produced by the layer that produced the fact, not by the rendering
surface, so two surfaces stating the same derivation cannot disagree about it.

#### Scenario: At rest the surface is quiet

- **WHEN** a surface renders a derived number
- **THEN** the number and its unit are visible and its derivation is not — only the mono `how ·` affordance is

#### Scenario: The derivation opens and closes from the keyboard

- **WHEN** a user focuses the `how ·` affordance and activates it, then presses Escape
- **THEN** the derivation appears and then folds away, focus returns to the affordance, and the surface is quiet again

#### Scenario: The rule is not one page's rule

- **WHEN** any surface in the product renders a derived fact together with a sentence, legend, footnote, tooltip or mono clause line stating how it was derived
- **THEN** that explanation is folded behind that surface's `how ·` and nothing but the affordance remains at rest, on that surface exactly as on the delivery surface

#### Scenario: A derivation never stands beside its own affordance

- **WHEN** a surface renders a `how ·` whose panel states a derivation
- **THEN** no copy of that derivation is drawn beside the affordance at rest, because the affordance exists to hold it

#### Scenario: A surface that explains nothing needs no affordance

- **WHEN** a surface draws a count and states no derivation of it
- **THEN** no `how ·` is added beside that count, because the rule forbids explanation at rest rather than requiring one

#### Scenario: The fold is discoverable without sight

- **WHEN** a screen-reader user reaches a `how ·` whose panel is closed
- **THEN** the trigger announces which derivation it holds, and the panel's text is absent from the accessibility tree until the trigger is activated

## ADDED Requirements

### Requirement: A query definition folds; a refusal, a promise, a finding, an instruction and an empty state do not

`how ·` explains **derivations**. It is not a drawer for everything a page says. This requirement
draws the line, so a later change cannot fold something behind the affordance merely because it is
prose.

A **query definition** — a statement of the rows a surface counted, the scope it counted them over,
or the clauses of the lens it applied — SHALL fold behind that surface's `how ·`. It is a derivation
of what is drawn, it is identically true of every render, and a reader who has read it once does not
need it printed again every morning.

Five kinds of sentence SHALL NOT be folded by this rule, and a surface SHALL keep them at rest:

- **A refusal** — the product stating what it will not measure, and why the stored data cannot
  support it. A refusal is not a derivation of anything drawn; it is the reason something is
  *absent*. A reader who never opens the fold would never learn that the absence was chosen rather
  than forgotten, which inverts the honesty the refusal exists to serve. A refusal MAY carry its own
  `how ·` explaining the derivation it refused.
- **A binding product promise that another capability mandates appearing at rest**, in the one place
  that capability mandates it. Folding it would contradict that requirement rather than amend it.
- **A derived section standfirst that states a finding** — one sentence saying what the data says,
  which the drawing beneath it then evidences. It is a sentence *about* derived data, so the
  "caption sentence" in the definition above must not be read as reaching it: a standfirst states
  the reading, not the method by which the reading was computed, and the method belongs in the same
  section's `how ·`. A capability MAY require such a standfirst and require it to be derived from
  the data it introduces rather than fixed; where one does, removing the sentence is an amendment to
  that capability and SHALL be argued there rather than taken as an application of this rule.
- **A live-session instruction** — a line telling a participant the rule of an action they are
  about to take, on a surface whose phase changes what is permitted. It is not a derivation of
  anything drawn; it is the condition under which a person is about to act, read at the moment of
  acting rather than recalled from an earlier reading. Someone who must open a fold to learn that
  their cards stay private until the room moves on learns it after they have typed.
- **An empty state's single quiet line** naming what will appear. There is no drawn fact to hang an
  affordance on, and the line is the surface's only content. That line SHALL NOT render on the same
  surface once it has rows to draw.

#### Scenario: A counting rule folds

- **WHEN** a surface prints, at rest, the scope its counts were taken over
- **THEN** that statement moves behind the surface's `how ·`, and the surface draws nothing where it stood

#### Scenario: A refusal stays at rest

- **WHEN** a surface states that it will not draw something because no stored fact supports it
- **THEN** that statement remains visible at rest and is not folded behind a `how ·`, though the derivation it refused may itself sit behind one

#### Scenario: A mandated promise is not folded away by this rule

- **WHEN** a capability requires a binding product rule to appear once in the application at rest
- **THEN** this rule does not fold it, and a change that wanted to fold it would have to amend the requirement that mandates it rather than relying on this one

#### Scenario: A section standfirst is not folded away by this rule

- **WHEN** a section leads with one derived sentence stating what its data says and then draws the evidence for it
- **THEN** that sentence remains visible at rest, the derivation of the numbers it states sits behind that section's `how ·`, and a change wanting to remove the sentence amends the capability that mandates it rather than citing this rule

#### Scenario: A live-session instruction is not folded away by this rule

- **WHEN** a facilitated session's surface states at rest what its current phase permits, immediately beside the control that acts under it
- **THEN** that line renders in place, this rule does not move it behind a `how ·`, and the line changes with the phase rather than being written once for every phase

#### Scenario: An empty surface keeps its one line

- **WHEN** a surface has nothing to draw and states one quiet line naming what will appear
- **THEN** that line renders at rest; and **WHEN** the same surface later has rows to draw, the line is absent
