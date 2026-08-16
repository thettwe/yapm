## MODIFIED Requirements

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

- **WHEN** the `more` menu is opened in a build where a destination the interaction model draws
  has no entity storing its rows
- **THEN** no item for it appears — neither enabled nor disabled

#### Scenario: The count is over destinations, not over bar seats

- **WHEN** the set of places the deck can reach is counted at the widest width and again at the
  narrowest, including everything the menu lists
- **THEN** both counts are the same number, that number is at most eight, and the `more` trigger
  is not one of them

#### Scenario: A destination in the menu is still the current page

- **WHEN** a member opens a destination that lives in the menu's permanent list
- **THEN** that destination's menu item carries `aria-current="page"`, the `more` trigger carries
  no current marking, and exactly one element in the navigation landmark claims the current page

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
