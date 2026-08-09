# cycles Specification

## Purpose
The team's planning boundary and the record of what crossed it: a cycle entity with a gap-free
per-team number, an auto-rollover that never silently drops work, and a Cycles view drawn as a
**register** — the history of the team's cycles and the work that persisted between them. It states
the one fact no other surface states (what was carried, and how often), and it refuses to draw a
burndown the stored data cannot support. Archived from change cycles and extended by
cycle-digest, retro-board and cycles-register (PR #43).

## Requirements

### Requirement: Team-scoped cycle entity with per-team number and lifecycle

The system SHALL provide a `cycle` entity that belongs to a team and has a name, a per-team `number`, a start date, an end date, and a status of `upcoming`, `active`, or `completed`. The `number` SHALL be assigned server-authoritatively as a gap-free per-team sequence (mirroring the issue number), and SHALL be absent from the optimistic client insert until it replicates. A cycle SHALL be created in the `upcoming` status, and its end date SHALL be required to be after its start date. Cycles SHALL be team-scoped synced (`cycles.byTeam`) under the same predicate as issues: a user syncs only their teams' cycles, and a viewer reads but cannot write.

Work-graph placement: a new team-bound entity; the `cycle_sequence` counter is server-only and never syncs. Permission story: create/update/activate/complete require `canWrite` and team access; viewers and non-members are denied before existence is revealed.

#### Scenario: Creating a cycle

- **WHEN** a member creates a cycle in their team with a name and a start date before its end date
- **THEN** the cycle is created in the `upcoming` status, and a gap-free per-team number replicates onto it

#### Scenario: End date must be after start date

- **WHEN** a caller creates or updates a cycle with an end date not after its start date
- **THEN** the mutation is rejected with an invalid-date error and no row is written

#### Scenario: A viewer cannot write a cycle

- **WHEN** a viewer attempts to create, update, activate, or complete a cycle
- **THEN** the mutation is rejected before any write and the cycle store is unchanged

#### Scenario: Cycles are team-scoped

- **WHEN** a user who is not a member of a team queries that team's cycles
- **THEN** the synced query returns nothing (deny by empty query)

### Requirement: Assign an issue to a cycle

The system SHALL let a writer assign an issue to a cycle in the same team, or clear the assignment (null), via a shared `issue.setCycle` mutator. Assigning an issue to a cycle in a different team SHALL be rejected. Deleting a cycle SHALL null the `cycleId` of its issues rather than deleting them.

Work-graph placement: a nullable `cycleId` reference on `issue`. Permission story: gated as the underlying issue write — viewers rejected.

#### Scenario: Assign and clear a cycle

- **WHEN** a member sets an issue's cycle to a same-team cycle, then clears it to null
- **THEN** the issue's `cycleId` is set and then unset optimistically, with no cross-team leak

#### Scenario: Cross-team cycle is rejected

- **WHEN** a member sets an issue's cycle to a cycle in another team
- **THEN** the mutation is rejected with a cross-team error and the issue is unchanged

### Requirement: Auto-rollover of unfinished issues on completion

Completing a cycle SHALL move its unfinished issues — every issue assigned to it whose status is not `done` or `canceled` — to the next open cycle, so no work is silently dropped. The destination SHALL be the earliest still-open cycle (upcoming or active) in the same team that sorts after the completing cycle; when no such cycle exists, the unfinished issues SHALL be unassigned (cycle set to null) and remain visible. Finished issues SHALL remain on the completed cycle. The rollover SHALL be team-scoped, permission-gated, deterministic, and idempotent: completing an already-completed cycle SHALL do nothing, so a deliberate completion and the scheduler can never double-move an issue.

The system SHALL complete cycles by two equivalent triggers: a deliberate "Complete cycle" action, and a scheduled job that completes cycles whose end date has passed (and activates cycles whose start date has passed). The scheduled job SHALL run on the existing Postgres via pg-boss (no additional container) and SHALL be idempotent.

Work-graph placement: a status transition on `cycle` plus `cycleId` re-pointing on `issue`. Permission story: `canWrite` + team access; the scheduler runs as a system admin principal, never impersonating a user.

#### Scenario: Completing a cycle rolls unfinished issues forward

- **WHEN** a member completes an active cycle that has an open successor and holds a mix of finished and unfinished issues
- **THEN** the cycle becomes `completed`, its unfinished issues move to the successor cycle, and its finished issues stay

#### Scenario: Rollover with no successor unassigns

- **WHEN** a cycle with no open successor is completed
- **THEN** its unfinished issues are unassigned (cycle null) and remain visible, and nothing is dropped

#### Scenario: Rollover is idempotent

- **WHEN** `cycle.complete` runs again on an already-completed cycle (a retry, or the scheduler racing the manual action)
- **THEN** no issue is moved and no write occurs

#### Scenario: The scheduler activates and completes on schedule

- **WHEN** the scheduled maintenance pass runs and a team has an upcoming cycle whose start date has passed and an active cycle whose end date has passed
- **THEN** the upcoming cycle becomes active and the ended cycle completes with its unfinished issues rolled forward

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

### Requirement: Group and filter the issue list by cycle

The issue list SHALL let a user filter issues by one or more cycles (including a "no cycle" option) and group issues by cycle, with issues that belong to no cycle bucketed last.

Work-graph placement: a client-side view concern over the synced `cycleId`. Permission story: read-only presentation; no writes.

#### Scenario: Filter the list by cycle

- **WHEN** a member selects one or more cycles in the list's cycle filter
- **THEN** only issues in those cycles (or with no cycle, when chosen) are shown

#### Scenario: Group the list by cycle

- **WHEN** a member groups the list by cycle
- **THEN** issues are bucketed under each cycle with a "no cycle" group last

#### Scenario: Cycle grouping and filtering are keyboard-operable

- **WHEN** a member opens the list's cycle filter, selects cycles, and switches to group-by-cycle using only the keyboard
- **THEN** the filter and grouping controls are reachable and operable by keyboard, and the list updates without a pointer

### Requirement: Completing a cycle opens its retrospective

Completing a cycle SHALL also open that cycle's retrospective exactly once, through both existing completion triggers — the deliberate Complete-cycle action and the scheduled maintenance pass — using the same code path. Because a retro's id and its seeded column ids are client-minted UUIDv7 values generated at the **call site**, the retro SHALL NOT be created inside the cycle-completion mutator; each trigger SHALL mint the ids and call the retro-open mutator. Opening SHALL be idempotent: a cycle that already has a retro SHALL be left untouched, so the deliberate action racing the scheduler still yields exactly one retro. The opened retro SHALL start in its first phase with no facilitator assigned, its columns seeded from the default format, and its next-cycle reference resolved by the same deterministic successor rule the rollover uses. No new scheduler, job type, container, or environment variable SHALL be introduced.

#### Scenario: The scheduler opens a retro when a cycle ends

- **WHEN** the maintenance pass completes a cycle whose end date has passed
- **THEN** that cycle's unfinished issues roll forward as before and a retrospective is opened for the cycle, ready for the team

#### Scenario: The deliberate action and the scheduler cannot double-open

- **WHEN** a member completes a cycle from the Cycles view at the same time the maintenance pass completes it
- **THEN** exactly one retro exists for that cycle

#### Scenario: A completed cycle links to its retro

- **WHEN** a member views a completed cycle
- **THEN** its retrospective is reachable from that view, by keyboard and from the command palette

### Requirement: Rollover records the carryover fact

When a completing cycle re-points an unfinished issue to its successor, it SHALL also increment that issue's carryover count and stamp its cycle-assignment time, using values derived from the mutator's arguments so the write is deterministic under rebase and a re-run of the completion is still a no-op.

#### Scenario: Carrying an issue increments its carryover count

- **WHEN** a cycle completes and rolls an unfinished issue into the next cycle
- **THEN** that issue's carryover count increases by one and its cycle-assignment time is updated

#### Scenario: Re-running completion changes nothing

- **WHEN** the completion mutator runs again for an already-completed cycle
- **THEN** no carryover count changes

### Requirement: The maintenance pass prunes stale retro presence

The existing scheduled cycle-maintenance pass SHALL additionally delete retrospective presence heartbeat rows that have not been refreshed within a short window, so "who's here" stays accurate without a new job, service, or container.

#### Scenario: A departed participant disappears from presence

- **WHEN** a participant stops refreshing their heartbeat and the maintenance pass runs
- **THEN** their presence row is removed and remaining participants see an accurate roster

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
