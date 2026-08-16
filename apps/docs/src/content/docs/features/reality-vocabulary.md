---
title: The reality vocabulary
description: How yapm draws delivery reality — the track and its stations, the divergence break, status as cycle position, priority as weight, the peek, the how, and the provenance mark.
---

yapm draws the same things the same way everywhere. An issue row, a board card, an issue page, the
team's morning digest and the Delivery view all render delivery reality with **one vocabulary**: a
track of nodes,
a `//` break where the board and git disagree, an arc for status, ticks for priority. Learning it on
one surface means you already know it on the next.

This page is the reference for what each mark means. What the marks are *derived from* — how a PR
links to an issue, what counts as deployed — lives in
[Delivery signals](/features/delivery-signals/).

## The track

Delivery is drawn as a **track**: four stations, joined by segments, read left to right.

| Station | What it says |
| --- | --- |
| **Change** | A pull request exists, and where it is: draft → open → approved → merged → closed |
| **Checks** | CI health rolled up over the linked checks |
| **Review** | Whether the change has been reviewed |
| **Live** | Whether a deployment carrying this change's merge commit succeeded |

Each station is a node, and **every** distinction it carries is carried by the node's form, not by
hue:

- a **filled disc** — the station has been reached,
- a **half-filled disc** — reality is standing here right now,
- an **outline ring** — waiting here (a draft PR, checks still running, a review not back),
- a **filled square** — it broke here,
- a **dashed outline ring** — not reached yet,
- an **outline square** — not reached, and something is wrong: the station just past a `//` break.

So a change that is **approved but not merged** draws the half-filled disc at Change and the filled
disc at Review, where a merged one fills both — the pair of stations tells them apart with no phrase
and no hue. The six forms are tabulated with what each is drawn from under
[Accessibility](#accessibility); colour reinforces every one of them and carries none of them alone.

The track states its facts in words as well as marks, so nothing it says is said only by the drawing:
the accessible label reads "PR open, CI passing" or "PR merged, CI passing".

The segments between the stations carry the same reading: solid where the work has run through,
dotted where it has not.

A pull request **closed without merging** leaves the Change station empty — the change never
landed, and there is no fifth shape for "started and stopped". The fact is not lost: the track's
accessible label says "PR closed". An issue with no pull request at all has no fact to state, and
draws and announces nothing — see below.

An issue with **no linked activity at all** draws nothing in its track slot. The slot is still
there, at exactly the width a populated track occupies, so connecting GitHub never shifts a row —
but until there is a fact, no ink is laid down. On a list where most issues have no linked change,
that keeps delivery ink on the rows that have delivery, instead of repeating the same placeholder
sixty times. Because such a slot states nothing, it states nothing to a screen reader either: it is
not announced as an image and carries no label. A track that draws **any** fact is one image to a
screen reader, labelled with the facts it actually draws ("PR merged, CI passing, Deployed").

The same rule holds off the track. A retro card that has received **no dots** draws no count, no
pip and no retract control during `vote` — its slot keeps its measure so the column does not shift
as dots land, and the control that casts the first dot is still there. A mono `0` beside five hollow
pips would be reality ink on a quiet row: it reads as "measured, and none" where the truth is
"nobody has voted yet".

The **vertical rail** is the deliberate exception. The issue page's subject *is* the change, so an
issue with no linked change keeps an explicit station saying so rather than showing a blank rail.

Where the **review age** is written depends on how much room the surface has. On a dense list row
there is no room for words, so it sits beside the stations in a mono column reserved whether or not
there is anything to put in it — "3d", "2h", "now" — and a row with nothing to say still holds
exactly the space a row with an age takes. The team digest's rows state the age in words beside the
track instead, and the issue page states it in its own two registers ("In review — waiting 16h");
neither draws an age column. The board card draws the column exactly as a list row does: a card's
accessible name suppresses everything inside it, so an age living only in a phrase would reach
nobody who is looking at the card.

### The same track, on its side

Where a surface has room for words rather than only for marks, the same track is drawn **vertically
as a rail**: the same stations, top to bottom, each with a sentence and a mono line of the evidence
under it. It is one shape on two axes, not two vocabularies — so a break in a dense row and a break
in a rail mean exactly the same thing.

The rail's consumer is [the issue detail](/features/issue-detail/), and it differs from the dense
track in one way: a row's track always draws the same four facts, while a rail draws **one station
per moment that actually happened**. A change nobody has reviewed has no Reviewed station, not an
empty one, and the rail's header names only the chain it drew. Which connector each station earns,
and which segment the `//` falls on, still come from this one vocabulary — the surface names its
stations, and the vocabulary decides how they are drawn.

## The `//` break

Where the board and git disagree, the track does not continue: it **breaks**, with a mono `//` at
the point of disagreement. Which segment breaks says which disagreement fired:

| The disagreement | Where the track breaks |
| --- | --- |
| The board ran ahead of the pull request — an in-review issue whose only PR is a draft | On the first segment |
| Done, but CI is failing | On the segment leaving Checks |
| The PR merged, but the issue is not done or canceled | On the last segment |

The station just past the break wears an urgent ring, so the break reads as a stop rather than a
gap. The mark draws attention; the words carry the meaning — and where the words go depends on how
much room the surface has. On an issue page and on the team digest's rows the sentence is written
out beside the break. On a dense list row there is no room for it, so the break stands alone and the
sentence is carried in the track's accessible label, which reads, for example, "PR merged, CI
passing, PR merged but this issue is not marked done".

Earlier versions of yapm drew this as a warning triangle beside the row. It is now part of the
track, because a disagreement is a fact about the *path* the work took, and belongs on the drawing
of that path.

## What the track can and cannot say

The track shows exactly four facts — PR state, CI health, review age, and the deploy join — and
never invents a fifth. Two limits are worth knowing, because yapm will not paper over either:

- **Checks have no duration.** GitHub gives yapm a check's conclusion and when it last changed, not
  when it started and finished. So "red for 41 minutes" is a fact yapm can state; "checks took 4
  minutes" is not, and no surface claims it.
- **There is no "review requested" event.** yapm can see reviews that happened, not reviews that
  were asked for. Review age is therefore the time since the newest review, or, before any review,
  how long the PR has been open — never "waiting on a reviewer since Tuesday", which the data cannot
  distinguish from "open since Tuesday". The two clocks are the same number and not the same fact,
  so they are never announced in the same words: a reviewed change reads "reviewed 3d ago", one
  nobody has looked at reads "unreviewed for 3d".

## Status is cycle position

The status glyph is **one loop, filled as far as the work has run**:

| Status | Glyph |
| --- | --- |
| Backlog | A dashed ring — nothing has started |
| Todo | An open ring |
| In progress | A half arc |
| In review | A three-quarter arc |
| Done | A filled disc carrying a check |
| Canceled | An open ring with a cross through it |

Because the glyphs differ by how much of the loop is drawn, they are distinguishable without
relying on color — and they read as *progress around a cycle*, which is what a status is.

## Priority is weight

Priority is drawn as **ticks of rising height**. All three ticks are always in place — the ones the
work does not carry stay faint — so weight reads as height against a fixed row rather than as a
count of shapes you have to make. Low lights one tick, medium two, high three, and an issue with no
priority lights none.

Urgent is the exception that proves it is a different claim rather than more of high: **a single
tick standing alone**, with a dot beneath it. It is deliberately not a fourth tick.

## The peek

**Anything with a dotted underline opens something.** Hovering it — or reaching it with the keyboard
— opens a **peek**: a small elevated panel answering "what is this?" without leaving the page.

- **⏎ goes to the thing.** The trigger is still the link it always was, so Enter navigates.
- **esc stays.** Escape closes the peek and puts focus back where it was.
- **At most one peek is open at a time**, anywhere on the page. This is enforced by construction,
  not by convention, so peeks can never stack up as you sweep across a list.

A peek is transient, so it is the one kind of surface in yapm allowed to lift off the page with a
shadow. Everything else stays flat.

Among the product's own surfaces, the [Delivery view](/features/delivery/) is the one that draws a
peek: the chip on its timeline is the issue that is done in git but not on the board, and the panel
answers what it is in the dictionary's own words.

## The how

A derived number never explains itself at rest. Beside it sits a quiet mono **`how ·`**. Open it —
by click or by Enter, never by hover, because a derivation is read rather than glanced at — and it
tells you exactly how the number was computed and within what constraints. Close it, and the surface
returns to quiet. Facts stay; footnotes fold.

Escape closes it and returns focus to the affordance, and tabbing away closes it too. The panel is
not merely hidden while it is closed — it does not exist in the page at all, so the derivation is
absent for a screen-reader user exactly as it is for a sighted one. The trigger says which
derivation it holds ("How the counting rule is derived"), so the fold is discoverable without sight
and without a pointer.

The rule binds **every** surface, not just the page it was first written for: wherever an
explanation of a derived fact exists, it lives behind exactly one `how ·` and nowhere else at rest.
The obligation runs one way only — a surface is not required to attach a `how ·` to every number it
draws. A count nobody explains needs no affordance; adding one to every mono figure would be chrome,
not relief. And a derivation is never drawn *beside* the affordance built to hold it.

### What folds, and what never does

`how ·` explains **derivations**. It is not a drawer for everything a page says.

**A query definition folds** — a statement of the rows a surface counted, the scope it counted them
over, or the clauses of the lens it applied. Projects' `counted over the issues in your teams`,
Home's YOURS lens, Home's composition record: each is identically true of every render, and a reader
who has read it once does not need it printed again every morning.

**Five kinds of sentence stay at rest**, because the fold removes text from the page for every
reader — which is right for a scoping clause and wrong for these:

- **A refusal.** *"a cycle keeps no status history, so nothing here burns down."* A refusal is not
  the derivation of anything drawn; it is the reason something is **absent**. A reader who never
  opened the fold would conclude the absence was an oversight rather than a choice — the exact
  inversion of the honesty a refusal exists to serve. A refusal may carry its own `how ·` for the
  derivation it refused, which is the correct division.
- **A binding product promise another capability mandates at rest** — the Delivery view's
  *team-level only — never a per-person number*, which appears once in the whole application.
  Folding it would contradict that requirement rather than amend it.
- **A derived section standfirst** — one sentence saying what the data says, evidenced by the
  drawing beneath it. A standfirst states the *reading*; the *method* belongs in that section's
  `how ·`.
- **A live-session instruction** — a line telling a participant the rule of the action they are
  taking right now, on a surface whose phase changes what is permitted. Someone who must open a fold
  to learn their cards stay private until the room moves on learns it after they have typed.
- **An empty state's single quiet line.** There is no drawn fact to hang an affordance on, and the
  line is the surface's only content. That line does not render once the surface has rows.

The [Delivery view](/features/delivery/) is where this pattern earns its keep: every derived number
on that page carries a `how ·`, and the prose it keeps at rest is only what this rule exempts — the
promise it is required to make, the refusal it is right to state, and each section's derived
standfirst.

## The provenance mark

yapm's own glyphs carry **meaning**. A brand mark carries **provenance** — where a fact came from —
and nothing else. So a provider's mark is:

- **monochrome**, drawn in the current text color, never in the provider's brand color,
- **12–14px**, never larger than the text beside it,
- placed **after** the fact it sourced, never in place of a status arc or a track node.

GitHub's mark appears after facts sourced from GitHub, and today it is the only mark yapm draws —
GitHub is the only connector, so it is the only provenance there is to name. **An uploaded file
carries no mark**: there is no provider behind it.

Which phrases carry a mark is a property of the **dictionary entry** below, not a decision each
screen makes, so two screens showing the same fact cannot disagree about where it came from.

## Phrases at rest

The vocabulary is not only drawn. A row, a digest line and a rail also state delivery reality **in
words**, and those words come from **one shared dictionary** living beside the delivery-signal
derivation — never inside a screen's own module.

The dictionary is keyed by a classifier over **real predicates only**: the delivery signal and the
divergence computation. There is no phrase a stored fact cannot support, and a classification with
nothing behind it resolves to silence rather than to an invented sentence.

One key can be spoken in more than one **register**. A register is a voice *and* a policy about when
that voice speaks:

| The facts | Neutral (issue detail, Cycles, Delivery's peek) | News (the list, a project's page, the board) | Personal ([Team Home](/features/team-home/)'s YOURS) |
| --- | --- | --- | --- |
| A merged PR under an issue that is not done | Done in git, not on the board | Done in git, not on the board | Done in git — update the board |
| Linked checks are failing | Checks failing | Checks failing | Checks failing — the fix is yours |
| Merged, nothing deployed the commit | Built — not live yet | *quiet* — Built — not live yet | Merged — not live yet |
| A PR approved and waiting | Approved | *quiet* — Approved | Approved — merge when ready |
| Nothing has happened yet | *(silence)* | *(silence)* | In progress |

Every register is **total** over the key set — a key that exists in one exists in every one — and it
resolves each key to exactly one of three states:

- **drawn** — the register has words and the screen renders them.
- **quiet** — the register has words and the screen does *not* render them, because the drawing
  beside them already carries the same fact. The words still exist, and the **accessible name of
  that drawing states them**, in exactly the text the register would have drawn. Quiet is a
  redistribution, never a deletion.
- **silent** — the register has nothing true to add. Nothing is drawn and nothing is spoken, because
  there is nothing to say.

A register may only resolve a key to quiet where the drawing beside it tells that key apart from
every other key it quiets or silences. Where the drawing cannot — a review that came back looks
exactly like one nobody has read — the register draws the words instead. Which state a key takes is
a property of the dictionary **entry**, never a decision a screen makes, so two screens speaking one
register cannot disagree about whether a fact is worth saying.

A phrase is always real text — drawn, or spoken by the drawing that replaced it — never an icon
standing in for one, so it is readable by assistive technology and by a reader who cannot tell the
drawing's hues apart. Where each phrase appears in context is documented on
[The issue list](/features/issue-list/).

## Accessibility

Every mark in this vocabulary is drawn from theme tokens and holds its contrast bar in all three
presets in both light and dark: the 3:1 non-text bar for the drawn nodes and segments, and the 4.5:1
text bar for the `//` break and the rail's mono fact lines — on a plain row, a hovered row, a
selected row and the digest's divergence row alike.

State is never carried by color alone: the track's nodes differ by shape, the status glyphs by how
much of the loop is drawn, and priority by how many ticks stand. The peek and the how are both fully
operable from the keyboard and both announce their open state; neither traps focus.

The horizontal track's six node kinds are told apart **without colour**, and the six forms are
declared as values the drawing is composed from rather than left to six hand-written rules:

| Node | Form |
| --- | --- |
| Reached | a filled disc |
| Reality is here now | a half-filled disc |
| Waiting here | an outline ring |
| It broke here | a filled square |
| Not reached | a dashed outline ring — the dotted segment's grammar, at a node's scale |
| Not reached, and something is wrong | an outline square, in the broken station's family |

For any two kinds at least one non-colour channel differs — fill, form or stroke style — so a reader
who cannot separate the hues can still name every station. Colour reinforces those distinctions; it
never carries one alone. The **vertical rail is excluded**: each of its stations carries a label line
and a mono fact line in text, so nobody tells its nodes apart by eye.

A track that draws at least one fact is one labelled image whose name states the facts it draws, the
divergence sentence when the break is present, and — where the screen's register went quiet — that
register's words, first. A track that draws no ink is not exposed as an image at all. And a phrase
drawn in visible text beside a track is never repeated in that track's name: it is announced once.
