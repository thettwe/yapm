# retrospective Specification

## Purpose
TBD - created by archiving change retro-board. Update Purpose after archive.
## Requirements
### Requirement: Team-scoped retro entity anchored to a cycle

The system SHALL provide a `retro` entity carrying a `title`, a `format`, a `phase`, an optional `facilitator_id`, an `is_anonymous` flag, a `votes_per_participant` budget, an optional durable `timer_ends_at` / `timer_duration_s`, a `created_by`, an optional `closed_at`, an optional `cycle_id` (the cycle being reflected on) and an optional `next_cycle_id` (the default target for action items). Every retro SHALL belong to exactly one `team`. At most one retro SHALL exist per cycle, enforced by a unique constraint on `cycle_id`. The primary key and the ids of every row created alongside it (columns, cards, groups, votes, actions) SHALL be client-minted UUIDv7 values generated at the mutator call site, never inside a mutator body.

Work-graph placement: `retro` hangs off `team` and references `cycle` twice — the cycle it reflects on and the cycle its actions land in — so the retro sits between one cycle's delivery record and the next cycle's plan. Sync/permission story: a retro and its columns, cards, groups, vote tallies, actions and presence rows SHALL sync only to members of the retro's team, scoped by a `whereExists` over the team roster driven by the verified `ctx.userID`; non-members read nothing, denied by an empty query with no leak of existence. Viewers SHALL read their teams' retros and SHALL be rejected for every retro write, with authorization checked before any existence check.

#### Scenario: A retro is created for a team's cycle

- **WHEN** a member opens a retro for a completed cycle
- **THEN** the retro is created with a client-minted UUIDv7 id, its columns seeded from the chosen format, `created_by` taken from the verified `ctx.userID`, and it becomes visible to every member of that team

#### Scenario: A second retro for the same cycle is refused

- **WHEN** a retro is opened for a cycle that already has one
- **THEN** the mutator is a no-op and exactly one retro exists for that cycle

#### Scenario: A non-member cannot see another team's retro

- **WHEN** an authenticated user who is not a member of the retro's team runs any retro query
- **THEN** every result is empty and the retro's existence is never revealed

#### Scenario: A viewer cannot write to a retro

- **WHEN** a `viewer` attempts any retro write — a card, a vote, a group move, an action, or a phase change
- **THEN** the mutator rejects it as not authorized before any existence check

### Requirement: Server-enforced phase state machine

A retro SHALL move through the ordered phases `brainstorm → group → vote → discuss → actions → closed`. A phase change SHALL be accepted only when the target phase is **exactly one step forward or exactly one step back** from the current phase, and only when the caller is the retro's facilitator or a workspace admin. Any other target — skipping a phase, rewinding more than one step, or a call by a non-facilitator member — SHALL be rejected. Entering `closed` SHALL stamp `closed_at`; the single legal step back out of `closed` SHALL clear it. When `facilitator_id` is null, any non-viewer team member SHALL be able to claim facilitation; the facilitator or an admin SHALL be able to hand it off.

Every retro write mutator SHALL re-read the retro's current phase on the server and consult a single shared pure predicate before applying, so that phase legality is authoritative rather than advisory. The UI SHALL drive its affordances from the same predicate.

#### Scenario: A crafted mutation cannot skip a phase

- **WHEN** a client submits a phase change from `brainstorm` directly to `actions`
- **THEN** the server mutator rejects it and the retro stays in `brainstorm`

#### Scenario: A non-facilitator cannot advance the phase

- **WHEN** a team member who is neither the facilitator nor a workspace admin submits a phase advance
- **THEN** the mutator rejects it as not authorized and the phase is unchanged

#### Scenario: The facilitator may step back exactly one phase

- **WHEN** the facilitator steps a retro back from `vote` to `group`
- **THEN** the retro returns to `group` and grouping becomes editable again for every client

#### Scenario: A write for a disallowed phase is rejected at apply time

- **WHEN** a client submits a vote while the retro's current phase on the server is `discuss`
- **THEN** the server rejects the write, the optimistic dot is rolled back, and no vote row persists

#### Scenario: A closed retro is read-only

- **WHEN** any member attempts to add a card, group, or vote on a retro in `closed`
- **THEN** every such write is rejected while the retro remains fully readable

#### Scenario: Phase control is keyboard-operable

- **WHEN** the facilitator presses `]` and then `[` with the retro focused, using no pointer
- **THEN** the retro advances one phase and then steps back one phase, and both actions are also available from the command palette

### Requirement: Anonymity is guaranteed at the storage layer

Because sync returns whole rows and the sync engine has no column-level read permission, the author of a card SHALL NOT be carried on any row that syncs to clients other than the author. The system SHALL store the card→author binding in a server-only table that is **absent from the Zero schema entirely**, used solely by server mutators for authorization, moderation and audit. For a retro with `is_anonymous` set, the synced card row's author field SHALL be null — there SHALL be no hidden author column to strip. A retro's anonymity SHALL be settable only while the retro is in `brainstorm`, before any card exists, and SHALL be immutable thereafter. No code path SHALL copy the server-only author onto a synced row.

Work-graph placement: the card→author table is a server-only leaf off `retro_card`, in the same class as the per-team sequence counters. Permission story: it is written and read only by the server mutator pass and can never be named by a synced query.

#### Scenario: No synced query yields an anonymous card's author

- **WHEN** every synced query in the registry is evaluated with the context of a team member who did not write a given anonymous card
- **THEN** no result of any query contains that card's author identity, and the server-only author table is absent from the Zero schema

#### Scenario: An anonymous card syncs with no author value

- **WHEN** a card is published in a retro marked anonymous
- **THEN** the synced card row's author field is null for every client, including the author's

#### Scenario: The author of an anonymous card can still be authorized server-side

- **WHEN** the facilitator deletes an anonymous card during moderation
- **THEN** the server authorizes the deletion against the server-only author table without that identity ever reaching a client

#### Scenario: Anonymity cannot be flipped once cards exist

- **WHEN** a facilitator attempts to change `is_anonymous` after the retro has left `brainstorm`
- **THEN** the mutator rejects the change

### Requirement: Private brainstorming with a publish step

During `brainstorm`, participants SHALL write cards as private draft rows carrying their author, and the only synced query over drafts SHALL filter to the caller's own rows using the verified `ctx.userID` — never client args — with **no workspace-admin bypass**. A participant SHALL be able to create, edit and delete their own drafts freely while in `brainstorm`, and SHALL NOT receive any other participant's draft. Advancing forward out of `brainstorm` SHALL publish every unpublished draft into a card **reusing the draft's own id**, so no id is minted inside a mutator body and re-running the publish is idempotent. Publishing SHALL set the card's author only when the retro is not anonymous. A published card's body SHALL NOT be editable; deletion after publish SHALL be a facilitator/admin moderation action.

#### Scenario: Another participant's in-progress card never arrives

- **WHEN** two members each write cards during `brainstorm`
- **THEN** each client's synced data contains only that member's own drafts, and neither can observe the other's card or its existence

#### Scenario: Advancing reveals every card at once

- **WHEN** the facilitator advances from `brainstorm` to `group`
- **THEN** every participant's cards become visible to the whole team, each keeping the id its draft was created with

#### Scenario: A workspace admin gets no bypass on drafts

- **WHEN** a workspace admin who did not author a draft runs the draft query
- **THEN** the result is empty

#### Scenario: Capturing cards is keyboard-only

- **WHEN** a participant presses `c` in a focused column, types, and presses `Enter` repeatedly, using no pointer
- **THEN** each card is submitted, the composer stays open for the next one, and arrow keys move focus between columns and cards

### Requirement: Grouping by a single-write fractional-index move

During `group`, a card SHALL be movable into a group, between groups, and within its column by a **single mutator writing one row's rank** (and its group reference when it changed), computed at the call site from the destination neighbours — never renumbering siblings and never recomputing the rank inside the mutator body. A group SHALL carry an optional label and its own rank within a column, and a group left with no cards SHALL be dissolved by the same mutator that emptied it. Concurrent moves SHALL converge without corrupting order.

#### Scenario: Dragging one card onto another forms a group

- **WHEN** a member drags a card onto another card in the same column during `group`
- **THEN** a group is created with a client-minted id, both cards reference it, and every other client sees the same clustering

#### Scenario: A move writes exactly one row

- **WHEN** a card is moved within or between groups
- **THEN** exactly one card row's rank and group reference are written, with no sibling renumbering

#### Scenario: Grouping is keyboard-operable

- **WHEN** a member focuses a card and invokes "Group with…" via `g` or the command palette, using no pointer
- **THEN** the card joins the chosen group and focus is retained

### Requirement: Dot voting with a server-enforced budget and unlinkable voters

During `vote`, each participant SHALL have a per-retro budget of dots (`votes_per_participant`, default 3, settable only during `brainstorm`), and may stack multiple dots on one target. A vote SHALL target a group when the card is grouped, and the card itself otherwise; a vote on a grouped card SHALL be rejected. The budget SHALL be enforced authoritatively in the server mutator; an over-budget optimistic dot SHALL be rolled back. A vote row SHALL sync **only to the voter who cast it** (filtered by the verified `ctx.userID`, no admin bypass), and every other client SHALL read only a synced per-target tally. The tally row SHALL be keyed by its target's id so it is upserted without minting an id inside a mutator.

#### Scenario: Who voted never reaches another client

- **WHEN** a member votes and a second member queries everything they can
- **THEN** the second member sees the target's tally increase but never receives the first member's vote row or identity

#### Scenario: The budget cannot be exceeded

- **WHEN** a member attempts to cast one more dot than their budget allows
- **THEN** the server rejects it, the optimistic dot is rolled back, and the tally is unchanged

#### Scenario: Retracting returns a dot

- **WHEN** a member retracts one of their dots
- **THEN** their remaining budget increases by one and the target's tally decreases by one for every client

#### Scenario: Voting is keyboard-operable

- **WHEN** a member focuses a target and presses `v`, then `Shift+V`, using no pointer
- **THEN** a dot is cast and then retracted, and both actions are available from the command palette

### Requirement: Auto-seeded team-level data panel

A retro SHALL open with a data panel computed from the work graph — the "gather data" step pre-filled — rendered as team-level trends against prior cycles with blameless captions that narrate the system and never a person. The panel SHALL degrade gracefully to the data that exists: the **Delivered** section SHALL be fully populated from cycles alone with no connectors configured (shipped, carried out, carried in, carried twice or more, added mid-cycle, canceled, total); the **Flow** section SHALL appear only when connector-derived delivery data exists (median PR cycle time, median time to first review, review rounds, issues with no linked pull request, and CI failing rate — speed and stability shown together) and SHALL otherwise render a single quiet empty state naming what would populate it, never zeros or hollow charts. DORA/MTTR health metrics SHALL NOT be produced by this capability.

The panel model SHALL contain **no per-person dimension of any kind** — no assignee, author, reviewer, creator, or user id — so that a per-individual metric is not renderable, and no per-individual retro table SHALL exist. A panel widget SHALL be able to seed a card that carries an evidence reference back to the issue, pull request, check, or widget it came from.

#### Scenario: The panel is useful with no connectors

- **WHEN** a team with no connector configured opens a retro for a completed cycle
- **THEN** the Delivered section shows shipped, carried, carried-twice-or-more and added-mid-cycle counts with trends against prior cycles, and the Flow section shows a single empty state naming the connector that would light it up

#### Scenario: Flow lights up when delivery data exists

- **WHEN** the cycle's issues have linked pull requests, reviews and checks
- **THEN** the Flow section shows median PR cycle time and median time-to-first-review alongside the CI failing rate, each as a trend with a blameless caption

#### Scenario: The panel cannot name a person

- **WHEN** the panel model is computed for any cycle
- **THEN** it contains no user, assignee, author, reviewer or creator field at any depth, and no view renders a per-individual number

#### Scenario: A widget seeds an evidence-anchored card

- **WHEN** a member adds a card from a panel widget during `brainstorm`
- **THEN** the card carries an evidence reference to the originating issue, pull request, check or widget and renders a link back to it

#### Scenario: The panel is keyboard-navigable

- **WHEN** a member moves through the panel's widgets with the keyboard and invokes "add a card from this widget", using no pointer
- **THEN** focus moves widget to widget visibly and the card composer opens with the evidence reference attached

### Requirement: Action items become tracked issues in the next cycle

A retro SHALL record action items carrying a body, an optional assignee, an optional target cycle and an optional provenance reference to the card or group that produced them. During `discuss`, `actions`, or `closed`, an action SHALL be convertible into a **real issue created through the same shared issue-creation mutator, permissions and server-authoritative numbering as any human-created issue** — team-scoped, assigned when an assignee was set, and placed in the action's target cycle or, absent one, the retro's next cycle. The new issue's id SHALL be minted at the call site. Conversion SHALL be idempotent: converting an already-converted action SHALL be a no-op rather than creating a second issue. After conversion the action SHALL display the issue's live status.

#### Scenario: Converting an action creates a real issue in the next cycle

- **WHEN** a member converts an action during `actions`
- **THEN** an issue is created in the retro's team with a server-assigned per-team number, placed in the next cycle, and the action shows the issue's live status

#### Scenario: Converting twice creates only one issue

- **WHEN** the convert action is invoked again on an already-converted action
- **THEN** no second issue is created and the existing reference is unchanged

#### Scenario: A viewer cannot convert an action

- **WHEN** a `viewer` invokes convert-to-issue
- **THEN** the mutator rejects it as not authorized before any existence check

#### Scenario: Conversion is keyboard-operable

- **WHEN** a member focuses an action and presses `⌘/Ctrl+Enter`, using no pointer
- **THEN** the issue is created and the action's tracked state updates in place

### Requirement: Durable timer and coarse presence without new infrastructure

The shared timer SHALL be modeled as durable state on the retro (an end timestamp plus the last-set duration) with each client counting down locally; per-tick messages SHALL NOT be broadcast. The end timestamp SHALL be recomputed authoritatively from the server clock so client skew cannot shift it, and only the facilitator or an admin may start, stop, or reset it. Presence SHALL be coarse throttled heartbeat rows (one per participant per retro, at column-level granularity, self-written from the verified `ctx.userID`) pruned by the existing scheduled maintenance pass. Neither SHALL introduce a new container, service, or job type.

#### Scenario: Every client counts down to the same moment

- **WHEN** the facilitator starts a five-minute timer
- **THEN** every client shows a countdown converging on the same end time, with no per-second traffic, and a client whose clock is skewed still ends at the authoritative time

#### Scenario: A non-facilitator cannot control the timer

- **WHEN** a member who is not the facilitator or an admin starts or stops the timer
- **THEN** the mutator rejects it

#### Scenario: Stale presence disappears

- **WHEN** a participant closes the retro and the maintenance pass runs
- **THEN** their presence row is pruned and the remaining participants see an accurate "who's here"

### Requirement: Tokenized, keyboard-first retro surface

The retro SHALL be fully operable without a pointer — capture, navigation, grouping, voting, action creation, conversion, phase control, and timer — and every action SHALL also be reachable from the command palette. Every color, spacing, and font SHALL come from a semantic token; a column's accent SHALL be stored as a token key, never a literal color; a converted action's issue status SHALL render with the existing status tokens. The surface SHALL be correct and AA-contrast in the Warm, Focused and Editorial presets in both light and dark, and common interactions SHALL not newly wait on the network.

#### Scenario: A whole retro can be run from the keyboard

- **WHEN** a facilitator runs a retro end to end — capture, advance, group, vote, discuss, add an action, convert it, close — using no pointer
- **THEN** every step is reachable and every focused element is visibly focused

#### Scenario: The retro is correct in every theme

- **WHEN** the retro is rendered in Warm, Focused and Editorial, in light and dark
- **THEN** cards, column accents, vote pips, the phase stepper and the timer all resolve from tokens and meet AA contrast, with no hardcoded color

#### Scenario: Card capture and voting stay instant

- **WHEN** a member adds a card or casts a vote
- **THEN** the change renders immediately from the optimistic local write and is reconciled in the background

