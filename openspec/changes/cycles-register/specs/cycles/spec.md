## RENAMED Requirements

- FROM: `### Requirement: Cycle view with progress`
- TO: `### Requirement: The cycle register`

## MODIFIED Requirements

### Requirement: The cycle register

The system SHALL present a Cycles view at `/teams/$teamId/cycles`, reached from the application
frame's Cycles destination, drawn as a **register**: the history of the team's cycles and the work
that persists between them. It SHALL NOT redraw the active cycle's plan, which Team Home's hero
already states, and SHALL NOT redraw the cross-cycle trend, which Delivery already states.

**The register.** The view SHALL list every one of the team's cycles, **one row per cycle, newest
first**, each row stating: a cycle-status glyph drawn on the same grid and stroke as the issue
status glyph (upcoming, active, completed, each carrying a truthful text label); the cycle's key;
its name; its date range; a scope ledger; the carryover fact where there is one; and the cycle's
artifact chips. The team's current cycle (the earliest active, else the earliest upcoming) SHALL be
selected on arrival. Selecting a row SHALL re-point the carried-in band and the report band to that
cycle, and SHALL wait on no network round trip.

**The scope ledger** SHALL be the same three-segment encoding Team Home's hero uses — landed, still
open, and added after the cycle started — derived by one shared rule so the two surfaces can never
disagree about the same cycle. Each segment SHALL be distinguishable without colour. The ledger
SHALL carry a truthful text label stating what it shows, and SHALL be absent, not empty, for a
cycle that holds no issues.

**The committed denominator SHALL degrade rather than lie.** Because completing a cycle overwrites
an issue's rolled-over-from reference, a completed cycle's committed total is reconstructible only
until one of its carried issues carries again. The view SHALL state a landed-out-of-committed
reading with an open remainder only for cycles whose carried set is still addressable — an open
cycle, or the latest completed cycle with no completed cycle after it — and for every earlier cycle
SHALL state the landed count alone, drawing no remainder and claiming no denominator. The rule SHALL
be stated on the surface, once, through the derived-number affordance rather than as prose at rest.

**Artifact chips SHALL appear only where the artifact exists.** A cycle-report chip SHALL be drawn
only where a stored cycle digest is ready with content, and a wrapped chip only where that cycle's
retrospective is closed — the same predicates Team Home's hero uses. Where an artifact does not
exist the slot SHALL draw nothing at all, never a label saying it is missing.

**A writer** SHALL be able to create a cycle and complete the selected cycle from this view, and to
reach or open the selected cycle's retrospective. **A viewer** SHALL see the whole register and
every fact on it, and SHALL be offered no write control.

The view SHALL NOT list the selected cycle's issues; that lens belongs to the issue list, which
already filters and groups by cycle. All colors, fonts, and density SHALL come from tokens and be
correct in all three presets in light and dark.

Work-graph placement: a view over team-scoped `cycle`, `issue`, `retro` and `cycle_digest` rows
already synced by their existing named queries; no new query, table, column or mutator. Permission
story: create/complete/open-retro controls are hidden and never written for viewers; every read is
denied by empty query for a non-member.

#### Scenario: The Cycles view shows the current cycle and its progress

- **WHEN** a member opens the Cycles view for a team with completed, active and upcoming cycles
- **THEN** every cycle appears as one row, newest first, each stating its status glyph with a
  truthful label, its key, its name, its dates and its scope ledger, and the current cycle is the
  selected row

#### Scenario: The scope ledger reads the same as Team Home's hero

- **WHEN** a cycle holds issues that landed, issues still open, and issues added after it started
- **THEN** the register row's ledger shows those three segments distinguishably without relying on
  colour, carries a text label stating the counts, and agrees with Team Home's hero for that cycle

#### Scenario: A cycle with no issues draws no ledger

- **WHEN** a cycle holds no issues
- **THEN** its row draws no scope ledger and no zero — the slot is simply absent

#### Scenario: An older cycle stops claiming a committed total

- **WHEN** a completed cycle is followed by another completed cycle, so its carried issues have been
  re-stamped
- **THEN** its row states the landed count alone, draws no open remainder, and the surface can
  explain that degradation on request

#### Scenario: An artifact chip appears only where the artifact exists

- **WHEN** one cycle has a ready cycle digest and a closed retrospective and another has neither
- **THEN** the first row draws both chips and the second draws neither, with no "not generated"
  label anywhere

#### Scenario: A viewer reads the register and is offered nothing to write

- **WHEN** a viewer opens the Cycles view
- **THEN** the register, its ledgers and its chips are fully readable, and no create, complete or
  open-retrospective control is rendered

#### Scenario: Cycles view is correct across themes

- **WHEN** the Cycles view is viewed in each preset in light and dark
- **THEN** all colors, fonts, and density come from tokens, every ground it paints meets its
  contrast bar, and no fact is carried by colour alone

#### Scenario: The Cycles view is fully keyboard-operable

- **WHEN** a member operates the Cycles view with the keyboard only — moving between register rows,
  selecting one, opening the create form, triggering "Complete cycle", opening the derivation
  affordances, reaching the selected cycle's retrospective, and opening a carried issue — without a
  pointer
- **THEN** every row and control is reachable and operable by keyboard, and each action behaves
  identically to its pointer equivalent

## ADDED Requirements

### Requirement: The carried-in band

The Cycles view SHALL show the work that persisted across a cycle boundary into the selected cycle
— the one fact no other surface in the product states. For each issue in the selected cycle whose
carryover count is greater than zero, the band SHALL state the issue's status glyph, its key, its
title, its rest phrase, the number of times it has been carried, and the cycle it last left where
that reference still names one.

The band SHALL be derived from the stored carryover count and the stored rolled-over-from reference
**only**. It SHALL NOT infer a hop from cycle ordering, and SHALL NOT name any cycle other than the
one the reference still holds — the boundaries before that are not recoverable, and where the band
draws them it SHALL draw them as unnamed.

Where the selected cycle carried nothing in, the band SHALL be absent entirely rather than drawing
a zero or an empty frame. Where a carried issue is drawn with a graphic, that graphic SHALL be
hidden from assistive technology and the same fact SHALL be available as text. A deeply-carried row
SHALL NOT enter the team's attention count and SHALL NOT take the urgent register — carrying is not
one of the exception classes.

Selecting a carried issue SHALL open that issue, by keyboard and by pointer.

Work-graph placement: a read over the already-synced `issue.carryover_count` and
`issue.rolled_over_from_cycle_id` written by the rollover; no new column, query or mutator.
Permission story: read-only presentation of rows the caller already syncs.

#### Scenario: An issue that has crossed three boundaries says so

- **WHEN** an issue has been rolled forward three times and now sits in the selected cycle
- **THEN** the carried-in band states it as carried three times and names the cycle it last left,
  and states nothing about the two boundaries before that

#### Scenario: A cycle that carried nothing draws no band

- **WHEN** the selected cycle holds no issue with a carryover count above zero
- **THEN** the carried-in band is absent from the page entirely — no header, no zero, no empty frame

#### Scenario: Carrying does not raise the attention number

- **WHEN** an issue in the selected cycle has been carried several times but is not in any of the
  four attention classes
- **THEN** it is drawn in the carried register and the team's attention count is unchanged

#### Scenario: A carried issue opens from the band

- **WHEN** a member activates a carried row, by pointer or by keyboard
- **THEN** that issue opens

### Requirement: The cycle page draws no burndown

The Cycles view SHALL NOT draw a burndown, a burn-up, a velocity, a capacity, a forecast, or any
other series over time within a cycle. No issue status-history entity exists in this product — only
a single last-human-status timestamp, a cycle-assignment timestamp and a monotone carryover count —
so remaining scope over the days of a cycle is not reconstructible at any fidelity, and any such
line would be an invention. The view SHALL state this refusal once, in one sentence, and SHALL NOT
substitute a chart of something else in its place.

The view SHALL carry no per-person dimension of any kind: no load, no throughput, no capacity, and
no attribution of a carry to a person.

#### Scenario: No chart of remaining scope appears

- **WHEN** a member opens the Cycles view for a team with a long cycle history
- **THEN** no burndown, burn-up, velocity or forecast is drawn anywhere on the page, and the page
  says once that a cycle keeps no status history

#### Scenario: No per-person number appears

- **WHEN** a member opens the Cycles view for a team with several members
- **THEN** no figure on the page is attributed to an individual
