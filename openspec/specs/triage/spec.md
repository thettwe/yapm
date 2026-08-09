# triage Specification

## Purpose
The inbox where unsorted work is decided, one issue at a time: triage as an orthogonal flag rather
than a seventh status, a queue whose head arrives unfolded into a decision panel, and three verdicts
under the fingers. The panel is the height of what it has — a description-less issue folds rather
than reserving a measure, because the product's grammar for a fact a row does not carry is absence.
Archived from change triage and extended by triage-daylight and render-defects-cleanup (PR #49).

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
- `issue.routeIssue` SHALL clear the flag and, in one atomic write, apply any of a status, an assignee, a cycle, a **project**, and labels. The assignee, the cycle and every label SHALL be validated to the issue's team, cross-team rejected. The project SHALL be required only to **exist in the workspace** and SHALL NOT be team-validated, because a project spans teams — the identical rule `issue.setProject` already applies, under the same issue-scoped write gate.

Team reassignment SHALL NOT be part of routing. All three SHALL be optimistic (sub-100ms) and reject viewers and non-members before existence is revealed.

Work-graph placement: each action updates only existing rows (the issue and its label edges); no id is minted inside a mutator, and no new table or column is added — `issue.project_id` already exists. Permission story: `canWrite` then `loadIssueForWrite` (auth before existence), same-team validation for routed assignee/cycle/labels, existence-only validation for the routed project.

#### Scenario: Accept clears triage and keeps status

- **WHEN** a member accepts an inbox issue whose status is Backlog
- **THEN** its `needs_triage` becomes false, its status stays Backlog, and it reappears in the normal list

#### Scenario: Decline clears triage and cancels

- **WHEN** a member declines an inbox issue
- **THEN** its `needs_triage` becomes false and its status becomes Canceled

#### Scenario: Route accepts with fields and rejects cross-team

- **WHEN** a member routes an inbox issue with a same-team assignee, cycle, and labels
- **THEN** its `needs_triage` becomes false and those fields are applied atomically, while a cross-team assignee, cycle, or label is rejected

#### Scenario: Route places the issue in a project

- **WHEN** a member routes an inbox issue with the id of a project that exists in the workspace, including a project whose other issues belong to a different team
- **THEN** the issue's `project_id` is set in the same atomic write that clears `needs_triage`, and no cross-team rejection occurs

#### Scenario: Routing to a project that does not exist is rejected

- **WHEN** a member routes an inbox issue with a project id that no project in the workspace carries
- **THEN** the mutation is rejected and neither `needs_triage` nor any other field on the issue is written

#### Scenario: A viewer cannot triage

- **WHEN** a viewer attempts to accept, decline, or route an inbox issue
- **THEN** the mutation is rejected before any write and the inbox is unchanged

### Requirement: A keyboard-first Triage view and command-palette actions

The system SHALL provide a Triage inbox view at `/teams/$teamId/triage`, reached from the application frame's Triage destination (and its `g t` shortcut) rather than from a per-page view switcher, listing the team's awaiting-triage issues **oldest first, all of them, with no fold** — a queue whose purpose is to be emptied SHALL show its own floor.

Every triage verdict SHALL be reachable and activatable without a pointer: `j`/`k` and the arrow keys move between waiting issues, `⏎` opens the issue, and `a`, `r` and `d` invoke Accept, Route and Decline on the issue under decision. The view SHALL be correct across all three theme presets in light and dark, meeting the contrast bar on every ground it draws.

The command palette SHALL offer Accept, Decline, Route, and Send-to-triage on the targeted issue(s), gated to writers. All triage actions SHALL be hidden and never written for a viewer.

The masthead SHALL state the page's name, a mono count of the waiting issues, and the ordering — and SHALL NOT repeat the team name, which the application frame's deck already carries. The ordering label SHALL NOT be drawn over an empty queue.

The count the masthead states SHALL be the length of the same `triage.inbox` result the team's attention number counts, so the masthead, the deck badge, the statusline and Team Home can never disagree about how many issues are waiting.

Work-graph placement: a destination over the same team-scoped issues, filtered to the inbox. Permission story: actions rendered and dispatched only for `canWrite`.

#### Scenario: Keyboard-first accept from the inbox

- **WHEN** a member focuses an inbox issue and presses the accept key
- **THEN** the issue is accepted optimistically and leaves the inbox without a full-page reload

#### Scenario: Viewer sees a read-only inbox

- **WHEN** a viewer opens the Triage view
- **THEN** the inbox is readable but the accept/decline/route controls are absent, and the accept, route and decline keys are inert

#### Scenario: Reached from the frame rather than a view switcher

- **WHEN** a member on any team surface activates the deck's Triage destination, by pointer or by pressing `g` then `t`
- **THEN** the Triage view opens with the Triage destination marked as the current page

#### Scenario: The masthead does not repeat the team

- **WHEN** a member opens the Triage view for a team
- **THEN** the masthead states the page name, the mono count and the ordering, and the team's name appears in the frame's deck rather than in the masthead

#### Scenario: One count, everywhere

- **WHEN** a team has issues awaiting triage and no other exception
- **THEN** the masthead's count, the deck's attention badge and the statusline's attention segment state the same number

### Requirement: A triage row is an issue-list row, with the reality slot reserved and empty

Each waiting issue SHALL be drawn with the **same row anatomy the issue list uses**, from the same shared row component, so a triage row and a list row line up column for column: the priority tick, the status arc, the mono issue key, the title, a spring, the phrase slot, the reality track, the track's mono age column, the labels as dot + name, a mono age, and a trailing avatar.

The reality slot SHALL be **reserved and empty** — its measure held, no ink laid down — because an issue awaiting triage has no linked change. No row SHALL bolt controls onto the outside of this anatomy.

The mono age column SHALL state the issue's `created_at` as a plain relative age. It SHALL NOT be coloured by age, marked overdue, compared to a target, or presented as any kind of service level — no such target exists.

The trailing avatar SHALL depict the issue's **reporter** and SHALL announce itself as such, because an issue awaiting triage has no meaningful assignee until routing sets one.

Work-graph placement: a rendering surface over rows the triage inbox already syncs; no new entity, query or mutator. Permission story: unchanged — every fact drawn comes from a row the caller already reads.

#### Scenario: A triage row lines up with a list row

- **WHEN** the same issue is drawn in the triage inbox and, once accepted, in the issue list
- **THEN** every column boundary is identical, and the triage row carries no control outside the row's anatomy

#### Scenario: The reality slot draws nothing

- **WHEN** the inbox renders any waiting issue
- **THEN** the reality slot occupies its reserved measure and draws no ink, because no triage issue has a linked change

#### Scenario: The age column makes no claim

- **WHEN** an issue has been waiting far longer than any other in the queue
- **THEN** its age column states the same plain relative age in the same ink as every other row, with no colour change, badge or overdue mark

### Requirement: The issue under decision unfolds in place

Exactly one waiting issue at a time SHALL unfold, in place and below its own row, into a decision panel carrying what makes the next decision fast:

- the issue's **own description**, rendered as written — the one document voice this surface admits;
- a mono line stating the **reporter** and the issue's **created-at**;
- each of the issue's attachments as an upload chip.

The unfolded issue SHALL be the issue the verdict keys act on, so the panel and the keys can never name different issues. On arrival that SHALL be the head of the queue — the oldest waiting issue — and moving the keyboard selection SHALL move the panel with it.

The panel SHALL be **the height of what it has**. When the unfolded issue carries no description, the panel SHALL NOT reserve the prose measure or the height that a description would have occupied: it SHALL fold to a single band carrying the provenance line, any attachment chips, and the verdicts, and SHALL NOT draw an empty region with the verdicts stranded beside it. No placeholder sentence SHALL stand in for the missing description — the product's grammar for a fact a row does not carry is absence, the same grammar the reality track and the vertical rail already follow.

Folding SHALL cost the reader nothing: every verdict, the movement hint and the route transient SHALL remain present, keyboard-reachable and named exactly as they are when a description is drawn.

The panel SHALL render entirely from rows already synced and SHALL introduce no new named query.

Work-graph placement: a rendering surface over the inbox's own rows plus the existing per-issue attachments query. Permission story: read-only; the panel writes nothing.

#### Scenario: The head of the queue arrives unfolded

- **WHEN** a member opens the Triage view for a team with waiting issues
- **THEN** the oldest waiting issue is unfolded, showing its description, its reporter and created-at, and its attachments, and every other waiting issue is a single row

#### Scenario: The panel follows the decision

- **WHEN** the member moves the keyboard selection to another waiting issue
- **THEN** that issue's panel unfolds, the previous one folds, and the verdict keys act on the newly unfolded issue

#### Scenario: An issue with no description or attachments

- **WHEN** the unfolded issue has neither a description nor an attachment
- **THEN** the panel states no placeholder text for either and the verdicts remain available

#### Scenario: A terse issue folds rather than reserving a measure

- **WHEN** the unfolded issue carries no description
- **THEN** the panel draws no prose region at all, folds to a single band carrying the provenance line and the verdicts, and its drawn height is the height of that band rather than the height a description would have taken

#### Scenario: Folding takes nothing away

- **WHEN** a member reaches the folded panel of a description-less issue by keyboard
- **THEN** Accept, Route, Decline, the movement hint and the route transient are all present and operable, each with the same name and key it carries on a panel that draws a description

### Requirement: The three verdicts are named keys, and Route opens the page's one transient

Accept, Route and Decline SHALL be drawn as **keys** — each stating its keycap and its word — and each SHALL be a control whose accessible name is the word. No verdict SHALL be an icon-only control, and no borrowed icon SHALL stand in for this product's own drawn marks.

`Route` SHALL open the page's **single transient**: a labelled panel naming the issue and listing exactly the fields routing writes — status, assignee, cycle, project and labels — each showing the value that will be written. The transient SHALL be reachable and operable from the keyboard, SHALL commit the whole routing in one mutation, SHALL close on `esc` with nothing written, and SHALL return focus to the row it was opened from. No control in it SHALL be offered that the routing mutator does not write.

Work-graph placement: three verdicts over the three existing triage mutators. Permission story: rendered and dispatched only for `canWrite`; a viewer sees none of them and the keys are inert.

#### Scenario: Verdicts are readable, not just clickable

- **WHEN** a member reads the decision panel by screen reader or by eye
- **THEN** each verdict states its word and its key, and none is an icon alone

#### Scenario: The route transient lists only what routing writes

- **WHEN** a member opens the route transient on a waiting issue
- **THEN** it lists status, assignee, cycle, project and labels with the values routing will write, and every one of those five is applied when the routing is committed

#### Scenario: Escape writes nothing

- **WHEN** a member opens the route transient, changes values, and presses `esc`
- **THEN** the transient closes, the issue is unchanged and still waiting, and focus returns to its row

### Requirement: The empty queue is drawn, not explained

When no issue is waiting and the inbox query has completed, the Triage view SHALL draw the done mark and state, in no more than a short phrase, that nothing is waiting — and SHALL offer an onward foot to the surfaces a member goes to next. It SHALL NOT explain what triage is, what will appear here, or how issues arrive.

An inbox whose query has **not** completed is not an empty inbox: until the result is complete the view SHALL state that it is loading, and both states SHALL be announced to assistive technology so a premature all-clear is never heard.

Nothing on the empty state SHALL claim the queue was cleared recently, or by anyone in particular — no triage event is recorded anywhere.

Work-graph placement: a rendering state of the existing inbox query. Permission story: unchanged.

#### Scenario: An empty inbox says two words

- **WHEN** a member opens the Triage view for a team with no waiting issues and the inbox query has completed
- **THEN** the view draws the done mark, states that nothing is waiting, offers the onward foot, and renders no explanatory sentence and no ordering label

#### Scenario: A loading inbox is not an empty one

- **WHEN** the Triage view renders before the inbox query has completed
- **THEN** it states that it is loading rather than that nothing is waiting, and the state is announced

#### Scenario: Clearing the queue claims nothing

- **WHEN** a member accepts the last waiting issue
- **THEN** the empty state that replaces the queue makes no statement about who cleared it or when
