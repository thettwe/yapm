---
title: Board
description: A keyboard-first kanban of your team's issues, grouped into the six fixed status columns.
---

The board is a kanban view of a team's issues, grouped into columns by status. It is a peer
view to the issue list — both show the same team-scoped issues, and a change made in one
shows up in the other without a reload. Open it at `/board`, or use the **List ↔ Board**
toggle in the team header.

## The six columns

The board always has the same six columns, in this order:

1. **Backlog**
2. **Todo**
3. **In Progress**
4. **In Review**
5. **Done**
6. **Canceled**

These are the fixed issue statuses — the board never adds, removes, or renames columns, and
it only ever groups by status. Each card shows the issue's status glyph, priority mark, key,
title, and assignee, exactly as the list row does.

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
the card in its new location after the drop.

:::tip
With a card focused but not picked up, press **Enter** to open the issue.
:::

### With the command palette

For the fastest status change — and the most reliable path for switch and voice control —
focus a card and open the board's **Move to status…** palette:

- Press **m**, or
- Press **⌘K** (**Ctrl+K** on Windows and Linux).

Then choose **Move to Backlog**, **Move to In Review**, and so on. The card moves to that
column's status and is appended to the bottom of the column.

## Large columns

A column stays a plain, simple list until it grows past roughly one hundred cards, at which
point it virtualizes automatically so scrolling stays fast. Cards remain fully draggable and
keyboard-movable either way — you never have to think about the threshold.

## Viewers

Viewers are free and unlimited, and they can read the board like anyone else. Viewers cannot
move cards: dragging, the keyboard pick-up, and the **Move to status…** palette are all
read-only for them, and no move is ever written.
