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

