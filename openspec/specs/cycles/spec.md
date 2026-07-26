# cycles Specification

## Purpose
TBD - created by archiving change cycles. Update Purpose after archive.
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

### Requirement: Cycle view with progress

The system SHALL present a Cycles view at `/teams/$teamId/cycles`, a peer to the list and board. It SHALL show the team's cycles split into active, upcoming, and completed; feature the current cycle (the earliest active, else the earliest upcoming); and show the featured cycle's date range, its issues, and a simple progress indicator (finished issues out of total). A writer SHALL be able to create a cycle and complete the active cycle from this view; a viewer SHALL see it read-only. All colors, fonts, and density SHALL come from tokens and be correct in all three presets in light and dark.

Work-graph placement: a view over team-scoped `cycle` and `issue` rows. Permission story: create/complete controls are hidden and never written for viewers.

#### Scenario: The Cycles view shows the current cycle and its progress

- **WHEN** a member opens the Cycles view for a team with an active cycle
- **THEN** the active cycle is featured with its issues and a progress bar showing how many are finished out of the total

#### Scenario: Cycles view is correct across themes

- **WHEN** the Cycles view is viewed in each preset in light and dark
- **THEN** all colors, fonts, and density come from tokens and remain legible

#### Scenario: The Cycles view is fully keyboard-operable

- **WHEN** a member operates the Cycles view with the keyboard only — moving focus through the cycle rail, activating a cycle to feature it, opening the create form, triggering "Complete cycle", and opening a listed issue — without a pointer
- **THEN** every cycle and control is reachable and operable by keyboard, and each action behaves identically to its pointer equivalent

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

