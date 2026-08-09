---
title: Board
description: The card's anatomy, the six fixed columns, the whole keyboard move contract, and what a board deliberately does not draw.
---

The board is a kanban view of a team's issues, grouped into columns by status. It is a **lens
on Issues, not a destination of its own** — both show the same team-scoped issues, and a change
made in one shows up in the other without a reload. Open it at `/teams/<teamId>/board`, or use
the **List | Board** lens in the Issues masthead. The **Issues** stop in
[the deck](/features/app-frame/) stays current either way.

## The masthead

Band 2 is the same masthead the [issue list](/features/issue-list/) draws, with the lens toggle
flipped: the page name, the mono count of issues **matching the current filter**, the toggle,
**Save view**, **New issue**, and the same filter axes — Status, Priority, Assignee, Delivery,
Label, Cycle, Project, plus free-text search. There is one implementation of those axes, imported
by both lenses, so an axis can never mean one thing on the list and another on the board.

Where the list states its grouping and sort, the board states `Order · Manual` and offers no
control. That is not a missing feature: a board's columns **are** the grouping, and its vertical
order is the manual rank you set by moving cards. Neither control would have anything to act on.

Filters are per-lens: switching from List to Board starts the board unfiltered.

## The six columns

The board always has the same six columns, in this order:

1. **Backlog**
2. **Todo**
3. **In Progress**
4. **In Review**
5. **Done**
6. **Canceled**

These are the fixed issue statuses — the board never adds, removes, renames or reorders columns,
and it only ever groups by status.

The six share the page's width equally, so **all six are on screen** and the board never scrolls
sideways. A column whose cards run past the bottom scrolls **vertically**; it never folds its
remainder behind a "show more" control, because a folded card is a place a move cannot land. The
column header always states the true total.

A column with no cards draws one reserved slot and no words. Its accessible name still states the
count, so `Canceled, 0 issues` is what a screen reader hears.

## The card

A card carries the **same facts as a list row, in a different shape**. Top row: the status glyph,
the mono issue key, and the priority mark. Then the title. Then, when there is something true to
say, the delivery phrase — the same sentence the list row states, from the same dictionary. Last
row: the labels, the reserved [reality track](/features/reality-vocabulary/), and the assignee.

The track carries the `//` break when your board and git disagree — a pull request merged while
the issue is still In Progress breaks there, and the phrase says so in words.

An issue with **no linked change** is quiet: the track slot keeps its measure and draws nothing at
all, announces nothing to assistive technology, and no phrase line is drawn. A quiet card is
shorter than a loud one; it is not a card with a blank row in it.

## Moving a card

Moving a card does one of two things:

- Move it **to another column** — the issue's status changes to that column's status.
- Move it **within a column** — the issue is reordered relative to its neighbours.

Every move is optimistic: the card settles into its new place immediately, with no network
wait, and the new order persists across a reload. There are three ways to move a card.

### With the pointer

Drag a card and drop it in any column, above or below other cards. Dropping it in a
different column changes the issue's status; dropping it elsewhere in the same column
reorders it.

### With the keyboard

The board is fully operable without a pointer. With a card focused:

- Press **Space** or **Enter** to pick it up.
- Use the **arrow keys** to move it within its column and to adjacent columns.
- Press **Space** or **Enter** again to drop it.
- Press **Escape** to cancel — the card returns to where it started and nothing is written.

Each step is announced to assistive technology through a live region, and focus returns to
the card in its new location after the drop. If the move sends the card to a status your
current filter hides, there is no card to return to: focus goes to the destination column
and the live region says where the card went.

:::tip
With a card focused, press **o** to open the issue (or click the card). **Enter** and
**Space** are reserved for picking the card up.
:::

### What a move looks like

A move in progress is **drawn, not animated** — it reads the same from a still frame and with
`prefers-reduced-motion: reduce` set, whether a pointer or the arrow keys are driving it:

- The card you picked up becomes a **hole**: it keeps its exact size and empties out, so the gap
  is the shape of the card that left it.
- The destination column draws the **landing slot** where the card will come to rest. It appears
  only when you are over a column that is not the card's own — within a column, the gap that opens
  between two cards is already the landing site, and a second marker would show two.
- The card **in flight** is the one raised thing on the page, and while the move is live it states
  the contract: `space drop · esc cancel · ← → column`.

### With the command palette

For the fastest status change — and the most reliable path for switch and voice control —
focus a card and open the board's **Move to status…** palette:

- Press **m**, or
- Press **⌘K** (**Ctrl+K** on Windows and Linux).

Then choose **Move to Backlog**, **Move to In Review**, and so on. The card moves to that
column's status and is appended to the bottom of the column.

With **no** card focused, **⌘K** is not about a card, so it opens the ordinary Issues palette:
search, create, and the destinations. The bulk actions need a selection, and the board has none —
a card's own **Move to status…** is the board's equivalent.

## Large columns

A column stays a plain, simple list until it grows past roughly one hundred cards, at which
point it virtualizes automatically so scrolling stays fast. Cards remain fully draggable and
keyboard-movable either way — you never have to think about the threshold.

## What the board does not draw

Each of these is something a board is expected to have. Each is absent because no fact in yapm
backs it, or because it is something yapm refuses to build:

- **Swimlanes by person.** A per-person row of a team's work is a per-person scorecard, and yapm's
  metrics are [team-level only](/features/delivery/). The assignee stays one avatar at the card's
  tail, never an axis.
- **WIP limits.** No per-column limit is stored anywhere, so the number would be decoration and
  the over-limit alarm a lie.
- **Custom columns.** The columns are the status enum.
- **Column dwell, aging dots, stale washes.** yapm knows an issue's status now; it does not store
  when the issue entered that status. Nothing on this page ages a card. The only ages drawn come
  from the delivery seam's review clock, which is stored.
- **Estimates, points, sizes, dependency arrows, design thumbnails.** No entity backs any of them.

## Viewers

Viewers are free and unlimited, and they can read the board like anyone else. Viewers cannot
move cards: dragging, the keyboard pick-up, and the **Move to status…** palette are all
read-only for them, no hole or landing slot is ever drawn, and no move is ever written. A card is
still an operable button — **Enter**, **Space** or **o** opens the issue.
