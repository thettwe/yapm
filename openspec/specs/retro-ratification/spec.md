# retro-ratification Specification

## Purpose
The team's decision layer over the AI's retro proposals: a private per-member agree/disagree signal,
a fixed knob-free verdict computed once when the retro leaves voting, contested-first ordering in
the discussion, and the one-keystroke path from an agreed improvement to a tracked issue that never
names an owner.
## Requirements
### Requirement: A private per-member reaction, self-scoped with no admin bypass

A member SHALL be able to record exactly one reaction — `agree` or `disagree` — per AI proposal, and
SHALL be able to change it or clear it. The reaction SHALL be keyed by the proposal and the
**verified caller identity**, never by an identity supplied as an argument, so that one member
holds at most one reaction per proposal as a property of storage rather than of validation.

A reaction SHALL replicate to its own author and to **nobody else**: not to another member of the
team, and **not to a workspace admin**. This is a deliberate deviation from the team-scoped read
predicate that governs ordinary work data, and it SHALL be expressed as a self-filtered synced query
gated on workspace membership and denied by an empty query otherwise. No query SHALL exist anywhere
that returns another member's reaction row, so no surface — including an admin surface — can display
who reacted how.

No count, proportion or "n of m have responded" affordance SHALL be derivable by a client before the
verdict is stamped, because no client can read any reaction but its own.

Work-graph placement: a per-member leaf hanging off an AI proposal, which hangs off `retro`, which
hangs off `team`. Sync/permission story: exactly one person reads a given row — its author; `retro_id`
and `team_id` are present for the server's one-shot count and for membership cleanup and are **not**
sync scopes.

#### Scenario: A member's reaction never reaches another member

- **WHEN** two members of the same team have each reacted to the same proposal and both clients are fully synced
- **THEN** each client's local store contains that member's own reaction row and none of the other's

#### Scenario: A workspace admin reads no reaction but their own

- **WHEN** a workspace admin's client is fully synced for a team whose members have reacted
- **THEN** its local store contains zero reaction rows authored by anyone else, even though the same admin reads every issue in the workspace

#### Scenario: A non-member is denied by empty query

- **WHEN** an authenticated user who is not a workspace member subscribes to the reaction query
- **THEN** it resolves to an empty result rather than an error that reveals whether the retro exists

#### Scenario: Reacting twice replaces rather than accumulates

- **WHEN** a member agrees with a proposal and then disagrees with the same proposal
- **THEN** exactly one reaction row exists for that member and that proposal, carrying `disagree`

#### Scenario: A reaction can be withdrawn

- **WHEN** a member clears their reaction on a proposal
- **THEN** no reaction row for that member and proposal remains, and the proposal counts them as not having responded

### Requirement: Reactions are accepted only while the retro is grouping or voting

Reacting SHALL be a distinct retro write operation governed by the same shared phase predicate as
every other retro write, and SHALL be permitted **only** in the `group` and `vote` phases. The
ordered phase list, the one-step adjacency rule, the phase constraint stored with the retro and the
phase stepper SHALL all be unchanged by this capability.

A reaction submitted in any other phase SHALL be rejected on the server with the same
phase-not-allowed error every other out-of-phase retro write produces, and the optimistic local
write SHALL be rolled back. The reaction controls SHALL be driven by the same predicate, so the UI
cannot offer an affordance the server will refuse.

A caller who may not write — a `viewer`, or a user who is not a workspace member — SHALL be rejected
**before any existence check**, so the mutator cannot be used to learn whether a proposal id exists.

#### Scenario: A viewer is rejected before any existence check

- **WHEN** a `viewer` invokes the reaction mutator with a proposal id that does not exist
- **THEN** it is rejected as not authorized, no row is read, and the response is indistinguishable from the same call with a real proposal id

#### Scenario: A reaction in discuss is rejected

- **WHEN** a member submits a reaction while the retro's current phase on the server is `discuss`
- **THEN** the server rejects it as not allowed in that phase, no reaction row persists, and the optimistic control returns to its previous state

#### Scenario: The phase machine is unchanged

- **WHEN** the retro's phases and their legal transitions are enumerated
- **THEN** they are exactly the phases and transitions that shipped before this capability, and adding the reaction operation changed none of them

#### Scenario: Reacting is available while grouping and while voting

- **WHEN** a member reacts to a proposal during `group`, and another member reacts during `vote`
- **THEN** both are accepted and both are counted when the verdict is computed

### Requirement: A verdict computed once, from a fixed knob-free rule

When a retro advances from `vote` to `discuss`, the system SHALL compute each AI proposal's verdict
and its agree and disagree counts **once**, on the server, inside the same authoritative transaction
that performs the phase advance, and SHALL store them on the proposal.

The system SHALL NOT maintain any running tally: no counter SHALL be incremented, decremented or
otherwise written on the reaction path, and no counter column SHALL exist. Recording a reaction
SHALL therefore involve no shared-row contention of any kind.

The verdict rule SHALL be fixed and SHALL NOT be configurable by a workspace, a team, an admin or an
operator:

- no member responded ⇒ **unrated**
- at least one responded and none disagreed ⇒ **agreed**
- more disagrees than agrees ⇒ **rejected**
- otherwise (at least one disagree, not a majority) ⇒ **contested**

A single disagree SHALL therefore prevent a proposal from being agreed, so that one dissenting voice
routes a proposal to discussion rather than being outvoted silently.

Stepping the retro back from `discuss` to `vote` SHALL clear the stored verdict and counts while
leaving every reaction row intact, so that the next advance recomputes an authoritative verdict and
no stale verdict is visible while members are still reacting.

Work-graph placement: written-once attributes of an existing AI proposal row; no new entity.
Permission story: written only by the server-authoritative phase-advance pass through the same
server-only write path the proposal itself uses; read by any member of the owning team as part of
the proposal row.

#### Scenario: The computed verdict matches a hand-count

- **WHEN** several members react to the same proposals from different clients and the facilitator then advances from `vote` to `discuss`
- **THEN** each proposal's stored agree and disagree counts equal the number of reaction rows of each value, and its verdict is the one the fixed rule yields for those counts

#### Scenario: Concurrent reactions do not race

- **WHEN** two members react to the same proposal at the same moment
- **THEN** both reactions are stored, neither overwrites the other, no counter is written by either, and the count computed at the advance includes both

#### Scenario: One disagree makes a proposal contested

- **WHEN** four members agree with a proposal and one disagrees
- **THEN** its verdict is `contested`, not `agreed`, and no setting anywhere can change that outcome

#### Scenario: A proposal nobody reacted to is unrated

- **WHEN** the retro advances to `discuss` and no member reacted to a given proposal
- **THEN** that proposal's verdict is `unrated` with zero counts, and it is not presented as agreed

#### Scenario: Stepping back clears the verdict and keeps the reactions

- **WHEN** the facilitator steps the retro back from `discuss` to `vote`
- **THEN** every proposal's verdict, counts and ratification stamp are cleared, every reaction row still exists, and advancing forward again recomputes the verdict including any reaction added in between

#### Scenario: There is no counter to contend on

- **WHEN** the storage schema for reactions and proposals is inspected
- **THEN** it contains no column that is incremented as reactions arrive, and the only aggregate values are written once by the phase advance

### Requirement: Contested proposals lead the discussion, and a verdict is visible

From `discuss` onward the AI section SHALL display each proposal's verdict, with its agree and
disagree counts as a team-level aggregate carrying **no per-person dimension** — no name, no avatar
and no way to learn who reacted which way. Proposals whose verdict is `contested` SHALL be ordered
before the rest, which SHALL keep their existing category-and-rank order, so the team's discussion
time lands first on what they disagree about.

Before the verdict is stamped, a proposal SHALL display the caller's **own** reaction and nothing
else about anyone else's, and the section SHALL continue to state that its content is AI-drafted and
not agreed by the team.

The reaction controls, the verdict display and the ordering SHALL be fully operable and legible
without a pointer, every colour and font SHALL resolve from a semantic token, and the surface SHALL
be correct and AA-contrast in the Warm, Focused and Editorial presets in both light and dark. Making
or clearing a reaction SHALL render immediately from the optimistic local write and SHALL NOT newly
wait on the network.

#### Scenario: Contested sorts to the top

- **WHEN** a retro in `discuss` holds proposals with mixed verdicts
- **THEN** every `contested` proposal is rendered before every non-contested one, and the non-contested ones keep the order they had

#### Scenario: The counts name nobody

- **WHEN** a member reads a ratified proposal
- **THEN** they see how many agreed and how many disagreed, and no surface anywhere lets them learn which member did which

#### Scenario: Only your own reaction is shown before the stamp

- **WHEN** a member reads a proposal during `vote` after reacting to it
- **THEN** their own reaction is shown as selected and no indication of any other member's reaction or of a running total is present

#### Scenario: The whole ratification surface works from the keyboard

- **WHEN** a member tabs to a proposal, agrees with it, changes to disagree, and clears the reaction, using no pointer
- **THEN** focus is visible at every step, each control reports its pressed state to assistive technology, and every one of those actions is also reachable from the command palette

#### Scenario: A reaction is instant

- **WHEN** a member activates a reaction control
- **THEN** the control updates immediately from the optimistic local write and is reconciled in the background

#### Scenario: It is correct in every theme

- **WHEN** the reaction controls and verdict badges are rendered in Warm, Focused and Editorial, in light and dark
- **THEN** every colour resolves from a semantic token and meets AA contrast, with no hardcoded colour

### Requirement: An agreed improvement becomes a tracked issue with no pre-filled owner

A member SHALL be able to turn an agreed improvement proposal into a retro action item with a single
keystroke, and that action SHALL record which proposal produced it. The action SHALL then convert
into a real issue through the **existing unchanged** conversion path — the same shared issue-creation
mutator, the same permissions, the same server-authoritative per-team numbering and the same
idempotence — so an issue born from an AI proposal is indistinguishable from any other issue.

**The action and the resulting issue SHALL NOT carry an assignee.** No part of this path SHALL
suggest, default or infer an owner. The model receives no identity dimension at any depth, so any
owner it appeared to suggest would be invented, and it would be the first per-person output anywhere
in the AI layer. A human SHALL assign the issue afterwards through the ordinary control.

If the AI draft is discarded — for example because the facilitator stepped the retro back to
`brainstorm` — an action created from a proposal SHALL survive, losing only its provenance link.

Work-graph placement: an optional provenance edge from an existing `retro_action` to an existing AI
proposal. Permission story: the action and the issue are team-scoped exactly as they already are;
the provenance column adds no read path.

#### Scenario: A converted improvement's issue has no assignee

- **WHEN** a member turns an agreed improvement into an action and converts that action to an issue
- **THEN** the issue is created with a null assignee, and nothing in the AI path ever set one

#### Scenario: The conversion path is the shipped one

- **WHEN** an action created from an AI proposal is converted
- **THEN** it is created through the same shared issue-creation mutator with a server-assigned per-team number, placed in the target cycle, and converting it a second time creates no second issue

#### Scenario: Provenance is recorded

- **WHEN** an action is created from a proposal
- **THEN** the action records that proposal as its origin, so the loop from an AI suggestion to a tracked issue is traceable

#### Scenario: Discarding the draft does not delete the action

- **WHEN** the facilitator steps the retro back to `brainstorm`, discarding the AI draft and its proposals
- **THEN** any action created from a proposal still exists with its body intact, and its provenance link is empty

#### Scenario: Creating the action is one keystroke

- **WHEN** a member focuses an agreed improvement and presses the documented key, using no pointer
- **THEN** the action item is created and appears in the action list, and the same command is available from the command palette

### Requirement: The ratification surface is absent when AI is off

When a team has not opted into AI participation, or the workspace has no AI configured, or the draft
produced no surviving proposal, the ratification surface SHALL be absent in exactly the sense the AI
draft section is already absent: no reaction control SHALL render, no reaction query SHALL be
issued, no verdict SHALL be computed, and the phase advance SHALL do no additional work. The retro
SHALL remain byte-identical to the retro that ships without any AI capability.

#### Scenario: A team that never opted in sees no ratification

- **WHEN** a member opens a retro on a team whose AI participation is off, and the facilitator advances it from `vote` to `discuss`
- **THEN** no reaction query is issued, no reaction control renders, no verdict is computed or stored, and no error is logged

#### Scenario: Advancing costs nothing when there is no draft

- **WHEN** a retro with no AI draft row advances from `vote` to `discuss`
- **THEN** the advance performs no ratification work and behaves exactly as it did before this capability

