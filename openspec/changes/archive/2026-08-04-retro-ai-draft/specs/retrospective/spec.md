## MODIFIED Requirements

### Requirement: Anonymity is guaranteed at the storage layer

Because sync returns whole rows and the sync engine has no column-level read permission, the author of a card SHALL NOT be carried on any row that syncs to clients other than the author. The system SHALL store the card→author binding in a server-only table that is **absent from the Zero schema entirely**, used solely by server mutators for authorization, moderation and audit. For a retro with `is_anonymous` set, the synced card row's author field SHALL be null — there SHALL be no hidden author column to strip. A retro's anonymity SHALL be settable only while the retro is in `brainstorm`, before any card exists, and SHALL be immutable thereafter. No code path SHALL copy the server-only author onto a synced row.

**No automated reader of the retro — including an AI step — SHALL read retro-authored content.** Any pipeline that produces content into a retro SHALL assemble its input from work-graph tables under an explicit table allowlist that excludes every retro content table and the card→author binding, so authorship is not reconstructable from what such a pipeline reads. Every synced query added by any capability SHALL be covered by the registry-wide anonymity proof by construction, so a query added later cannot escape it.

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

#### Scenario: An automated retro contributor reads no card

- **WHEN** an AI step produces content into a retro whose board holds published anonymous cards
- **THEN** the tables its input assembly reads exclude every retro content table and the card→author binding, so no card body and no card author is reachable from it

## ADDED Requirements

### Requirement: An AI draft section beside the data panel, never inside the format's columns

The retro surface SHALL be able to show AI-drafted proposals in a section adjacent to the
auto-seeded data panel, and SHALL NOT place them into the retro format's own columns: the shipped
formats include two whose columns do not map onto wins, losses and improvements, so the AI's buckets
are its own and are labelled as such. The section SHALL be absent — rendering nothing, firing no
error and consuming no space — whenever the capability is off for the team, unavailable for the
workspace, or produced no surviving proposal, leaving the auto-seeded data panel as the unchanged
raw-evidence fallback. The section SHALL state that its content is AI-drafted and not agreed by the
team, and SHALL offer no means of endorsing, rejecting or reacting to a proposal.

The section SHALL be fully operable with the keyboard alone and SHALL render entirely from semantic
tokens, correct and AA-contrast in the Warm, Focused and Editorial presets in both light and dark,
consistent with the rest of the retro surface. Its presence SHALL NOT make any existing retro
interaction wait on the network.

#### Scenario: The retro is unchanged when the capability is off

- **WHEN** a member opens a retro on a team that has not enabled AI participation
- **THEN** the retro renders exactly as it does without this capability, with no extra section, no extra query and no error

#### Scenario: Proposals never take over a format's columns

- **WHEN** a retro using a format whose columns are not wins/losses/improvements shows AI proposals
- **THEN** the proposals appear only in their own labelled section and no column's contents are altered

#### Scenario: The section is reachable and operable by keyboard

- **WHEN** a member tabs from the data panel into the draft section and activates a proposal's references, using no pointer
- **THEN** focus is visible at each step and every reference is activatable

#### Scenario: Nothing in the section records an opinion

- **WHEN** a member reads a proposal they disagree with
- **THEN** the surface offers no control to agree, disagree, vote on or dismiss it, and the proposal is unchanged
