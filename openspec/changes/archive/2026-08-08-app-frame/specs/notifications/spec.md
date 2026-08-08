## MODIFIED Requirements

### Requirement: Keyboard-first inbox surface and unread badge

The system SHALL provide a workspace-wide `/inbox` surface listing the caller's notifications
newest-first, and an unread badge in the application frame's deck. Badge and inbox SHALL read from **one**
shared synced query subscription. Because the deck is on every authenticated surface, the badge SHALL be
present on every authenticated surface — including the team-scoped surfaces that previously drew their own
header and offered no inbox doorway at all.

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

#### Scenario: The badge is on every authenticated surface

- **WHEN** a member with unread notifications opens the issues list, the board, the issue detail or
  the delivery surface
- **THEN** the deck's inbox badge is present on each, carrying the same unread count

#### Scenario: No body content leaks into the row

- **WHEN** someone comments on an issue with sensitive text
- **THEN** the recipient's inbox row names the actor, the action and the issue, and contains no part
  of the comment body
