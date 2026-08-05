---
title: Delivery view
description: The team's flow and delivery metrics over a rolling window of completed cycles — the same numbers a retro shows, computed on the client, team-level only, with an honest list of the DORA keys they are not.
---

The **Delivery view** answers *"did we ship faster and safer lately, and what is blocking review?"*
for a team, over a rolling window rather than inside a single retrospective. It lives at
`/teams/<teamId>/delivery` and is the eighth entry in the view switcher, beside Retros.

These are the same metrics the [retro's data panel](/features/retrospectives/) shows — the same
formulas, the same captions, the same empty states, the same trend sparkline. The only difference is
scope: a retro reads one cycle, this reads several.

## What it shows

Two sections, exactly as the retro panel has them.

**Delivered**, computed from cycles alone and therefore populated on an instance with **no
connectors at all**:

| Metric | Reads |
|---|---|
| Shipped | Issues in scope that finished `done` |
| Carried out | Issues that left the window rather than being dropped |
| Carried in | Issues already in flight when the window opened |
| Carried twice or more | Issues the rollover has moved at least twice |
| Added mid-cycle | Issues that joined a cycle after that cycle started |
| Canceled | Issues canceled in scope |
| In scope | Distinct issues that touched the window, carried work included |

**Flow**, computed from pull requests linked by a
[connector](/self-hosting/github-connector/):

| Metric | Reads |
|---|---|
| PR cycle time | Median hours from pull request open to merge |
| Time to first review | Median hours a change waited for its first review |
| Review rounds | Median reviews submitted per pull request |
| No linked PR | Issues in scope with no pull request attached |
| CI failing | Share of pull requests with a failing check |

Speed and stability sit next to each other on purpose, so neither can be optimised at the other's
expense.

## The window

The window is measured in **completed cycles**, not days. Four of the Delivered metrics are defined
relative to a cycle boundary — "carried out of the last 30 days" is not a thing — so a day-based
window would force them to be dropped or redefined.

- **Sizes are 3, 6 or 12 completed cycles, defaulting to 6.** The choice lives in the URL
  (`?window=6`), so a reading is shareable and the back button behaves.
- **The cycle in progress is excluded.** A half-finished cycle drags every count down and would make
  the trend report a decline that is only the calendar.
- **Twelve is a hard ceiling**, not a UI convention. At a two-week cadence that is roughly six months
  of history. A team asking for more is asking a year-over-year reporting question, which this view
  is not.

Three numbers appear on each tile, and they are three different readings:

- The **value** is the whole window, evaluated once. It is not the sum of the sparkline.
- The **sparkline** is one point per cycle in the window, oldest first.
- The **delta** compares this window against the window immediately before it — "vs. the previous
  6 cycles". It appears only when two full windows of completed cycles exist; comparing a 6-cycle
  window against a 2-cycle one would be arithmetic on incomparable things.

One consequence worth knowing: the window's **Carried out** is smaller than the sum of its
sparkline. A carry from cycle 9 into cycle 10 is a carry out of cycle 9, but it never left the
window. The tile's caption says which reading it is.

## No connector, no cycles

- **A team with no connector** sees Delivered fully populated and Flow as one quiet state naming what
  would light it up. Never zeros, never a hollow chart.
- **A team with no completed cycle** — brand new, or not using cycles — sees a single empty state
  saying so, rather than twelve zeros.
- **Fewer completed cycles than the window asks for**: the window is what exists, the label says so,
  and the delta is dropped.

## Where the numbers come from

Every number is computed **on your own device**, as a pure function over rows the issue list has
already synced. There is no aggregate query, no reporting endpoint, no materialised table and no
server round trip — changing the window re-runs a function over data already in memory, so it is
instant and works offline.

The formulas live in one place (`packages/schema/src/zero/metrics/`) and are shared with the retro
panel, so a metric cannot mean one thing here and another inside a retro.

## Never per-person

Every metric here is **team-level only**, and that is structural rather than a policy this page
keeps. The model the view renders has nowhere to put a person: no assignee, no author, no reviewer,
no creator, no login, at any depth. A per-person breakdown is not something you have to be trusted
not to add — it is not renderable. There is no filter, no drill-down and no tooltip that names
anybody.

This is deliberate. Individual delivery scorecards are the fastest way to make a team optimise the
metric instead of the work.

## What this doesn't show yet

The page carries this list permanently, at its foot, because showing five flow metrics under a
DORA-adjacent heading and saying nothing would imply four keys it does not have.

| DORA key | Status |
|---|---|
| Lead time for changes | **Partial.** PR cycle time is open→merge only. Commit→deploy is not measured. |
| Deployment frequency | **Absent.** Needs durable deploy history, which is being built. Lands here in a later change. |
| Change failure rate | **Absent.** Needs an incident record yapm does not have yet. |
| Time to restore (MTTR) | **Absent.** Same. |
