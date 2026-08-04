## ADDED Requirements

### Requirement: A second notification subject type, and two provably disjoint delivery selections

The system SHALL support a notification subject beyond the issue: a published PM digest, written
with its own notification kind and its own subject type, costing a type-union member and a copy
string rather than a schema migration.

The shipped notification delivery sweep SHALL narrow its selection to **issue-subject** rows, and
the disclosure delivery sweep SHALL select **PM-digest-subject** rows only, so that no row can be
picked up by both and no recipient can be mailed twice about the same event. The narrowing SHALL
remove no issue notification that was previously eligible.

The shipped sweep's current-access predicate — a current member of the notification's team, or a
current workspace admin — SHALL NOT be widened, weakened or taught about the disclosure audience.

#### Scenario: A workspace admin who is also a named reader is mailed once

- **WHEN** a digest is published to an audience that includes a workspace admin, and both delivery
  sweeps run
- **THEN** exactly one message is sent to that admin about that publication

#### Scenario: The narrowing changes nothing for issue notifications

- **WHEN** the notification delivery sweep runs over the same issue notifications it selected before
  this change
- **THEN** the same rows are selected, grouped, sent and stamped

### Requirement: A PM-digest notification is worded without an actor and carries no digest content

The system SHALL word the PM-digest notice without naming an actor, in the one place notifications
are turned into words, so the inbox row and the mailed message can never describe the event
differently. The wording SHALL carry only yapm-computed metadata: the team name and the cycle name.

Opening the notice SHALL take the recipient to the disclosure surface. Where a recipient is no
longer entitled, that surface SHALL be absent exactly as it is for any unentitled reader — the
notice does not create an entitlement.

#### Scenario: The inbox row names no publisher

- **WHEN** a named reader opens their inbox after a digest is published to them
- **THEN** the row reads as a system notice with the team and cycle name and no person's name, and
  contains no part of the digest content

#### Scenario: Following a notice after entitlement is withdrawn

- **WHEN** a recipient opens a PM-digest notice after being removed from the audience
- **THEN** the disclosure surface is absent for them, with no empty state announcing that a channel
  exists
