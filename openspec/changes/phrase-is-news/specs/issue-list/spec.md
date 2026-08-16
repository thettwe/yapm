## MODIFIED Requirements

### Requirement: The row states its reality in words, in a reserved slot

Each issue row SHALL render, left to right: the priority tick, the status arc, the mono issue
key, the title, a spring, the **phrase at rest**, the reality track, the track's mono age
column, the issue's labels as dot + name, the mono last-updated age, and the assignee avatar.

The phrase SHALL be drawn from the shared phrase dictionary defined in the reality-vocabulary
capability, in the register that speaks **only when a row's delivery reality is news**. A row
whose classification is an exception — the board and git disagreeing, or a check failing —
SHALL state its phrase as visible text. A row whose classification the reality track beside it
already draws SHALL render its phrase slot **genuinely empty** — no placeholder, no dash, no
filler — and the words that register holds for that key SHALL be carried by the track's
accessible name, exactly as the register would have drawn them. A row with nothing true to say
in that register SHALL render the slot empty and state nothing anywhere, because there is
nothing to state.

The list SHALL NOT decide for itself which classifications are worth saying. Which keys the
register draws, quiets and silences is a property of the dictionary, so the list, a board card
and a project's page cannot describe one issue differently.

Every slot right of the title SHALL occupy a **reserved measure**, so a row whose signal
populates — checks going red, a merge landing, a deployment arriving — SHALL NOT reflow itself
or any neighbouring row. The phrase slot SHALL keep that reserved measure on every row, including
a page on which no row draws a phrase at all; a slot that collapsed when the page happened to
carry no exception would move every track on the page the moment one appeared. The title SHALL
be the element that yields space; the phrase SHALL NOT be truncated ahead of the title.

The phrase SHALL be real text rather than an icon-only signal, and SHALL render correctly from
theme tokens in every preset in light and dark, meeting the text contrast bar against every
surface a row is drawn on — including the selected row's tinted ground.

Work-graph placement: rendering surface over the existing delivery-signal seam; no new entity,
query or mutator. Permission story: unchanged — the phrase derives from rows the caller already
syncs.

#### Scenario: A failing-checks row says so

- **WHEN** the list renders an issue whose linked pull request's checks are failing
- **THEN** that row states the failing-checks phrase in its reserved slot, beside a reality
  track drawing the same fact, and the row's alignment matches every other row's

#### Scenario: An ordinary row draws its track and says nothing

- **WHEN** the list renders an issue whose pull request is merged with no deployment carrying its
  merge commit, and another whose pull request is approved and unmerged
- **THEN** neither row draws a phrase, each row's track draws stations that tell the two apart,
  and both rows keep the same slot measures as a row that carries a phrase

#### Scenario: The words a quiet row stopped drawing are still spoken

- **WHEN** a screen-reader user reaches a row whose phrase went quiet
- **THEN** that row's track announces the register's words for the row's key before the facts it
  draws, so nothing that was readable in text before is unreachable now

#### Scenario: A quiet row stays blank

- **WHEN** the list renders an issue with no linked delivery entities, or one whose signal
  supports no phrase in the row's register
- **THEN** the row's phrase slot renders empty and the row's slots occupy exactly the same
  measures as a row that carries a phrase

#### Scenario: A populating signal does not move the list

- **WHEN** an issue's checks turn red while its row is on screen
- **THEN** the phrase appears in the already-reserved slot and no row's columns shift position

#### Scenario: The divergent row shows its phrase and its broken track together

- **WHEN** the list renders an issue marked in progress whose linked pull request is merged
- **THEN** the row states the divergence phrase **and** draws the `//` break on its track, and
  the row does not draw a second warning symbol for the same fact

#### Scenario: A row that says something is not also heard saying it

- **WHEN** a screen-reader user reaches a row that draws its phrase as visible text
- **THEN** the phrase is announced once, and the track's label states the facts it draws without
  repeating the phrase

### Requirement: Check and deploy phrases carry the source's mark

A row's phrase SHALL carry the GitHub provenance mark when — and only when — it states a check
fact or a deployment fact **as visible text**. The mark SHALL be monochrome, drawn after the
phrase text, no larger than that text, and SHALL NOT replace the row's status arc or any node of
its reality track.

A mark follows the fact it sourced, so a row whose phrase the register resolved to quiet SHALL
draw no mark: there is no text for one to follow, and a mark standing alone would be a provenance
claim about nothing. The words that row's register holds are carried by the track's accessible
name, which states the fact rather than the provider — provenance is a drawing, and nothing is
drawn.

#### Scenario: The mark suffixes the sourced fact

- **WHEN** the list renders the failing-checks phrase and the done-past-a-failing-check phrase
- **THEN** each carries the monochrome GitHub mark after its text, and neither row's status arc
  is replaced or recoloured by it

#### Scenario: A quiet deploy phrase draws no mark

- **WHEN** the list renders an issue whose pull request is merged with no deployment carrying its
  merge commit, so the register resolved its phrase to quiet
- **THEN** no provenance mark is drawn on that row, and the row's track announces the register's
  words for the key

#### Scenario: A derived phrase carries no mark

- **WHEN** the list renders the divergence phrase or the in-review phrase
- **THEN** no provenance mark is drawn beside them
