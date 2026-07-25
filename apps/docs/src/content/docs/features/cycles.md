---
title: Cycles
description: Time-boxed iterations for a team, with automatic rollover of unfinished work when a cycle ends.
---

A cycle is a time-boxed iteration for a team — a sprint by another name. Each cycle has a
name, a per-team number, a start and end date, and a status (**Upcoming**, **Active**, or
**Completed**). Issues can belong to a cycle, and the Cycles view shows the current cycle,
its issues, and its progress. Open it at `/teams/<teamId>/cycles`, or use the **Cycles** tab
in the team header next to **List** and **Board**.

## The Cycles view

The left rail lists every cycle for the team, split into **Active**, **Upcoming**, and
**Completed**. Selecting one shows it in the main panel: its date range, a simple progress
bar (how many of its issues have reached **Done** or **Canceled** out of the total), and the
list of issues assigned to it. By default the view features the active cycle, falling back to
the next upcoming one.

## Creating a cycle

Anyone who can write (admins and members — viewers are read-only) can create a cycle with the
**+** button in the Cycles rail: give it a name and a start and end date. New cycles start as
**Upcoming**. A per-team cycle number is assigned by the server, so it is gap-free even when
two people create cycles at once (it appears a moment after the cycle first shows up).

## Automatic rollover

The signature behavior of cycles is **auto-rollover**: when a cycle is completed, its
unfinished issues are not dropped — they move to the next cycle. An issue is *unfinished* if
its status is anything other than **Done** or **Canceled**. The destination is the next open
cycle for the team (the earliest **Upcoming** or **Active** cycle after the one completing);
if there is no such cycle, the issues are simply unassigned from any cycle and stay visible in
the list, never lost.

A cycle is completed in one of two ways, and both do exactly the same rollover:

- **Deliberately** — press **Complete cycle** on the active cycle. Its unfinished issues roll
  forward immediately.
- **Automatically** — a scheduled job on the server promotes cycles whose start date has
  passed to **Active**, and completes cycles whose end date has passed, rolling their
  unfinished work forward. The job runs on the same Postgres the rest of yapm uses (no extra
  service), and it is idempotent: completing an already-completed cycle does nothing, so the
  scheduler and a manual **Complete cycle** can never double-move an issue.

Either way, completing a cycle also opens its [retrospective](/features/retrospectives/) —
already seeded with what the cycle actually delivered. Opening one is idempotent too: the
scheduler and the button can race and still produce exactly one retro.

## Grouping and filtering by cycle in the list

The issue list can **filter by cycle** — pick one or more cycles (or **No cycle**) to narrow
the list to that work — and **group by cycle**, which buckets issues under each cycle with a
**No cycle** group last. Cycle grouping is a view-only convenience; saved views persist the
other groupings.

## Viewers

Viewers are free and unlimited and can read cycles and their progress like anyone else. They
cannot create, complete, or edit cycles, and they cannot assign issues to a cycle — those
actions are hidden and never written for a viewer.
