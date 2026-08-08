# triage Specification

## Purpose
TBD - created by archiving change triage. Update Purpose after archive.
## Requirements
### Requirement: Triage is an orthogonal state, never a seventh status

The system SHALL model triage as an orthogonal boolean `needs_triage` on an issue (`NOT NULL DEFAULT false`), separate from the fixed six statuses, which remain unchanged and non-configurable. An issue awaiting triage SHALL still carry one of the six statuses. No status SHALL be added or made configurable.

Work-graph placement: a boolean flag on `issue`, orthogonal to `status`. Permission story: the flag is written only through the triage mutators, each `canWrite`-gated and team-scoped.

#### Scenario: The six statuses are unchanged

- **WHEN** the issue status enum is inspected
- **THEN** it still contains exactly Backlog, Todo, In Progress, In Review, Done, and Canceled, and no triage status exists

#### Scenario: Existing issues are not in triage

- **WHEN** the migration adds `needs_triage`
- **THEN** every existing issue has `needs_triage = false` and continues to appear in the normal list and board

### Requirement: An issue enters triage by creation or flagging

The system SHALL let an issue enter triage two ways: created with `needsTriage` set through `issue.create` — the argument a programmatic ingest of externally-created issues would set; no shipped UI surface or connector sets it today — or flagged from an existing issue through `issue.flagTriage`. Flagging SHALL be `canWrite`-gated and team-scoped, rejecting viewers and non-members before existence is revealed.

Work-graph placement: entry into the inbox sets the orthogonal flag; the issue's status is untouched. Permission story: only writers on the issue's team may flag.

#### Scenario: Create an issue directly into triage

- **WHEN** an issue is created with `needsTriage` true
- **THEN** it is stored with `needs_triage = true` and appears in that team's triage inbox, not the normal list

#### Scenario: Flag an existing issue into triage

- **WHEN** a member flags an existing issue for triage
- **THEN** its `needs_triage` becomes true and it moves from the normal list into the inbox

#### Scenario: A viewer cannot flag for triage

- **WHEN** a viewer attempts to flag an issue for triage
- **THEN** the mutation is rejected before any write

### Requirement: A team-scoped triage inbox lists awaiting-triage issues

The system SHALL provide a team-scoped synced query `triage.inbox` returning exactly the issues with `needs_triage = true` for a team, oldest first, under the same team-scoped predicate as issues: a user syncs only their teams' inbox, and a non-member gets an empty result. Issues awaiting triage SHALL be excluded from `issues.byTeam` and `issues.mine`.

Work-graph placement: a filtered view of `issue` by the orthogonal flag. Permission story: read requires membership (deny by empty query); the inbox is held out of the normal issue queries.

#### Scenario: The inbox lists only awaiting-triage issues

- **WHEN** a member queries their team's triage inbox
- **THEN** it returns only issues with `needs_triage = true`, and those issues do not appear in `issues.byTeam`

#### Scenario: The inbox is team-scoped

- **WHEN** a user who is not a member of a team queries that team's triage inbox
- **THEN** the synced query returns nothing (deny by empty query)

### Requirement: Accept, Decline, and Route clear triage

The system SHALL provide three shared mutators that clear `needs_triage`, each `canWrite`-gated and team-scoped:

- `issue.acceptTriage` SHALL clear the flag and leave the status unchanged (the issue becomes a normal issue at its current status).
- `issue.declineTriage` SHALL clear the flag and set the status to `canceled`.
- `issue.routeIssue` SHALL clear the flag and, in one atomic write, apply any of a status, an assignee, a cycle, and labels — each validated to the issue's team, cross-team rejected.

Team reassignment SHALL NOT be part of routing. All three SHALL be optimistic (sub-100ms) and reject viewers and non-members before existence is revealed.

Work-graph placement: each action updates only existing rows (the issue and its label edges); no id is minted inside a mutator. Permission story: `canWrite` then `loadIssueForWrite` (auth before existence), same-team validation for routed assignee/cycle/labels.

#### Scenario: Accept clears triage and keeps status

- **WHEN** a member accepts an inbox issue whose status is Backlog
- **THEN** its `needs_triage` becomes false, its status stays Backlog, and it reappears in the normal list

#### Scenario: Decline clears triage and cancels

- **WHEN** a member declines an inbox issue
- **THEN** its `needs_triage` becomes false and its status becomes Canceled

#### Scenario: Route accepts with fields and rejects cross-team

- **WHEN** a member routes an inbox issue with a same-team assignee, cycle, and labels
- **THEN** its `needs_triage` becomes false and those fields are applied atomically, while a cross-team assignee, cycle, or label is rejected

#### Scenario: A viewer cannot triage

- **WHEN** a viewer attempts to accept, decline, or route an inbox issue
- **THEN** the mutation is rejected before any write and the inbox is unchanged

### Requirement: A keyboard-first Triage view and command-palette actions

The system SHALL provide a Triage inbox view at `/teams/$teamId/triage`, reached from the application frame's Triage destination (and its `g t` shortcut) rather than from a per-page view switcher, listing the team's awaiting-triage issues with keyboard-first Accept, Decline, and Route actions, correct across all three theme presets in light and dark. The command palette SHALL offer Accept, Decline, Route, and Send-to-triage on the targeted issue(s), gated to writers. All triage actions SHALL be hidden and never written for a viewer.

Work-graph placement: a destination over the same team-scoped issues, filtered to the inbox. Permission story: actions rendered and dispatched only for `canWrite`.

#### Scenario: Keyboard-first accept from the inbox

- **WHEN** a member focuses an inbox issue and presses the accept key
- **THEN** the issue is accepted optimistically and leaves the inbox without a full-page reload

#### Scenario: Viewer sees a read-only inbox

- **WHEN** a viewer opens the Triage view
- **THEN** the inbox is readable but the accept/decline/route controls are absent

#### Scenario: Reached from the frame rather than a view switcher

- **WHEN** a member on any team surface activates the deck's Triage destination, by pointer or by pressing `g` then `t`
- **THEN** the Triage view opens with the Triage destination marked as the current page

