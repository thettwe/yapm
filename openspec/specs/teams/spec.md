# teams Specification

## Purpose
TBD - created by archiving change workspace-auth. Update Purpose after archive.
## Requirements
### Requirement: Team entity and membership

The workspace SHALL contain zero or more `team` rows, each with a human name and a short key (the uppercase identifier that prefixes the team's issue keys, e.g. `ENG-42`), and a `team_membership` edge recording which users belong to which teams. A team MAY be archived (soft-hidden) without deletion. Team membership SHALL carry no per-team role — the workspace role is the sole capability axis.

Work-graph placement: `team` hangs off the single `workspace`; `team_membership` connects `user` to `team` and is the visibility edge every work-data query joins against so that a user syncs only the work of teams they belong to. Sync/permission story: any member SHALL read all (non-archived) teams and all `team_membership` rows in the workspace, so the team list is browsable and rosters are visible; an authenticated non-member SHALL read none. Only an `admin` SHALL create, rename, or archive a team and manage arbitrary members' team rosters; any member MAY add or remove **itself** on a team it can see (self-serve join/leave). Reads are denied by empty query; write authorization is checked before existence.

#### Scenario: Member browses teams

- **WHEN** a member opens the teams surface
- **THEN** all non-archived teams and their rosters sync to their client

#### Scenario: Non-member reads no teams

- **WHEN** an authenticated non-member queries teams
- **THEN** the query returns an empty result

#### Scenario: Admin creates a team

- **WHEN** an admin creates a team with a name and key
- **THEN** the team is created with a client-minted UUIDv7 id and becomes visible to all members

#### Scenario: Team key is unique and normalized

- **WHEN** an admin creates a team whose key collides with an existing team's key
- **THEN** the mutator rejects it with a validation error and no team is created

#### Scenario: Non-admin cannot manage teams

- **WHEN** a `member` or `viewer` attempts to create, rename, or archive a team
- **THEN** the mutator rejects it as not authorized

### Requirement: Self-serve and administered team membership

A member SHALL be able to join and leave any team it can see; an admin SHALL additionally be able to add or remove any user to/from any team. A `viewer` MAY join a team to scope its read access but SHALL NOT gain any write capability by doing so.

Removing a user from a team — whether by an admin or by the user leaving — SHALL additionally **delete that user's notifications whose team is the team being left**, in the same server-authoritative transaction as the membership removal, and SHALL leave that user's notifications for **other** teams intact. The deletion SHALL happen server-side because the acting user can never read another user's notifications and therefore cannot delete them optimistically. Deleting a team SHALL remove every notification for that team, for every recipient, by database cascade.

#### Scenario: Member joins a team

- **WHEN** a member joins a visible team
- **THEN** a `team_membership` row is created for that user and team

#### Scenario: Member leaves a team

- **WHEN** a member on a team leaves it
- **THEN** its own `team_membership` row is removed without admin action

#### Scenario: Leaving a team deletes only that team's notifications

- **WHEN** a member belonging to teams T1 and T2, holding notifications from both, leaves T1
- **THEN** their T1 notifications are deleted and their T2 notifications remain readable in their inbox

#### Scenario: Admin manages another user's membership

- **WHEN** an admin adds another user to a team
- **THEN** that user's `team_membership` row is created

#### Scenario: Admin removing a team member deletes that member's team notifications

- **WHEN** an admin removes another user from a team
- **THEN** that user's notifications for that team are deleted, even though the admin can never read them

#### Scenario: Joining a team grants a viewer no write power

- **WHEN** a `viewer` joins a team
- **THEN** the viewer's reads may widen to that team's data but every write remains rejected

### Requirement: Keyboard-operable team surfaces

Team creation, renaming, archiving, and membership management SHALL be fully operable without a pointer: reachable by Tab, actionable by Enter/Space, with dialogs trapping and restoring focus.

#### Scenario: Keyboard-only team creation

- **WHEN** an admin opens the create-team control, types a name and key, and confirms with Enter
- **THEN** the team is created with no pointer interaction

#### Scenario: Keyboard-only join/leave

- **WHEN** a member focuses a team's join/leave control and activates it with Enter or Space
- **THEN** membership toggles with no pointer interaction

### Requirement: Leaving a team clears that team's issue subscriptions

Removing a member from a team — whether an administrator removes them or they leave — SHALL delete
that person's `issue_subscription` rows **for that team**, and SHALL leave their subscriptions for
every other team intact.

This SHALL be performed in the server-authoritative pass, in the same transaction as the membership
removal, because the person losing membership can no longer read the rows involved and an optimistic
client pass would therefore have nothing to delete.

This distinction is sound only because an issue can never change team, so a subscription's
denormalised team is permanent.

#### Scenario: Only the removed team's subscriptions go

- **WHEN** a person following issues in two teams is removed from one of them
- **THEN** their subscriptions for the removed team no longer exist and their subscriptions for the
  other team remain

#### Scenario: A removed member receives no further activity

- **WHEN** a person is removed from a team and someone comments on an issue they previously followed
  in that team
- **THEN** they receive no notification

#### Scenario: Cleanup rides the membership removal

- **WHEN** the transaction removing the membership fails
- **THEN** the subscriptions are still present, because the two commit or roll back together

### Requirement: Team carries its status-automation setting

The `team` entity SHALL carry a nullable `auto_status_since` timestamp expressing whether that team
has opted in to connector-driven issue-status automation and, if so, from when. `NULL` SHALL mean
off, which is the default for every team including newly created ones. A shared
`team.setAutoStatus` mutator SHALL be the only write path: it SHALL require the `admin` workspace
role (`canManage`), checked before the team row is loaded, and SHALL write the caller-supplied
instant when enabling and `NULL` when disabling. The instant SHALL be supplied by the mutator's
caller rather than generated inside the mutator body, so the value is identical on the optimistic and
authoritative passes. Setting the value SHALL NOT alter any issue.

Work-graph placement: a scalar configuration attribute of `team`, which hangs off the single
`workspace`; no new entity, no new edge, no per-team role. Sync/permission story: the column
replicates with the `team` row under the existing rule that any member reads all non-archived teams,
so every member can see whether their team's board moves on its own; an authenticated non-member
reads nothing, as before. Only an `admin` MAY write it; a `member` or `viewer` attempting to write is
rejected before any existence check.

#### Scenario: A new team defaults to automation off

- **WHEN** an admin creates a team
- **THEN** its `auto_status_since` is `NULL` and no connector event drives any of its issues' status

#### Scenario: Admin enables and disables automation

- **WHEN** an admin enables automation for a team and later disables it
- **THEN** the column holds the enabling instant and is then `NULL` again, and re-enabling records a
  fresh instant rather than the original one

#### Scenario: Non-admin cannot write the setting

- **WHEN** a `member` or `viewer` invokes `team.setAutoStatus`
- **THEN** the mutator rejects it as not authorized before any existence check

#### Scenario: Members can read the setting

- **WHEN** a member of the workspace syncs the team list
- **THEN** each team's automation state is present on the synced row, so the member can tell whether
  that team's issues move on their own

#### Scenario: Keyboard-only toggle

- **WHEN** an admin reaches a team's automation control with Tab and activates it with Enter or Space
- **THEN** the setting toggles with no pointer interaction

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

