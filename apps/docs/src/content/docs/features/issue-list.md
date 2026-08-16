---
title: The issue list
description: The row's anatomy left to right, the phrases at rest and where else they are spoken, the quiet filter bar, group headers, the fold, and the complete keyboard model.
---

The issue list is where a team's work lives, and where yapm's whole argument shows up: the work
graph is visible **where the work is**, not on a dashboard somebody has to remember to open. Every
row states what git actually says about it, in words and in a drawing, without you asking.

Everything on this page is computed on your own device over rows already synced. Filtering,
sorting, grouping, opening the fold — none of it waits on the network.

## The row, left to right

| Slot | What it carries |
| --- | --- |
| **Priority tick** | Weight, drawn as ticks; one tick standing alone is urgent |
| **Status arc** | Status as a position around the cycle |
| **Key** | `ENG-116`, in mono. A key still replicating renders as pending |
| **Title** | The one element that yields space when the row is narrow |
| **Phrase at rest** | What git says about this issue right now — or nothing at all |
| **Reality track** | The same fact, drawn: stations, segments, and `//` where the board and git disagree. With no linked change it draws nothing |
| **Age** | How long the review clock has been running, in mono |
| **Labels** | A coloured dot and the label's name |
| **Updated** | Last movement, in mono |
| **Assignee** | Avatar, or an empty reserved slot |

Every slot right of the title occupies a **reserved measure**. A row whose checks go red, whose PR
merges, or whose deploy lands does not shove its neighbours' columns sideways — the space was
always there. On a narrow window the phrase and the labels fold away rather than wrapping: the
row's height is a rule.

A reserved measure is not the same as a drawn one. An issue with no linked change reserves the
track's full width and its age column and lays down **no ink at all** — the alignment is held by
the layout, not by a placeholder. On a list where most issues have no linked change, that leaves
delivery ink only on the rows that have delivery. See
[The reality vocabulary](/features/reality-vocabulary/).

The selected row carries a **left accent rail** and a tinted ground. The rail is a position as
well as a colour, so selection reads without relying on hue.

## Phrases at rest

A row says something only when there is something true to say. A row with no linked pull request,
or one whose delivery state adds nothing the track has not already drawn, stays **genuinely
blank** — no placeholder, no dash, no filler.

| What the facts say | The row says |
| --- | --- |
| A merged PR under an issue that is not done | **Done in git, not on the board** |
| Linked checks are failing | **Checks failing** |
| Merged, and no successful deployment carried the merge commit | **Built — not live yet** |
| An open PR nobody has reviewed yet | **In review — waiting 16h** |
| An open PR whose review came back without approving | **In review — reviewed 3h ago** |
| A done issue whose checks are red | **Done — checks failing** |
| A PR approved and waiting to merge | **Approved** |
| A draft PR | **Draft open** |
| Deployed | *(nothing — the track already says it)* |
| Nothing has happened yet — including an issue marked in review with no PR behind it | *(nothing — and the track draws nothing either)* |

Two of those deserve their own note.

**A waiting phrase never claims a reviewer waited.** There is no "review requested" event in the
data, so when nobody has reviewed a change, the clock measures how long the *pull request* has been
open. That is a true statement about the change, so the phrase says the change is waiting. Once a
review has actually come back, the phrase changes to *reviewed N ago* — because saying "waiting"
there would invert the fact.

**These are the same words Home speaks.** The phrases live in one shared dictionary next to the
delivery-signal derivation, not inside any one screen. [Team Home](/features/team-home/)'s YOURS
band renders that dictionary in a **personal** register — *Checks failing — the fix is yours* — and
the list renders it in a **neutral** one. Same classifier, same facts, two voices. A screen cannot
invent a phrase of its own for a fact another screen already names.

## Where the source's mark appears

A phrase carries the GitHub mark when — and only when — the fact it states came **from GitHub**:
the check facts and the deployment fact. A divergence between your board and git, a review age, a
status position: those are yapm's own derivations, and they carry no mark.

The mark is monochrome, sits after the text it sourced, and is never larger than that text. It
never replaces a status arc or a track node — see
[The reality vocabulary](/features/reality-vocabulary/) for why our glyphs carry meaning while
brand marks carry only provenance.

## The filter bar

The bar is drawn quietly on purpose: a filter mark, then the axes as plain text, with the current
grouping and sort stated at the trailing edge. Nothing in it competes with the work for attention.
Everything in it still works.

It is also the **Board** lens's bar — one implementation, imported by both, so an axis cannot mean
one thing here and another there. The **List | Board** toggle beside the page name switches which
lens draws the results; the Board lens offers the same axes, the same search, the same saved views
and the same **Save view** and **New issue** actions, and states `Order · Manual` where this one
states its grouping and sort. Filters are per-lens: switching starts the other lens unfiltered.
See [the board](/features/board/).

**Filter axes** — Status, Priority, Assignee, Delivery, Label, Cycle, Project. Each opens a menu of
options with the selected count shown beside the axis. Multiple values within an axis are OR'd;
different axes are AND'd.

**The Status axis starts with four values already selected** — Backlog, Todo, In Progress, In
Review — so the list opens on work in flight rather than on an archive. It reads `Status 4`, and
opening the menu names exactly which four and shows Done and Canceled offered but unticked. That is
the whole mechanism: there is no hidden rule behind the bar, and the masthead count is the filtered
count as it is for any other filter.

To see terminal work, tick Done (or Canceled), or clear the axis the same way you clear any other —
toggle its values off and it admits everything again. Under the default lens the Done and Canceled
groups simply do not render, exactly as an empty group does for any filter; the six-category order
is unchanged. The set is derived by excluding the terminal statuses rather than by listing the live
ones, so a status added to yapm later joins the default instead of quietly disappearing from it.

The **Board** lens starts unfiltered, as the per-lens rule above already promises: its columns *are*
the status axis, and a card dragged into a filtered-out column would vanish under the cursor. So
switching to Board is the second way to see everything.

**Delivery** is the reality-derived axis, and its three predicates evaluate over real linked data:

- **Blocked on review** — an open pull request awaiting a review
- **Failing CI** — linked checks are red
- **Merged, not deployed** — merged, and no successful deployment carried the merge commit

A note on the last one: the deployment join is an **exact commit match**. If your change was merged
and then shipped inside a batched release under a different commit, `Merged, not deployed` will
still list it. That is deliberate — the alternative is claiming a deployment yapm cannot prove
happened. See [Delivery signals](/features/delivery-signals/).

Where no connector is installed, the delivery predicates match nothing rather than being hidden:
the control is honest about having no data instead of pretending it does not exist.

**Search** filters the list by text as you type.

**Group** — Status, Priority, Assignee, Label, Cycle, Project, or no grouping. Group headers carry
the grouping's own mark (the status arc, the priority tick, the label's dot), its label, and the
number of rows in that group **after filtering**.

**Sort** — Priority, Status, Assignee, Last updated, Created, or Number, ascending or descending.
Sorting happens within each group.

**Saved views** save the current filter, grouping and sort under a name, and any team member can
apply one. Two groupings — cycle and project — are not part of the saved-view schema, so saving
while grouped by one of those stores the default grouping instead; the filter and sort are saved
intact. Viewers can apply saved views but not create them.

## The fold

A long result renders one page of rows and then states, plainly, how many matching issues are
**not** on screen: `↓ 109 more`. That number is the real remainder of the filtered set — never a
constant, never an estimate.

A page holds a fixed number of **issues**, not of rows — so when you group by label, an issue that
carries two labels appears under both, and the page draws both rows. The masthead's count always
states the **full** filtered total of issues, so the page never understates how much work matches,
and the fold's number is that total minus the issues on screen. The fold is a real button: move
down from the last row to reach it, press Enter
or Space to render the next page, and focus lands on the first newly revealed row. When everything
matching is on screen, no fold is drawn at all.

The fold does not collapse again. A list that re-hides rows under your cursor is worse than a long
one.

## The keyboard model

Every interaction here is operable without a pointer.

| Key | What it does |
| --- | --- |
| `j` / `↓` | Move down — and, from the last row, onto the fold |
| `k` / `↑` | Move up |
| `x` / `Space` | Toggle selection on the focused row |
| `Enter` / `→` | Open the focused issue |
| `c` | Create an issue |
| `s` | Set status on the focused or selected issues |
| `a` | Assign |
| `l` | Label |
| `p` | Set project |
| `⌘K` / `Ctrl-K` | The command palette, which acts on whatever the list has focused or selected |

The palette is owned by the app frame, not by this page — see [Search](/features/search/). The list
registers its commands with it rather than listening for the shortcut itself, so the same keystroke
means the same thing on every screen.

## Opening an issue

`Enter` opens the focused issue in a side panel, and the URL carries it (`?open=…`) so a reload
lands you back on it. The panel and the full page are **one implementation** of
[the issue detail](/features/issue-detail/): the same description, files, activity, comments,
delivery rail, divergence callout and properties, stacked at the panel's narrower measure instead of
placed in two columns. Nothing is available on one and missing from the other.
