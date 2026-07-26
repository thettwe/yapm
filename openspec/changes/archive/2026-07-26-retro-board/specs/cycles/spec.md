## ADDED Requirements

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
