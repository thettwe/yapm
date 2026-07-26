## ADDED Requirements

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
newest-first, and an unread badge in the application shell. Badge and inbox SHALL read from **one**
shared synced query subscription.

The inbox SHALL be fully operable without a pointer: `j`/`k` and Down/Up move the focused row,
Enter and Right open the subject and mark the row read, and a single key toggles a row's read state.
The badge SHALL carry an accessible name stating the unread count (for example "Inbox, 3 unread")
and SHALL render a capped indication once the count reaches the query limit. Every colour and font
SHALL come from theme tokens and SHALL meet AA contrast in all three presets, light and dark.

The inbox SHALL show what happened and who did it, and SHALL NOT show any excerpt of a comment or
issue body.

#### Scenario: Keyboard-only from badge to issue

- **WHEN** a member with unread notifications navigates to the inbox and presses `j` then Enter,
  using only the keyboard
- **THEN** the focused notification's issue opens and that notification becomes read

#### Scenario: Toggling read state by keyboard

- **WHEN** a member presses the read-toggle key on a focused notification
- **THEN** the row's read state flips optimistically and the unread badge updates in the same frame

#### Scenario: The badge announces the unread count

- **WHEN** a screen-reader user reaches the inbox badge
- **THEN** its accessible name states the number of unread notifications

#### Scenario: No body content leaks into the row

- **WHEN** someone comments on an issue with sensitive text
- **THEN** the recipient's inbox row names the actor, the action and the issue, and contains no part
  of the comment body

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
