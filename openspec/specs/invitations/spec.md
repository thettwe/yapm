# invitations Specification

## Purpose
TBD - created by archiving change workspace-auth. Update Purpose after archive.
## Requirements
### Requirement: Invite by email and by shareable link

An `admin` SHALL be able to invite users into the workspace both by single-use email invitation and by reusable shareable link, each carrying the role the invitee will receive and optionally a team to add them to. Both mechanisms SHALL work with or without SMTP: the invite link SHALL always be presentable for the admin to copy, and email delivery SHALL be an additional convenience when SMTP is configured — never a requirement.

Work-graph placement: `invite` hangs off the single `workspace` and optionally references a `team`; accepting an invite produces a `workspace_member` (and a `team_membership` when a team is set). Sync/permission story: `invite` rows SHALL be readable by `admin` only — a `member` or `viewer` reads none, and a non-member reads none; the invitee interacts with the invite through a token, not through a synced query, so pending invites never leak to non-admins. An email invite (`email` set) SHALL be single-use and bound to that email; a shareable link (`email` null) SHALL be reusable until it expires or is revoked. Reads are denied by empty query; accept/revoke authorization is checked before existence.

#### Scenario: Admin creates an email invite without SMTP

- **WHEN** an admin with no SMTP configured creates an email invite with a role
- **THEN** an `invite` row is created and its accept link is shown for the admin to copy

#### Scenario: Admin creates a shareable link

- **WHEN** an admin creates a shareable invite link with a role and optional team
- **THEN** a reusable-until-expiry `invite` row is created and its link is presented

#### Scenario: Email delivery when SMTP is configured

- **WHEN** SMTP is configured and an admin creates an email invite
- **THEN** the invite email is sent in addition to the link being shown

#### Scenario: Only admins see pending invites

- **WHEN** a `member` or `viewer` queries invites
- **THEN** the query returns an empty result

### Requirement: Accepting an invite grants membership

An authenticated user presenting a valid, unexpired, unrevoked invite token SHALL be granted a `workspace_member` row with the invite's role (and a `team_membership` if the invite named a team). An email invite SHALL be consumed (revoked) on acceptance; a shareable link SHALL remain valid for further acceptances until it expires or is revoked. Accepting SHALL assign exactly the invite's role and no more.

#### Scenario: Accept an email invite

- **WHEN** an authenticated user accepts a valid single-use email invite for role `member`
- **THEN** they receive a `member` `workspace_member` row and the invite becomes consumed

#### Scenario: Accept via reusable link

- **WHEN** two different authenticated users each accept the same valid shareable link
- **THEN** both become members and the link remains valid until it expires or is revoked

#### Scenario: Expired or revoked invite is refused

- **WHEN** a user attempts to accept an expired or revoked invite
- **THEN** acceptance is refused, no membership is created, and the reason is surfaced

#### Scenario: Email invite is bound to its address

- **WHEN** a user whose verified email does not match a single-use email invite attempts to accept it
- **THEN** acceptance is refused

#### Scenario: Accept grants only the invited role

- **WHEN** a user accepts an invite for role `viewer`
- **THEN** they become a `viewer` and gain no additional capability

### Requirement: Revoking invites

An `admin` SHALL be able to revoke any pending invite, after which it can no longer be accepted. Revocation SHALL NOT affect memberships already granted through that invite.

#### Scenario: Revoke a pending link

- **WHEN** an admin revokes a shareable link
- **THEN** subsequent accept attempts with that link are refused while already-joined members keep their access

#### Scenario: Keyboard-only invite management

- **WHEN** an admin creates an invite, copies its link, and revokes an invite entirely via Tab/Enter/Space
- **THEN** each action completes with no pointer interaction

