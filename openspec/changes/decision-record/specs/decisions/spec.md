## Purpose

The decision entity and its record: the surface on which a team's settled reasoning becomes a
first-class work-graph node — one plain sentence, owned by the team and by no person, pinned to
the thread it distilled and accumulated into a page that answers "why did we do it this way?" six
weeks later.

## ADDED Requirements

### Requirement: A decision is a team-owned sentence with no author

The system SHALL provide a `decision` entity holding exactly one plain-text sentence, a
`decided_at` instant, a reference to the issue whose thread it distilled, the provenance of that
thread (the count of comments at the moment of deciding, and the first and last comment of the
range), and an optional revisit cycle.

The `decision` table SHALL contain **no author, owner, creator or `decided_by` column** — not
nullable, not server-only, absent — in the database schema and in the sync schema alike, so that no
query, export or later feature can attribute a decision to an individual. The surface SHALL state
the team's ownership as a fact (`the team's call, no owner`), and that statement SHALL be true of
storage rather than of presentation.

The sentence SHALL be plain text subject to a stated maximum length, enforced identically by the
write path's validation and by a database constraint, so a decision cannot become a paragraph.

Work-graph placement: `decision` hangs off `team` and references `issue` (required), `comment`
twice (the source range, optional) and `cycle` once (the revisit marker, optional). Deleting the
issue removes its decisions; deleting a source comment or the revisit cycle SHALL leave the
decision standing with that reference cleared. Sync/permission story: team-scoped exactly as
`comment` is, denied by an empty query for a non-member with authorization checked before
existence; a viewer reads and cannot write; there is no wider read path of any kind.

#### Scenario: The absence of an author is enforced, not documented

- **WHEN** the schema-drift check runs against the live database and the sync schema
- **THEN** the `decision` table in both carries no column naming an author, owner, creator or
  `decided_by`, and the check fails if one is added

#### Scenario: A sentence longer than the maximum is refused

- **WHEN** a member submits a decision sentence longer than the stated maximum
- **THEN** the write is rejected with the limit named, and the database constraint would refuse it
  independently

#### Scenario: A decision outlives the comments it came from

- **WHEN** every comment in a decision's source range is deleted
- **THEN** the decision still exists and still states the number of comments in the thread at the
  moment it was decided, and the doorway to that thread is absent rather than dead

#### Scenario: Another team's decisions are unreadable

- **WHEN** an authenticated user who is not a member of a team requests that team's decisions
- **THEN** the result is empty, indistinguishable from the team having none, with authorization
  applied before existence

### Requirement: Any thread can end in one sentence

A member with write access on an issue's team SHALL be able to record a decision from that issue's
comment thread through a shared mutator, supplying the sentence, the moment, and optionally a
revisit cycle. The decision's provenance — the comment count and the first and last comment of the
range — SHALL be derived by the mutator from the issue's own comments and SHALL NOT be supplied by
the caller, so a client cannot overstate the debate a decision came out of. The decision's team
SHALL be taken from the issue, never from the caller's arguments.

A viewer and a non-member SHALL be rejected before any existence check. An issue MAY carry more
than one decision; recording a second SHALL NOT overwrite or hide the first.

A recorded decision SHALL be correctable and removable by any member with write access on its
team, because it belongs to the team; there SHALL be no author-based restriction, since no author
is stored.

#### Scenario: Provenance is derived, not asserted

- **WHEN** a member records a decision on an issue whose thread holds five comments, supplying a
  larger count in the request
- **THEN** the stored decision states five, derived from the thread itself

#### Scenario: A viewer cannot decide

- **WHEN** a viewer attempts to record a decision
- **THEN** it is rejected as not authorized before any existence check and no row is written

#### Scenario: A second decision does not displace the first

- **WHEN** an issue that already carries a decision receives another
- **THEN** both exist and both are readable, ordered newest first

#### Scenario: Any writer may correct the team's sentence

- **WHEN** a member with write access who did not record a decision revises its sentence or its
  revisit marker
- **THEN** the revision succeeds, because the decision is the team's

### Requirement: The Decisions record is a searchable page grouped by cycle, with no owner column

The system SHALL provide a team-scoped Decisions page listing every decision the team has recorded,
grouped by the cycle containing each decision's moment — cycles newest first, decisions newest
first within a cycle, and a final group for decisions falling outside any cycle. Each row SHALL
present the decision mark, the sentence, the issue key, the date, the issue's area where the issue
carries one, and the revisit pill where a revisit cycle is set. **No column, cell or label on the
page SHALL name a person.**

The page SHALL offer a search field that filters rows by the sentence text and the issue key,
matched locally against rows already synced to the device, so it answers offline and without a
network request. A scope control SHALL narrow the list to decisions carrying a revisit marker.

A row SHALL unfold in place to reveal the full sentence, the provenance line, and a doorway to the
source thread where that thread still exists — without leaving the page.

The page SHALL be fully keyboard-operable: the search field reachable by keyboard, rows focusable
in document order, unfolding and folding by keyboard, and every doorway activated by Enter.

#### Scenario: The record answers why without a navigation

- **WHEN** a member unfolds a row on the Decisions page
- **THEN** the full sentence and its provenance are shown in place, and the source thread is
  offered as a doorway rather than being required

#### Scenario: Search is local and offline

- **WHEN** a member types into the search field while the device is offline
- **THEN** the list narrows to matching sentences and issue keys with no network request

#### Scenario: Decisions outside a cycle still have a home

- **WHEN** a decision's moment falls before the team's earliest cycle or in a gap between cycles
- **THEN** it appears in the final group, which does not claim it belongs to a cycle

#### Scenario: The page is navigable without a pointer

- **WHEN** a member reaches the page by keyboard and tabs through it
- **THEN** the search field and every row receive visible focus in document order, and a focused
  row unfolds and folds from the keyboard

#### Scenario: A team with no decisions is not offered an empty apparatus

- **WHEN** a member opens the Decisions page for a team that has recorded none
- **THEN** the page states what will appear there in one line, and renders no search field, no
  scope control, no group header and no reserved empty measure

### Requirement: A decision never expires — it gets revisited

The record SHALL NOT fade. No decision's mark, ink, border or type SHALL vary with its age; no
ordering SHALL be derived from staleness; nothing SHALL be labelled expired, stale or old.

A decision MAY carry a revisit marker naming a cycle. The marker SHALL be presented as a pill whose
visible text states its meaning in words — that the decision resurfaces at that cycle's planning —
and that same text SHALL be its accessible name, so the marker is never conveyed by shape or colour
alone. The Decisions page SHALL be able to list exactly the decisions carrying one, and SHALL state
how many are due.

Where the product has no planning surface at which a marker can resurface, the marker SHALL still
store, display and filter, and the product's documentation SHALL state plainly that resurfacing at
planning arrives with the planning surface. No surface SHALL imply a notification or a prompt the
product does not send.

#### Scenario: Age changes nothing

- **WHEN** a decision recorded today and a decision recorded a year ago are rendered side by side
- **THEN** their marks and their type are identical, and neither is marked stale

#### Scenario: The revisit marker says what it means

- **WHEN** a decision carrying a revisit cycle is rendered
- **THEN** its pill reads that the decision resurfaces at that cycle's planning, and assistive
  technology receives the same sentence

#### Scenario: The record states its own rule

- **WHEN** the Decisions page renders for a team with at least one decision
- **THEN** it states that decisions never expire but get revisited, together with the number of
  revisits due, derived from the rows rather than fixed text

### Requirement: The decision surface is themed by tokens and renders from synced rows

Every colour, font, radius and hairline on the decision chip, the record page and the Home band
SHALL resolve through theme tokens and SHALL meet AA contrast in every shipped theme preset, light
and dark; non-text marks SHALL meet the 3:1 non-text bar. The decision mark SHALL be a drawn
primitive in the shared component package on the shared drawing grid, static, with no motion.

Every fact these surfaces state SHALL be computed by pure functions in the schema package over rows
the client has already synced, so the record renders offline and no common interaction newly waits
on the network.

#### Scenario: Dark themes have no stray daylight

- **WHEN** the Decisions page renders under any dark theme variant
- **THEN** every hairline, wash, mark and ink resolves to that theme's token values with AA
  contrast and no hard-coded light-theme colour

#### Scenario: The record renders offline

- **WHEN** a member opens the Decisions page with the connection down and the team's rows already
  synced
- **THEN** the page renders completely, with grouping, search and unfolding all working
