## MODIFIED Requirements

### Requirement: One global owner of the palette keybinding

The application SHALL have exactly one owner of the command-palette shortcut, mounted above
every authenticated surface, and exactly one palette instance. No individual surface SHALL
bind the palette shortcut itself. Because the frame advertises the shortcut on every page,
the shortcut SHALL open a palette on every authenticated page — including pages that
register no commands of their own, where the palette offers the always-present set (**every
destination the deck offers, in either of its tiers**, the notification inbox, search everything,
and theme selection).

The always-present set SHALL name the deck's destinations by the deck's own membership rather than
by a number written here, so that a destination moving between the bar and the `more` menu changes
nothing in this capability, and a destination added or retired is a single edit in the capability
that owns the deck. The palette SHALL take that membership from the same declaration the deck is
drawn from rather than keeping a second copy of it, so the two cannot disagree about which places
exist. Each destination's row SHALL state the `g` binding the frame actually implements, because
for a destination on the bar the palette is the only place in the product that advertises it.

Surfaces that contribute commands SHALL **register** a command source with the global owner
while they are mounted and SHALL unregister it when they unmount, so the palette offers the
union of the always-present set and the sources currently mounted. Registration SHALL NOT
change what any surface offers: every command reachable from the palette before this
requirement SHALL remain reachable, with the same targeting rules and the same mutators.
Surface-local shortcuts that are not the palette shortcut SHALL be unaffected.

Work-graph placement: interaction surface only; no entity. Permission story: unchanged —
registered commands are authorized by the same team-scoped mutator checks as before, and the
always-present set contains no writes.

#### Scenario: The shortcut works on a page that registers nothing

- **WHEN** a member presses the palette shortcut on the delivery surface, which contributes
  no commands of its own
- **THEN** the palette opens and offers the destinations, inbox, search and theme commands

#### Scenario: The always-present set follows the deck

- **WHEN** the palette's navigation group is compared against the destinations the deck offers
  across both of its tiers
- **THEN** the two sets are identical, every row states the binding the frame implements, and
  neither set is fixed to a count written in a requirement

#### Scenario: A surface's commands appear only while it is mounted

- **WHEN** a member opens the palette on the issue list, then navigates to a surface that
  registers no issue commands and opens it again
- **THEN** the issue commands are offered on the first surface and absent on the second

#### Scenario: Exactly one palette responds to the shortcut

- **WHEN** a member presses the palette shortcut on a surface that contributes commands
- **THEN** exactly one palette opens

#### Scenario: Every previously reachable command survives

- **WHEN** the palette is opened on the issue list, the board, and a retro
- **THEN** each surface's full command set — including create, status, assign, label,
  project, triage and the retro and board actions — is offered exactly as before

#### Scenario: Surface shortcuts other than the palette are untouched

- **WHEN** a member uses the board's and inbox's row-movement keys and the retro's own
  shortcuts
- **THEN** each behaves exactly as before
