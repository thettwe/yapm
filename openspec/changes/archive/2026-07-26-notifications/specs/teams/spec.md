## MODIFIED Requirements

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
