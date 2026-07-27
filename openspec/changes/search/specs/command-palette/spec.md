## ADDED Requirements

### Requirement: The palette's issue jump becomes the search result groups

The palette's title-and-key jump list SHALL be **replaced** by search's two result groups rather than
sitting beside them — two title-only matchers in one palette is two mental models for one question.
The first group SHALL be fed entirely by the on-device pass, rendering on the keystroke with no
request in its path, and SHALL therefore find a token that appears only in an issue's description,
which the previous jump list could not. The second group SHALL be appended below a labelled divider
after the debounced server pass resolves. Each group SHALL be capped at a small number of rows, with a
persistent row that opens the full search route carrying the same query.

Work-graph placement: an interaction surface over team-scoped entities; it introduces no entity.
Permission story: the on-device group can only show rows the caller's synced queries already
delivered; the server group carries search's own team-scoped predicate and is limited to the team
whose list is open, so both groups mean the same scope.

#### Scenario: A description-only token is found from the palette

- **WHEN** a member opens the palette and types a token that appears only in the description of an
  issue in the open team
- **THEN** the issue appears in the on-device group in the same frame, with no request issued

#### Scenario: The old jump list is gone, not duplicated

- **WHEN** a member types a query that matches an issue by key
- **THEN** the issue appears exactly once, in the on-device results group, and no separate jump group
  is rendered

#### Scenario: Escalate to the full route from the palette

- **WHEN** a member activates the persistent "search everything" row with Enter
- **THEN** the full search route opens carrying the query, with no pointer interaction

### Requirement: The palette owns its own filtering, ordering and cursor

The palette SHALL NOT delegate filtering or ordering to the command primitive's built-in scorer, which
re-sorts items within a group and groups by their best item's score — appending a group would then
re-sort everything above it. Filtering and ordering SHALL be deterministic and applied by the
application to **every** group, action rows included, over a stable declaration order.

The active item SHALL be **controlled by the palette and keyed to a row identity**, not to a list
index, so appending late results cannot move it. When the active row leaves the list because the query
narrowed, the cursor SHALL fall to the first row of the first group.

Every behaviour the palette already guarantees — a shortcut opens it, typing filters, Arrow keys move
the active item with an accent highlight, Enter executes, Escape closes and restores focus, focus is
trapped while open — SHALL be unchanged.

#### Scenario: The cursor survives the server answering

- **WHEN** a member arrows down to the third row and the server group then arrives below
- **THEN** the same row remains active and in the same position, and Enter activates it

#### Scenario: Existing palette actions still filter and execute

- **WHEN** a member types to narrow to a status, assign, label, project, triage or inbox action and
  presses Enter
- **THEN** that action executes exactly as before, through the same shared mutator

#### Scenario: Ordering does not depend on typing history

- **WHEN** a member types a query, deletes it, and types the same query again
- **THEN** the rows appear in the same order both times
