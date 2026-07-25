## MODIFIED Requirements

### Requirement: Issue mutations via shared mutators

All issue, label, comment, and saved-view writes SHALL flow through custom mutators defined once in `packages/schema` and imported by both client (optimistic) and server (authoritative). The mutator set SHALL cover creating and updating issues, changing status, setting priority, assigning/unassigning, adding/removing labels, creating/editing/deleting comments, and managing labels and saved views. Every mutator SHALL enforce team-scoped role authorization from the verified `ctx` before any existence check, set owner/creator/author fields from `ctx` (never args), and mint any created row's UUIDv7 at the call site. Assignee changes SHALL validate that the assignee is a member of the issue's team.

Any feature that creates an issue on a user's behalf — including converting a retrospective action item — SHALL do so by calling the **same shared issue-creation mutator**, inheriting its authorization, its `ctx`-derived creator, its triage and status defaults, and its server-authoritative per-team numbering. A parallel insert into the issue table SHALL NOT exist.

Work-graph placement: these mutators are the sole write path into the team-scoped work-graph entities. Permission story: viewers and non-members are rejected for every write; author/creator-scoped operations additionally require ownership-or-admin.

#### Scenario: Status change applies optimistically then persists

- **WHEN** a member changes an issue's status
- **THEN** the UI updates immediately and the change persists in Postgres via the server mutator, rolling back to the authoritative value if the server rejects it

#### Scenario: Assigning to a non-team-member is rejected

- **WHEN** a caller attempts to assign an issue to a user who is not a member of the issue's team
- **THEN** the mutator rejects it as invalid

#### Scenario: Unauthorized write reveals nothing

- **WHEN** a viewer or non-member attempts any issue, label, comment, or saved-view write
- **THEN** the mutator rejects it as not authorized without revealing whether the target row exists

#### Scenario: A derived creation path reuses the shared create mutator

- **WHEN** a retrospective action item is converted into an issue
- **THEN** the issue is created through the shared issue-creation mutator and is indistinguishable from a hand-created issue — same authorization, same defaults, and a server-assigned per-team number

## ADDED Requirements

### Requirement: Issue carries cycle-carryover facts

The system SHALL record, on the `issue` row, two facts that its cycle history cannot otherwise reconstruct: a non-negative `carryover_count` incremented every time the issue is rolled over by a completing cycle, and a nullable `cycle_assigned_at` stamped whenever the issue is placed in (or moved between) cycles, including by rollover. Both SHALL be written only by the mutators that already write the row in the same transaction, SHALL be derived from mutator arguments so that a rebase or a retried mutation is deterministic, and SHALL NOT be settable directly by a client as a standalone write.

Work-graph placement: both are attributes of `issue` on the `issue`↔`cycle` edge, feeding the retrospective's team-level Delivered panel ("carried twice or more", "added mid-cycle"). Permission story: unchanged — they sync with the issue under the team scope and carry no identity dimension.

#### Scenario: A twice-carried issue is distinguishable

- **WHEN** an issue is rolled over by two consecutive completing cycles
- **THEN** its carryover count is 2 and the retro's Delivered panel can report it as carried twice or more

#### Scenario: Mid-cycle scope is precise

- **WHEN** an issue is assigned to a cycle after that cycle has started
- **THEN** its cycle-assignment timestamp records that moment and the Delivered panel reports it as added mid-cycle

#### Scenario: Rollover stays idempotent

- **WHEN** a cycle completion runs twice for the same cycle
- **THEN** the carryover count is incremented exactly once
