## MODIFIED Requirements

### Requirement: Tokenized, keyboard-first retro surface

The retro SHALL be fully operable without a pointer — capture, navigation, grouping, voting, action creation, conversion, phase control, and timer — and every action SHALL also be reachable from the command palette. Every color, spacing, and font SHALL come from a semantic token; a column's accent SHALL be stored as a token key, never a literal color; a converted action's issue status SHALL render with the existing status tokens. The surface SHALL be correct and AA-contrast in the Warm, Focused and Editorial presets in both light and dark, and common interactions SHALL not newly wait on the network.

The room SHALL be drawn to one anatomy, correct in every phase:

- **The masthead** SHALL state the retro and the cycle it reflects on, and SHALL NOT repeat the team name, which the application frame's deck already carries. It SHALL carry the live presence reading, the shared timer and who is facilitating. The retro's format SHALL NOT be stated as a resting pill, because the format's own column headings already state it; the format control SHALL still render while the retro is configurable.
- **The phase stepper** SHALL draw the six phases in the same day-band language the cycle surfaces use for time passing — spent, now, and to come — naming the current phase and marking it as the current one, and SHALL NOT state a duration for any phase, because no phase transition is stored. The facilitator's step-back and step-forward controls SHALL remain focusable named controls carrying their keyboard shortcuts.
- **The phase's request of the room** SHALL be stated in the room's own words for the current phase.
- **The vote budget**, during `vote`, SHALL be drawn as spent and unspent dots **and** stated as a reading, so the remaining budget is never conveyed by shape or colour alone.
- **A vote slot with no dots SHALL draw no ink at all**, while keeping its reserved measure so the column does not shift as dots land. Where dots are drawn, the tally SHALL also be stated as a number.
- **A control that cannot act and is not the only way to begin an action SHALL NOT be drawn**: the retract control SHALL be absent when the caller has cast no dot on that target.
- **The cards** SHALL sit on the tabletop ground as flat notes carrying their column's accent as a mark, with no rotation, no dog-ear and no illustration.
- **The room foot** SHALL state only phase facts the state machine enforces.

The surface SHALL state its anonymity guarantee in words whenever the retro is anonymous — that cards are anonymous by design and no author column exists — and SHALL state the opposite truth when the retro is attributed. This sentence SHALL NOT render on a retro whose stored state does not make it true.

The auto-seeded data panel SHALL open expanded while the phase can still take a card seeded from it and SHALL collapse to a labelled door naming what is behind it once the phase can no longer take one, for every reader in the room including one who was already there when the phase advanced; the reader's own expand or collapse SHALL hold within a phase, and no widget, metric or seed path SHALL be removed by that collapse.

The action list SHALL render whenever the current phase permits an action write **or** at least one action already exists, so stepping the retro back never hides a recorded action. Where the phase forbids the write, the list SHALL render read-only and SHALL state what the phase itself makes true — when the write reopens where it does reopen, and that the retro is closed where it does not — and SHALL NOT describe a phase's rule to a reader whose own role is what forbids the write.

#### Scenario: A whole retro can be run from the keyboard

- **WHEN** a facilitator runs a retro end to end — capture, advance, group, vote, discuss, add an action, convert it, close — using no pointer
- **THEN** every step is reachable and every focused element is visibly focused

#### Scenario: The retro is correct in every theme

- **WHEN** the retro is rendered in Warm, Focused and Editorial, in light and dark
- **THEN** cards, column accents, vote pips, the phase stepper and the timer all resolve from tokens and meet AA contrast, with no hardcoded color

#### Scenario: Card capture and voting stay instant

- **WHEN** a member adds a card or casts a vote
- **THEN** the change renders immediately from the optimistic local write and is reconciled in the background

#### Scenario: An unvoted card draws no vote ink

- **WHEN** a retro in `vote` shows a card that has received no dots
- **THEN** its vote slot renders no count, no pip and no retract control, its reserved measure is unchanged, and the control that casts the first dot is still present and keyboard-reachable

#### Scenario: The dot budget is drawn and read

- **WHEN** a member with dots left reads the room during `vote`
- **THEN** the remaining budget is shown both as unspent dots and as a stated reading, and neither alone carries the meaning

#### Scenario: The anonymity guarantee is stated only when it is true

- **WHEN** a member opens an anonymous retro
- **THEN** the surface states in words that cards are anonymous by design and that there is no author column

#### Scenario: An attributed retro does not claim anonymity

- **WHEN** a member opens a retro whose `is_anonymous` is false
- **THEN** the anonymity guarantee is absent and the surface instead states that cards carry their author

#### Scenario: The phase stepper claims no duration

- **WHEN** a member reads the stepper on a retro that has passed through three phases
- **THEN** the spent phases are shown as spent and no elapsed or per-phase duration is stated anywhere, because none is stored

#### Scenario: Stepping back does not hide a recorded action

- **WHEN** a facilitator steps a retro that already holds action items back from `discuss` to `vote`
- **THEN** those actions are still listed, read-only, and the surface states when action editing reopens

#### Scenario: The data panel becomes a door once it cannot seed a card

- **WHEN** a retro advances out of `brainstorm` while a member is reading it with the panel expanded
- **THEN** that member's seeded data panel collapses to a labelled door naming what it holds, every widget survives behind it, and the reader can expand it again

#### Scenario: A closed retro is not told that its actions reopen

- **WHEN** a member reads a `closed` retro that holds actions
- **THEN** the list states that the retro is closed rather than that actions reopen, and the control that converts an action into a numbered issue is still offered

## ADDED Requirements

### Requirement: The retros index is a destination drawn to the list register

The system SHALL provide a retros index at `/teams/$teamId/retros`, reached from the application frame's `more▾` menu and its `g r` shortcut, listing the team's retros. It SHALL state the page's name and a mono count and SHALL NOT repeat the team name.

Each row SHALL carry the drawn retro mark, the retro's title, its current phase, its format, and the date range of the cycle it reflects on, and SHALL be a single keyboard-reachable link into that retro. The row SHALL claim nothing that no stored row supports: no participant count, no card count, no per-person figure of any kind.

The index SHALL also list a team's completed cycles that have no retrospective, offering to open one, and SHALL render that group only when it has rows — never as an empty heading.

A team with no retros SHALL be met by a short honest statement that a retro opens when a cycle closes, together with the mono fact of when the next cycle closes where a cycle exists to state it, and nothing where none does. The index SHALL NOT offer to create a retro detached from a cycle.

Work-graph placement: a destination over the team's existing retros and cycles; no new entity and no new query. Permission story: unchanged — the retro rows are the team-scoped rows a member already syncs, and the open-a-retro control renders only for a writer.

#### Scenario: The index lists a team's retros

- **WHEN** a member opens the retros destination for a team with retros
- **THEN** each retro is one row stating its title, phase, format and its cycle's date range, and activating the row opens that retro

#### Scenario: A team that has never run a retro

- **WHEN** a member opens the retros destination for a team with no retro and no completed cycle
- **THEN** the page states that a retro opens when a cycle closes, offers no create control, and shows no empty group heading

#### Scenario: A completed cycle owed a retro is offered one

- **WHEN** a team has a completed cycle with no retrospective
- **THEN** that cycle is listed with a control to open a retrospective for it, and the control is absent for a viewer

#### Scenario: The index names no person

- **WHEN** any row of the index is rendered
- **THEN** it contains no participant, author, facilitator or per-person figure

#### Scenario: The index is keyboard-operable and correct in every theme

- **WHEN** a member moves through the index with the keyboard in Warm, Focused and Editorial, in light and dark
- **THEN** every row is focus-reachable with visible focus, and every colour resolves from a semantic token and meets AA contrast
