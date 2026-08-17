## MODIFIED Requirements

### Requirement: The team page is an adaptive digest composed from synced work-graph facts

`/teams/{teamId}` SHALL render the team Home digest: an ordered composition of bands —
hero, NEEDS ATTENTION, SINCE YESTERDAY, YOURS, READY FOR YOU, SHIP CADENCE, SHIPPED THIS
CYCLE, then the page's composition record behind one quiet `how ·`, and an onward footer
(the board, with a ⌘K hint). Every fact on the page SHALL be
derived from rows the client has already synced through existing team-scoped or self-scoped
queries; the page SHALL add no new synced table and no new named query, and SHALL make no
network request to render. All derivations SHALL be pure functions in `packages/schema`,
computed client-side.

The digest SHALL carry no explanatory prose at rest. The composition record and the YOURS
lens definition are derivations and SHALL be reachable only through a `how ·`; the onward
footer's doorways are labels rather than derivations, and SHALL remain visible at rest —
however few of them the deck leaves the footer to carry.

Which doorways it carries is decided by the deck. The onward footer SHALL carry only the surfaces
the deck does not itself offer as destinations — today the board, which is a lens and holds no seat
of its own — together with the `⌘K` hint. It SHALL NOT repeat a deck destination: Issues, Delivery,
Retros and Roadmap are one keystroke and one glance away on every page of the product, and offering
them again at the foot of the one page that already opens on work teaches a second navigation for a
thing the reader must already know. Where a band already links onward to a destination as part of
the fact it is stating — the cadence band to Delivery, an artifact chip to a closed retro — that
doorway is the band's and SHALL be unaffected.

Every band SHALL render only when it has content: an empty band folds away entirely — no
header, no empty-state apology. The digest SHALL remain a complete, honest page when *every*
optional band folds.

#### Scenario: A working morning composes the full page

- **WHEN** a member opens their team's Home while the team has an active cycle, exception
  issues, recent deployments, work assigned to the viewer, and unassigned ready work
- **THEN** the bands render in the fixed order above, each drawn from synced rows, with no
  loading waterfall and no server round trip beyond the already-established sync

#### Scenario: A quiet day folds without apology

- **WHEN** a member opens the team Home while no exception class matches, nothing happened
  in the last 24 hours, the viewer has no in-flight issues, and no unassigned ready work
  exists
- **THEN** the attention, since-yesterday, and ready bands are absent entirely (not rendered
  empty), YOURS renders its single warmth line standing alone — the Runway doorway renders
  only while the READY FOR YOU band renders, and here it has folded — and the hero degrades
  to its quiet form

#### Scenario: The foot of the page does not rebuild the deck

- **WHEN** a member reaches the end of the digest
- **THEN** the onward footer offers the board and the `⌘K` hint, and offers no link to Issues,
  Delivery, Retros or Roadmap, each of which the deck already carries

#### Scenario: A band's own doorway survives the rationing

- **WHEN** the SHIP CADENCE band renders and the hero has a closed retro to point at
- **THEN** the cadence band still links onward to the Delivery view and the artifact chip still
  opens the retro, because each is part of the fact its band is stating rather than a second
  navigation

#### Scenario: Composition is local-first

- **WHEN** the digest renders for a team whose rows are already synced
- **THEN** every number and phrase on the page is computed from local Zero query results by
  pure functions exported from `packages/schema`

#### Scenario: The page states no derivation at rest

- **WHEN** a member opens the digest in any state
- **THEN** no mono clause line naming the composition rules and no mono clause line defining
  the YOURS lens is drawn anywhere on the page; the composition record is reachable through the
  page's `how ·`, and the YOURS lens through the band's own `how ·` wherever the band has rows to
  apply it to
