## MODIFIED Requirements

### Requirement: Six destinations, and everything else is a doorway, a lens or a transient

The deck SHALL present exactly six stops in order: Home, Issues, Triage, Cycles, Delivery,
and a `more` menu. The active stop SHALL be marked with accent text, a 2px accent underline
and `aria-current="page"`, inside a navigation landmark with an accessible name. The `more`
menu SHALL be a transient, never a destination: it opens on activation, lists Retros,
Projects, Roadmap and Decisions with their keyboard hints, is reachable by keyboard, closes on
Escape and returns focus to its trigger.

The board SHALL NOT be a deck stop; it SHALL be a lens offered in the Issues masthead, and
while it is open the Issues stop SHALL remain the current destination. A destination for
which no entity exists SHALL NOT be rendered at all — never as a disabled or dead link.

The frame SHALL provide `g`-prefixed go-to shortcuts for each destination, and SHALL
suppress them while a text input, rich-text editor or modal surface holds focus. `g d` SHALL open
Decisions and `g s` SHALL open Delivery; each destination's advertised hint in the `more` menu and
in the documentation SHALL match the binding the frame actually implements.

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
- **THEN** the menu opened, the retro/projects/roadmap/decisions items were reachable, and Escape
  closed it and returned focus to the trigger

#### Scenario: Go-to shortcuts navigate without a pointer

- **WHEN** a member presses the go-to prefix followed by a destination key with no text
  input focused
- **THEN** that destination opens

#### Scenario: Go-to shortcuts do not fire while typing

- **WHEN** a member types the same keys inside an issue title field or a rich-text editor
- **THEN** the characters are entered and no navigation occurs

#### Scenario: `g d` reaches the record and Delivery keeps a binding

- **WHEN** a member presses the go-to prefix followed by `d`, and separately followed by `s`
- **THEN** the Decisions record opens for the first and the Delivery view for the second, and the
  hints drawn in the `more` menu name exactly those keys

#### Scenario: A destination with no entity behind it does not render

- **WHEN** the `more` menu is opened in a build where a destination drawn in the interaction model
  has no entity storing its rows
- **THEN** no item for it appears — neither enabled nor disabled; the Decisions item appears only
  because the decision entity now exists
