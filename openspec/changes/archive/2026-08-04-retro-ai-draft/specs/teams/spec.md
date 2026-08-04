## ADDED Requirements

### Requirement: Team carries its AI-retro-participation setting

The `team` entity SHALL carry a nullable `ai_retro_draft_since` timestamp expressing whether that
team has opted in to AI participation in its own retrospectives and, if so, from when. `NULL` SHALL
mean off, which is the default for every team including newly created ones. A shared
`team.setAiRetroDraft` mutator SHALL be the only write path: it SHALL require the `admin` workspace
role (`canManage`), checked **before** the team row is loaded, and SHALL write the caller-supplied
instant when enabling and `NULL` when disabling. The instant SHALL be supplied by the mutator's
caller rather than generated inside the mutator body, so the value is identical on the optimistic and
authoritative passes. Setting the value SHALL NOT create, alter or delete any retro, artifact or
issue, and SHALL NOT trigger a provider call.

The setting SHALL be independent of every other team setting: enabling or disabling it SHALL have no
effect on status automation, cycle digests, or any other per-team behaviour.

Work-graph placement: a scalar configuration attribute of `team`, which hangs off the single
`workspace`; no new entity, no new edge, no per-team role. Sync/permission story: the column
replicates with the `team` row under the existing rule that any member reads all non-archived teams,
so every member can see whether a model participates in their retro; an authenticated non-member
reads nothing, as before. Only an `admin` MAY write it; a `member` or `viewer` attempting to write is
rejected before any existence check.

#### Scenario: A new team defaults to no AI participation

- **WHEN** an admin creates a team
- **THEN** its `ai_retro_draft_since` is `NULL` and no retro of that team is drafted into

#### Scenario: Admin enables and disables participation

- **WHEN** an admin enables AI participation for a team and later disables it
- **THEN** the column holds the enabling instant and is then `NULL` again, and re-enabling records a fresh instant rather than the original one

#### Scenario: Non-admin cannot write the setting

- **WHEN** a `member` or `viewer` invokes `team.setAiRetroDraft`
- **THEN** the mutator rejects it as not authorized before any existence check

#### Scenario: Members can read the setting

- **WHEN** a member of the workspace syncs the team list
- **THEN** each team's AI-participation state is present on the synced row, so the member can tell whether a model will draft into their retro

#### Scenario: The toggle is keyboard-operable and tokenized

- **WHEN** an admin moves to the per-team control with the keyboard and toggles it, using no pointer
- **THEN** focus is visible, the control activates from the keyboard, and it renders from semantic tokens correctly in all three presets in light and dark

#### Scenario: The setting touches nothing else

- **WHEN** an admin toggles AI participation for a team
- **THEN** that team's status automation, cycle digests and every other behaviour are unchanged
