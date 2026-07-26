## ADDED Requirements

### Requirement: Leaving the workspace clears every issue subscription

Removing a member from the workspace — whether an administrator removes them or they leave — SHALL
delete **every** `issue_subscription` row they hold, across every team.

This SHALL be performed in the server-authoritative pass, in the same transaction as the member
removal, for the same reason the equivalent notification cleanup is: an administrator removing
somebody else cannot see that person's rows, so an optimistic client pass has nothing to delete.

#### Scenario: Every subscription is removed

- **WHEN** a person following issues in several teams is removed from the workspace
- **THEN** they hold no issue subscriptions in any team

#### Scenario: Cleanup rides the member removal

- **WHEN** the transaction removing the workspace member fails
- **THEN** the subscriptions are still present, because the two commit or roll back together
