## ADDED Requirements

### Requirement: Issue entity bound to a team

The system SHALL provide an `issue` entity carrying a title, an optional rich `description` (a TipTap-v3 document stored as JSON), a `status`, a `priority`, an optional `assignee`, a `creator`, an optional server-assigned per-team `number`, and created/updated timestamps. Every issue SHALL belong to exactly one `team` via a `team_id` reference. The primary key SHALL be a client-minted UUIDv7 generated at the mutator call site, never inside a mutator body.

Work-graph placement: `issue` is the tracking root and hangs off `team`, which hangs off the single `workspace`; it is the entity every later work-graph edge (PR link, CI run, deploy) will attach to. Sync/permission story: an issue SHALL sync only to members of its team (a `whereExists` over the team's roster driven by the verified `ctx.userID`); an authenticated non-member and any caller who does not belong to the issue's team SHALL read nothing, denied by an empty query with no leak of existence. Writes SHALL be permitted to admins and members of the issue's team and rejected for viewers and non-members, with authorization checked before any existence check.

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

### Requirement: Reality-strip and divergence computation seam

The system SHALL model the issue-row's delivery signal (reality strip) and divergence flag as pure derived values computed in `packages/schema`, not as stored columns on `issue`. A `computeDeliverySignal(issue, linkedEntities)` function SHALL return a typed delivery signal or null, and a `computeDivergence(status, signal)` function SHALL return a typed divergence marker or null. In this change there are no linked git entities, so the delivery signal SHALL always be null (the reality strip renders its quiet "not linked" state) and the divergence flag SHALL always be dormant. No git-shaped columns (PR state, CI status) SHALL be added to `issue`; delivery reality is modeled as future linked entities, so that `connectors` can populate the signal by changing only these functions and their inputs, leaving the issue schema, rows, queries, and filter model unchanged.

Work-graph placement: the seam is a computation over `issue` and its (future) linked work-graph entities; it introduces no new synced entity in this change. Permission story: the computation runs over already-permitted synced rows and adds no new visibility surface.

#### Scenario: Reality strip renders the unlinked state

- **WHEN** an issue with no linked git entities is rendered in the list or detail
- **THEN** `computeDeliverySignal` returns null and the reality-strip slot shows the quiet "not linked" placeholder

#### Scenario: Divergence flag is dormant without delivery state

- **WHEN** any issue is evaluated for divergence in this change
- **THEN** `computeDivergence` returns null and no divergence flag is shown, regardless of the human-set status

#### Scenario: No git columns on the issue

- **WHEN** the issue schema is inspected
- **THEN** it carries no PR/CI/deploy columns, and the delivery signal is available only through the computation seam

### Requirement: Reality-aware filter and saved-view model

The system SHALL define a typed, structured `IssueFilter` with intention axes (status, priority, assignee including an explicit unassigned option, label, and free text) AND a reserved delivery axis for derived delivery predicates (e.g. blocked-on-review, failing-CI, merged-not-deployed). Intention predicates SHALL filter synced issue rows; delivery predicates SHALL evaluate through the delivery-signal computation seam and, in this change, match nothing (the signal is always null). The system SHALL persist a `saved_view` entity carrying a name, an `IssueFilter`, a grouping, and a sort. No default reality-derived views (blocked-on-review, failing-CI, merged-not-deployed) SHALL be shipped in this change; only the model that can hold them.

Work-graph placement: `saved_view` hangs off `team` as a shared, team-visible configuration entity. Sync/permission story: saved views SHALL sync to all members of their team; creating and editing SHALL be gated by team-scoped `canWrite`; deleting SHALL require the view's creator or an admin; viewers SHALL read shared views but never create, edit, or delete them.

#### Scenario: Intention filter narrows the list

- **WHEN** a member applies a filter by status, assignee, label, or priority
- **THEN** the synced issue rows are narrowed accordingly, evaluated locally without a network round-trip

#### Scenario: Delivery-only filter yields empty by construction

- **WHEN** a filter sets only a reserved delivery predicate and no intention predicate
- **THEN** the result is empty because the delivery signal is always null in this change, and no such view is shipped as a default

#### Scenario: Saved view persists and syncs to the team

- **WHEN** a member saves a view with a filter, grouping, and sort
- **THEN** the `saved_view` persists via the shared mutator and syncs to every member of the team

#### Scenario: Viewer cannot mutate saved views

- **WHEN** a `viewer` attempts to create, edit, or delete a saved view
- **THEN** the mutator rejects it as not authorized while the viewer can still read the team's shared views

### Requirement: Issue mutations via shared mutators

All issue, label, comment, and saved-view writes SHALL flow through custom mutators defined once in `packages/schema` and imported by both client (optimistic) and server (authoritative). The mutator set SHALL cover creating and updating issues, changing status, setting priority, assigning/unassigning, adding/removing labels, creating/editing/deleting comments, and managing labels and saved views. Every mutator SHALL enforce team-scoped role authorization from the verified `ctx` before any existence check, set owner/creator/author fields from `ctx` (never args), and mint any created row's UUIDv7 at the call site. Assignee changes SHALL validate that the assignee is a member of the issue's team.

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
