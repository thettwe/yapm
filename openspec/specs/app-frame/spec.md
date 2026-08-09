# app-frame Specification

## Purpose
The three-band frame every authenticated surface renders inside: a deck of destinations
that never adapts to the page, a masthead the page owns, and a statusline that states the
team's day. It carries the six destinations, the one attention number, and the single owner
of the command-palette shortcut — and it states no team fact it has no context for.
Archived from change app-frame (PR #33).

## Requirements

### Requirement: Three bands on every authenticated surface

Every authenticated route SHALL render inside one shared frame that emits, in document
order: band 1 the **deck**, a 48px navigation header; band 2 the **masthead**, owned and
adapted by the page; band 3 the **statusline**, a 32px line at the bottom of the viewport
for short pages and after the content for long ones. Bands 1 and 3 SHALL be rendered by the
frame alone. No page SHALL render its own application header.

The deck SHALL be identical on every page — nothing in it adapts to the page except which
destination is marked current. All colour, spacing and type SHALL come from theme tokens and
SHALL meet AA contrast in every shipped preset, light and dark.

Work-graph placement: chrome over entities that already sync; the frame introduces no
entity. Sync/permission story: the frame reads only team-scoped queries the caller already
syncs, so it can never display a team, a count or a destination the caller may not see.

#### Scenario: Every authenticated route carries the frame

- **WHEN** an authenticated member visits any in-app route
- **THEN** exactly one deck and exactly one statusline are rendered on the page

#### Scenario: No page draws its own header

- **WHEN** the application's source is inspected for a sticky application header outside the
  frame
- **THEN** none exists; no page hand-rolls application chrome, and every work surface's header
  content is supplied to the frame's masthead

#### Scenario: Unauthenticated surfaces have no frame

- **WHEN** a signed-out visitor loads the sign-in or invitation-acceptance surface
- **THEN** no deck and no statusline are rendered

### Requirement: Six destinations, and everything else is a doorway, a lens or a transient

The deck SHALL present exactly six stops in order: Home, Issues, Triage, Cycles, Delivery,
and a `more` menu. The active stop SHALL be marked with accent text, a 2px accent underline
and `aria-current="page"`, inside a navigation landmark with an accessible name. The `more`
menu SHALL be a transient, never a destination: it opens on activation, lists Retros,
Projects and Roadmap with their keyboard hints, is reachable by keyboard, closes on Escape
and returns focus to its trigger.

The board SHALL NOT be a deck stop; it SHALL be a lens offered in the Issues masthead, and
while it is open the Issues stop SHALL remain the current destination. A destination for
which no entity exists SHALL NOT be rendered at all — never as a disabled or dead link.

The frame SHALL provide `g`-prefixed go-to shortcuts for each destination, and SHALL
suppress them while a text input, rich-text editor or modal surface holds focus.

#### Scenario: The current destination is announced truthfully

- **WHEN** a member is on the team's issues list
- **THEN** the Issues stop is the only stop carrying `aria-current="page"`, and it is
  visually marked with accent text and an underline

#### Scenario: The board is a lens, not a stop

- **WHEN** a member switches the Issues masthead to the board lens
- **THEN** the board renders, the Issues stop remains the current destination, and the lens
  control reports which lens is active

#### Scenario: The more menu is keyboard-operable and escapable

- **WHEN** a member tabs to the `more` trigger, opens it with the keyboard, moves with Arrow
  keys and presses Escape
- **THEN** the menu opened, the retro/projects/roadmap items were reachable, and Escape
  closed it and returned focus to the trigger

#### Scenario: Go-to shortcuts navigate without a pointer

- **WHEN** a member presses the go-to prefix followed by a destination key with no text
  input focused
- **THEN** that destination opens

#### Scenario: Go-to shortcuts do not fire while typing

- **WHEN** a member types the same keys inside an issue title field or a rich-text editor
- **THEN** the characters are entered and no navigation occurs

#### Scenario: A destination with no entity behind it does not render

- **WHEN** the `more` menu is opened in a build where no decision entity exists
- **THEN** no decisions item appears — neither enabled nor disabled

### Requirement: The statusline states the team's day, and the sync state

On a page with a team in context the statusline SHALL state, as labels and numbers only:
the active cycle and its day (`Cycle N, day X of Y`), the count shipped this cycle, the
count of deployments this week, and the attention count. Each segment SHALL fold
individually when the fact behind it is absent — a team with no active cycle shows no cycle
segment rather than a placeholder.

The statusline SHALL carry the connection indicator, right-aligned, as the application's
only such indicator. It SHALL report the sync state, announce reconnection to assistive
technology via a polite live region, and offer a keyboard-operable retry control once the
backoff delay has stretched. No second connection indicator SHALL be rendered anywhere.

The indicator's label SHALL name what the reader has, not what the socket is doing: the
healthy state SHALL read **`Synced`**. Every other state SHALL keep naming its own
condition specifically — connecting, reconnecting, offline, an expired sign-in, a sync
error, and closed are each distinct and SHALL NOT be collapsed into one word. The label
SHALL be produced by the single function that turns a connection state into words, and the
indicator's `data-testid`, its connection-state attribute, its recovery-phase attribute and
its retry control SHALL be unchanged by any wording change, because they are the contract
the end-to-end suite reads.

The statusline SHALL contain no sentences.

#### Scenario: The team's day in one line

- **WHEN** a member with an active cycle on day 9 of 14, 8 issues shipped, 3 deployments
  this week and 4 exceptions opens any page of that team
- **THEN** the statusline reads the cycle and day, 8 shipped, 3 deploys this week and 4
  needing attention, with the sync state right-aligned

#### Scenario: The healthy sync state says Synced

- **WHEN** the sync connection is established on any authenticated page
- **THEN** the statusline's indicator reads `Synced`

#### Scenario: An unhealthy state still says what is wrong

- **WHEN** the connection is connecting, offline, has an expired sign-in, has a sync error or is closed
- **THEN** the indicator names that specific condition rather than the healthy word

#### Scenario: Segments fold rather than placehold

- **WHEN** the team has no active cycle
- **THEN** the cycle-and-day segment is absent and the remaining true segments still render

#### Scenario: One connection indicator, in the statusline

- **WHEN** the sync connection drops on any authenticated page
- **THEN** the statusline's indicator reports the reconnecting state and offers a
  keyboard-reachable retry, and no other connection indicator exists on the page

### Requirement: One attention number across the whole application

The attention number SHALL be produced by exactly one derivation — the four disjoint
exception classes of the team home digest — and every place it appears SHALL render that
same value: the deck's attention badge, the statusline's attention segment, and the team
home's NEEDS ATTENTION band. No second computation of the number SHALL exist.

When the count is zero the deck badge and the statusline segment SHALL be **absent**, not
rendered as zero. The badge SHALL carry an accessible name stating what the number counts.

#### Scenario: The bands agree with the page

- **WHEN** a member opens the team home with one divergent issue, one issue whose checks are
  failing, two pull requests waiting on review over a day and three triage rows
- **THEN** the deck badge, the statusline segment and the NEEDS ATTENTION band all read 7

#### Scenario: Two attention numbers can never render at once

- **WHEN** any authenticated page renders every element that reports an attention count
- **THEN** all of them report the same value

#### Scenario: Zero is absence, not a zero

- **WHEN** no issue matches any exception class and triage is empty
- **THEN** the deck shows no attention badge and the statusline shows no attention segment

#### Scenario: The badge names what it counts

- **WHEN** a screen-reader user reaches the attention badge
- **THEN** its accessible name states the number of items needing attention

### Requirement: Honest degradation where no team is in context

On a workspace-level surface the deck SHALL remain present and useful: its six stops SHALL
point at an anchor team — the caller's last visited team, or failing that the first team
they can see — and no stop SHALL be marked current. Where the caller can see no team at all,
the six stops SHALL be absent rather than disabled.

The statusline SHALL NOT state a team fact on a page with no team in context: no cycle, no
shipped count, no deploy count and no attention segment. It SHALL show only what is true
there — the workspace and the sync state. An anchor team the caller can no longer see SHALL
be discarded rather than linked.

#### Scenario: The deck stays useful on a workspace page

- **WHEN** a member who last visited the Engineering team opens the workspace inbox
- **THEN** the deck's six stops point at Engineering, and no stop is marked current

#### Scenario: The statusline invents nothing off-team

- **WHEN** the same member is on that workspace page
- **THEN** the statusline states no cycle, no shipped count, no deploy count and no
  attention count

#### Scenario: A workspace with no teams drops the stops

- **WHEN** a member who belongs to no team signs in
- **THEN** the deck shows the switcher and the right-hand cluster, and no destination stops
  at all

#### Scenario: A stale anchor team is discarded

- **WHEN** the remembered anchor team is one the caller has since lost access to
- **THEN** the stops point at the first team the caller can see, or fold away if there is
  none

### Requirement: The page owns band 2 through a shared masthead

The frame SHALL provide one masthead component taking a title, an optional count, an
optional lens-toggle slot, an optional filter/meta slot and an optional actions slot. Every
**work surface** — a page presenting a titled, counted, filtered or acted-upon collection —
SHALL render its page header through that component, preserving the controls it offers
today. A page whose own design owns band 2 entirely MAY decline to render a masthead; it
SHALL NOT render a substitute header of its own.

An **editorial reading surface** — a document in a reading column whose heading names a
section and whose sub-line explains it — presents body content rather than a page header,
and SHALL keep its own heading. What no page SHALL do, on either kind of surface, is
hand-roll application chrome.

Masthead content SHALL be labels only — no sentences. The one binding rule about metrics
("team-level only — never a per-person number") SHALL appear once in the application, on the
delivery surface.

#### Scenario: Every page header is the shared masthead

- **WHEN** the issues list, board, issue detail, delivery, cycles, triage, projects, roadmap
  and retro surfaces are rendered
- **THEN** each presents its title, count, lenses, filters and actions through the shared
  masthead, and none renders a header of its own

#### Scenario: Existing controls survive the migration

- **WHEN** a member uses the delivery window picker, the issue list's filters or the board's
  grouping control after the migration
- **THEN** each behaves exactly as before, from the masthead

#### Scenario: A reading surface keeps its document heading

- **WHEN** the workspace overview, the settings surfaces or the product-digest reader is
  rendered
- **THEN** each presents its heading and explanatory line as body content in its reading
  column, renders no masthead and no application header, and the deck and statusline are
  unchanged

#### Scenario: A page may own its band without hand-rolling chrome

- **WHEN** the team home renders its cycle hero in band 2
- **THEN** no masthead and no page-level header are rendered, and the deck and statusline are
  unchanged

### Requirement: No route is unreachable from the frame

Every authenticated route SHALL be reachable from the frame without prior knowledge of its
URL — as a deck stop, a `more` item, a lens, an entry in the workspace/team switcher, an
entry in the user menu, an item in the deck's right-hand cluster, or a doorway from a page
that is itself reachable. Search, the notification inbox, product digests, the settings
surfaces, team members and theme selection SHALL each have such a home.

Losing a route's reachability SHALL be treated as a regression.

#### Scenario: The inventory holds

- **WHEN** the set of registered application routes is compared against the set the frame
  can reach
- **THEN** every authenticated route is reachable, and the only unreachable routes are the
  unauthenticated sign-in and invitation surfaces

#### Scenario: The conditional digests doorway keeps its gate

- **WHEN** a member who is not in the product-digest audience signs in
- **THEN** no digests entry is offered anywhere in the frame and no digest query is issued
  on their behalf

#### Scenario: Search is reachable without the palette

- **WHEN** a member tabs through the deck without using any shortcut
- **THEN** the search entry is in the tab order and activating it opens the search surface
