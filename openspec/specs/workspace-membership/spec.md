# workspace-membership Specification

## Purpose
TBD - created by archiving change workspace-auth. Update Purpose after archive.
## Requirements
### Requirement: Single workspace and role edge

The instance SHALL have exactly one `workspace` row (the instance root), and access to it SHALL be modeled by a `workspace_member` row per user carrying a role of `admin`, `member`, or `viewer`. Presence of a `workspace_member` row SHALL be what grants a user access to the instance; the role SHALL determine capability. The `viewer` role SHALL be free and unlimited — no seat cap, no count, and no upgrade prompt may ever apply to it (nor to any role).

Work-graph placement: `workspace` is the instance root every other entity (member, team, and every future issue/PR/deploy) hangs off; `workspace_member` is the authorization edge between `user` (identity) and the workspace. Sync/permission story: any member (role ≠ null) SHALL read the single `workspace` row and all `workspace_member` and member `user`-profile rows (assignee/mention pickers need them); an authenticated non-member SHALL read none of them. Only an `admin` SHALL rename the workspace or change/remove members; a member MAY remove only its own membership (leave). Reads are denied by returning an empty query; write authorization is checked before any existence check.

#### Scenario: Member reads the workspace and roster

- **WHEN** a `member` or `viewer` opens the app
- **THEN** the single workspace and the full member roster (with profiles) sync to their client

#### Scenario: Non-member reads nothing

- **WHEN** an authenticated user with no `workspace_member` row queries any workspace or member data
- **THEN** every such query returns an empty result

#### Scenario: Role determines write capability

- **WHEN** a `viewer` attempts any write
- **THEN** the mutator rejects it as not authorized, while an `admin` or `member` write within its rights succeeds

#### Scenario: Viewer is free and unlimited

- **WHEN** an admin assigns the `viewer` role to any number of users
- **THEN** no seat limit, count, cost, or upgrade prompt is imposed at any point

### Requirement: First-admin bootstrap

On a fresh instance with no `workspace_member` rows, the first user to complete sign-in SHALL be promoted to `admin` atomically, so a new self-host reaches a usable administered state with no manual seeding. The promotion MUST be safe against concurrent boots/sign-ins (advisory-locked, insert-if-not-exists). An optional `YAPM_BOOTSTRAP_ADMIN_EMAIL` env var SHALL restrict the bootstrap to a matching verified email.

#### Scenario: First user becomes admin

- **WHEN** the first user signs in on an instance with zero members and no bootstrap email configured
- **THEN** that user is inserted as `admin` and can administer the workspace

#### Scenario: Concurrent first sign-ins produce one admin

- **WHEN** multiple users sign in simultaneously on a fresh instance
- **THEN** exactly one `admin` `workspace_member` row results, with no duplicate or lost promotion

#### Scenario: Bootstrap email restricts promotion

- **WHEN** `YAPM_BOOTSTRAP_ADMIN_EMAIL` is set and a user whose verified email does not match signs in first
- **THEN** that user is not promoted and remains a non-member until invited, and only the matching email becomes the bootstrap admin

### Requirement: Member management

An `admin` SHALL be able to list members, change a member's role, and remove a member; a member SHALL be able to leave (remove its own membership). Removing a member SHALL revoke their access (their subsequent reads return empty). An admin MUST NOT be able to remove or demote the last remaining admin, so the instance can never be left unadministered.

#### Scenario: Admin changes a role

- **WHEN** an admin changes a member's role from `member` to `viewer`
- **THEN** that user's write capability is reduced accordingly on their next synced state

#### Scenario: Admin removes a member

- **WHEN** an admin removes a member
- **THEN** the member's `workspace_member` row is deleted and their subsequent workspace reads return empty

#### Scenario: Last admin is protected

- **WHEN** an admin attempts to remove or demote the only remaining admin
- **THEN** the mutator rejects it and the instance retains at least one admin

#### Scenario: Member leaves

- **WHEN** a `member` or `viewer` chooses to leave
- **THEN** their own membership is removed without requiring admin action

### Requirement: Access gate for non-members

An authenticated user who is not a workspace member SHALL be shown an explicit access-gate surface (not a blank or broken app) explaining that they need an invitation, with a way to sign out. This surface and its controls SHALL be fully keyboard-operable.

#### Scenario: Non-member sees the access gate

- **WHEN** an authenticated non-member loads the app
- **THEN** an access-gate screen explains that access requires an invitation and offers a sign-out control

#### Scenario: Keyboard-only member management

- **WHEN** an admin navigates the member list, opens a member's role control, changes the role, and confirms — all via Tab/Arrow/Enter
- **THEN** the change is applied with no pointer interaction

