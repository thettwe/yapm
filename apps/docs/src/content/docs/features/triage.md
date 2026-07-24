---
title: Triage
description: An inbox for incoming, unsorted issues, with keyboard-first accept, decline, and route — without adding a seventh status.
---

Triage is an inbox for incoming issues a team has not yet decided what to do with. It is
deliberately **not a seventh status**: yapm's six statuses (Backlog, Todo, In Progress, In
Review, Done, Canceled) are fixed and non-configurable. Instead, triage is an **orthogonal
flag** on an issue — an issue awaiting triage still has a normal status; it is just held out
of the list and board until someone sorts it. Open the inbox at `/teams/<teamId>/triage`, or
use the **Triage** tab in the team header next to **List**, **Board**, and **Cycles**.

## How an issue enters triage

An issue enters the inbox two ways:

- **Flagged** — send an existing issue to triage with **Send to triage** in the command
  palette (⌘K).
- **Created into triage** — an issue can be created with the triage flag already set. This is
  reserved for connectors that ingest externally-created issues (from a linked source) and
  route them straight into the inbox for a human to sort.

While an issue is in triage it is held out of `List`, `Board`, and "assigned to me" — it
lives only in the Triage inbox until it is accepted, declined, or routed.

## The three actions

The inbox is keyboard-first. Move the focus with **j**/**k** (or the arrow keys) and act on the
focused issue:

- **Accept** (**A**) — clear the triage flag and leave the status as-is. The issue becomes a
  normal issue and reappears in the list and board.
- **Decline** (**D**) — clear the flag and set the status to **Canceled**. A rejected incoming
  issue leaves the inbox as a canceled record; it is never deleted.
- **Route** (**R**) — accept *with routing*: a dialog lets you set the status, assignee, cycle,
  and labels, and clears the flag — all in one action. Routing stays within the issue's team.

Each action is optimistic and sub-100ms — the issue leaves the inbox immediately, and the
change syncs in the background. The same actions are available in the command palette (Accept,
Route, Decline, and Send to triage) on the focused or selected issue.

## Viewers

Viewers are free and unlimited and can read the triage inbox like anyone else. They cannot
accept, decline, route, or flag issues — those controls are absent and never written for a
viewer.
