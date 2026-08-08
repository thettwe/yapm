---
title: Triage
description: An inbox for incoming, unsorted issues — one queue, one decision at a time, with keyboard-first accept, route, and decline, and without a seventh status.
---

Triage is an inbox for incoming issues a team has not yet decided what to do with. It is
deliberately **not a seventh status**: yapm's six statuses (Backlog, Todo, In Progress, In
Review, Done, Canceled) are fixed and non-configurable. Instead, triage is an **orthogonal
flag** on an issue — an issue awaiting triage still has a normal status; it is just held out
of the list and board until someone sorts it. Open the inbox at `/teams/<teamId>/triage`, or
take the **Triage** stop in [the deck](/features/app-frame/) — `g t`.

The masthead states the page, a mono count of what is waiting, and the ordering — **oldest
first**. It does not repeat the team name: the deck already carries it two stops to the left.
That count is the same number the deck's attention badge, the statusline and
[Team Home](/features/team-home/) state, from one derivation, so they cannot disagree.

## How an issue enters triage

An issue enters the inbox two ways:

- **Flagged** — send an existing issue to triage with **Send to triage** in the command
  palette (⌘K).
- **Created into triage** — an issue can be created with the triage flag already set. This is
  reserved for connectors that ingest externally-created issues (from a linked source) and
  route them straight into the inbox for a human to sort.

While an issue is in triage it is held out of `List`, `Board`, and "assigned to me" — it
lives only in the Triage inbox until it is accepted, declined, or routed.

## The queue

Every waiting issue is shown. There is no fold and no page cap: a queue whose whole purpose is
to be emptied has to show its own floor.

Each row is the **same row the issue list draws**, from the same component, so a triage row and
a list row line up column for column:

| Column | What it states |
| --- | --- |
| Priority tick | The issue's priority, as weight in ticks |
| Status arc | Its status, as position in the cycle |
| Mono key | `ENG-125` |
| Title | The issue's title |
| Phrase slot | Reserved, and empty |
| Reality track | Reserved, and empty |
| Age | The issue's **created-at**, as a plain relative number |
| Labels | Dot + name |
| Avatar | The issue's **reporter** |

Two of those are worth stating plainly.

**The reality track is blank on purpose.** It is where a linked pull request, its checks and its
deployment are drawn — and an issue awaiting triage has no linked change. The slot keeps its
measure so alignment never shifts when a signal arrives, and it lays down no ink.

**The age column claims nothing.** It states when the issue arrived and stops there: no colour
ramp, no overdue mark, no target, no service level. yapm stores no triage SLA and no queue-age
target, so the page does not imply one.

The trailing avatar is the **reporter**, not the assignee, and announces itself as such — an
issue awaiting triage has no meaningful assignee until routing sets one.

## The issue under decision

One waiting issue at a time unfolds, in place and below its own row, into a decision panel
carrying what makes the next decision fast:

- the issue's **own description**, as written — the one document voice on this surface;
- a mono line stating the **reporter** and the **created-at**;
- each **attachment** as an upload chip you can open or download.

On arrival that is the head of the queue — the oldest waiting issue. Moving the keyboard
selection moves the panel with it, so the panel and the verdict keys can never name different
issues. A viewer sees the panel too; only the verdicts are withheld.

**Clicking a row brings it under decision** rather than opening it — on this surface the click
is how a pointer reaches the row it wants to decide about. Opening the issue itself is `⏎`, or
the **Open** control in the panel's own foot.

## The three verdicts

The verdicts are **keys**, each stating its keycap and its word:

- **[A] Accept** — clear the triage flag and leave the status as-is. The issue becomes a normal
  issue and reappears in the list and board.
- **[R] Route** — accept *with placement*. Opens the page's one transient (below).
- **[D] Decline** — clear the flag and set the status to **Canceled**. A rejected incoming issue
  leaves the inbox as a canceled record; it is never deleted.

Each is a real button whose accessible name is the word, so none of them is an icon alone.

### What routing writes

**Route** opens a small labelled panel naming the issue and listing **exactly** the five facts
routing writes, each showing the value it will write (`none` where nothing is set):

| Field | Scope |
| --- | --- |
| Status | Any of the six statuses |
| Assignee | A member of **this** issue's team |
| Cycle | A cycle of **this** issue's team |
| Project | Any project in the workspace |
| Labels | Labels of **this** issue's team — routing **adds**, it never removes |

All five are applied in **one atomic write** that also clears the triage flag. `⏎` commits;
`esc` closes the panel having written nothing and returns focus to the row it opened from —
from anywhere, not only from inside the panel — as does a click on the queue around the issue
under decision. `⌘K` still opens [the command palette](/features/app-frame/) while the panel is
open, but the `g …` go-to grammar is **suppressed** while the panel holds the keyboard, exactly as
it is beside any other focused surface.

**Project** is the one field whose scope is not the issue's team, and deliberately so:
[projects are workspace-level](/features/projects/), so any team's issue can belong to any
project. Routing checks only that the project exists; it never rejects one for belonging to
another team's work. Routing is therefore the second path that sets an issue's project,
alongside **Move to project** in the command palette.

Routing never moves an issue to another **team**. Team reassignment is not part of triage.

## When the queue is empty

A cleared inbox draws the done mark and says **Nothing waiting.**, with an onward foot to
Issues, Cycles and Projects. It does not explain what triage is or what will appear here.

An inbox that has not finished syncing is **not** an empty inbox: until the query completes the
view says it is loading. Both states are announced, so a premature all-clear is never heard.

The empty state makes no claim that the queue was cleared recently, or by anyone in particular —
yapm records no triage event, so there is nothing honest to say about it.

## The keyboard model

| Key | Effect |
| --- | --- |
| `j` / `↓` | Move the decision down one issue |
| `k` / `↑` | Move the decision up one issue |
| `⏎` / `→` | Open the issue |
| `a` | Accept |
| `r` | Route — opens the transient |
| `d` | Decline |
| `esc` | Close the route transient, writing nothing |
| `⌘K` | The command palette, owned by the frame |

Each verdict is optimistic and sub-100ms — the issue leaves the inbox immediately, and the
change syncs in the background. The same verdicts are available in the command palette (Accept,
Route, Decline, and Send to triage) on the focused or selected issue.

## What Triage does not show

Each of these is left undrawn because no stored fact backs it — not because it would be
unwelcome:

| Not shown | Why |
| --- | --- |
| An SLA, queue-age target, overdue mark or age colour ramp | No such target exists anywhere in the product |
| A triage owner or rota | No entity backs either |
| A suggested label or priority | There is no classifier |
| Per-person triage throughput | [Metrics are team-level only](/features/delivery/) |
| A possible-duplicate hint | Issue links are issue → pull request only; there is no issue-to-issue table |
| "Moved to triage at 14:02" | There is no issue status-history table |

## Viewers

Viewers are free and unlimited and can read the triage inbox — including the decision panel's
description, reporter and attachments — like anyone else. They cannot accept, decline, route, or
flag issues: those controls are absent, and the `a`, `r` and `d` keys are inert.
