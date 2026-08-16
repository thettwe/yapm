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

### Requirement: Signing in lands on work, not on administration

Completing sign-in SHALL land the caller on a team's Home rather than on the workspace
administration surface. The team SHALL be resolved from the anchor concept this capability already
defines — the caller's remembered team, or failing that the first team they can reach — narrowed by
one further condition the deck does not apply: **the landing team SHALL be one whose work the caller
can actually read.** A workspace member may see the name of every team in the workspace; being able
to name a team is not being able to open it. The deck MAY offer a stop pointing at such a team,
because navigation is an offer and an offer may be wrong without lying; a redirect is not an offer,
and SHALL NOT resolve to a team whose rows the caller's own queries would return empty.

Where no such team exists — a workspace holding no team, a member belonging to none, or an
authenticated non-member — the caller SHALL land on the workspace administration surface, which this
change neither moves nor renames. That surface SHALL remain reachable from the frame rather than by
URL alone, so a member who wants it still finds it, and every navigation that reaches it today SHALL
still reach it. Where that surface should ultimately live is not settled by this requirement.

The landing decision SHALL NOT be taken before the team roster has settled. A decision computed over
an unsynced roster would send a member with teams to administration, so until the caller's
authoritative role is resolved **and** the team list reports itself complete, the sign-in surface
SHALL hold — showing the loading state it already shows — rather than guess. An unidentified caller's
roster can report itself complete while empty, so a complete roster SHALL NOT on its own release the
decision.

Nor SHALL a settled credential release it on its own. The roster the decision reads SHALL be one the
caller's OWN identity produced: a resolved credential and a synchronised replica are two facts, and
on sign-in they arrive one render apart, so a roster answered before the caller was identified is
complete, empty and wrong. The decision SHALL therefore be taken only where the identity that
resolved the roster is the identity the credential names — including the role it names, since a role
that has just changed reads a different roster than the one on screen.

That wait SHALL have an end, on both of the things it waits for. Where the caller holds a session but
the credential the sync layer needs cannot be obtained — the request never landing, or the endpoint
rejecting it — and equally where the credential mints but the sync connection itself does not come
back, so the roster never settles, the sign-in surface SHALL resolve to a surface the caller can act
on: the retry surface the application already uses when the server is unreachable, or the sign-in
form where the rejection is clean and settled. The bound on the connection SHALL be the one the
statusline already applies, so the surface clears itself once the connection holds. It SHALL NOT hold
a loading state indefinitely, and it SHALL NOT navigate into a surface that navigates back to it.

The landing decision SHALL be taken in exactly one place. No second mechanism — an authentication
callback URL, a route guard, or a redirect issued by a dependency — SHALL also choose where a
signed-in caller arrives; where a third-party provider structurally requires a return URL, that URL
SHALL point at the one place the decision is taken. Two mechanisms that happen to agree today are
one edit away from disagreeing.

This binds every door into the product, not only the sign-in form. A surface that completes entry by
another route — accepting an invitation — SHALL send the caller through the same landing resolution
rather than a destination of its own. Where acceptance grants membership of a named team, that team
SHALL be the landing, because the grant that just happened is stronger evidence of readability than
any test over a synced roster; where acceptance grants workspace membership without naming a team,
the ordinary resolution applies unchanged.

Work-graph placement: navigation over entities that already sync; no entity, query or mutator is
introduced. Sync/permission story: the landing team is resolved from the team-scoped rows the caller
already syncs, including the membership rows those already carry, so the frame can never send a
caller to a team it could not have shown them. On the invitation path the team is the one the
acceptance itself granted membership of, which the accepting request already reports, so that landing
rests on a membership row that exists before the navigation is taken.

#### Scenario: A member lands on their team's work

- **WHEN** a member of a team completes sign-in
- **THEN** they arrive on that team's Home digest, not on the Members / Teams / Invitations surface

#### Scenario: The remembered team wins where it is still the caller's

- **WHEN** a member who last visited the Engineering team signs in again, and Engineering is still a
  team they can read
- **THEN** they arrive on Engineering's Home

#### Scenario: A team the caller cannot read is never the landing

- **WHEN** a member signs in whose workspace holds an older team they do not belong to, alongside one
  they do
- **THEN** they arrive on the team they belong to, and never on the one whose rows their queries
  would return empty

#### Scenario: With no team of their own the caller lands on administration

- **WHEN** a caller signs in to a workspace holding no team at all, or belongs to none of the teams
  it holds
- **THEN** they arrive on the workspace administration surface — `/`, as this change leaves it — and
  no team page is opened on their behalf

#### Scenario: The decision waits for the roster rather than guessing

- **WHEN** sign-in completes while the caller's role or the team list has not yet settled
- **THEN** the sign-in surface shows its loading state and no navigation is taken, and once both have
  settled the caller is sent to the team the settled data names

#### Scenario: An empty roster that reports itself complete is not a decision

- **WHEN** the team list reports itself complete while the caller's identity has not yet settled, so
  it is empty because nobody has been identified rather than because they belong to no team
- **THEN** no navigation is taken, and the decision is retaken once identity settles and the roster
  is re-read

#### Scenario: The credential settling is not the replica settling

- **WHEN** a caller submits the sign-in form, the credential resolves and names them a member of
  teams, but the roster on screen is still the one answered before they were identified — complete
  and empty
- **THEN** no navigation is taken on that roster, and the caller arrives on their team once the
  roster being read is the one their own identity resolved

#### Scenario: A sync session that never becomes ready does not hang the door

- **WHEN** the caller holds a session but the sync credential cannot be obtained — the server is
  unreachable, or it rejects the credential outright — or the credential mints and the sync
  connection stays down long enough that the statusline would offer its retry
- **THEN** the sign-in surface shows the retry surface the product already uses for an unreachable
  server, or the sign-in form for a clean settled rejection, and never an indefinite loading state,
  and no pair of routes navigates at each other; and the retry surface gives way to the landing
  decision once the connection holds

#### Scenario: One landing decision, not two

- **WHEN** the same account signs in by creating an account, by email and password, and by a
  configured provider
- **THEN** all three arrive in the same place by the same decision, and no dependency-issued redirect
  lands the caller anywhere else on the way

#### Scenario: Accepting a team-bound invitation lands on that team

- **WHEN** a caller accepts an invitation that grants membership of a named team
- **THEN** they arrive on that team's Home, not on the administration surface, by the same landing
  decision the sign-in surface takes

#### Scenario: Accepting a workspace-level invitation falls to the ordinary decision

- **WHEN** a caller accepts an invitation that grants workspace membership without naming a team
- **THEN** they arrive wherever the ordinary landing decision sends them — a team they can read where
  one exists, and the administration surface otherwise

#### Scenario: Administration keeps its place in the frame

- **WHEN** a member who is not on the workspace administration surface looks for it
- **THEN** it is reachable from the frame — today from the workspace switcher and the command
  palette — and every navigation that reached it before this change still arrives
