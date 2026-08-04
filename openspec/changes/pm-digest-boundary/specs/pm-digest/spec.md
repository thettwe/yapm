## Purpose

Discloses a PM-altitude summary of a completed cycle to an explicitly named audience outside the
producing team, behind a second authorization axis, a default-off pair of switches, a human
review-and-publish gate, and a server-only disclosure audit record.

## ADDED Requirements

### Requirement: A separate synced PM-digest artifact, never a widened read on the team digest

The system SHALL persist the PM-facing summary as its own Zero-synced `pm_digest` entity, one per
cycle, hanging off `cycle` (and off `team`), carrying: `id`, `team_id`, `cycle_id`, a `status` of
`pending | ready | failed | ai_off`, a typed `content` blob, the `provider`/`model`, `generated_at`,
a `published_at` that is null until a human releases it, and a yapm-computed audience size stamped
at publish. It SHALL NOT be a widened read on the team-internal cycle-digest entity: the sync engine
returns whole rows with no column projection, so a query serving a reader outside the team over the
team-internal entity would hand that reader the team-internal content.

The entity SHALL be **client-read-only for its content**: no client mutator creates a PM digest or
edits its content, provider, model, status or generated numbers — those are written only server-side
by the pre-compute job. The only client-reachable writes are the publish and retraction described
below.

**The synced row SHALL be self-sufficient and SHALL relate to nothing.** No query over this entity
may traverse a relationship to another entity, because a related row is a second disclosure that the
audience predicate does not gate. Everything the reader needs — the team name, the cycle name and
dates, and each evidence item's label — SHALL be baked into the stored content by the server.

**Columns that are not safe for both audiences SHALL NOT be in the sync schema.** Token counts, the
estimated cost, and the identity of the human who published SHALL exist in the database (for the
spend cap and the audit record) and SHALL be excluded from the sync schema, and a check SHALL fail
if either half drifts.

Work-graph placement: a leaf off `cycle`, sibling to the team-internal digest, referencing work-graph
entities only as baked text labels and adding no per-person visibility surface. Permission story: two
different read predicates over one entity — the producing team reads every status through the
ordinary team-scoped predicate, and the disclosure audience reads only published rows through the
separate audience predicate below.

#### Scenario: The PM-facing row carries no team-internal content

- **WHEN** a reader in a team's disclosure audience receives a `pm_digest` row
- **THEN** the row contains only PM-altitude content, and no field of the team-internal cycle digest
  is reachable from it

#### Scenario: The row relates to nothing

- **WHEN** a query serving the disclosure audience is evaluated
- **THEN** it traverses no relationship, so no cycle, team, issue or pull-request row is synced as a
  side effect of reading a PM digest

#### Scenario: Clients cannot write the content

- **WHEN** a client attempts to create a PM digest or edit its content, status or generated numbers
- **THEN** there is no mutator to do so and the write does not apply

#### Scenario: Cost and publisher identity do not sync

- **WHEN** the sync schema for the entity is compared against the database table
- **THEN** the token counts, estimated cost and publishing user are present in the database, absent
  from the sync schema, and the asymmetry is asserted from both sides

### Requirement: A second read predicate, written beside the team predicate and never inside it

The system SHALL express disclosure-audience reads through a **separate read predicate function**,
distinct from the team-membership predicate that every other work-data query uses. The team
predicate SHALL NOT be modified: many queries depend on it, and widening it would silently re-scope
issues, cycles, labels, deployments, saved views and attachments in one line that reviews as normal.

The audience predicate SHALL grant a read when, and only when, **the caller's verified user id
appears in the audience list of the row's team**, the workspace disclosure switch is on, that team's
visibility switch is on, the kill switch is off, and the row has been published. It SHALL deny by
returning an empty query, and it SHALL check entitlement before existence. It SHALL have **no
workspace-admin bypass**: membership of the audience list is the entitlement, so an administrator
who is not on the list reads nothing through it.

No new role SHALL be introduced and the existing `admin | member | viewer` model SHALL be unchanged.

The predicate SHALL carry a comment stating why it is separate from the team predicate and what
would break if the two were merged, and a check SHALL assert that the team predicate and its
dependent queries are untouched by this change.

Work-graph placement: a second authorization axis over exactly one entity. Permission story:
entitlement is an explicit per-team list of user ids resolved server-side from admin-gated
configuration; it grants nothing beyond published PM digests for the teams that named the caller.

#### Scenario: A workspace member not on the team and not on the list reads nothing

- **WHEN** a workspace member with no membership of the producing team, and not named in that team's
  audience list, requests that team's PM digest for a real cycle
- **THEN** the response is byte-identical to the response for a cycle id that never existed, so
  nothing distinguishes "not allowed" from "does not exist"

#### Scenario: The team predicate is not widened

- **WHEN** the same non-member requests that team's issues, cycles, labels, deployments, saved
  views, attachments, retros or team-internal cycle digests
- **THEN** every one of those queries returns zero rows, unchanged from before this capability
  existed

#### Scenario: An administrator not on the list gets nothing from this predicate

- **WHEN** a workspace administrator who is not named in a team's audience list reads through the
  audience predicate
- **THEN** the result is empty, because the list is the entitlement and this predicate grants no
  administrative bypass

#### Scenario: A stale credential denies

- **WHEN** a caller presents a session credential minted before their audience entitlement was
  resolved, so it carries no audience at all
- **THEN** the predicate treats the absent audience as empty and denies

### Requirement: Four default-off switches in admin-gated server-only configuration

The system SHALL gate disclosure on four operator-controlled settings, all stored in the existing
admin-gated, server-only workspace AI configuration blob — **adding no table, no column, no crypto
and no new secret**: a workspace-level PM-disclosure switch, a per-team visibility switch, a per-team
audience list of workspace-member user ids, and a workspace-level kill switch.

The workspace switch and every per-team visibility switch SHALL default to **off**, and every
audience list SHALL default to **empty**, so an instance that upgrades into this capability discloses
nothing until an administrator acts. A configuration blob that predates this capability SHALL parse
to the all-off defaults.

Only a workspace administrator SHALL read or write these settings, and they SHALL never be synced to
any client. The kill switch SHALL, while set, cause every audience to resolve empty regardless of
every other setting; the surface SHALL state honestly that this stops further reads and does not
un-read anything already disclosed.

These settings SHALL NOT be stored in the connector repository-mapping value, which is typed as a
flat string map and read by a SQL expression that a richer value shape would break.

Work-graph placement: workspace-level operator configuration, not work data. Permission story:
admin-only read and write over the existing server-only administrative surface; never reaches a
client.

#### Scenario: Defaults disclose nothing

- **WHEN** the capability ships to an instance that has never configured it
- **THEN** the workspace switch is off, every team's visibility switch is off, every audience list is
  empty, the disclosure reader surface does not exist for anyone, and no disclosure query is issued

#### Scenario: Turning the workspace switch on is not enough

- **WHEN** an administrator enables the workspace switch but leaves a team's visibility switch off
- **THEN** that team produces no PM digest and its named readers, if any, receive nothing

#### Scenario: A non-administrator cannot see or change the policy

- **WHEN** a member or viewer requests the disclosure policy or attempts to change it
- **THEN** the request is refused and no part of the policy — including who is on an audience list —
  is disclosed

#### Scenario: The kill switch empties every audience

- **WHEN** an administrator sets the kill switch
- **THEN** every audience resolves empty, every disclosure query returns nothing, and the surface
  states that already-disclosed content cannot be recalled

#### Scenario: Keyboard and themes on the policy surface

- **WHEN** an administrator operates the PM-disclosure settings using only the keyboard, in each
  theme preset in light and dark
- **THEN** every switch, every team row and the audience picker are reachable and operable without a
  pointer, and render from theme tokens with no hardcoded colors or fonts at AA contrast

### Requirement: Generation never discloses; a human publishes

The system SHALL generate the PM digest off the interactive hot path, in the same pre-compute pass
that produces the team-internal digest and from the same computed cycle facts, and it SHALL write
the row **unpublished**. An unpublished row SHALL be readable by the producing team only.

A member of the producing team with write authority SHALL be able to **publish** a `ready` PM
digest, and to **retract** a published one. Publishing SHALL be the only way content reaches the
disclosure audience; nothing SHALL publish automatically, on a timer, or as a side effect of any
other action. Publishing SHALL stamp the row with the audience size computed at that moment.
Retracting SHALL stop further reads and SHALL be described to the operator as exactly that.

Generation SHALL be gated by its own instance toggle, independent of the team-internal digest's
toggle, defaulting to off; and it SHALL be skipped entirely for a team whose visibility switch is
off, so a disclosure that was never wanted costs no model call.

Work-graph placement: a batch producer of the artifact, triggered by cycle completion under the
system principal. Permission story: generation runs server-side and discloses to nobody; the
transition to disclosed is a human write under the ordinary team write gate.

#### Scenario: A generated digest is not readable until published

- **WHEN** the job writes a `ready` PM digest for a team whose audience is configured and non-empty
- **THEN** every named reader receives nothing until a human publishes it, and the response they get
  is indistinguishable from one for a cycle that never existed

#### Scenario: Publishing discloses

- **WHEN** a member of the producing team publishes the digest
- **THEN** the named readers receive it, and the row records how many readers the audience held at
  that moment

#### Scenario: Retraction is honest

- **WHEN** a member of the producing team retracts a published digest
- **THEN** further reads return nothing, and the surface states that this does not un-read what was
  already disclosed

#### Scenario: A viewer on the team cannot publish

- **WHEN** a viewer on the producing team, or any user outside it who is not an administrator,
  attempts to publish
- **THEN** the write is rejected before any existence check, and nothing is disclosed

#### Scenario: Keyboard operation of the gate

- **WHEN** a team member reviews and publishes using only the keyboard, in each theme preset in
  light and dark
- **THEN** the full PM-facing text, the publish control and the retraction control are reachable and
  operable without a pointer and render from theme tokens at AA contrast

### Requirement: Every policy change and every disclosure event is recorded server-side

The system SHALL persist a disclosure audit record, in a table **excluded from the sync schema**, on
every change to the disclosure policy and on every generation, publication and retraction. Each
record SHALL carry the workspace, the team where one applies, the acting user (or the system
principal for a generation), the event, the affected digest where one applies, and yapm-computed
metadata such as the resulting audience size or which switch changed.

A record SHALL NOT contain digest content, prose, or any part of the summary — the audit says that a
disclosure happened and to how many readers, never what was said.

No client SHALL be able to read these records through the sync engine, and this change SHALL NOT add
a surface that displays them.

Work-graph placement: server-only operational record, outside the work graph and outside sync.
Permission story: written server-side only; unreadable by any client in this change.

#### Scenario: Generation is recorded

- **WHEN** the job writes a PM digest in any terminal status
- **THEN** exactly one audit record for that generation exists, attributed to the system principal
  and carrying no content

#### Scenario: Publication and retraction are recorded

- **WHEN** a human publishes and later retracts a digest
- **THEN** two further audit records exist, each naming the acting user, and the publication record
  carries the audience size at that moment

#### Scenario: A policy change is recorded

- **WHEN** an administrator changes any of the four switches or an audience list
- **THEN** an audit record exists naming the administrator and describing what changed, without
  restating the whole configuration

#### Scenario: The audit table never syncs

- **WHEN** the sync schema is compared against the database
- **THEN** the disclosure audit table is absent from the sync schema and no query can name it

### Requirement: PM-altitude content grounded in the same facts, with baked evidence labels

The system SHALL produce the PM-facing content with one structured-output run over the **existing**
team-level, identity-free cycle facts, under a PM-altitude operator prompt, mounting no tool and
opening no outbound channel. It SHALL reuse the shipped cite-evidence-or-omit walker, member-name
walker and disclosure validator **without adding a second copy of any of them**.

Every emitted item SHALL be dropped unless it cites an evidence id that yapm computed. Every
consequential number SHALL be computed by yapm and only narrated by the model. **Evidence SHALL be
rendered as a server-computed plain-text label** identifying the work (for example an issue key and
a pull-request number) and SHALL NOT be a link: a reader outside the team can open none of the
targets, and making the links work would require widening reads on issues and pull requests — a
larger disclosure than the prose it was meant to make verifiable.

No published item SHALL contain a file path, a source-file extension, a code fence, a backtick, or a
code-identifier call shape; the same deterministic validator that guards the team-internal digest
SHALL be applied here, after the name validator.

The estimated cost of a PM run SHALL count toward the workspace's single running AI spend total, so
the spend cap cannot under-fire because a second artifact table is invisible to it.

Work-graph placement: a read-and-summarize pass over team-level aggregates; it emits text and baked
labels, never a traversal. Permission story: runs under the system principal over the producing
team's own facts; the output crosses the boundary only after a human publishes it.

#### Scenario: An uncited claim never reaches a reader

- **WHEN** the model emits an item citing no yapm-computed evidence id
- **THEN** that item is dropped before the row is written

#### Scenario: Evidence is a label, not a link

- **WHEN** a reader outside the team views a published item's evidence
- **THEN** it renders as plain text naming the work, and there is no link to an entity the reader
  cannot open

#### Scenario: No path-shaped string survives publication

- **WHEN** a pull-request title in the cycle contains a file path and the model echoes it
- **THEN** the affected item is dropped, and the published content contains no path token, source
  extension, backtick or identifier-call shape at any depth

#### Scenario: The model cannot name a person

- **WHEN** the run is assembled
- **THEN** the facts it is given contain no assignee, author, reviewer or user dimension, and the
  name validator drops any output naming a workspace member

#### Scenario: The second run counts against the spend cap

- **WHEN** a PM digest is written `ready` with an estimated cost
- **THEN** the workspace's running AI spend total rises by that amount through the single existing
  accessor, with no second spend query added

### Requirement: The producing team is told that their work was disclosed, and to how many

The system SHALL show the producing team, on their own cycle view, the exact PM-facing text before
it is disclosed, and after publication a yapm-computed marker stating how many readers outside the
team it was shared with.

The marker SHALL be a **count only**. The system SHALL NOT name individual readers, record who read
a digest, or present any per-person view of readership.

Work-graph placement: a read surface on the cycle view over the team's own PM digest. Permission
story: shown only to the producing team through the ordinary team-membership predicate.

#### Scenario: The team reads what would be disclosed, first

- **WHEN** a PM digest is generated for a team's completed cycle
- **THEN** the team's cycle view shows the full PM-facing text before any reader outside the team can
  see it

#### Scenario: The team learns the disclosure happened

- **WHEN** the digest has been published
- **THEN** the team's cycle view states that it was shared with a number of readers outside the team

#### Scenario: No reader is named and no read is logged

- **WHEN** the team views the marker
- **THEN** no individual reader is identified anywhere in the product, and no record of who read the
  digest exists

### Requirement: With AI off or disclosure off, the reader surface is cleanly absent

For a reader whose audience is empty — because the switches are off, the kill switch is set, they
were never named, or nothing has been published — the disclosure surface SHALL NOT exist: no
navigation entry, no route, no empty state, and **no query issued**. Absence SHALL be the graceful
degradation for this reader, because they have no raw evidence to fall back to: every raw-evidence
fallback in the product is built from team-scoped reads a reader outside the team cannot perform.

When AI is disabled, keyless, in outage or spend-capped, the digest row SHALL be written in the
corresponding non-ready status and SHALL never be publishable, so the disclosure surface stays
absent rather than showing an error to someone who can do nothing about it.

Work-graph placement: the read surface over the artifact. Permission story: the surface's existence
is itself gated on the resolved audience, so its presence never signals that a digest exists.

#### Scenario: Nothing renders and nothing is queried

- **WHEN** a workspace member whose resolved audience is empty opens the application
- **THEN** no disclosure navigation entry or route exists, no disclosure query is issued, and no
  error is logged

#### Scenario: A non-ready digest is not publishable

- **WHEN** a run ends `ai_off` or `failed`
- **THEN** the producing team is told the digest could not be generated, the publish control is not
  offered, and the reader surface stays absent

#### Scenario: Keyboard and themes on the reader surface

- **WHEN** a named reader navigates a published digest using only the keyboard, in each theme preset
  in light and dark
- **THEN** every section, item and evidence label is reachable without a pointer, renders from theme
  tokens at AA contrast, and no remote image or link from the summarized content is auto-loaded
