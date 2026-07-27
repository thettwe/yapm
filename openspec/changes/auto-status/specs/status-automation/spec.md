## ADDED Requirements

### Requirement: Opt-in per-team status automation, off by default

The system SHALL let a team opt in to having linked pull-request state drive its issues' status, and
SHALL keep that automation **off by default**. The setting SHALL be stored on the `team` entity as a
single nullable `auto_status_since` timestamp: `NULL` means automation is off, and a value means
automation is enabled **as of that instant**. Enabling automation SHALL NOT change any existing
issue; a work-graph event whose own source timestamp precedes `auto_status_since` SHALL NOT drive
any status, so first-install backfill and reconciliation of historical pull requests can never
retroactively rewrite a board. Disabling automation SHALL set the value back to `NULL`, and
re-enabling SHALL record a fresh instant so a disabled window is never replayed. The setting SHALL be
per team and SHALL NOT be a workspace-wide switch.

Work-graph placement: `auto_status_since` is a scalar configuration attribute of `team`, which hangs
off the single `workspace`; it introduces no new entity and no new edge. Sync/permission story: it
replicates with the `team` row under the existing team read scope, so every member of the workspace
can see whether a team's board moves on its own; only an `admin` MAY write it, through the shared
`team.setAutoStatus` mutator, with authorization checked before the team is loaded.

#### Scenario: A fresh instance behaves exactly as before

- **WHEN** an instance is upgraded and no team has enabled automation
- **THEN** every team's `auto_status_since` is `NULL`, no pull-request event writes any issue status,
  and the divergence flag behaves identically to before the upgrade

#### Scenario: Enabling automation does not rewrite the existing board

- **WHEN** an admin enables automation for a team that already has issues linked to pull requests
  merged before that moment
- **THEN** no issue's status changes, because every one of those events predates `auto_status_since`

#### Scenario: Only an admin can change the setting

- **WHEN** a `member` or `viewer` attempts to enable or disable a team's status automation
- **THEN** the mutator rejects it as not authorized before any existence check, and the setting is
  unchanged

#### Scenario: The setting is per team

- **WHEN** automation is enabled for team T1 and left off for team T2, and each has an issue linked
  to a merged pull request
- **THEN** T1's issue transitions and T2's issue does not

### Requirement: Two supported transitions, forward only

For a team with automation enabled, the system SHALL transition a linked issue to **In Review** when
its linked pull request enters the `open` state, and to **Done** when its linked pull request enters
the `merged` state. No other pull-request state SHALL drive any transition: a `draft` pull request
and a pull request `closed` without merging SHALL drive nothing. Automation SHALL move an issue only
**forward** along the ladder Backlog → Todo → In Progress → In Review → Done; a target at or below
the issue's current position SHALL be a no-op, so an issue is never moved backward and never moved
sideways. Automation SHALL NOT write the `canceled` status and SHALL NOT write over it. Automation
SHALL NOT change an issue's assignee, priority, cycle, project, labels, or triage flag, and SHALL
NOT write anything back to the connector's provider.

Work-graph placement: a derived write from the `issue ↔ pull_request` edge onto the `issue` root; it
adds no entity. Permission story: the write is performed through the shared issue status mutator
under the system principal and is subject to that mutator's own team-scoped authorization.

#### Scenario: An opened pull request moves the issue to In Review

- **WHEN** a pull request whose branch or body references `ENG-1` enters the `open` state and team
  ENG has automation enabled with `ENG-1` in Todo
- **THEN** `ENG-1` becomes In Review

#### Scenario: A merged pull request moves the issue to Done

- **WHEN** that same pull request is merged
- **THEN** `ENG-1` becomes Done

#### Scenario: A draft pull request drives nothing

- **WHEN** a linked pull request is opened as a draft
- **THEN** no status is written and the issue's reality strip shows the draft PR state as before

#### Scenario: A pull request closed without merging drives nothing

- **WHEN** a linked pull request is closed without being merged
- **THEN** no status is written, and an In Review issue whose pull request has gone away is reported
  by the existing divergence marker rather than by a transition

#### Scenario: Automation never moves an issue backward

- **WHEN** an issue is Done and a newly linked pull request for it enters the `open` state
- **THEN** the issue stays Done, because In Review is below Done on the ladder

#### Scenario: A canceled issue is never touched

- **WHEN** a linked pull request for a Canceled issue is merged
- **THEN** the issue stays Canceled

### Requirement: Guards that protect deliberate human intent

The system SHALL NOT apply a transition when any of the following holds, evaluated before the
transition is chosen: the team has automation off; the event's own source timestamp precedes the
team's `auto_status_since`; the pull request's effective state did not actually change as a result
of this event (no state **edge**); the issue carries the `needs_triage` flag; the issue's status is
`canceled`; or the issue's `last_human_status_at` is **newer than the event's own source timestamp**.
The human-intent guard SHALL be a comparison against the event's own timestamp and SHALL NOT be a
fixed grace period measured from arrival. Because the guard is keyed to the event rather than to the
clock, a delayed or reconciliation-healed event SHALL NOT overwrite a status a person set after the
event actually happened, while a status a person set shortly *before* opening a pull request SHALL
NOT prevent the transition that pull request warrants.

Work-graph placement: a precondition ladder over the `issue`, its `team`, and the `pull_request`
state change; no entity. Permission story: unchanged — a blocked transition writes nothing at all.

#### Scenario: A redelivered event is inert

- **WHEN** the same merged-pull-request delivery is processed twice
- **THEN** the second one produces no state edge, writes no status, and the issue remains as the
  first one left it

#### Scenario: Activity on an already-merged pull request does not re-fire the transition

- **WHEN** a comment or label bumps a merged pull request's modification time long after the merge,
  and a member has since moved the issue back to In Progress
- **THEN** no transition occurs, because the pull request's state did not change

#### Scenario: A healed missed event does not undo yesterday's decision

- **WHEN** reconciliation discovers a pull request that merged two days ago, and a member set that
  issue's status yesterday
- **THEN** the transition is blocked because `last_human_status_at` is newer than the event's own
  timestamp, and the divergence flag reports the disagreement instead

#### Scenario: Setting a status just before opening a pull request does not block the transition

- **WHEN** a member sets an issue to In Progress and opens a linked pull request two minutes later
- **THEN** the issue transitions to In Review, because the event is newer than the human's write

#### Scenario: An untriaged issue is not advanced

- **WHEN** a linked pull request is merged for an issue still flagged `needs_triage`
- **THEN** no status is written and the issue remains in the triage inbox

### Requirement: The transition is performed by a system principal through the shared mutator

The status write SHALL go through the **same shared issue status mutator** in `packages/schema` that
the keyboard, the board, and the AI agent call — never a raw table write and never a direct SQL
update — so the transition re-runs that mutator's team-scoped authorization. It SHALL be performed
under a **system principal** (`userID: 'system'`, workspace role `admin`), defined once in
`packages/schema` and shared with the cycle-rollover job, and SHALL NOT be attributed to the person
who opened the pull request, whose provider identity may map to no yapm user at all. The system
principal SHALL be reachable only from server-side call sites driven by instance-produced data,
never from user input. The number of linked issues one pull-request event may transition SHALL be
bounded.

Work-graph placement: the write path from the delivery edge onto `issue`; the principal is an
authorization context, not an entity. Permission story: the shared mutator's `canWrite` and
team-access checks run exactly as they do for a human; the principal's admin role is what lets one
instance-wide actor write across every team without a membership row, mirroring cycle rollover.

#### Scenario: The write goes through the shared mutator

- **WHEN** a transition fires
- **THEN** it is applied by invoking the shared issue status mutator with a system `AuthContext`, and
  no parallel write path into `issue.status` exists

#### Scenario: The transition is not attributed to the pull request's author

- **WHEN** a pull request opened by a person who is not a yapm user drives a transition
- **THEN** the write is performed by the system principal and no field on the issue records that
  person

#### Scenario: An automated write is distinguishable from a human one

- **WHEN** a transition writes a status
- **THEN** `last_human_status_at` is left untouched, which is the record that the last status change
  was not a person's

### Requirement: Divergence is the behaviour whenever automation does not act

The divergence flag SHALL remain the system's response wherever automation is off or a transition is
blocked, and SHALL go quiet on its own — by construction, not by suppression — wherever a transition
fires and makes status and git agree. The divergence computation SHALL NOT be disabled, weakened, or
special-cased by this capability, and no new divergence kind SHALL be introduced.

Work-graph placement: a computation over `issue` and its linked delivery entities, unchanged.
Permission story: unchanged — it adds no visibility surface.

#### Scenario: Automation off leaves divergence exactly as it was

- **WHEN** a team has automation off and one of its issues is In Progress with a merged linked pull
  request
- **THEN** the divergence flag fires exactly as it did before this capability existed

#### Scenario: A fired transition leaves nothing to diverge about

- **WHEN** automation moves an issue to Done on a merge
- **THEN** the divergence computation returns no marker, because the status and the pull request now
  agree

#### Scenario: A blocked transition still reports the disagreement

- **WHEN** a transition is blocked by the human-intent guard and the issue's status therefore
  disagrees with a merged pull request
- **THEN** the divergence flag fires, so the team sees the disagreement even though nothing was
  overwritten

### Requirement: Keyboard-operable, tokenized admin surface for the per-team setting

The system SHALL expose the per-team automation setting on the admin-only connector settings
surface, listing each team with its current state and a control to enable or disable it. The surface
SHALL state, at the point of decision, which transitions fire, that automation never moves an issue
backward and never touches Canceled or untriaged issues, and that enabling it does not change
existing issues. Every control SHALL be reachable by Tab and actionable by Enter or Space with no
pointer, SHALL announce its team and current state to assistive technology, and SHALL render strictly
from theme tokens — correct in all three presets in light and dark, at AA contrast. A non-admin SHALL
neither see nor be able to mutate the setting.

Work-graph placement: an admin configuration view over the `team` entity's automation column.
Permission story: admin-gated writes through the shared mutator; the value itself is readable by any
member because it replicates with the team row.

#### Scenario: Keyboard-only enable

- **WHEN** an admin reaches the automation control for a team using only Tab and activates it with
  Enter or Space
- **THEN** automation is enabled for that team with no pointer interaction and the control's new
  state is announced

#### Scenario: The setting persists across a reload

- **WHEN** an admin enables automation and reloads the application
- **THEN** the control still reads as enabled, having round-tripped through Postgres and the sync
  connection

#### Scenario: Non-admin cannot reach the control

- **WHEN** a member or viewer navigates to the connector settings surface
- **THEN** the automation section is not offered and any attempt to write the setting is rejected

#### Scenario: Tokenized in every theme

- **WHEN** the automation section is rendered in each preset in light and dark
- **THEN** every color and font comes from a theme token, with no hardcoded value and no contrast
  below AA

### Requirement: Automation is provider-neutral and adds no provider scope

The transition logic SHALL live behind the provider-neutral work-graph mutation union in
`packages/schema` and SHALL NOT read any provider-specific payload, so a second connector that emits
the same pull-request mutation inherits status automation with no feature-code change. The system
SHALL NOT write anything back to the provider — no comment, no label, no status, no check — and
SHALL NOT require any additional provider permission scope.

Work-graph placement: the decision is a pure function over the mutation union and the issue/team
rows it names. Permission story: unchanged on the provider side; the connector stays read-only.

#### Scenario: A second connector inherits automation

- **WHEN** a new provider is added by implementing the connector interface and emitting the same
  pull-request mutation variant
- **THEN** status automation works for it with no change to the transition logic, the settings
  surface, or the issue row

#### Scenario: Nothing is written back to the provider

- **WHEN** a transition fires
- **THEN** no request is made to the provider and the connector's granted scopes are unchanged
