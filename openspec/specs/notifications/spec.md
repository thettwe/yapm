# notifications Specification

## Purpose
TBD - created by archiving change notifications. Update Purpose after archive.
## Requirements
### Requirement: Per-recipient notification entity keyed by its natural key

The system SHALL persist a `notification` entity, one row per recipient per event, in the existing
Postgres (no new service), synced via Zero. Its **primary key SHALL be the composite natural key
`(recipient_id, kind, subject_id, event_key)`**; the entity SHALL carry **no generated id column**,
and this capability SHALL mint no identifier anywhere — neither at a call site nor inside a mutator.

Every component of the key SHALL be deterministic in the triggering mutation's own arguments:
`event_key` SHALL be the triggering comment's id for a comment notification, and the triggering
mutation's `updatedAt` rendered as a string for an assignment notification. A row SHALL additionally
carry `actor_id`, `team_id`, `subject_type`, `subject_key`, `subject_title`, `read_at`,
`email_sent_at` and `created_at`.

`kind` SHALL be validated as a TypeScript union and SHALL NOT carry a Postgres CHECK constraint, so
that a later change may add a kind at the cost of a union member and a copy string rather than a
migration. `subject_key` and `subject_title` SHALL be denormalised snapshots taken at write time,
never joins: a notification SHALL render from its own row alone, with no relationship to the
subject issue and therefore no possibility of widening a read past the team boundary.
`subject_id` SHALL carry no foreign key, being polymorphic by `subject_type`.

Work-graph placement: `notification` is a per-recipient leaf addressed *at* a `user` and *about* an
issue in a `team`; it is derived from the work graph and is never an input to it. Sync/permission
story: a row SHALL be readable **only** by its recipient (see the self-scoped query requirement);
`team_id` is a denormalised copy used for membership cleanup and indexing, never a sync scope.

#### Scenario: The same mutation applied twice yields exactly one row

- **WHEN** the server-authoritative pass applies the identical assignment mutation twice with
  identical arguments
- **THEN** exactly one `notification` row exists for that recipient, kind, subject and event key,
  the second insert having been absorbed by the primary key with no error

#### Scenario: No identifier is minted

- **WHEN** the notification write path is inspected
- **THEN** no UUID or other identifier is generated for a notification, at a call site or inside a
  mutator body, and the row's identity is entirely determined by the triggering mutation's arguments

#### Scenario: A renamed issue shows the title as it was

- **WHEN** an issue is renamed after a notification about it was created
- **THEN** the notification continues to show the title captured at write time, because it is a
  snapshot of what happened rather than a live join

### Requirement: The fan-out runs only on the server-authoritative pass

Notification rows SHALL be written **only** in the server-authoritative mutator pass, guarded so
that a client-location transaction writes none. The write SHALL happen through the same wrapped
Kysely transaction as the mutation that caused it, so notification rows and the change that caused
them commit or roll back together.

The system SHALL fan out from exactly five trigger sites: `issue.create` when it carries an
assignee, `issue.assign` when the new assignee is non-null, `issue.routeIssue` when it sets an
assignee, `retro.convertActionToIssue` when the converted action carries an owner — which calls the
shared `issue.create` function directly and therefore never reaches the `issue.create` override
that owns the fan-out — and `comment.create`. Assignment recipients SHALL be the assignee minus the
actor. Comment recipients SHALL be the union of the issue's assignee, its creator and its prior
commenters, deduplicated, minus the actor, and capped at a bounded maximum. The recipient
computation SHALL be a pure exported function.

The computed recipient set SHALL then be intersected with current `team_membership` of the issue's
team, inside the same transaction, before any row is written: involvement outlives membership, and
a row addressed at someone who has left the team would sync them an issue key and title they no
longer have access to. Where the cap truncates the set, it SHALL drop the least-recent
participants rather than the most-recent ones.

All rows for one triggering mutation SHALL be written in a **single** multi-row insert with
conflict-ignoring semantics, and the prior-commenter read SHALL be bounded, so that an issue with
very many distinct commenters cannot turn a one-row update into an unbounded transaction.

#### Scenario: Routing an issue notifies its new assignee

- **WHEN** a member routes a triage issue and sets an assignee in the same call
- **THEN** the assignee receives an `issue_assigned` notification, identically to being assigned
  through `issue.assign`

#### Scenario: Converting a retro action with an owner notifies that owner

- **WHEN** a retro action carrying an owner is converted into an issue
- **THEN** that owner receives exactly one `issue_assigned` notification, even though the
  conversion reaches the shared `issue.create` function rather than its server override

#### Scenario: An ex-team-member involved in an issue is not notified

- **WHEN** a comment is added to an issue whose creator, standing assignee or prior commenter has
  since been removed from the issue's team
- **THEN** no notification row is written for that person, the recipient set having been
  intersected with current team membership before the insert

#### Scenario: A client-location transaction writes nothing

- **WHEN** the same mutator is applied with a client-location transaction, as happens on every
  optimistic run and every rebase
- **THEN** zero notification rows are written

#### Scenario: The actor is never notified about their own action

- **WHEN** a member assigns an issue to themselves, or comments on an issue they are assigned
- **THEN** no notification is created for that member for that event

#### Scenario: Comment recipients are the involved people, deduplicated and capped

- **WHEN** a member comments on an issue whose assignee, creator and prior commenters overlap
- **THEN** each distinct involved person other than the commenter receives exactly one
  `issue_commented` notification, and the recipient set never exceeds the bounded cap

#### Scenario: The notification and its cause commit together

- **WHEN** the mutation that would trigger a notification fails and its transaction rolls back
- **THEN** no notification row survives

### Requirement: A public write seam other changes bind to

The system SHALL export `recordNotifications(db, events)` from `@yapm/schema/server` as the single
public write path for notifications: it SHALL perform one multi-row conflict-ignoring insert inside
the caller's transaction and SHALL be a no-op for an empty event list. The kind-to-recipients-and-copy
map that this capability uses to compute its own two kinds SHALL remain private to it.

A later change SHALL be able to add a new notification kind by supplying events to this seam,
without a migration, without a new write path, and without modifying this capability.

#### Scenario: A new kind needs no schema change

- **WHEN** a later change produces events of a kind this capability does not define
- **THEN** those events are recorded through the same exported seam with no migration, no CHECK
  constraint to alter, and no second write path

#### Scenario: Recording nothing does nothing

- **WHEN** the seam is called with an empty event list
- **THEN** no statement is issued and no error is raised

### Requirement: The inbox is readable only by its recipient, with no admin bypass

The system SHALL expose a self-scoped synced query returning the caller's own notifications,
filtered on the verified `ctx.userID` (never on an argument), ordered newest-first and bounded by a
row limit. The query SHALL be gated on workspace membership and SHALL deny by empty query
otherwise. It SHALL NOT carry the workspace-admin bypass that team-scoped work-data queries use.

**No user, of any role, SHALL be able to read another user's notifications** — not a teammate, not
a workspace admin. This SHALL be enforced in the permission model rather than in the UI, and proved
by a test that asserts a workspace admin reading the query receives zero of another user's rows.

#### Scenario: A workspace admin cannot read another user's inbox

- **WHEN** a workspace admin, who can read every issue in the workspace, queries notifications
- **THEN** they receive only their own notifications and zero rows addressed to anyone else

#### Scenario: A teammate cannot read another teammate's inbox

- **WHEN** a member of the same team as the recipient queries notifications
- **THEN** they receive zero of the recipient's rows

#### Scenario: A non-member is denied by empty query

- **WHEN** an authenticated user who is not a workspace member queries notifications
- **THEN** the query returns an empty result rather than an error revealing anything

### Requirement: Read and unread are optimistic and structurally self-scoped

The system SHALL provide shared mutators in `packages/schema` — imported by client and server — to
mark one notification read or unread, and to mark all of the caller's notifications read. The
per-row mutator SHALL address its row by the natural key, taking `recipient_id` from the verified
`ctx.userID` and never from arguments, so that a caller is structurally unable to name another
person's row.

Marking read SHALL apply optimistically on the client within the sub-100ms budget. Marking all read
SHALL additionally apply, on the server, to rows beyond those the caller's synced query returned,
so that the action means "all" rather than "all I happen to have synced".

#### Scenario: Marking read is instant

- **WHEN** a member marks a notification read
- **THEN** the row's read state changes in the UI immediately, without waiting on the network, and
  persists via the shared mutator

#### Scenario: A caller cannot mark another person's notification read

- **WHEN** a caller supplies arguments naming a notification addressed to someone else
- **THEN** the write targets only a row whose recipient is the caller's own verified identity, and
  the other person's row is unaffected

#### Scenario: Mark-all-read covers rows beyond the synced window

- **WHEN** a member with more notifications than the query limit marks all read
- **THEN** every unread notification of theirs is marked read, including those their client had not
  synced, and no other user's rows are touched

### Requirement: Keyboard-first inbox surface and unread badge

The system SHALL provide a workspace-wide `/inbox` surface listing the caller's notifications
newest-first, and an unread badge in the application frame's deck. Badge and inbox SHALL read from
**one** shared synced query subscription. Because the deck is on every authenticated surface, the
badge SHALL be present on every authenticated surface — including the team-scoped surfaces that
previously drew their own header and offered no inbox doorway at all.

The inbox SHALL be fully operable without a pointer: `j`/`k` and Down/Up move the focused row,
Enter and Right open the subject and mark the row read, and a single key toggles a row's read state.
The surface SHALL state these keys on the page, so the keyboard model is discoverable rather than
folklore. The badge SHALL carry an accessible name stating the unread count (for example "Inbox, 3
unread") and SHALL render a capped indication once the count reaches the query limit. Every colour
and font SHALL come from theme tokens and SHALL meet AA contrast in all three presets, light and
dark.

The inbox SHALL show what happened and who did it, and SHALL NOT show any excerpt of a comment or
issue body.

**The inbox SHALL be drawn as a work surface in the application's list anatomy**, not as a reading
column: one row per notification at the shared row density, in the shared column order —
read gutter · kind glyph · subject key · subject title · phrase · age — with day bands (`Today`,
`Yesterday`, `Earlier`) drawn as the list's group header. A day band SHALL carry no count: the
unread count is the only number this surface states, and the masthead count SHALL be that unread
count, so band 2 and the deck badge can never disagree.

**The row SHALL draw the notification's own stored snapshot as the subject.** The denormalised
`subject_title` SHALL be the row's title and `subject_key`, where present, its key. The
actor-and-verb SHALL be a separate short phrase that does NOT interpolate the subject. Both SHALL
come from the single shared copy function, so the inbox row and the mailed message can never word
the same event differently.

**Each notification kind SHALL be distinguishable before its words are read**, by a drawn glyph in
the product's own vocabulary — never a borrowed icon set — and the kind SHALL additionally be
available as text to assistive technology, so it is never conveyed by a drawing alone.

**Read and unread SHALL be distinguishable through at least three channels, none of which is hue
alone**, and every text channel the distinction is carried on SHALL itself meet the contrast bar.

Because the inbox is workspace-wide and the application frame is not, a row MAY name its team — but
only where that team is not the one the frame is currently pointing at, and only from the team list
the client has already synced. A team the client cannot name SHALL draw nothing rather than an
identifier, and naming a team SHALL NOT require reading the subject.

The surface MAY offer a lens restricting the list to unread notifications. Such a lens SHALL filter
rows the client has already synced, SHALL issue no additional query and SHALL take no round trip.

A control that cannot act SHALL be absent rather than disabled: where nothing is unread, the
mark-all-read control SHALL NOT be drawn.

Work-graph placement: a destination over the caller's own notification rows, joined to nothing.
Permission story: unchanged — the self-scoped query with no admin bypass is the only read.

#### Scenario: Keyboard-only from badge to issue

- **WHEN** a member with unread notifications navigates to the inbox and presses `j` then Enter,
  using only the keyboard
- **THEN** the focused notification's issue opens and that notification becomes read

#### Scenario: Toggling read state by keyboard

- **WHEN** a member presses the read-toggle key on a focused notification
- **THEN** the row's read state flips optimistically and the unread badge updates in the same frame

#### Scenario: The keys are stated on the surface

- **WHEN** a member opens the inbox with at least one notification in it
- **THEN** the surface states the keys that move the cursor, open the focused row and toggle its
  read state

#### Scenario: The badge announces the unread count

- **WHEN** a screen-reader user reaches the inbox badge
- **THEN** its accessible name states the number of unread notifications

#### Scenario: The badge is on every authenticated surface

- **WHEN** a member with unread notifications opens the issues list, the board, the issue detail or
  the delivery surface
- **THEN** the deck's inbox badge is present on each, carrying the same unread count

#### Scenario: No body content leaks into the row

- **WHEN** someone comments on an issue with sensitive text
- **THEN** the recipient's inbox row names the actor, the action and the issue, and contains no part
  of the comment body

#### Scenario: The row leads with the stored subject, not with the sentence

- **WHEN** a member opens their inbox on a notification about an issue
- **THEN** the row's title is the issue title as the notification stored it, its key column is the
  stored subject key, and the actor and verb are stated separately as a short phrase carrying no
  copy of the subject

#### Scenario: A digest notice draws no key and names no actor

- **WHEN** a member opens their inbox on a `pm_digest_published` notification
- **THEN** the row draws the digest kind, states the team and cycle name as its title, states a
  phrase naming no person, and leaves the key column empty

#### Scenario: The kind is legible without reading the words

- **WHEN** an inbox holds notifications of more than one kind
- **THEN** each row draws a glyph distinguishing its kind, and each row also exposes its kind as
  text to assistive technology

#### Scenario: Read and unread survive the loss of colour

- **WHEN** the inbox is rendered without colour
- **THEN** read and unread rows remain distinguishable, by the presence or absence of the gutter
  mark and by the weight of the title, and every text channel carrying the distinction meets the
  contrast bar

#### Scenario: Only a row outside the frame's team names its team

- **WHEN** a member's inbox holds notifications from the team the frame points at and from another
- **THEN** only the rows from the other team draw a team name, and a team the client cannot name
  draws nothing rather than an identifier

#### Scenario: The unread lens costs no round trip

- **WHEN** a member switches the inbox to its unread lens
- **THEN** the list narrows to the unread rows the client already holds, no additional query is
  issued, and the masthead continues to state the unread count

#### Scenario: Mark-all-read is absent when nothing is unread

- **WHEN** a member whose notifications are all read opens the inbox
- **THEN** no mark-all-read control is drawn

### Requirement: Per-user email preference, defaulting to actionable-only

The system SHALL extend the existing per-user preference entity with an `email_notifications`
setting of `all`, `assigned_only` or `none`, constrained at the storage layer, defaulting to
`assigned_only`. It SHALL be readable and writable only by its owner, through the existing
owner-only preference query and shared mutator.

Notification kinds SHALL be classified as *actionable* (addressed at a person — assignment, and a
mention once that capability exists) or *ambient* (everything else). `assigned_only` SHALL email
actionable kinds only; `all` SHALL email every kind; `none` SHALL email nothing. **The preference
SHALL govern email only** — the in-app notification is always created and always readable,
whatever the setting.

The preference SHALL be changeable entirely by keyboard from the existing preference surface.

#### Scenario: The default emails assignments but not comments

- **WHEN** a user who has never changed the setting is assigned an issue and, separately, is a prior
  commenter on an issue someone else comments on
- **THEN** they are emailed about the assignment and not about the comment, and both notifications
  appear in their inbox

#### Scenario: Turning email off keeps the inbox

- **WHEN** a user sets `email_notifications` to `none` and is then assigned an issue
- **THEN** no email is sent and the notification still appears in their inbox

#### Scenario: Keyboard-only preference change

- **WHEN** a user changes their email-notification setting using only the keyboard
- **THEN** the change applies optimistically and persists via the shared preference mutator

### Requirement: Batched, debounced, read-suppressed email with a delivery-time membership re-check

When an email transport is configured, the system SHALL run a scheduled sweep that selects
notifications which are unread, not yet emailed, older than a debounce window and younger than a
bounded recency window; joins **current** team membership for the notification's team, the
recipient's preference and the recipient's address; groups the survivors into **one** message per
recipient; sends it; and stamps the rows it sent.

A notification already read in the application SHALL NOT be emailed. A recipient who is no longer a
member of the notification's team at delivery time SHALL NOT be emailed about it, even though the
row was written while they were. Email SHALL contain no excerpt of a comment or issue body, and
SHALL link to the application using the configured public base URL.

The sweep SHALL be registered on the **existing** job scheduler instance; the system SHALL NOT
create an additional background-job instance. A transport failure SHALL be caught within the job,
logged, and leave the affected rows unstamped for the next window; it SHALL NOT throw out of the
worker, SHALL NOT disturb other scheduled work sharing the process, and SHALL NOT produce a job
that retries forever.

#### Scenario: Reading in-app before the sweep suppresses the email

- **WHEN** a recipient reads a notification in the inbox before the sweep runs
- **THEN** no email is sent for it

#### Scenario: Several notifications become one message

- **WHEN** a recipient accumulates several emailable notifications within one debounce window
- **THEN** they receive exactly one message covering all of them, and each of those rows is stamped
  as emailed

#### Scenario: Losing team membership stops delivery

- **WHEN** a recipient is removed from the notification's team between the write and the sweep
- **THEN** no email about that notification is sent to them

#### Scenario: A broken transport degrades rather than breaks

- **WHEN** the configured transport fails during a sweep
- **THEN** the failure is logged, the affected rows remain unstamped and eligible for the next
  window, the worker does not throw, and other scheduled jobs in the same process are unaffected

#### Scenario: No transport means no email and no failure

- **WHEN** no email transport is configured
- **THEN** the in-app inbox works fully, no email job is registered, boot succeeds, and nothing
  throws

### Requirement: Retention bounds the synced set

The system SHALL run a scheduled, bounded retention sweep deleting notifications older than a
configured number of days, defaulting to 30. The sweep SHALL run whether or not an email transport
is configured, because retention is what bounds the per-client synced set rather than an email
feature.

#### Scenario: Old notifications are removed

- **WHEN** the retention sweep runs against notifications older than the configured window
- **THEN** those rows are deleted and no longer sync to any client

#### Scenario: Retention runs without email

- **WHEN** no email transport is configured
- **THEN** the retention sweep is still registered and still runs

### Requirement: Leaving deletes, with team and workspace distinguished

When a user's membership is removed, their notifications SHALL be **deleted**, not retained.

Removing a user from **a team** — whether by an admin or by the user leaving — SHALL delete exactly
that user's notifications whose `team_id` is that team, and SHALL leave their notifications for
other teams intact. Removing a user from **the workspace** — whether by an admin or by the user
leaving — SHALL delete **every** notification addressed to that user, across every team. Deleting a
team SHALL remove every notification for that team, for every recipient, by database cascade.

These deletions SHALL run in the server-authoritative pass, in the same transaction as the
membership removal, because the actor removing another user cannot see that user's notification rows
and therefore cannot delete them optimistically.

#### Scenario: Leaving one team keeps notifications for another

- **WHEN** a member of teams T1 and T2, with notifications from both, leaves T1
- **THEN** their T1 notifications are deleted and their T2 notifications remain

#### Scenario: Leaving the workspace deletes everything

- **WHEN** a member with notifications from several teams is removed from the workspace
- **THEN** every notification addressed to them is deleted

#### Scenario: An admin removing someone deletes that person's rows

- **WHEN** an admin removes another user from a team
- **THEN** that user's notifications for that team are deleted even though the admin can never read
  them

### Requirement: A notification is routing, never a per-person record

This capability SHALL NOT produce anything aggregatable into a per-person scorecard. It SHALL NOT
add a per-person activity table, a read-receipt visible to a sender, a "who reads their
notifications" signal, or any count, view or export of notifications aggregated across people. No
surface SHALL show any user anything about another user's inbox.

Notification and email delivery SHALL be role-independent: a `viewer` SHALL be notified and emailed
exactly like a `member` or an `admin`, with no role gate and no seat gate.

#### Scenario: No cross-person view exists

- **WHEN** the shipped surfaces and queries are enumerated
- **THEN** none of them exposes another person's notifications, their count, their read state, or
  any aggregate over people

#### Scenario: A viewer is notified like anyone else

- **WHEN** a `viewer` is assigned an issue
- **THEN** they receive the notification and, subject to their own preference, the email, with no
  role-based restriction

### Requirement: An issue never changes team, and notifications depend on it

`notification.team_id` is a denormalised copy of the owning issue's team and is sound only because
an issue can never be reassigned to another team. The system SHALL keep issue team reassignment
unavailable in every mutator, and SHALL carry a test asserting that no mutator mutates an issue's
team.

#### Scenario: No mutator moves an issue between teams

- **WHEN** every shared and server mutator is exercised
- **THEN** none of them changes an issue's team, so no derived notification row can be left pointing
  at the wrong team

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

The shared copy function SHALL produce, for every kind, both a full sentence naming the subject —
used where the notification is read outside the application, as in a mailed message — and a short
subject-free phrase, used where the surface already draws the subject beside it. Adding a surface
SHALL NOT add a second place a notification is turned into words.

Opening the notice SHALL take the recipient to the disclosure surface. Where a recipient is no
longer entitled, that surface SHALL be absent exactly as it is for any unentitled reader — the
notice does not create an entitlement.

#### Scenario: The inbox row names no publisher

- **WHEN** a named reader opens their inbox after a digest is published to them
- **THEN** the row reads as a system notice with the team and cycle name and no person's name, and
  contains no part of the digest content

#### Scenario: The phrase and the sentence come from one function

- **WHEN** the shared copy function is called for any notification kind
- **THEN** it returns both the full subject-naming sentence and the short subject-free phrase, and
  no other module in the system words a notification

#### Scenario: Following a notice after entitlement is withdrawn

- **WHEN** a recipient opens a PM-digest notice after being removed from the audience
- **THEN** the disclosure surface is absent for them, with no empty state announcing that a channel
  exists

### Requirement: The inbox draws only what the notification stored

The inbox SHALL render each notification from its own row alone. It SHALL NOT draw the subject's
current status, its delivery reality, its assignee, its labels, or any other fact that would require
reading the subject entity, and the sync schema SHALL carry no relationship from `notification` to
its subject.

This is a permission boundary rather than a simplification: a notification is readable only by its
recipient with no admin bypass, and a row joined from it would be a second disclosure the query's
predicate does not gate.

The surface SHALL NOT imply that the stored subject title is current, and SHALL NOT mark it as
stale — marking staleness would itself require the live title.

The inbox SHALL NOT collapse notifications into threads or roll-ups, because every notification is
its own row keyed by `(recipient, kind, subject, event_key)` and no parent entity exists to restore
the grouping from.

The inbox SHALL offer no per-notification or per-kind preference control. The only notification
preference the system has governs **email** and lives on the preference surface.

#### Scenario: No subject state is drawn

- **WHEN** the inbox is rendered over notifications about issues in several states
- **THEN** no row draws the issue's status, its delivery signals, its assignee or its labels, and
  the surface issues no query for the subject entities

#### Scenario: A renamed subject keeps its stored title, unmarked

- **WHEN** an issue is renamed after a notification about it was written
- **THEN** the inbox row still states the title as it was stored, and carries no mark claiming the
  title is stale or out of date

#### Scenario: Several notifications about one issue stay several rows

- **WHEN** a member receives three comment notifications about the same issue
- **THEN** the inbox draws three rows and offers no roll-up, thread or collapse control

#### Scenario: No preference control appears on the inbox

- **WHEN** the inbox is rendered
- **THEN** it offers no per-notification mute, no per-kind switch and no notification-preference
  control of any kind

### Requirement: The empty inbox is a composed state, announced honestly

An inbox with no notifications is the state a healthy inbox is in most of the time, and the system
SHALL draw it as a composed surface rather than as an absence: a settled mark, a short statement,
the kinds of thing that arrive here, and at least one onward doorway.

The empty state SHALL be distinguishable from the not-yet-synced state, and SHALL NOT be drawn while
the query result is still incomplete — an all-clear announced before the answer is known is a lie.

Both states SHALL be announced to assistive technology through a **single** persistent live region
whose text changes, never by inserting a region that already contains its message.

The empty state SHALL state no explanatory sentence about what an inbox is.

Where there is nothing to count and nothing to filter, the surface SHALL state no count and SHALL
draw no lens — the same rule that makes an unusable mark-all-read control absent rather than
disabled. The test SHALL be the notification set itself rather than the lens's current view, so a
reader who clears their last unread notification while looking through the unread lens keeps the
control that returns them to the whole list.

#### Scenario: An empty inbox reads as composed

- **WHEN** a member with no notifications opens the inbox
- **THEN** the surface draws a settled mark, a short statement that nothing is waiting, the kinds
  of notification that arrive here, and at least one onward doorway — and no explanatory sentence

#### Scenario: A premature all-clear is never announced

- **WHEN** the inbox is opened and its query result is still incomplete
- **THEN** the surface says it is still loading, does not draw the empty state, and does not
  announce that nothing is waiting

#### Scenario: Band 2 on an empty inbox is the title alone

- **WHEN** a member with no notifications opens the inbox
- **THEN** the surface states its title and draws no count, no lens and no mark-all-read control

#### Scenario: Clearing the last unread row under the lens keeps the lens

- **WHEN** a member viewing the unread lens marks their last unread notification read
- **THEN** the lens remains drawn and returns them to the whole list

#### Scenario: The transition from loading to empty is spoken

- **WHEN** the inbox query completes with zero rows after having been incomplete
- **THEN** the change is announced through the same live region that carried the loading text

