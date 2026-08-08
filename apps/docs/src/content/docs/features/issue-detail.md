---
title: The issue detail
description: The page top to bottom — the masthead, the two-register subline, the delivery rail, the divergence callout, the honest activity feed — and the four blocks that fold away because nothing in the work graph backs them.
---

The issue detail is the one place in yapm where a fact is stated **twice on purpose**: once in a
sentence a product manager reads, and once in a mono line an engineer reads. Both come from one
computation over rows already synced to your device, so the two registers cannot drift apart, and
neither of them waits on the network.

## The page, top to bottom

### Band 2 — the masthead

Above the title: a breadcrumb back to **Issues**, the issue's key in mono, and — when the board and
git disagree — the **divergence pill**. The pill carries the shared dictionary's own words
("Done in git, not on the board"), never a colour on its own. Right-aligned: **Follow**, and the
primary action, **Mark Done**.

The title is editable in place. A reader who cannot write sees it as a heading rather than a field.

### The two-register subline

Directly under the title, two lines saying the same thing in two voices:

```
◐ In Progress · Cycle 2 · ● feature · Done in git, not on the board
git merged 8f21c4a · PR #188 · drifted 22h            ⟨GitHub⟩
```

The plain line is the status arc, the cycle, the labels, and the phrase from the **shared phrase
dictionary** — the same dictionary the issue list and Team Home speak. The mono line is the git
facts behind that phrase: the merge commit, the change number, the drift. The GitHub mark suffixes
the mono line because those facts are sourced from a provider; yapm's own derivations (a divergence,
a review age, a status position) never wear a brand mark.

When an issue is linked to more than one change, both registers — and the rail, and the callout's
evidence — describe the **same** one: the newest change opened, which is the change the phrase was
computed over. An older merged change is still reported in the activity feed, where it belongs, and
never lends its merge commit to a sentence about a newer one.

Mono sublines live **only here**. Every other surface in yapm speaks in phrases; the detail is the
one work surface where the second register earns its rent.

### The delivery rail

The right column draws the **vertical reality track** — the same node, segment and `//` vocabulary
the list row's compact track uses, at full measure with a sentence and a mono fact per station.

| Station | Drawn when | What its fact line states |
| --- | --- | --- |
| **Idea** | always | when the issue was created, and when it was planned into its cycle |
| **Change opened** | a linked pull request exists | the change number and how long it has been open |
| **Reviewed** | at least one review was submitted | the rounds, and how the exchange ended |
| **Merged** | the change merged | the merge commit, and how the checks landed |
| **Live** / **Not live yet** | the change merged | the deployment that carried the merge commit, or that none did |

A station is drawn **only when a durable timestamp supports it**. A change nobody has reviewed has
no Reviewed station — not an empty one. The header states the chain the rail actually draws
(`idea → built → live`), and shortens when there is less to draw, because a header promising a
station that never appears is the same lie as a menu row that does nothing.

The `//` break falls on the segment the divergence names — for a merge the board never followed,
between **Merged** and **Not live yet**.

### The divergence callout

When the board and git disagree, the rail is followed by a callout carrying the evidence:

```
Done in git, not on the board
Status says In Progress — the change merged 22h ago with every check green.
in-progress set 3d ago ≠ merge 8f21c4a, 22h ago
[ Mark Done ⏎ ]  [ Keep as is esc ]
```

The mono evidence line contrasts **when a human last set the status** against **what git did and
when**. On a row that predates the stored status time, it says which clock it is reading instead —
it never prints a set-time nothing recorded.

- **Mark Done** writes the status through the same mutator the properties block uses. It is offered
  only for a merge the board has not followed: a red check is not repaired by a status, and an issue
  marked in review with no change behind it needs a change, not a click.
- **Keep as is** dismisses the callout **for this reader, for this visit**, and writes nothing. The
  divergence is still true afterwards, so the pill, the `//` break and the phrase at rest all stay
  exactly where they were. There is no "acknowledged" state, and there should not be.

Both are real buttons in the tab order. ⏎ and esc are answered inside the callout's own key scope —
never on the document, because ⌘K and the app frame own that layer. Either action removes the
callout from under your cursor, so focus lands on the **Delivery** section above it rather than
falling back to the top of the page.

A check count is read, never subtracted: a check that has not reported yet is neither a pass nor a
failure, so "1 of 14 failing, 2 still reporting" is three separate facts and the page states them
as three.

### The activity feed

Every entry is a stored timestamp saying what it is: created, planned into a cycle, linked to a
change (naming how — "matched by branch"), change opened, each review, merged, deployed. The rail
and the feed read the **same** derivation, so one moment can never be dated two ways on one page.

### The rest of the page

The description is the document: rich text with autosave, `@` mentions and pasted images. Below it,
**Files**, and the **comment thread** with its composer (⌘↵ to send). The properties block carries
Status, Priority, Assignee, Cycle, Labels and — in the side panel — Updates/Follow.

## The blocks that fold away, and why

The detail deliberately draws **less** than a designer's mock of it would. Four blocks are absent
because nothing in the work graph backs them, and drawing them would mean inventing:

1. **A design stage.** There is no design-artifact entity in yapm, so there is no *Designed* station
   on the rail, no design property, and no mention of design in the rail's header or its accessible
   description.
2. **Status history.** yapm stores *when a human last set a status* — one timestamp — and no history
   at all. So the feed has no "Work started · todo → in progress" entry: that is two claims a single
   scalar cannot make. The same scalar is used where it *is* honest, as one side of the divergence
   evidence.
3. **Backlinks.** There is no issue↔issue link table, no mention edge and no path from an issue to a
   retrospective action. "Referenced in" shows the linked changes and how each was linked, and folds
   away entirely when there are none — no header standing over an empty state.
4. **Pull-request comment counts.** Comments on a change are not synced, so the page never breaks a
   comment count down by where the conversation happened.

Two further limits are stated here because they shape what the page can say:

- **A check has no duration.** yapm stores a check's conclusion and when it was last updated — no
  start and no finish. "Red for 41m" is derivable; "checks took 4m" is not, and nothing on this page
  claims it.
- **There is no review-requested event.** So "waiting on a reviewer since Tuesday" is
  indistinguishable from "this change has been open since Tuesday". The rail says *change opened*
  and dates it; it never says a reviewer has been kept waiting.

## The panel and the page

Opening an issue from the list gives you the same detail in a side panel; the URL carries it
(`?open=…`) so a reload lands you back on it. The panel stacks the sections the full page places in
two columns — it is the same implementation of every section, at a narrower measure, with nothing
missing.

The full page is addressed by the issue's **key**: `/teams/<team>/issues/ENG-116`. The team prefix
is matched case-insensitively against *that team's* key, and a bare number (`…/issues/116`) is
accepted too, which is the form the panel's **Open full view** link emits. Another team's key is not
an address here — `ENG/issues/OPS-116` is not found rather than quietly answering with this team's
116 — and a link you followed before the page finished syncing says *Loading*, never *does not
exist*. Resolving costs one row and its linked change, not the team's whole backlog.

## Keyboard

| Key | Where | What it does |
| --- | --- | --- |
| `⏎` | on the callout | Mark Done |
| `esc` | on the callout | Keep as is — dismiss without writing |
| `⌘↵` | in the comment composer | Post the comment |
| `⌘K` | anywhere | The frame's palette, which this page adds *Mark done* and *Open the change* to |

Every control on the page is reachable and activatable without a pointer.
