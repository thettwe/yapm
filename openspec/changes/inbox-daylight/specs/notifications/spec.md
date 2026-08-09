## MODIFIED Requirements

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

#### Scenario: The unread lens costs no round trip

- **WHEN** a member switches the inbox to its unread lens
- **THEN** the list narrows to the unread rows the client already holds, no additional query is
  issued, and the masthead continues to state the unread count

#### Scenario: Mark-all-read is absent when nothing is unread

- **WHEN** a member whose notifications are all read opens the inbox
- **THEN** no mark-all-read control is drawn

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

## ADDED Requirements

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

#### Scenario: An empty inbox reads as composed

- **WHEN** a member with no notifications opens the inbox
- **THEN** the surface draws a settled mark, a short statement that nothing is waiting, the kinds
  of notification that arrive here, and at least one onward doorway — and no explanatory sentence

#### Scenario: A premature all-clear is never announced

- **WHEN** the inbox is opened and its query result is still incomplete
- **THEN** the surface says it is still loading, does not draw the empty state, and does not
  announce that nothing is waiting

#### Scenario: The transition from loading to empty is spoken

- **WHEN** the inbox query completes with zero rows after having been incomplete
- **THEN** the change is announced through the same live region that carried the loading text
