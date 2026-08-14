## MODIFIED Requirements

### Requirement: The team page is an adaptive digest composed from synced work-graph facts

`/teams/{teamId}` SHALL render the team Home digest: an ordered composition of bands —
hero, NEEDS ATTENTION, SINCE YESTERDAY, YOURS, READY FOR YOU, SHIP CADENCE, SHIPPED THIS
CYCLE, then the page's composition record behind one quiet `how ·`, and an onward footer
(Issues · Delivery · Retro · Roadmap, with a ⌘K hint). Every fact on the page SHALL be
derived from rows the client has already synced through existing team-scoped or self-scoped
queries; the page SHALL add no new synced table and no new named query, and SHALL make no
network request to render. All derivations SHALL be pure functions in `packages/schema`,
computed client-side.

The digest SHALL carry no explanatory prose at rest. The composition record and the YOURS
lens definition are derivations and SHALL be reachable only through a `how ·`; the onward
footer's doorways are labels and SHALL remain visible.

Every band SHALL render only when it has content: an empty band folds away entirely — no
header, no empty-state apology. The digest SHALL remain a complete, honest page when *every*
optional band folds.

#### Scenario: A working morning composes the full page

- **WHEN** a member opens their team's Home while the team has an active cycle, exception
  issues, recent deployments, work assigned to the viewer, and unassigned ready work
- **THEN** the bands render in the fixed order above, each drawn from synced rows, with no
  loading waterfall and no server round trip beyond the already-established sync

#### Scenario: A quiet day folds without apology

- **WHEN** a member opens the team Home while no exception class matches, nothing happened
  in the last 24 hours, the viewer has no in-flight issues, and no unassigned ready work
  exists
- **THEN** the attention, since-yesterday, and ready bands are absent entirely (not rendered
  empty), YOURS renders its single warmth line standing alone — the Runway doorway renders
  only while the READY FOR YOU band renders, and here it has folded — and the hero degrades
  to its quiet form

#### Scenario: Composition is local-first

- **WHEN** the digest renders for a team whose rows are already synced
- **THEN** every number and phrase on the page is computed from local Zero query results by
  pure functions exported from `packages/schema`

#### Scenario: The page states no derivation at rest

- **WHEN** a member opens the digest in any state
- **THEN** no mono clause line naming the composition rules and no mono clause line defining
  the YOURS lens is drawn anywhere on the page, and each is reachable through its own `how ·`

### Requirement: YOURS shows only the signed-in user's own work and says so

The YOURS band SHALL list the signed-in user's in-flight issues in this team (assignee =
viewer, status unfinished, not in triage), ordered by last movement, each row carrying the
issue-list anatomy: status glyph, key, title, reality track, and a two-line bifact whose
phrases come from the **shared phrase dictionary** defined in the reality-vocabulary
capability, in that dictionary's personal register. The band SHALL NOT hold a phrase table of
its own: the strings it speaks and the strings the issue list speaks SHALL resolve from one
dictionary keyed by one classifier over the delivery signal and the divergence computation, so
the two surfaces cannot drift apart.

Rows whose signal shows an open pull request awaiting review SHALL collapse into a single "N of
yours are waiting on others" row carrying the waiting ages. A "No reviews owed" reciprocal line
SHALL render only when no open pull request linked to the team's issues awaits review at all,
and SHALL fold otherwise — it never renders a claim the data cannot verify.

The band's **lens definition** — that it lists the viewer's own assigned, unfinished work,
ordered by last movement, and compares nothing — SHALL be carried behind a quiet `how ·` on the
band's own header rather than printed as a mono footnote at rest. Every clause of that definition
SHALL be true of the rendered derivation, its final clause SHALL state that the lens is the
viewer's work only and never compared, and the text SHALL be produced by the derivation layer in
`packages/schema` rather than by the rendering surface. The guarantee itself is structural and
does not depend on the sentence being visible: the band SHALL contain no other person's identity
or count whether the affordance is open or closed.

When the viewer has no in-flight issues, the band SHALL render a single warmth line instead of
an empty list, with a doorway to the ready work only while the READY FOR YOU band renders; on a
fully quiet day the READY band has folded, so the warmth line stands alone — a doorway SHALL NOT
point at a band that cannot render. The band SHALL never render another person's work, name, or
count.

#### Scenario: In-flight rows with delivery reality

- **WHEN** the viewer holds three unfinished issues in the team, one approved-and-unmerged,
  one in progress, one with failing checks
- **THEN** YOURS renders three rows whose say/git bifacts derive from each issue's own
  delivery signal, ordered by most recent movement

#### Scenario: The band speaks the shared dictionary

- **WHEN** YOURS renders a row for an issue whose checks are failing
- **THEN** its phrase resolves from the shared dictionary's personal register for the same key
  the issue list would resolve in its neutral register, and no second phrase table exists for
  that fact

#### Scenario: Waiting work collapses

- **WHEN** two of the viewer's issues have open pull requests awaiting review
- **THEN** those two collapse into the "2 of yours are waiting on others" row with their
  waiting ages

#### Scenario: Empty YOURS is warmth, not apology

- **WHEN** the viewer has no unfinished issue in the team
- **THEN** the band renders one warmth line and no table — with a Runway doorway when the
  READY FOR YOU band renders, and without one when that band has folded

#### Scenario: The lens is personal, never comparative

- **WHEN** any state of the team is rendered
- **THEN** the YOURS band contains no other user's identity or per-person count, and no
  statement of its lens is drawn at rest

#### Scenario: The lens definition is one keystroke away

- **WHEN** a member activates the `how ·` on the YOURS band header
- **THEN** the derivation states the assignee, status and ordering clauses and ends by stating
  that the lens is the viewer's work only and never compared; and **WHEN** it is dismissed, the
  band carries no such statement anywhere

### Requirement: The composed footline states only rules the code executed

The digest SHALL end with a **composition record** naming the composition rules actually applied
in the current render (folding, the attention-first ordering, the personal lens), followed by the
onward footer. That record SHALL be carried behind one quiet `how ·` and SHALL NOT be drawn as a
mono clause line at rest. The record SHALL never name a rule the implementation does not execute,
and clauses for folded/absent behaviors SHALL be omitted rather than aspirational — the honesty
rule is unchanged by where the record is read.

The affordance SHALL render whenever the record has at least one clause, and SHALL be reachable
and dismissable from the keyboard alone. The onward footer SHALL remain visible at rest.

#### Scenario: The footline is honest on a quiet day

- **WHEN** the attention band and other optional bands have folded
- **THEN** the composition record names the folding that happened and contains no claim about
  behaviors (e.g. crit scheduling) that do not exist

#### Scenario: The record is read, not printed

- **WHEN** a member opens the digest
- **THEN** no mono composition line is drawn above the onward footer; a quiet `how ·` stands
  there instead, and activating it states the clauses the render actually applied
