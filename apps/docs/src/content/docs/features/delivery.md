---
title: Delivery view
description: The team's delivery story over a rolling window of completed cycles — an annotated timeline, four stat readings, three drawn sections and one honest line about what is not measured. Team-level only, computed on your own device.
---

The **Delivery view** answers *"did we ship faster and safer lately, and what is blocking review?"*
for a team, over a rolling window rather than inside a single retrospective. It lives at
`/teams/<teamId>/delivery` and is one of [the deck](/features/app-frame/)'s destinations — `g d`.

The page is a **journalism cut**: each section leads with a sentence stating what the data says, and
then draws the evidence under it. Nothing on it explains itself at rest — a derived number carries a
quiet mono `how ·` that unfolds its derivation and folds back again.

## The standfirst, and the one binding rule

Under the title:

> Cycle 2 · last 6 completed cycles · team-level only — never a per-person number.

Those are two different scopes, said together because the page uses both. **The timeline is the cycle
in progress**; **every number below it is the completed-cycle window.**

The last clause is the binding rule, and it appears **exactly once in the whole product** — here, on
the one page that could tempt a per-person reading. See [Never per-person](#never-per-person).

## The annotated timeline

The cycle in progress, drawn along its own span. One dot is **one deployment that reached
production** (`deployed_at` is written once, the moment a deployment first succeeded, so its presence
*is* the success test). Every annotation on it is derived — none of it is written by hand:

| Annotation | Derived from |
|---|---|
| The dots | Deployments whose `deployed_at` falls inside the cycle's span |
| The call-out | The **first successful deployment of the ISO week, inside the cycle, that carried the most** — ties break to the earliest week. It names the deployment's `ref` when the row carries one and says "A deployment went out here" when it does not |
| The retro mark | A retrospective that **closed** inside the span, with its title and its close date |
| The retro's subline | The count of deployments before that date and after it |
| `today · day N of M` | The cycle's start and end dates against now |
| `N days left` | The same. A cycle whose end date has passed reads `day M of M · N days over` and `N days over` instead — an overrun is stated, never clamped to "0 days left" |

Two things the design mock drew that this page will **not** say:

- **The agreed action from a retro.** That text lives on a retro action, which carries an assignee —
  an identity column. The mark states the retro's own title and close date instead.
- **"the dots have been denser since".** That is a causal claim about a retrospective's effect, and
  yapm does not get to make it. The subline states the two counts and the date, with no verb joining
  them, and the timeline's `how ·` says so in as many words.

## The four stat readings

Across the full measure, hairline-separated, each with its number, its delta in words, a small drawn
mini and its own `how ·`:

| Reading | Reads | Its `how ·` also carries |
|---|---|---|
| **Shipped** | Issues in scope that finished `done` | *In scope* and *canceled* — what the shipped count is a count **of** |
| **Open to merged** | Median hours from pull request open to merge | The population and the rule that one change is counted once |
| **Checks failing** | Share of changes carrying at least one check that had a failing one | That a change with **no** checks at all is not in the denominator |
| **Not linked to a change** | Issues in scope with no linked pull request | That the change may exist and simply not be linked |

The delta compares this window against the window immediately before it, and it states its direction
**in words** ("down 22h against the previous 6 cycles — better"). The glyph and the colour are
reinforcement, never the carrier.

## Open to merged

> *Half of the last 26 changes merged inside 46 hours — two waited 208h or more.*

One dot is **one merged pull request**, on a linear axis from zero to the slowest change observed.
The median is drawn **where it falls**, at its own position on that axis, rather than quoted from a
summary — it is the same number the Open to merged reading states, read from the same field.

A change linked to two issues in scope is **one dot and one contribution to the median**, not two.

The axis is linear and the giants are included. That compresses the crowd into the left of the axis,
which *is* the reading — and it is why the outlier annotation exists and states the count and the
slowest observed wait in words. No log axis, no clipped axis, no "other" bucket: each would hide the
shape the section exists to show. A change is called an outlier when it took **four times the median
or longer**, which is a stated rule over the data rather than a hand-picked pair of dots. The rule is
read against the median's *exact* value, not the rounded figure the sentence quotes — a team whose
median change merges in two minutes rounds to `0h`, and four times zero would make every change a
giant. Only an *exact* median of zero states nothing and calls nothing out.

A median that merely **rounds** to `0h` still has giants, and they are still named. What changes is
the figure the page quotes: the sentence, the median label and the crowd note all state that median
in **minutes** instead, because "merged inside 0 hours" is a threshold none of the changes it counts
satisfies. The giants are named the same way in both places — the sentence above the drawing and the
note beside them state the **same absolute wait** ("two waited 208h or more"), never a multiple in
one place and an absolute in the other.

## Cycle flow

> *Carryover is shrinking — 1 item carried from Cycle 11 into Cycle 12, where 3 carried from Cycle
> 10 into Cycle 11.*

One bar is **one completed cycle**, showing what it shipped. A **ribbon** between two bars is work
the rollover carried from one of those cycles into the next, carrying its count. A **cap** on a bar
is work added after that cycle had started.

The sentence compares **consecutive cycles** and names them. A cycle that carried nothing counts as
a zero rather than being skipped, so "shrinking" never means a comparison against whichever cycle
last happened to carry something; and the newest comparable carry is the one out of the
second-to-last cycle in the window, because the last cycle's carry left the window and has no bar to
reach.

A carry that left the window has no second bar to reach, so it draws no ribbon — that count, and the
work that carried in from before the window, are stated in the section's `how ·` instead. So is
*carried twice or more*, which also enters the sentence above the drawing when it is not zero.

## Review rhythm

> *A first review arrived a median of 5h after a change opened, and reviews came back a median of 2
> times per change.*

Small multiples, one per merged change. One row is **one merged pull request**, from where it opened,
through the wait before a first review came back, each review after that, to where it merged. The
newest 24 changes are drawn and the section says how many of how many.

A change that ran past the 96-hour axis **states its own duration in text** rather than being clipped
into a shorter one.

**No reviewer appears anywhere**, at any depth. `review.author` is a provider login with no mapping
to a yapm user, and the model this section renders has no field that could carry one.

## The peek

One chip sits on the timeline: the issue whose change is **done in git but not on the board**, at the
moment its change merged. The chip is the newest such change *the timeline can hold* — one whose
merge falls inside the cycle in progress — so a change that merged outside that span never suppresses
the chip for one that fits. Focus or hover it and a peek answers *what is this?* — the issue's own
phrase from the [shared dictionary](/features/reality-vocabulary/), its reality track, and how many
changes are in that class. `⏎` opens the issue (the chip is a real link, so that is the browser's own
activation); `esc` closes the peek and returns focus without going anywhere.

At most one peek is ever open on a page, and this is the page in the product that draws one.

## The window

The window is measured in **completed cycles**, not days. Four of the Delivered metrics are defined
relative to a cycle boundary — "carried out of the last 30 days" is not a thing — so a day-based
window would force them to be dropped or redefined.

- **Sizes are 3, 6 or 12 completed cycles, defaulting to 6.** The choice lives in the URL
  (`?window=6`), so a reading is shareable and the back button behaves.
- **The cycle in progress is excluded from the numbers.** A half-finished cycle drags every count
  down and would make the trend report a decline that is only the calendar. It is drawn on the
  timeline, which is the one part of the page scoped to it.
- **Twelve is a hard ceiling**, not a UI convention. At a two-week cadence that is roughly six months
  of history. A team asking for more is asking a year-over-year reporting question, which this view
  is not.

The value is the whole window evaluated once — it is **not** the sum of the mini beside it, which is
one point per cycle, oldest first. The delta appears only when two full windows of completed cycles
exist; comparing a 6-cycle window against a 2-cycle one would be arithmetic on incomparable things.

One consequence worth knowing: the window's carried-out count is smaller than the sum of its
per-cycle carries. A carry from cycle 9 into cycle 10 is a carry out of cycle 9, but it never left
the window. *Carried twice or more* is deliberately not scoped that way: it counts a repeat rollover
out of *any* cycle in the window, whether or not the issue then left it.

## Blank means blank

Where a section has no data it renders **nothing at all** — not a heading, not an axis, not a zero.
An empty chart is a claim that there is a shape to see.

- **No cycle in progress** → no timeline, and no peek chip on it.
- **No merged change in the window** → no *Open to merged*, no *Review rhythm*.
- **No completed cycle at all** — brand new, or not using cycles — → one empty state saying so,
  rather than a board of zeros.
- **Fewer completed cycles than the window asks for**: the window is what exists, the standfirst says
  so, and the delta is dropped.

## Where the numbers come from

Every number is computed **on your own device**, as a pure function over rows the app has already
synced — the team's cycles, its issues with their linked delivery subtree, its deployments and its
retrospectives. There is no aggregate query, no reporting endpoint, no materialised table and no
server round trip: changing the window re-runs a function over data already in memory, so it is
instant and works offline.

The formulas live in one place (`packages/schema/src/zero/metrics/`) and are shared with the
[retro's data panel](/features/retrospectives/), so a metric cannot mean one thing here and another
inside a retro. The whole page is one model built in that same package, so what the page states is
testable as data rather than as rendered HTML.

## Never per-person

Every metric here is **team-level only**, and that is structural rather than a policy this page
keeps. The model the view renders has nowhere to put a person: no assignee, no author, no reviewer,
no creator, no login, at any depth. A per-person breakdown is not something you have to be trusted
not to add — it is not renderable. There is no filter, no drill-down and no tooltip that names
anybody.

This is deliberate. Individual delivery scorecards are the fastest way to make a team optimise the
metric instead of the work.

## Readable without the colour, and without a mouse

Every drawing on this page carries a label that states, in words, **the population it drew and what
one mark represents** — "5 merged changes by hours from open to merged… one dot is one merged pull
request; median 46 hours". A screen reader gets the same reading a sighted reader gets, and the label
is the model's own sentence rather than something the drawing composed for itself.

No fact is carried by colour alone. A slow change is a **hollow ring** as well as a warmer one, and
the outlier note states its count in words. Work added after a cycle started is an **outlined cap
separated from the shipped bar** rather than a second colour stacked on it — the amber measures as
little as 1.31 against the shipped green in some themes, so a flush stack would read as one taller
bar of shipped work. A delta says "up", "down" or "no change" before any arrow or tint does.

Everything is reachable from the keyboard: each `how ·` is a button that opens and folds, `esc`
closing it and returning focus to it; the peek opens on focus alone and `esc` closes it without
navigating; the window is a native select. `⌘K` belongs to the frame, and this page registers its
commands with it.

## What this doesn't show yet

The page carries one line about this at its foot, permanently, with a `more ·` that unfolds the rest.
It is not dismissible.

| Not measured | Why |
|---|---|
| **Change failure rate** | Needs an incident record yapm does not have |
| **Time to restore (MTTR)** | Same |
| **Deployment frequency as a rate** | Deployments are drawn here as they happened, not normalised into a rate |

And one coverage limit that has always been true and is now stated: **a pull request reaches this
page only through an issue.** A change linked to no issue is invisible in every reading and every
drawing here.

What is **not** on that list is `merged → live`. Whether a merged change reached production *is*
derived — its merge commit against a deployment's — and it is stated per change on the
[issue's delivery rail](/features/issue-detail/), where it belongs to one change rather than to a
team-level average.
