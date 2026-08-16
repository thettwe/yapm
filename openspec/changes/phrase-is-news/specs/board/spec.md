## MODIFIED Requirements

### Requirement: Status-grouped keyboard-first board

The system SHALL present a team's issues as a kanban board of six fixed columns in the status category order (Backlog, Todo, In Progress, In Review, Done, Canceled) at a `/board` route reached as the **Board lens** in the Issues masthead, where Issues remains the current destination on the deck. The board SHALL read the same team-scoped synced query the list uses, so already-synced rows render and re-arrange locally without a network round-trip, meeting the sub-100ms budget. A viewer SHALL see the board read-only.

The six columns SHALL share the page's measure fluidly — each column an equal fraction of the available width, none fixed — so that **all six are readable at 1440 with no horizontal scrolling**, and the promise holds at other widths without a breakpoint. A column whose cards exceed its height SHALL scroll vertically, and SHALL NOT fold its remainder behind a "more" control: a folded remainder would hide drop targets from a move. The column header SHALL state the column's true total.

A card SHALL carry the **same facts as a list row in a different shape**: the status glyph, the mono issue key, the priority mark, the title, the rest phrase, the labels, the reserved reality-track slot, and the assignee. The phrase and the track SHALL be derived from the same delivery seam the list row derives them from, **in the same register**, so a card and a row describing one issue can never disagree about what is worth saying. The track SHALL carry the `//` divergence break when the board and git disagree — no separate divergence slot is laid out — and an issue with no linked change SHALL draw **no reality ink at all**: the slot reserves its measure, draws nothing, and states nothing to assistive technology. The phrase SHALL render nothing when the register has nothing true to say **or when the register resolved the card's key to quiet**, rather than reserving an empty line. A card carries an explicit accessible name, which suppresses everything drawn inside it — the phrase and the track's own label alike — so that name SHALL carry the delivery register too: the phrase when the register drew one, the register's words for the key when it resolved that key to quiet, and the divergence in words when the board and git disagree.

Because the card's accessible name is the only channel that survives the suppression, the card's reality track SHALL reserve the same **age column** the list row's track reserves, so the review age is drawn on the card rather than living only in a phrase the register may quiet. That column SHALL be reserved whether or not the card has an age to put in it, so a card whose signal arrives shifts nothing.

A column with no cards SHALL draw one reserved slot and no words; the column's accessible name SHALL continue to state its count.

Every colour, font and density SHALL come from tokens and be correct in all three presets in both light and dark, on the board's own grounds — the card's elevated surface and the column's tinted surface — with drawn elements meeting the 3:1 non-text bar and every text-sized element meeting the 4.5:1 bar.

Work-graph placement: a view over team-scoped `issue` rows and the linked `pull_request` / `ci_check` / `review` / `deployment` rows the list already syncs; introduces no new entity and no new query. Permission story: renders only the caller's teams' issues; viewers read but cannot move.

#### Scenario: Board renders issues in fixed status columns

- **WHEN** a member opens a team's board
- **THEN** the six fixed status columns appear in order and each issue renders as a card in its status column with its status glyph, priority mark, key, title, and assignee

#### Scenario: All six columns are readable at 1440 without horizontal scrolling

- **WHEN** the board renders at a 1440-wide viewport
- **THEN** every one of the six columns is within the viewport and the board region does not scroll horizontally

#### Scenario: A card states its delivery reality

- **WHEN** a card renders an issue whose linked pull request is merged while the issue is not marked done
- **THEN** the card draws the reality track with the `//` break on the segment where the board and git parted, states the divergence in words in its phrase, and carries both the phrase and the divergence in its accessible name

#### Scenario: A card and a row agree about what is worth saying

- **WHEN** one issue is rendered as a list row and as a board card, and the register resolves its key to quiet
- **THEN** neither draws a phrase, and both carry the register's words for that key in the accessible name available to them — the track's on the row, the card's own on the card

#### Scenario: A quiet card still draws the review age

- **WHEN** a card renders an issue whose pull request is open and unreviewed, so its phrase is quiet
- **THEN** the card's track draws the review age in its reserved age column, and a card with no age reserves the same column and draws nothing in it

#### Scenario: A quiet card draws no reality ink

- **WHEN** a card renders an issue with no linked change
- **THEN** its track slot reserves its measure, draws no station, segment or age, is not exposed to assistive technology as an image, and no phrase line is drawn

#### Scenario: An empty column is reserved, not captioned

- **WHEN** a status column contains no issues
- **THEN** it draws one reserved slot with no words, and its accessible name still states the column and a count of zero

#### Scenario: A large column scrolls and states its true count

- **WHEN** a status column holds far more cards than fit its height
- **THEN** the column scrolls to reach them, its header states the true total, and no card is hidden behind a fold

#### Scenario: Board and list are lenses on the same data

- **WHEN** a member switches between the List and Board lenses for a team
- **THEN** both show the same team-scoped issues and a change made in one is reflected in the other without a reload

#### Scenario: Board is correct across themes

- **WHEN** the board is viewed in each preset in light and dark
- **THEN** all card and column colors, fonts, and density come from tokens and remain legible
