## MODIFIED Requirements

### Requirement: Invite by email and by shareable link

An `admin` SHALL be able to invite users into the workspace both by single-use email invitation and by reusable shareable link, each carrying the role the invitee will receive and optionally a team to add them to. Both mechanisms SHALL work with or without an email transport: the invite link SHALL always be presentable for the admin to copy, and email delivery SHALL be an additional convenience when a transport is configured — never a requirement.

Email delivery SHALL go through the shared provider-neutral `Mailer` seam rather than any invite-specific mail code, so that an invite email is sent by whichever transport the instance has configured — SMTP **or** the HTTPS sender — and is rendered by the same template mechanism as every other outgoing message. When no transport is configured, creating an email invite SHALL succeed, SHALL present the link, and SHALL send nothing, without error.

Work-graph placement: `invite` hangs off the single `workspace` and optionally references a `team`; accepting an invite produces a `workspace_member` (and a `team_membership` when a team is set). Sync/permission story: `invite` rows SHALL be readable by `admin` only — a `member` or `viewer` reads none, and a non-member reads none; the invitee interacts with the invite through a token, not through a synced query, so pending invites never leak to non-admins. An email invite (`email` set) SHALL be single-use and bound to that email; a shareable link (`email` null) SHALL be reusable until it expires or is revoked. Reads are denied by empty query; accept/revoke authorization is checked before existence.

#### Scenario: Admin creates an email invite without SMTP

- **WHEN** an admin with no email transport configured creates an email invite with a role
- **THEN** an `invite` row is created, its accept link is shown for the admin to copy, and no email is attempted

#### Scenario: Admin creates a shareable link

- **WHEN** an admin creates a shareable invite link with a role and optional team
- **THEN** a reusable-until-expiry `invite` row is created and its link is presented

#### Scenario: Email delivery when SMTP is configured

- **WHEN** SMTP is configured and an admin creates an email invite
- **THEN** the invite email is sent through the shared mailer in addition to the link being shown

#### Scenario: Email delivery when the HTTPS sender is configured

- **WHEN** the HTTPS transport is configured instead of SMTP and an admin creates an email invite
- **THEN** the same invite email is sent through that transport, with the same content and the same link

#### Scenario: Only admins see pending invites

- **WHEN** a `member` or `viewer` queries invites
- **THEN** the query returns an empty result
