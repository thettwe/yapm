## ADDED Requirements

### Requirement: DECIDED THIS CYCLE states what the team settled, and never who settled it

The team Home SHALL render a **DECIDED THIS CYCLE** band listing the decisions recorded within the
active cycle, newest first, each as a chip carrying the drawn decision mark, the sentence, a mono
line naming the issue's area where it has one, the issue key, the size of the thread the decision
came out of and the date, and the revisit pill where a revisit cycle is set. Each chip SHALL be a
doorway to its issue.

**No chip, line or label in the band SHALL name a person**, and the band SHALL NOT be derived from
any per-person count. The band SHALL fold entirely when the active cycle holds no decision, and
SHALL not render at all when the team has no active cycle, like every other cycle-dependent band.
The band SHALL sit after SHIPPED THIS CYCLE and before the composed footline.

#### Scenario: The cycle's settlements are on the morning page

- **WHEN** a member opens Home while the active cycle holds three decisions
- **THEN** the DECIDED THIS CYCLE band lists all three newest first, each stating its sentence,
  its issue key and the thread size it came from, and none naming a person

#### Scenario: A cycle that settled nothing folds the band

- **WHEN** the active cycle holds no decision
- **THEN** the band is absent entirely — no header, no empty-state apology

#### Scenario: The revisit marker travels to Home

- **WHEN** one of the cycle's decisions carries a revisit cycle
- **THEN** its chip renders the pill whose words state that the decision resurfaces at that cycle's
  planning

## MODIFIED Requirements

### Requirement: The team page is an adaptive digest composed from synced work-graph facts

`/teams/{teamId}` SHALL render the team Home digest: an ordered composition of bands —
hero, NEEDS ATTENTION, SINCE YESTERDAY, YOURS, READY FOR YOU, SHIP CADENCE, SHIPPED THIS
CYCLE, DECIDED THIS CYCLE, then a composed mono footline and an onward footer (Issues · Delivery ·
Retro · Roadmap, with a ⌘K hint). Every fact on the page SHALL be derived from rows the client has
already synced through team-scoped or self-scoped queries; the page SHALL make no network request
to render. Beyond the team-scoped decisions query the record page also uses, the page SHALL add no
synced table and no named query of its own. All derivations SHALL be pure functions in
`packages/schema`, computed client-side.

Every band SHALL render only when it has content: an empty band folds away entirely — no
header, no empty-state apology. The digest SHALL remain a complete, honest page when *every*
optional band folds.

#### Scenario: A working morning composes the full page

- **WHEN** a member opens their team's Home while the team has an active cycle, exception
  issues, recent deployments, work assigned to the viewer, unassigned ready work, and a decision
  recorded this cycle
- **THEN** the bands render in the fixed order above, each drawn from synced rows, with no
  loading waterfall and no server round trip beyond the already-established sync

#### Scenario: A quiet day folds without apology

- **WHEN** a member opens the team Home while no exception class matches, nothing happened
  in the last 24 hours, the viewer has no in-flight issues, no unassigned ready work
  exists, and the cycle has settled nothing
- **THEN** the attention, since-yesterday, ready and decided bands are absent entirely (not
  rendered empty), YOURS renders its single warmth line standing alone — the Runway doorway renders
  only while the READY FOR YOU band renders, and here it has folded — and the hero degrades
  to its quiet form

#### Scenario: Composition is local-first

- **WHEN** the digest renders for a team whose rows are already synced
- **THEN** every number and phrase on the page is computed from local Zero query results by
  pure functions exported from `packages/schema`
