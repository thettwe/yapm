## ADDED Requirements

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
