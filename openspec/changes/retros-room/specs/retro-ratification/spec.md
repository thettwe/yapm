## MODIFIED Requirements

### Requirement: Contested proposals lead the discussion, and a verdict is visible

From `discuss` onward the AI section SHALL display each proposal's verdict, with its agree and
disagree counts as a team-level aggregate carrying **no per-person dimension** — no name, no avatar
and no way to learn who reacted which way. Proposals whose verdict is `contested` SHALL be ordered
before the rest, which SHALL keep their existing category-and-rank order, so the team's discussion
time lands first on what they disagree about.

Before the verdict is stamped, a proposal SHALL display the caller's **own** reaction and nothing
else about anyone else's, and the section SHALL continue to state that its content is AI-drafted and
not agreed by the team.

The reaction controls, the verdict display and the ordering SHALL be fully operable and legible
without a pointer, every colour and font SHALL resolve from a semantic token, and the surface SHALL
be correct and AA-contrast in the Warm, Focused and Editorial presets in both light and dark. Making
or clearing a reaction SHALL render immediately from the optimistic local write and SHALL NOT newly
wait on the network.

**Neither a verdict nor a reaction SHALL be conveyed by colour alone.** Each verdict SHALL carry its
word, and each reaction control SHALL carry a drawn mark and a stated accessible name as well as its
selected treatment, so the surface is legible to a reader who cannot distinguish the hues and to one
reading through assistive technology.

#### Scenario: Contested sorts to the top

- **WHEN** a retro in `discuss` holds proposals with mixed verdicts
- **THEN** every `contested` proposal is rendered before every non-contested one, and the non-contested ones keep the order they had

#### Scenario: The counts name nobody

- **WHEN** a member reads a ratified proposal
- **THEN** they see how many agreed and how many disagreed, and no surface anywhere lets them learn which member did which

#### Scenario: Only your own reaction is shown before the stamp

- **WHEN** a member reads a proposal during `vote` after reacting to it
- **THEN** their own reaction is shown as selected and no indication of any other member's reaction or of a running total is present

#### Scenario: The whole ratification surface works from the keyboard

- **WHEN** a member tabs to a proposal, agrees with it, changes to disagree, and clears the reaction, using no pointer
- **THEN** focus is visible at every step, each control reports its pressed state to assistive technology, and every one of those actions is also reachable from the command palette

#### Scenario: A reaction is instant

- **WHEN** a member activates a reaction control
- **THEN** the control updates immediately from the optimistic local write and is reconciled in the background

#### Scenario: It is correct in every theme

- **WHEN** the reaction controls and verdict badges are rendered in Warm, Focused and Editorial, in light and dark
- **THEN** every colour resolves from a semantic token and meets AA contrast, with no hardcoded colour

#### Scenario: A verdict is readable without colour

- **WHEN** every verdict a retro can hold — agreed, contested, rejected and unrated — is rendered with colour removed
- **THEN** each is still distinguishable by its word, and each reaction control is still distinguishable by its drawn mark and its accessible name
