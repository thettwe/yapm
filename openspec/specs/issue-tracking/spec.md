# issue-tracking Specification

## Purpose
TBD - created by archiving change issue-core. Update Purpose after archive.
## Requirements
### Requirement: Issue entity bound to a team

The system SHALL provide an `issue` entity carrying a title, an optional rich `description` (a TipTap-v3 document stored as JSON), a `status`, a `priority`, an optional `assignee`, a `creator`, an optional server-assigned per-team `number`, and created/updated timestamps. Every issue SHALL belong to exactly one `team` via a `team_id` reference. The primary key SHALL be a client-minted UUIDv7 generated at the mutator call site, never inside a mutator body.

Work-graph placement: `issue` is the tracking root and hangs off `team`, which hangs off the single `workspace`; it is the entity the work-graph delivery edges (the `issue_link` edge to `pull_request`, and through it `ci_check` and `review`) attach to. Sync/permission story: an issue SHALL sync only to members of its team (a `whereExists` over the team's roster driven by the verified `ctx.userID`); an authenticated non-member and any caller who does not belong to the issue's team SHALL read nothing, denied by an empty query with no leak of existence. Writes SHALL be permitted to admins and members of the issue's team and rejected for viewers and non-members, with authorization checked before any existence check.

#### Scenario: Member creates an issue in their team

- **WHEN** a member of a team creates an issue with a title, status, and priority
- **THEN** the issue is created with a client-minted UUIDv7 id, `creator` set from the verified `ctx.userID` (never from args), and becomes visible to every member of that team

#### Scenario: Non-member cannot see another team's issue

- **WHEN** an authenticated user who is not a member of an issue's team queries issues
- **THEN** the query returns an empty result for that issue and never reveals its existence

#### Scenario: Viewer cannot write issues

- **WHEN** a `viewer` attempts to create or edit an issue
- **THEN** the mutator rejects it as not authorized before any existence check

#### Scenario: Description is stored and re-rendered as rich text

- **WHEN** a member saves an issue description authored in the TipTap editor
- **THEN** the description persists as a TipTap JSON document and re-renders with its formatting intact on another client

### Requirement: Fixed status and priority model

Issue `status` SHALL be exactly one of the fixed categories Backlog, Todo, In Progress, In Review, Done, or Canceled, and `priority` SHALL be exactly one of No priority, Low, Medium, High, or Urgent. These sets SHALL NOT be user-configurable, and no custom statuses, priorities, or issue types SHALL be supported. A write attempting a value outside these sets SHALL be rejected on both client and server.

Work-graph placement: status and priority are intrinsic scalar attributes of `issue`; they carry no sync story beyond the issue's own team-scoped visibility. Permission story: changing status or priority is a write gated by team-scoped `canWrite`.

#### Scenario: All six statuses are representable

- **WHEN** an issue is moved through Backlog, Todo, In Progress, In Review, Done, and Canceled
- **THEN** each transition persists and the corresponding tokenized status glyph (including the Canceled variant) renders

#### Scenario: Invalid status is rejected

- **WHEN** a client submits a status value outside the fixed category set
- **THEN** the mutator rejects it with a validation error on both the optimistic client pass and the authoritative server pass

### Requirement: Server-authoritative per-team issue number

Each issue SHALL be assigned a per-team monotonic `number` forming a human-facing key of the form `<team key>-<number>` (e.g. `ENG-142`). Because the client mints the UUIDv7 primary key optimistically and cannot know the number, the `number` SHALL be assigned ONLY in the server-authoritative mutator pass, drawn from a per-team counter claimed atomically so that concurrent creates in the same team never collide and different teams never contend. The client optimistic create SHALL leave `number` unset (null); the UI SHALL render a pending key until the authoritative number replicates back, then settle without a reload. The number SHALL NOT be generated inside the shared client mutator body.

Work-graph placement: the per-team counter is a server-only leaf off `team`, excluded from the Zero schema so its churn never syncs to clients. Permission story: the counter is written only by the server mutator pass; it is never read or written by clients directly.

#### Scenario: Number is assigned by the server, not the client

- **WHEN** a member creates an issue optimistically
- **THEN** the client shows a pending key with no fabricated number, and the authoritative server pass assigns the next per-team number which then appears on the row without a reload

#### Scenario: Concurrent creates get distinct sequential numbers

- **WHEN** two members create issues in the same team at the same time
- **THEN** each authoritative issue receives a distinct, sequential per-team number with no collision

#### Scenario: Numbering is isolated per team

- **WHEN** issues are created in two different teams
- **THEN** each team's numbers advance independently and neither team's counter is affected by the other

### Requirement: Labels and issue labeling

The system SHALL provide a `label` entity (a name and a color) that belongs to a `team`, and an `issue_label` edge assigning labels to issues as a many-to-many relationship with a compound key of issue and label. A label SHALL only be assignable to an issue in the same team. Label color SHALL be validated so an unparseable color is rejected.

Work-graph placement: `label` hangs off `team`; `issue_label` is an edge between `issue` and `label` within one team. Sync/permission story: labels and issue-label edges SHALL sync only to members of the owning team (via the team/issue scope), denied by empty query otherwise; creating/renaming/deleting labels and adding/removing labels on issues SHALL be gated by team-scoped `canWrite`, checked before existence; viewers SHALL be rejected for every label write.

#### Scenario: Member labels an issue

- **WHEN** a member adds a team label to an issue in that team
- **THEN** an `issue_label` edge is created and the label renders on the issue row and detail for every team member

#### Scenario: Cross-team labeling is rejected

- **WHEN** a caller attempts to attach a label to an issue in a different team than the label
- **THEN** the mutator rejects it as invalid

#### Scenario: Viewer cannot manage labels

- **WHEN** a `viewer` attempts to create a label or attach one to an issue
- **THEN** the mutator rejects it as not authorized before any existence check

### Requirement: Comments on issues

The system SHALL provide a `comment` entity hanging off an `issue`, carrying a rich `body` (a TipTap-v3 document stored as JSON), an `author`, and timestamps. The comment primary key SHALL be a client-minted UUIDv7 at the call site, and the `author` SHALL be taken from the verified `ctx.userID`, never from args. A comment SHALL be editable and deletable only by its author or a workspace admin.

Work-graph placement: `comment` hangs off `issue` (and transitively off `team`). Sync/permission story: comments SHALL sync only to members of the comment's issue's team; creating a comment SHALL be gated by team-scoped `canWrite`; editing/deleting SHALL require author-or-admin, checked before existence so a private issue's existence never leaks.

#### Scenario: Member comments on an issue

- **WHEN** a member of the issue's team posts a comment
- **THEN** the comment is created with a client-minted id and `author` from `ctx`, and appears in the issue's comment thread for every team member

#### Scenario: Only author or admin can edit a comment

- **WHEN** a user who is neither the comment's author nor an admin attempts to edit or delete it
- **THEN** the mutator rejects it as not authorized before revealing whether the comment exists

#### Scenario: Viewer cannot comment

- **WHEN** a `viewer` attempts to post a comment
- **THEN** the mutator rejects it as not authorized

### Requirement: Reality-track and divergence computation seam

The system SHALL model the issue-row's delivery signal (the reality track) and its `//` divergence break as pure derived values computed in `packages/schema`, not as stored columns on `issue`. A `computeDeliverySignal(issue, linkedEntities)` function SHALL return a typed delivery signal or null, and a `computeDivergence(status, signal)` function SHALL return a typed divergence marker or null. With the `connectors` change, real linked git entities (pull requests, checks, reviews, deployments) now exist, so `linkedEntities` is populated from an issue's linked delivery entities and `computeDeliverySignal` returns a **non-null** signal (PR state, CI health, review age) for a linked issue, while an unlinked issue still yields null — and the dense-row surface then draws no track at all: the slot keeps its full reserved measure and lays down no ink, no station, no segment and no age text. The issue detail's vertical rail is the deliberate exception and keeps an explicit station saying the change is not linked. `computeDivergence` SHALL return a marker when the human-set status disagrees with git reality (e.g. In Progress but PR merged; Done but CI failing). No git-shaped columns (PR state, CI status) SHALL be added to `issue`; delivery reality SHALL remain modeled as linked entities so that the seam's exported signatures stay unchanged and only their inputs become non-empty.

The rendering rule is a property of the **facts** the seam produced, never of the shape a surface drew from them: a signal is fact-free only when every axis it carries is absent. A pull request that ended without merging, or a review age with no open pull request behind it, is a fact the seam produced, so its row is drawn and announced even though no station fills for it.

Divergence SHALL remain the system's response wherever opt-in status automation does not act — that is, for every team with automation off, and for every event a guard blocks. Where a transition does fire, the divergence marker SHALL become null **by construction**, because status and git then agree; the seam SHALL NOT be suppressed, weakened, or special-cased for automated writes, and no new `DivergenceKind` SHALL be introduced. Both exported functions SHALL keep the signatures and the returned union that issue-core defined.

Work-graph placement: the seam is a computation over `issue` and its linked work-graph entities (defined in the work-graph capability). Permission story: the computation runs over already-permitted, team-scoped synced rows and adds no new visibility surface.

#### Scenario: The reality track renders a linked issue's real state

- **WHEN** an issue linked to a pull request and its checks is rendered in the list or detail
- **THEN** `computeDeliverySignal` returns a non-null signal and the reality-track slot shows PR state, CI health, and review age

#### Scenario: The reality track renders the unlinked state

- **WHEN** an issue with no linked git entities is rendered in a dense row
- **THEN** `computeDeliverySignal` returns null and the reality-track slot is reserved and inkless — no station, no segment, no age text, and no accessible label — while the issue detail's vertical rail keeps its explicit "no change linked yet" station

#### Scenario: A signal with a fact no station draws is still drawn

- **WHEN** an issue's linked pull request was closed without merging, and no check has run
- **THEN** the row draws its track and announces the facts it holds, because fact-freeness is decided from the signal's axes rather than from the stations the drawing happened to fill

#### Scenario: The divergence break fires when status disagrees with git

- **WHEN** an issue is marked In Progress while its linked PR is merged, or Done while its CI is failing
- **THEN** `computeDivergence` returns the corresponding marker and the `//` divergence break is drawn on the track

#### Scenario: The divergence break is dormant without delivery state

- **WHEN** an issue with no linked git entities is evaluated for divergence
- **THEN** `computeDivergence` returns null and the track carries no `//` break, regardless of the human-set status

#### Scenario: No git columns on the issue

- **WHEN** the issue schema is inspected
- **THEN** it carries no PR/CI/deploy columns, and the delivery signal is available only through the computation seam over linked entities

#### Scenario: Divergence is unchanged for a team with automation off

- **WHEN** a team has status automation off and one of its issues is In Progress with a merged linked pull request
- **THEN** `computeDivergence` returns the same marker it returned before status automation existed

#### Scenario: A fired transition leaves no divergence to report

- **WHEN** status automation moves an issue to Done on a merge
- **THEN** `computeDivergence` returns null because the status and the pull request agree, with no suppression logic involved

#### Scenario: The divergence union does not grow

- **WHEN** the seam is inspected
- **THEN** `computeDeliverySignal` and `computeDivergence` keep their signatures and `DivergenceKind` holds exactly the markers it held before

### Requirement: Reality-aware filter and saved-view model

The system SHALL define a typed, structured `IssueFilter` with intention axes (status, priority, assignee including an explicit unassigned option, label, and free text) AND a delivery axis for derived delivery predicates (blocked-on-review, failing-CI, merged-not-deployed). Intention predicates SHALL filter synced issue rows; delivery predicates SHALL evaluate through the delivery-signal computation seam over an issue's linked entities. With the `connectors` change the delivery signal is real, so all three delivery predicates SHALL be offered as selectable filter controls and evaluated through the seam; where a predicate has no data to consult — an issue with no linked delivery state, or merged-not-deployed, for which no issue↔deployment edge is modelled — it SHALL match nothing rather than the control being hidden. The system SHALL persist a `saved_view` entity carrying a name, an `IssueFilter`, a grouping, and a sort.

Work-graph placement: `saved_view` hangs off `team` as a shared, team-visible configuration entity. Sync/permission story: saved views SHALL sync to all members of their team; creating and editing SHALL be gated by team-scoped `canWrite`; deleting SHALL require the view's creator or an admin; viewers SHALL read shared views but never create, edit, or delete them.

#### Scenario: Intention filter narrows the list

- **WHEN** a member applies a filter by status, assignee, label, or priority
- **THEN** the synced issue rows are narrowed accordingly, evaluated locally without a network round-trip

#### Scenario: Delivery-only filter narrows by derived signal

- **WHEN** a filter sets only a delivery predicate and no intention predicate
- **THEN** the list shows the issues whose computed delivery signal matches that predicate, and is empty — rather than the control being hidden — when no issue has linked delivery state

#### Scenario: Saved view persists and syncs to the team

- **WHEN** a member saves a view with a filter, grouping, and sort
- **THEN** the `saved_view` persists via the shared mutator and syncs to every member of the team

#### Scenario: Viewer cannot mutate saved views

- **WHEN** a `viewer` attempts to create, edit, or delete a saved view
- **THEN** the mutator rejects it as not authorized while the viewer can still read the team's shared views

### Requirement: Issue mutations via shared mutators

All issue, label, comment, and saved-view writes SHALL flow through custom mutators defined once in `packages/schema` and imported by both client (optimistic) and server (authoritative). The mutator set SHALL cover creating and updating issues, changing status, setting priority, assigning/unassigning, adding/removing labels, creating/editing/deleting comments, and managing labels and saved views. Every mutator SHALL enforce team-scoped role authorization from the verified `ctx` before any existence check, set owner/creator/author fields from `ctx` (never args), and mint any created row's UUIDv7 at the call site. Assignee changes SHALL validate that the assignee is a member of the issue's team.

Any feature that creates an issue on a user's behalf — including converting a retrospective action item — SHALL do so by calling the **same shared issue-creation mutator**, inheriting its authorization, its `ctx`-derived creator, its triage and status defaults, and its server-authoritative per-team numbering. A parallel insert into the issue table SHALL NOT exist.

Any feature that changes an issue's status on the system's own behalf — including a connector-driven status transition — SHALL likewise do so by calling the **same shared status mutator**, under an explicit `AuthContext`, so the team-scoped authorization runs unchanged. A parallel update path into `issue.status` SHALL NOT exist, and a non-human write SHALL be distinguished from a human one by the `AuthContext` it carries, never by a separate mutator.

Work-graph placement: these mutators are the sole write path into the team-scoped work-graph entities. Permission story: viewers and non-members are rejected for every write; author/creator-scoped operations additionally require ownership-or-admin; a system principal is an `AuthContext` like any other and is subject to the same checks.

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

#### Scenario: A derived status path reuses the shared status mutator

- **WHEN** a connector-driven transition changes an issue's status
- **THEN** it invokes the shared status mutator with a system `AuthContext`, that mutator's authorization runs, and no direct table or SQL write to `issue.status` exists anywhere

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

### Requirement: Issue carries a nullable cycle reference

An issue SHALL carry a nullable `cycleId` referencing a cycle in the same team. It SHALL be settable and clearable through the shared `issue.setCycle` mutator, which SHALL reject a cycle in a different team and SHALL be gated exactly as other issue writes (viewers rejected). Deleting a cycle SHALL null the `cycleId` of its issues (`ON DELETE SET NULL`), never deleting the issues.

Work-graph placement: a nullable `issue.cycle_id` edge to `cycle`. Permission story: `canWrite` + team access; cross-team assignment rejected.

#### Scenario: An issue can be assigned to and cleared from a cycle

- **WHEN** a member assigns an issue to a same-team cycle and later clears it
- **THEN** the issue's `cycleId` is set then unset, and a cross-team cycle is rejected

#### Scenario: Deleting a cycle preserves its issues

- **WHEN** a cycle that has issues is deleted
- **THEN** those issues remain and their `cycleId` becomes null

### Requirement: Issue carries an orthogonal triage flag

An issue SHALL carry a `needs_triage` boolean (`NOT NULL DEFAULT false`), orthogonal to its status. It SHALL be settable through `issue.create` (optional `needsTriage`) and `issue.flagTriage`, and cleared through `issue.acceptTriage`, `issue.declineTriage`, and `issue.routeIssue`. Each triage mutator SHALL be gated exactly as other issue writes (viewers rejected, team-scoped, cross-team routed fields rejected). Issues with `needs_triage = true` SHALL be excluded from `issues.byTeam` and `issues.mine` and returned only by `triage.inbox`.

Work-graph placement: a boolean flag on `issue`, orthogonal to `status`. Permission story: `canWrite` + team access; routed assignee/cycle/label validated same-team.

#### Scenario: Triage issues are held out of the normal list

- **WHEN** an issue has `needs_triage = true`
- **THEN** it is absent from `issues.byTeam` and `issues.mine` and present in `triage.inbox`, and clearing the flag returns it to the normal list

#### Scenario: Routing applies same-team fields atomically

- **WHEN** a writer routes an inbox issue with a status, a same-team assignee, a same-team cycle, and same-team labels
- **THEN** the flag clears and all fields apply in one optimistic write, and any cross-team field is rejected

### Requirement: An issue can belong to a project

The system SHALL add a nullable `project_id` to `issue`, referencing a workspace-level project with `ON DELETE SET NULL`, written only through the `issue.setProject` shared mutator. Setting or clearing the project SHALL be `canWrite`-gated and run the issue's team-scoped write gate; the referenced project SHALL only be required to exist in the workspace. Existing issues SHALL be unaffected (`project_id` null).

Work-graph placement: the issue↔project edge, orthogonal to team, cycle, status, and triage. Permission story: written under the issue's existing team-scoped write permission; the project entity itself is workspace-level.

#### Scenario: An issue starts with no project

- **WHEN** the migration adds `project_id`
- **THEN** every existing issue has `project_id = null` and behaves exactly as before

#### Scenario: Assigning and clearing a project

- **WHEN** a writer sets an issue's project and later clears it
- **THEN** `project_id` is set then returns to null, each write gated by the issue's team-scoped permission

#### Scenario: A deleted project unassigns the issue

- **WHEN** an issue's project is deleted
- **THEN** the issue's `project_id` becomes null and the issue is otherwise unchanged

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

### Requirement: Issue records when a human last set its status

The `issue` entity SHALL carry a nullable `last_human_status_at` timestamp recording when a **person**
last wrote its status. Every shared mutator that writes `issue.status` — creating an issue, setting
its status, moving it on the board, and routing it out of triage — SHALL stamp this column from the
mutator's own `updatedAt` argument, **except** when the invoking `AuthContext` is the system
principal, in which case the column SHALL be left untouched. The stamp SHALL be a pure function of
the arguments and the context so that it is identical on the optimistic client pass and the
authoritative server pass and survives rebase. The column SHALL record a timestamp only — never a
user id, a name, or a count — so it constitutes no per-person record. Existing issues SHALL be
backfilled from `updated_at` when the column is introduced, so no pre-existing issue is treated as
never having been touched by a human.

Work-graph placement: a scalar attribute of `issue`, the tracking root; no new entity and no new
edge. Sync/permission story: it replicates under the issue's existing team scope and is written only
by the same shared mutators that write the status itself, so it inherits their authorization exactly.

#### Scenario: A human status change stamps the column

- **WHEN** a member changes an issue's status, moves it between board columns, or routes it out of
  triage with a status
- **THEN** `last_human_status_at` is set to that mutation's timestamp

#### Scenario: A system-principal status change does not stamp the column

- **WHEN** the status is written under the system principal
- **THEN** `last_human_status_at` is unchanged, which is the record that the last status change was
  not a person's

#### Scenario: Every status-writing mutator is covered

- **WHEN** the shared mutator set is inspected for mutators that write `issue.status`
- **THEN** each one stamps `last_human_status_at` for a human context and leaves it untouched for the
  system principal, with no status-writing mutator omitted

#### Scenario: The column carries no identity

- **WHEN** the issue schema is inspected
- **THEN** the column holds a timestamp only, with no user reference, so no per-person record exists

