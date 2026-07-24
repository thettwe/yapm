## ADDED Requirements

### Requirement: Issue ordering rank and single-write move mutator

The `issue` entity SHALL carry a nullable `rank` (a fractional-index `text` value, byte-collated) that orders issues within a status column on the board. A shared `issue.move` mutator SHALL set the target issue's `rank` and, when the destination column differs, its `status`, in a single-row update that never renumbers siblings. `issue.move` SHALL be team-scoped and role-gated identically to the other issue write mutators (authorization checked before existence; viewers and non-members rejected), and it SHALL accept the fractional index as an argument computed by the caller rather than computing it inside the mutator body.

Work-graph placement: an ordering field and move operation on the existing `issue` entity. Sync/permission story: `rank` replicates under the existing team scope; the move is gated by `canWrite`.

#### Scenario: A member moves an issue

- **WHEN** a team member invokes `issue.move` with a target status and a call-site-computed rank
- **THEN** the issue's `rank` (and `status` if changed) updates and no other issue is written

#### Scenario: A viewer cannot move an issue

- **WHEN** a viewer or non-member invokes `issue.move`
- **THEN** it is rejected as not-authorized before any row is read or written

#### Scenario: Existing issues are backfilled with ranks

- **WHEN** the board-view migration runs against a database with existing issues
- **THEN** each issue receives a fractional-index `rank` within its status group, matching the list's default order, with distinct byte-ordered keys
