## MODIFIED Requirements

### Requirement: Status-grouped keyboard-first board

The system SHALL present a team's issues as a kanban board of six fixed columns in the status category order (Backlog, Todo, In Progress, In Review, Done, Canceled) at a `/board` route reached as the **Board lens** in the Issues masthead, where Issues remains the current destination on the deck. The board SHALL read the same team-scoped synced query the list uses, so already-synced rows render and re-arrange locally without a network round-trip, meeting the sub-100ms budget. A viewer SHALL see the board read-only.

The six columns SHALL share the page's measure fluidly — each column an equal fraction of the available width, none fixed — so that **all six are readable at 1440 with no horizontal scrolling**, and the promise holds at other widths without a breakpoint. A column whose cards exceed its height SHALL scroll vertically, and SHALL NOT fold its remainder behind a "more" control: a folded remainder would hide drop targets from a move. The column header SHALL state the column's true total.

A card SHALL carry the **same facts as a list row in a different shape**: the status glyph, the mono issue key, the priority mark, the title, the rest phrase, the labels, the reserved reality-track slot, and the assignee. The phrase and the track SHALL be derived from the same delivery seam the list row derives them from, so a card and a row describing one issue can never disagree. The track SHALL carry the `//` divergence break when the board and git disagree — no separate divergence slot is laid out — and an issue with no linked change SHALL draw **no reality ink at all**: the slot reserves its measure, draws nothing, and states nothing to assistive technology. The phrase SHALL render nothing when the register has nothing true to say, rather than reserving an empty line. A card carries an explicit accessible name, which suppresses everything drawn inside it, so that name SHALL carry the delivery register too: the phrase when there is one, and the divergence in words when the board and git disagree.

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

### Requirement: Move a card by drag or keyboard within and across columns

The board SHALL let a card be moved with a pointer (drag and drop) and, equivalently, without a pointer: a focused card SHALL be picked up with Space or Enter, moved within its column and to adjacent columns with the arrow keys, dropped with Space or Enter, and the move cancelled with Escape restoring the original position. A move that lands the card in a different column SHALL change the issue's status to that column; a move within a column SHALL reorder it. Each move SHALL be announced to assistive technology via a live region, and focus SHALL return to the moved card in its new location. WHERE the move takes the card out of the board's current filter there is no card to return to, and focus SHALL go to the destination column while the live region states which column the card moved to and that the filter hides it.

A move in progress SHALL be legible **without motion** — that is, from a single still frame and under `prefers-reduced-motion: reduce` — through three drawn states: the **hole** the picked-up card leaves, holding that card's own measure; the **landing position** in the destination column, drawn where the card will come to rest; and the **card in flight**, which SHALL carry the page's elevation and SHALL state the keyboard contract (drop, cancel, and move-by-column) while the move is live. None of the three SHALL depend on animation to be understood, and the same three SHALL be drawn whether the move is driven by a pointer or by the keyboard.

Work-graph placement: a status and/or ordering change on one `issue`. Permission story: the move is gated exactly as the underlying mutator — viewers are rejected and no drag affordance is drawn for them.

#### Scenario: Keyboard move across columns changes status

- **WHEN** a member focuses a card, picks it up with Space, presses ArrowRight to an adjacent column, and drops it with Space
- **THEN** the issue's status changes to the target column optimistically with no pointer interaction, and focus returns to the moved card

#### Scenario: A move out of the filtered set keeps focus on the board

- **WHEN** a member narrows the board with a filter and then moves a card to a status that filter hides
- **THEN** the card leaves the board, focus goes to the destination column rather than to the document body, and the live region states the column it moved to and that the filter hides it

#### Scenario: Drag reorders within a column

- **WHEN** a member drags a card above another card in the same column and drops it
- **THEN** the card settles into the new position optimistically and the order persists across a reload

#### Scenario: Escape cancels a pick-up

- **WHEN** a member picks up a card and presses Escape
- **THEN** the card returns to its original position and no change is written

#### Scenario: A move in progress is drawn, not animated

- **WHEN** a card is picked up and carried over another column, with motion reduced
- **THEN** the card's original position is drawn as a hole of its own measure, the destination column draws the landing position, and the carried card is drawn elevated with the drop, cancel and move-by-column keys stated on it

#### Scenario: A viewer is offered no move

- **WHEN** a viewer focuses a card
- **THEN** no card can be picked up, no hole or landing position is ever drawn, and the card is still operable as a button that opens the issue

## ADDED Requirements

### Requirement: The Board lens carries the Issues masthead

The Board lens's band 2 SHALL be the Issues masthead with the lens toggle flipped: the page name, a mono count, the lens toggle, the same actions the list offers (saving the current view, and creating an issue), and the **same filter axes** the list draws — status, priority, assignee, delivery predicate, label, cycle and project, plus free text — presented in the same quiet register.

Those axes SHALL be rendered from **one shared implementation** imported by both lenses; a second filter bar SHALL NOT exist. Every axis, option, accessible name and saved-view behaviour SHALL be identical on both lenses.

The board SHALL apply the filter over already-synced rows and SHALL state, as its mono count, the **filtered** issue count derived the same way the list derives it, so the two lenses can never disagree about how much work matches.

The board SHALL NOT offer a grouping or a sort control: its columns are the grouping and its vertical order is the manual rank. It SHALL state that ordering plainly in the place the list states its grouping and sort.

Work-graph placement: unchanged — the filter evaluates locally over the same team-scoped rows. Permission story: unchanged; saving a view stays writer-gated.

#### Scenario: The Board lens offers the list's filter axes

- **WHEN** a member opens the Board lens
- **THEN** the masthead carries the mono count, the save-view and new-issue actions, and each of the filter axes the List lens offers, with the same accessible names

#### Scenario: Filtering narrows the board and its count together

- **WHEN** a member applies a filter on the board
- **THEN** the columns narrow locally without a network round-trip and the masthead's count states the filtered total

#### Scenario: The board states its ordering rather than offering a sort

- **WHEN** a member reads the board's masthead
- **THEN** it states that the order is manual, and offers no grouping or sort control

#### Scenario: One filter bar, two lenses

- **WHEN** the repository is searched for the filter axes' implementation
- **THEN** exactly one exists, imported by both the list and the board
