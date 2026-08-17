## REMOVED Requirements

### Requirement: Six destinations, and everything else is a doorway, a lens or a transient

**Reason**: the name and its first sentence count the `more` menu — which the same requirement
calls "a transient, never a destination" — as one of the six. The number therefore caps **bar
seats**, not destinations, and says nothing at all about what hangs off the menu. Eight
destinations ship under a sentence that reads as a cap of six, and every queued change grows the
menu, where the sentence does not reach. A budget with a hole in it is worse than no budget: it
lets a family add a destination while truthfully reporting that it changed nothing.

**Replaced by**: "A bounded deck: eight destinations, and everything else is a doorway, a lens or
a transient" below, which counts the thing the deck actually offers. Five of this requirement's
six scenarios are carried through **verbatim**; the sixth — "The more menu is keyboard-operable
and escapable" — is carried through with one generalisation, its THEN moving from "the
retro/projects/roadmap items were reachable" to "every destination in its permanent list was
reachable", because Triage joins that list and a scenario naming three of four items would go
stale on the change that wrote it.

## ADDED Requirements

### Requirement: A bounded deck: eight destinations, and everything else is a doorway, a lens or a transient

The deck SHALL offer **at most eight destinations, counted at every viewport width**, across
exactly two tiers:

- **the bar** — at most four destinations, drawn in the band itself, plus the `more` menu;
- **the menu's permanent list** — the remaining destinations, drawn only while the menu is open.

Home and Issues SHALL never leave the bar. Today the deck stands exactly at its ceiling: Home,
Issues, Cycles and Delivery on the bar, and Triage, Retros, Projects and Roadmap in the menu's
permanent list.

The count SHALL be over **destinations**, not over bar seats. The `more` menu SHALL be a
transient, never a destination, and SHALL NOT be counted as one of the eight: it opens on
activation, lists the permanent destinations with their keyboard hints together with whatever the
bar has shed at the current width, is reachable by keyboard, closes on Escape and returns focus to
its trigger.

Below the deck's comfortable width the bar SHALL shed destinations into the menu from the right,
and the band SHALL NOT wrap. The shed destinations SHALL be drawn separately from the permanent
list, so a destination is never offered twice in one menu, and the menu SHALL hold no more than
six items at any width — which is the ceiling's real origin: at the narrowest width the bar keeps
Home, Issues and the trigger, so nine destinations would put seven items in a menu on the viewport
with the least room for one.

The active destination SHALL be marked with accent text, a 2px accent underline and
`aria-current="page"`, inside a navigation landmark with an accessible name. Where the active
destination sits in the menu rather than on the bar, **its menu item SHALL carry the current-page
marking** and the trigger SHALL NOT, because the trigger is the transient and not the place.

A menu item's marking SHALL be drawn as well as announced — weight and a 2px accent rule on its
leading edge, in the popup's own ink — so that a member who opens the menu sees which of its
destinations they are on rather than only hearing it. A destination the bar has SHED SHALL carry
that same marking on its menu item, because at the width that shed it the bar link holding the
marking is not drawn at all, and a member would otherwise be on a page the deck claims nowhere.

The board SHALL NOT be a deck stop; it SHALL be a lens offered in the Issues masthead, and while
it is open the Issues stop SHALL remain the current destination. A destination for which no entity
exists SHALL NOT be rendered at all — never as a disabled or dead link.

The frame SHALL provide `g`-prefixed go-to shortcuts for each destination, and SHALL suppress them
while a text input, rich-text editor or modal surface holds focus.

A surface that has rendered its own content SHALL NOT re-offer the deck's destinations beneath it
as a second navigation. Such a page MAY carry doorways to lenses, to artifacts, to rows and to
pages that hold no seat; it SHALL NOT stand a list of deck destinations at the foot of the work it
has just shown, because a member who must learn two ways to reach one place has learned one thing
too many.

This SHALL NOT be read as reaching an **empty state**. A surface with nothing of its own to show has
no first navigation for a second one to stand beside, and the onward doorways it draws are what it
says instead of nothing — which the triage and notifications capabilities already require of their
empty states. Those doorways MAY name deck destinations, and this requirement SHALL NOT be used to
take them away: a dead end is a worse answer than a repeated label.

Work-graph placement: chrome over entities that already sync; no entity, query or mutator is
introduced, and no destination's route changes. Sync/permission story: unchanged — every
destination in either tier reads the same team-scoped queries the caller already syncs, and moving
one between tiers moves no row.

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
- **THEN** the menu opened, every destination in its permanent list was reachable, and Escape
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

#### Scenario: The count is over destinations, not over bar seats

- **WHEN** the set of places the deck can reach is counted at the widest width and again at the
  narrowest, including everything the menu lists
- **THEN** both counts are the same number, that number is at most eight, and the `more` trigger
  is not one of them

#### Scenario: A destination in the menu is still the current page

- **WHEN** a member opens a destination that lives in the menu's permanent list
- **THEN** that destination's menu item carries `aria-current="page"` and is drawn with the menu's
  current-page marking rather than announced only, the `more` trigger carries no current marking,
  and exactly one element in the navigation landmark claims the current page

#### Scenario: A shed destination is still marked where it landed

- **WHEN** the viewport narrows until the destination the member is on folds off the bar, and they
  open the menu
- **THEN** its item in the menu carries the current-page marking, and no other item does

#### Scenario: A shed destination is not offered twice

- **WHEN** the viewport narrows until a bar destination folds into the menu
- **THEN** the menu lists it once, the band does not wrap, and no destination appears both on the
  bar and in the menu at the same width

#### Scenario: A page with content does not rebuild the deck beneath it

- **WHEN** an authenticated page that has rendered its own content is read to its foot
- **THEN** it offers no second list of the deck's destinations there, and the doorways it does
  offer lead to lenses, artifacts, rows or seatless pages

#### Scenario: An empty state may point at a destination

- **WHEN** a surface with nothing of its own to show — a cleared triage queue, an empty
  notification inbox — draws the onward doorways its own capability requires of it
- **THEN** those doorways may name deck destinations, and this requirement removes none of them

### Requirement: What earns a place in the deck, and what a new one costs

A surface SHALL earn a place in the deck by three tests, and the tier it lands in SHALL be decided
by which of them it passes:

1. **An entity of its own.** The rows the surface presents SHALL be stored by the product. A
   surface with nothing behind it is not a destination at any tier and SHALL NOT be drawn.
2. **Not a re-cut, and not an interior.** A surface presenting the rows of a single collection
   another destination already owns — re-ordered, re-grouped or re-drawn — is a **lens**, and
   SHALL be offered in that destination's masthead. A surface answering, at a higher resolution,
   a question a destination already answers is that destination's **interior**, and SHALL be built
   there. Only a surface composing across collections no single destination owns may be a
   destination in its own right.
3. **A producer that fills it in the ordinary course of work.** A destination's rows SHALL come
   into existence as a side effect of a team working — created, ingested, or derived from git, CI
   or deploys. A surface whose rows can only appear through a deliberate act taken on another
   surface the member is already looking at has no intake of its own: it SHALL sit in the menu
   rather than on the bar until a producer ships, and SHALL be eligible to return to the bar,
   under this same requirement, when one does.

Because the deck is at its ceiling, a change that adds a destination SHALL name the destination it
displaces and SHALL show that destination failing one of these tests. A change that moves a
destination from the menu to the bar SHALL do the same. A change that can name no such destination
SHALL land its surface as a lens, an interior, a doorway or a section of a destination that
already exists, and SHALL say so in its own spec rather than leaving the placement to the build.

**Growth by menu is growth.** A change adding to the menu's permanent list spends exactly the same
budget as one adding to the bar, and no requirement, scenario or review SHALL treat the menu as
the cheaper door.

The deck's membership SHALL NOT be decided by how often a destination is visited. yapm keeps no
read log and is forbidden from adding one, so a usage test would be either unmeasurable or a
surveillance feature the product refuses on principle. These tests are structural on purpose: two
readers applying them to the same surface SHALL reach the same tier without consulting anybody.

Work-graph placement: a rule about chrome; it introduces no entity and reads no row. Sync/permission
story: unchanged.

#### Scenario: A destination with no intake sits in the menu

- **WHEN** a destination's rows can be created only by a member choosing an action on a row they
  are already looking at, with no ingest, connector or public route that creates them
- **THEN** it is offered in the menu's permanent list rather than on the bar, keeps its route and
  its keyboard shortcut, and returns to the bar only by a later change that names a producer and
  names what it displaces

#### Scenario: A re-cut of one collection is a lens

- **WHEN** a change proposes a surface listing the same collection an existing destination owns,
  cut by a different axis
- **THEN** it is built as a lens in that destination's masthead, that destination stays current
  while the lens is open, and the deck's count is unchanged

#### Scenario: A ninth destination must name what it displaces

- **WHEN** a change proposes a destination while the deck already offers eight
- **THEN** the change names the destination it displaces and shows it failing one of the three
  tests, or it is not a destination

#### Scenario: The menu is not a free shelf

- **WHEN** a change adds an item to the menu's permanent list without touching the bar
- **THEN** it is held to the same budget as a change adding a bar stop, and the count it must
  respect is the deck's total rather than the bar's

#### Scenario: Membership is never decided by usage

- **WHEN** a change argues for promoting or retiring a destination on the grounds that members
  visit it often or rarely
- **THEN** the argument is refused, because the product records no such fact and will not start

### Requirement: The deck does not vary with what a team happens to hold

The deck's membership SHALL be decided by what the product stores, never by what a team holds
today. A destination SHALL NOT be folded, hidden, dimmed, reordered or disabled because its rows
are empty for this team on this morning, and its `g` binding SHALL navigate whether or not the
destination has anything in it.

The absence rule the attention number carries — zero is absence, not a zero — SHALL NOT be
extended to a destination. A count is a claim about a quantity, and a rendered zero claims that
every class behind it was evaluated and came back empty; a destination is an offer of a place, and
the place exists whether or not it holds anything today. A member SHALL be able to open an empty
destination and see for themselves that it is empty.

A destination that is empty for *every* team, because nothing in the product produces its rows, is
not a folding problem but a tier problem, and SHALL be resolved once by the preceding requirement
rather than per team by the deck.

This requirement SHALL NOT be read as reaching a page's own masthead count: what a page states
about what it holds, on a page the member deliberately opened, is that capability's decision and
not the frame's.

Work-graph placement: chrome; no entity. Sync/permission story: unchanged — the deck already reads
only team-scoped queries the caller syncs, and this requirement removes the one reason it would
have had to branch on their contents.

#### Scenario: An empty destination is still a destination

- **WHEN** a member opens a team whose triage inbox, retros list and projects list are all empty
- **THEN** every destination is still offered, in the same tier and the same order, and each opens
  onto its own empty state

#### Scenario: The badge folds and the destination does not

- **WHEN** no issue matches any exception class and triage is empty
- **THEN** the deck shows no attention badge and the statusline shows no attention segment, and
  the deck's destinations are unchanged

#### Scenario: Two mornings read the same

- **WHEN** a member opens the deck on a morning with work waiting everywhere and again on a
  morning with nothing waiting anywhere
- **THEN** the bar carries the same destinations in the same order both times, the menu lists the
  same items, and every `g` binding does the same thing

### Requirement: A `g` binding belongs to its destination, not to its seat

Moving a destination between the bar and the menu SHALL NOT change its `g` binding. The grammar is
one key per destination, and the key names the place rather than where the place is drawn.

Only a destination SHALL hold a `g` binding. A lens, a doorway, an artifact and a transient SHALL
NOT — they are reached from the surface that owns them, from the command palette and from search,
which is how the notification inbox and the search surface are reached today.

Every destination SHALL advertise its binding, beside its own name, in at least the command
palette; a destination in the menu's permanent list SHALL additionally carry its hint on its menu
item at every width, rather than only at the widths where something has folded. Where an
advertisement and the implementation disagree, the advertisement is the defect.

A change that reassigns a binding SHALL move every advertisement of it in the same change: the
menu's hint, the palette's shortcut string, the documentation's keyboard table, and **every
requirement in any capability that names the key**. A capability naming a key it no longer owns
SHALL be listed among that change's modified capabilities.

Work-graph placement: chrome; no entity. Sync/permission story: unchanged.

#### Scenario: A destination that moves tier keeps its key

- **WHEN** a destination is moved from the bar into the menu's permanent list
- **THEN** its `g` binding, its route and its palette entry are unchanged, and a member who
  learned the key before the move reaches the same page after it

#### Scenario: A doorway holds no key

- **WHEN** a surface is placed as a doorway rather than a destination
- **THEN** no `g` binding is created for it, and it is reached from the surface that offers it,
  from the command palette and from search

#### Scenario: A menu destination advertises its key at every width

- **WHEN** a member opens the `more` menu at the widest supported width
- **THEN** every destination in its permanent list is drawn with its keyboard hint, without the
  member having first narrowed the window

#### Scenario: Reassigning a key moves every advertisement

- **WHEN** a change reassigns a `g` key from one destination to another
- **THEN** the menu hint, the palette shortcut, the documentation table and every requirement in
  every capability that names that key are amended in the same change, and that capability appears
  in the change's modified-capabilities list

## MODIFIED Requirements

### Requirement: Honest degradation where no team is in context

On a workspace-level surface the deck SHALL remain present and useful: its destinations SHALL
point at an anchor team — the caller's last visited team, or failing that the first team
they can see — and no destination SHALL be marked current. Where the caller can see no team at all,
the deck's destinations SHALL be absent rather than disabled, in **both** tiers: no destination is
drawn on the bar, and the `more` trigger is not offered either, because a transient onto nothing is
the same broken promise a disabled link is.

The count is the deck's own, not this requirement's: what points at the anchor team is however many
destinations the budget allows, in whichever tier each sits, and a change moving one between tiers
SHALL NOT have to amend this requirement to keep it true.

The statusline SHALL NOT state a team fact on a page with no team in context: no cycle, no
shipped count, no deploy count and no attention segment. It SHALL show only what is true
there — the workspace and the sync state. An anchor team the caller can no longer see SHALL
be discarded rather than linked.

#### Scenario: The deck stays useful on a workspace page

- **WHEN** a member who last visited the Engineering team opens the workspace inbox
- **THEN** the deck's destinations point at Engineering, in both tiers, and none of them is marked
  current

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
- **THEN** the destinations point at the first team the caller can see, or fold away if there is
  none
