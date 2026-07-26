## MODIFIED Requirements

### Requirement: Member management

An `admin` SHALL be able to list members, change a member's role, and remove a member; a member SHALL be able to leave (remove its own membership). Removing a member SHALL revoke their access (their subsequent reads return empty). An admin MUST NOT be able to remove or demote the last remaining admin, so the instance can never be left unadministered.

Removing a member — whether by an admin or by the member leaving — SHALL additionally **delete every notification addressed to that user**, across every team, in the same server-authoritative transaction as the membership removal. The deletion SHALL happen server-side because the acting user can never read another user's notifications and therefore cannot delete them optimistically.

#### Scenario: Admin changes a role

- **WHEN** an admin changes a member's role from `member` to `viewer`
- **THEN** that user's write capability is reduced accordingly on their next synced state

#### Scenario: Admin removes a member

- **WHEN** an admin removes a member
- **THEN** the member's `workspace_member` row is deleted and their subsequent workspace reads return empty

#### Scenario: Removing a member deletes their notifications

- **WHEN** an admin removes a member who had notifications from several teams
- **THEN** every notification addressed to that user is deleted, in the same transaction as the membership removal

#### Scenario: Last admin is protected

- **WHEN** an admin attempts to remove or demote the only remaining admin
- **THEN** the mutator rejects it and the instance retains at least one admin

#### Scenario: Member leaves

- **WHEN** a `member` or `viewer` chooses to leave
- **THEN** their own membership is removed without requiring admin action, and every notification addressed to them is deleted
