---
title: yapm
description: Open-source project management where issues and delivery truth live in one work graph.
---

yapm is the open-source tool where project management and engineering quality live in one
work graph — free and unlimited on your own server. It is keyboard-first, sub-100ms, and
runs as three containers you own.

## Features

- [Board](/features/board/) — a keyboard-first kanban of your team's issues, grouped into
  the six fixed status columns, at `/teams/<teamId>/board`.
- [Cycles](/features/cycles/) — time-boxed iterations for a team, with automatic rollover of
  unfinished work when a cycle ends, at `/teams/<teamId>/cycles`.
- [Triage](/features/triage/) — an inbox for incoming, unsorted issues with keyboard-first
  accept, decline, and route, at `/teams/<teamId>/triage`.
- [Projects & roadmap](/features/projects/) — lightweight, workspace-level projects with
  computed progress and a keyboard-first roadmap timeline across teams, at
  `/teams/<teamId>/projects` and `/teams/<teamId>/roadmap`.
- [Delivery signals](/features/delivery-signals/) — every issue row shows delivery reality
  (PR state, CI health, review age) derived from linked GitHub activity, with a divergence
  flag when a human status disagrees with git. [Connect GitHub](/self-hosting/github-connector/)
  to turn it on.
- [Cycle digest](/features/cycle-digest/) — a team-internal, evidence-linked AI summary of a
  completed cycle, with a raw-evidence fallback when AI is off. Bring your own key with
  [Enable AI](/self-hosting/ai-setup/).
- [Retrospectives](/features/retrospectives/) — a retro that opens with your cycle's own delivery
  data already gathered, anonymity guaranteed at the storage layer, and actions that become real
  issues in the next cycle, at `/teams/<teamId>/retros`.
- [Notifications](/features/notifications/) — a keyboard-first per-user inbox at `/inbox` for
  assignments and comments on issues you are involved in, with an unread badge and optional batched
  email. No admin, of any role, can read your inbox. Turn mail on with
  [Email delivery](/self-hosting/email/).
- [Mentions](/features/mentions/) — type `@` in a description or comment to pull a teammate in,
  from a list that opens instantly and offline, tells you when a name cannot be reached, and
  subscribes the person you named to the issue — reversibly, from the issue itself.
- [Search](/features/search/) — `⌘K` or `/search`, answered instantly from rows your browser already
  holds and then completed by Postgres full-text over comments and your other teams, in two labelled
  groups that never reorder under your keyboard. Queries are never recorded. Operators: see
  [Search index](/self-hosting/search-index/).
