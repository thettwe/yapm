## ADDED Requirements

### Requirement: A `mention` notification kind, addressed at a person and therefore emailed

The notification kind set SHALL gain `mention`, at the cost of a TypeScript union member and a copy
string and **no migration** — which is the reason `kind` carries no Postgres CHECK constraint.

`mention` SHALL be classified as **actionable** (addressed at a person), so the default email
preference emails it, alongside assignment. `issue_commented` SHALL remain **ambient** and therefore
unemailed at the default preference.

The shared copy function SHALL gain a `mention` case wording the event as the actor having mentioned
the recipient in the subject, used identically by the inbox row and the email so the two can never
describe the same event differently.

The mention email SHALL state, in one sentence, that the recipient now follows the issue and can
stop from the issue page, **when and only when the recipient actually follows it**. A mention of
somebody who has unfollowed the issue SHALL still be emailed and SHALL omit that sentence, because
unfollow is sticky and the sentence is a disclosure of a subscription rather than a description of
the kind. It SHALL NOT carry a signed unsubscribe link or an unsubscribe header; the link goes to
the application.

#### Scenario: A mention is emailed at the default preference

- **WHEN** a person at the default email preference is mentioned and has not read the notification
  in-app before the debounce elapses
- **THEN** they receive an email describing the mention

#### Scenario: A mention read in-app is not emailed

- **WHEN** a mentioned person reads the notification in the inbox before the delivery sweep runs
- **THEN** no email is sent, under the existing read-suppression rule

#### Scenario: Adding the kind required no schema change

- **WHEN** the migration set is inspected after this change
- **THEN** no migration alters the notification table to permit the new kind

#### Scenario: The mention email says how to stop following

- **WHEN** a mention email is rendered for a recipient the mention subscribed
- **THEN** it states that the recipient now follows the issue and that they can unfollow from the
  issue page

#### Scenario: The mention email claims no subscription an unfollow revoked

- **WHEN** a mention email is rendered for a recipient who had unfollowed that issue
- **THEN** the email is still sent and carries no sentence claiming they now follow the issue

### Requirement: A second producer of comment notifications, deduplicated by the primary key

Comment notifications SHALL have two independent producers: the existing involvement fan-out, and
the subscriber fan-out introduced by issue subscriptions.

The second producer SHALL write through the **exported** `recordNotifications` seam and SHALL NOT be
registered in the private involvement-trigger map, because its recipients come from a stored
subscription edge rather than from involvement with the subject.

Both producers SHALL emit the **same kind and the same event key** for a given comment, so that the
table's composite primary key absorbs the overlap and a recipient reached by both receives exactly
one row. Neither producer SHALL depend on running before or after the other.

#### Scenario: Overlapping producers yield one row

- **WHEN** a person is both a subscriber and an involved party on an issue and a comment is posted
- **THEN** exactly one notification row exists for them for that comment

#### Scenario: The private trigger map is unchanged

- **WHEN** the involvement-trigger map is inspected after this change
- **THEN** it contains the same two entries it did before, and the subscriber recipients are not
  among them

#### Scenario: Order of the two producers does not matter

- **WHEN** the two producers run in either order within the same transaction
- **THEN** the resulting row set is identical
