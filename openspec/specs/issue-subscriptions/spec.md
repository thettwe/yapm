# issue-subscriptions Specification

## Purpose
TBD - created by archiving change mentions. Update Purpose after archive.
## Requirements
### Requirement: A durable per-issue subscription entity keyed by its natural key

The system SHALL persist an `issue_subscription` entity, one row per (issue, user), in the existing
Postgres — no new service. Its **primary key SHALL be the composite natural key
`(issue_id, user_id)`**; the entity SHALL carry **no generated id column**, and this capability
SHALL mint no identifier anywhere, at a call site or inside a mutator body.

A row SHALL additionally carry a denormalised `team_id` (the issue's team, sound only because an
issue can never change team), a `state`, and creation and update timestamps.

The entity SHALL be **durable and independent of notification retention**. A subscription SHALL NOT
be derived from the presence of notification rows, because those are swept on a retention schedule
and a derived subscription would therefore expire silently.

Work-graph placement: `issue_subscription` is an edge from a `user` to a team-scoped `issue`,
recording a standing intent to be told about that issue; it is derived from the work graph and is
never an input to it. Sync/permission story: a row is readable **only** by the user it belongs to,
and only for the issue currently being viewed; `team_id` exists for cleanup and indexing and is
never a sync scope.

#### Scenario: Nothing is minted

- **WHEN** the subscription write path is inspected
- **THEN** no UUID or other identifier is generated for a subscription, and a row's identity is
  entirely determined by the issue and the user

#### Scenario: A subscription outlives notification retention

- **WHEN** every notification about an issue has aged past the retention window and been swept
- **THEN** the subscription still exists and the subscriber still receives new activity

#### Scenario: The same subscribe applied twice yields one row

- **WHEN** the same subscribe is applied twice with identical inputs
- **THEN** exactly one row exists, the second write having been absorbed by the primary key with no
  error

### Requirement: An eligible mention subscribes the mentioned person

When a mention produces a notification, the same authoritative transaction SHALL also create a
subscription for that person to that issue, in state `subscribed`.

Subscription creation SHALL be a single insert that does nothing on conflict, so that it is
idempotent under mutator rebase and cannot modify an existing row.

A mention that fails the eligibility check SHALL create no subscription, and a self-mention SHALL
create none.

#### Scenario: Being mentioned subscribes you

- **WHEN** a member is mentioned in a comment on an issue they can read
- **THEN** they are notified once and a subscription in state `subscribed` exists for them on that
  issue

#### Scenario: An ineligible mention subscribes nobody

- **WHEN** a comment mentions a person who cannot read the issue
- **THEN** no subscription is created for them

#### Scenario: Subscription and notification commit together

- **WHEN** the transaction containing the comment write fails
- **THEN** neither the notification nor the subscription exists

### Requirement: Unfollowing is explicit, sticky, and never undone by a later mention

Unfollowing SHALL set the subscription's `state` to `unsubscribed` rather than deleting the row, so
that the decision is representable and survives.

A subsequent mention of that person on that issue SHALL still notify them once — a mention is
addressed at them personally — but SHALL NOT return them to `subscribed`, because the auto-subscribe
write does nothing on conflict.

An explicit follow by the person themselves SHALL set `state` back to `subscribed`. Only the user's
own deliberate action may re-subscribe them.

#### Scenario: Unfollow survives the next mention

- **WHEN** a person unfollows an issue and is later mentioned on it again
- **THEN** they receive the mention notification, and their subscription remains `unsubscribed` so
  they receive no further activity

#### Scenario: Unfollowing stops subsequent activity

- **WHEN** a person unfollows an issue and someone else then comments on it
- **THEN** they receive no notification for that comment

#### Scenario: An explicit follow re-subscribes

- **WHEN** a person who previously unfollowed presses the follow control
- **THEN** their subscription returns to `subscribed` and they receive subsequent activity again

#### Scenario: A viewer can follow and unfollow

- **WHEN** a user with the `viewer` role who is a member of the issue's team is mentioned and
  auto-subscribed, and then unfollows
- **THEN** the unfollow succeeds, because follow and unfollow are gated on the same **read**
  predicate that decides mention eligibility and not on write capability — a role that can be
  subscribed must be able to unsubscribe

### Requirement: A keyboard-operable follow control, stating why you are following

The issue detail surface SHALL present a control showing whether the viewer currently follows the
issue and toggling it, fully operable by keyboard with no pointer interaction, and exposing its
state to assistive technology as a pressed/unpressed control.

When the viewer is following, the control SHALL make it discoverable *from the issue itself* that
they will receive updates and how to stop — an auto-subscription whose exit is not discoverable from
the thing it subscribes you to is a trap.

The control SHALL reflect the viewer's own subscription only. No count of followers, and no list of
who follows an issue, SHALL be rendered to anyone.

#### Scenario: Toggle following with the keyboard alone

- **WHEN** a member reaches the follow control by keyboard and activates it
- **THEN** their subscription toggles optimistically within the interaction budget, with no pointer
  interaction and no wait on the network

#### Scenario: The control announces its state

- **WHEN** assistive technology reaches the control
- **THEN** it announces whether the viewer is currently following and what activating it will do

#### Scenario: No follower list or count is shown

- **WHEN** any user, including a workspace admin, views an issue
- **THEN** no follower count and no list of subscribers is rendered

### Requirement: Subsequent activity reaches subscribers in-app, through the public notification seam

A new comment on an issue SHALL notify its subscribers, in addition to the people already involved
in the issue.

Subscriber notifications SHALL be written through the **public notification write seam**, not by
registering in the involvement-trigger map, and SHALL use the **same kind and the same natural key**
as the involvement fan-out produces for that comment — so that a subscriber who is also involved
receives exactly one inbox row rather than two.

The subscriber set SHALL be read **server-side only**, inside the triggering transaction, bounded by
the shared recipient cap, ordered oldest-subscription-first, and re-filtered through the same
eligibility predicate as a fresh mention, so a person who has left the team stops receiving activity
even before cleanup runs.

Subscription-derived activity SHALL be classified as **ambient** rather than addressed-at-a-person,
so that the default email preference never emails it: being mentioned emails you once, and the
thread it subscribed you to does not.

#### Scenario: A subscriber is told about a new comment

- **WHEN** someone comments on an issue a subscriber follows and is not otherwise involved in
- **THEN** the subscriber receives one in-app notification for that comment

#### Scenario: A subscriber who is also involved gets one row, not two

- **WHEN** a subscriber is also the issue's assignee and someone comments
- **THEN** exactly one notification row exists for them for that comment

#### Scenario: Subscription activity is not emailed at the default preference

- **WHEN** a subscriber at the default email preference receives subscription activity
- **THEN** no email is sent for it, while a mention addressed at them personally is still emailed

#### Scenario: The actor is never notified about their own comment

- **WHEN** a subscriber comments on an issue they follow
- **THEN** they receive no notification for their own comment

#### Scenario: A former team member stops receiving activity

- **WHEN** a subscriber has left the issue's team and is not a workspace admin
- **THEN** they receive no notification for new activity on that issue

### Requirement: Subscriptions are removed when membership ends

Removing a member from a team, or a member leaving a team, SHALL delete that person's issue
subscriptions **for that team**, leaving their subscriptions for other teams intact.

Removing a member from the workspace, or a member leaving it, SHALL delete **every** issue
subscription they hold.

Deleting an issue SHALL remove its subscriptions.

#### Scenario: Leaving one team clears only that team's subscriptions

- **WHEN** a person is removed from one team and holds subscriptions in two
- **THEN** the removed team's subscriptions are gone and the other team's remain

#### Scenario: Leaving the workspace clears them all

- **WHEN** a person is removed from the workspace
- **THEN** they hold no issue subscriptions in any team

