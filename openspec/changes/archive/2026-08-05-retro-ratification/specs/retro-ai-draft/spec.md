## MODIFIED Requirements

### Requirement: Team-scoped, client-read-only draft artifact

The draft SHALL be stored as one artifact row per retro (unique on the retro) plus one row per
proposal, both carrying the owning `team_id` as their permission anchor and both cascading from the
retro. Both SHALL be synced to clients under the ordinary team-scoped read predicate, and neither
SHALL be writable by any client: the write path SHALL be a server-only helper over the shared sync
transaction that is never registered in the client mutator map. Proposals SHALL be stored as rows
with stable ids rather than as one opaque document, so a later capability can key on a proposal.

The artifact SHALL carry a status drawn from the same union every AI artifact uses
(`pending`, `ready`, `failed`, `ai_off`) and SHALL record the provider, model, token counts and
estimated cost of the run that produced it. Scheduling state used only by the completion pass SHALL
NOT be part of the synced schema.

A proposal row SHALL additionally carry the team's decision about it — a verdict and its agree and
disagree counts — as **written-once** attributes set by the server-authoritative phase advance and
cleared by the reverse advance. These SHALL remain client-read-only through the same server-only
write path, SHALL be null on a proposal the team has not yet decided, and SHALL NOT be counters:
nothing SHALL increment them as opinions arrive.

Work-graph placement: a leaf artifact hanging off `retro`, which hangs off `team` — the same class
and the same shape as the cycle digest. Sync/permission story: a member of the owning team reads it;
an authenticated non-member reads nothing through the ordinary team-scoped predicate; no client can
write it at all.

#### Scenario: A client cannot forge a proposal

- **WHEN** a client attempts to write an AI draft or proposal row through the mutator surface
- **THEN** there is no such mutator to call, and no client-originated write can create or alter one

#### Scenario: A client cannot forge a verdict

- **WHEN** a client attempts to write a proposal's verdict or counts
- **THEN** there is no mutator that writes them, and the only writer is the server-authoritative phase advance

#### Scenario: A non-member reads nothing

- **WHEN** a workspace member who is not on the owning team evaluates the draft queries for that team's retro
- **THEN** both return zero rows

#### Scenario: Deleting the retro removes the artifact

- **WHEN** a retro is deleted
- **THEN** its draft row and every proposal row are removed with it

#### Scenario: The run's cost is recorded and counted

- **WHEN** a draft reaches `ready`
- **THEN** its estimated cost is stored on the artifact and is included in the workspace's running AI spend total

#### Scenario: A discarded run's cost is not refunded

- **WHEN** a `ready` draft is deleted because its retro stepped back to `brainstorm`
- **THEN** the workspace's running AI spend total is unchanged by the deletion, so the cap keeps counting money that was really spent

#### Scenario: An undecided proposal carries no verdict

- **WHEN** a proposal is stored by a completed draft and the retro has not yet left `vote`
- **THEN** its verdict and counts are empty rather than zero-valued, so nothing renders it as decided

### Requirement: A keyboard-operable draft section that is absent when AI is off

The retro SHALL render the AI's proposals in a section adjacent to the auto-seeded data panel and
SHALL NOT interleave them into the retro format's own columns, because two of the shipped formats do
not map onto wins, losses and improvements. The section SHALL render only when an artifact row
exists and is either in progress or ready with at least one proposal; a run that ended `ai_off` or
`failed`, or produced no surviving proposal, SHALL render nothing at all, leaving the seeded data
panel as the raw-evidence fallback. The section SHALL state plainly that its content is AI-drafted
and, until the team has decided, that it has not been agreed by the team.

Every proposal's evidence references SHALL be activatable: a work-graph reference SHALL open the
entity, and a metric reference SHALL reveal the seeded panel and move focus to that metric's tile.
Where the retro's phase permits it, each proposal SHALL additionally carry the caller's own
agree/disagree control, and once the team's decision has been recorded the proposal SHALL carry that
decision instead. The whole section SHALL be operable with the keyboard alone, every color and font
SHALL resolve from a semantic token, and it SHALL be correct and AA-contrast in the Warm, Focused
and Editorial presets in both light and dark. Reading the section SHALL NOT newly wait on the
network, and neither SHALL recording a reaction.

#### Scenario: The section is absent when AI is off

- **WHEN** a member opens a retro on a team that has opted in but whose workspace has no AI configured
- **THEN** the artifact is recorded `ai_off`, nothing renders in place of the section, no error is surfaced, and the seeded data panel is unchanged

#### Scenario: Drafting in progress is visible and quiet

- **WHEN** the facilitator has just advanced to `group` and the background pass has not finished
- **THEN** the section shows a single unobtrusive in-progress line and replaces it with the proposals when they arrive, with no reload, and both transitions are announced through one persistent live region rather than by inserting a status node

#### Scenario: An in-progress state that will never resolve stands down

- **WHEN** the completion pass is disabled instance-wide, so a stamped row is never completed
- **THEN** the in-progress line stops rendering after a bounded interval and the seeded data panel is the whole surface again, with no error and nothing left claiming to be in progress

#### Scenario: The whole section works from the keyboard

- **WHEN** a member tabs from the seeded data panel into the draft section and activates a proposal's issue reference, then a metric reference, then its reaction control, using no pointer
- **THEN** focus is visible at every step, the issue opens, the metric reference reveals the data panel and focuses that metric's tile, and the reaction control reports its pressed state

#### Scenario: It is correct in every theme

- **WHEN** the section is rendered in Warm, Focused and Editorial, in light and dark
- **THEN** the category chips, evidence chips, reaction controls, verdict badges and body text resolve from tokens and meet AA contrast, with no hardcoded color

#### Scenario: The draft is labelled as unratified

- **WHEN** proposals are shown before the team's decision has been recorded
- **THEN** the section states that they are AI-drafted and not agreed, so no reader mistakes them for a team conclusion; once the decision is recorded, each proposal shows what the team decided
