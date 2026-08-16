---
title: yapm
description: Open-source project management where issues and delivery truth live in one work graph.
---

yapm is the open-source tool where project management and engineering quality live in one
work graph — free and unlimited on your own server. It is keyboard-first, sub-100ms, and
runs as three containers you own.

## Features

- [Team Home](/features/team-home/) — the team page is a morning digest at `/teams/<teamId>`: the
  cycle's vitals, the exceptions that need a human, what happened overnight, and your own in-flight
  work. Every empty band folds away rather than apologising, and the whole page is computed on your
  device from rows already synced.
- [The issue list](/features/issue-list/) — where a team's work lives, at `/teams/<teamId>/issues`.
  Every row with a linked change **draws** what git says about it, and **states** it in words where
  that reality is news — an exception you have to act on. An ordinary row's words move into the
  drawing's accessible name rather than disappearing, and a row with no linked change stays
  genuinely blank. A quiet filter bar, group headers, a fold that states the true remaining count,
  and a complete keyboard model.
- [The issue detail](/features/issue-detail/) — at `/teams/<teamId>/issues/ENG-116`, the one page
  that states a fact twice on purpose: a plain line a product manager reads directly above a mono
  line an engineer reads, a vertical delivery rail, and — when the board and git disagree — a
  callout carrying both clocks as evidence.
- [Board](/features/board/) — a keyboard-first kanban of your team's issues in six fixed status
  columns that all fit the width. A card carries the same facts as a list row in a different shape,
  including the reality track and its `//` break, and a move is **drawn** rather than animated, so
  it reads with a keyboard and with motion off. A **lens on Issues**, not a destination of its own,
  sharing the list's filter bar, at `/teams/<teamId>/board`.
- [Cycles](/features/cycles/) — the register of a team's cycles: one row per cycle with its scope
  ledger and artifacts, the work that carried across a boundary, and automatic rollover of
  unfinished work when a cycle ends, at `/teams/<teamId>/cycles`.
- [Triage](/features/triage/) — an inbox for incoming, unsorted issues with keyboard-first
  accept, decline, and route, at `/teams/<teamId>/triage`.
- [Projects & roadmap](/features/projects/) — workspace-level projects read as a progress
  reading computed from their issues, and a roadmap over a real time axis carrying the team's
  stored cycle boundaries — and no bar, because a project stores no start date. At
  `/teams/<teamId>/projects` and `/teams/<teamId>/roadmap`.
- [The app frame](/features/app-frame/) — every page sits in the same three bands: a 48px deck
  identical everywhere, the page's own masthead, and a 32px statusline. Six destinations, one
  command palette, and one attention number the deck badge, the statusline and Team Home all read.
- [The reality vocabulary](/features/reality-vocabulary/) — one language for PR, CI, review and
  deploy reality wherever it is drawn: four stations joined by segments, a `//` break where the
  board and git disagree, status as a position around the cycle, priority as weight in ticks, and
  phrases at rest from one shared dictionary.
- [Delivery signals](/features/delivery-signals/) — an issue row with a linked change shows
  delivery reality (PR state, CI health, whether a deployment carrying the merge commit succeeded,
  review age) derived from linked GitHub activity, with a divergence break when a human status
  disagrees with git. [Connect GitHub](/self-hosting/github-connector/) to turn it on.
- [Status automation](/features/auto-status/) — opt in, per team, to let a linked pull request drive
  an issue's status: opened moves it to In Review, merged moves it to Done. Off by default, never
  backward, and it changes no existing issue when you enable it.
- [Cycle digest](/features/cycle-digest/) — a team-internal, evidence-linked AI summary of a
  completed cycle, with a raw-evidence fallback when AI is off. Bring your own key with
  [Enable AI](/self-hosting/ai-setup/).
- [Product digest](/features/pm-digest/) — off until an admin turns on all four switches: a
  product-level summary of a completed cycle for named readers outside the team that did the work.
  The team reads it first and releases it themselves, evidence is a plain-text label rather than a
  link, and nobody outside the team can read anything until a human shares it.
- [Retrospectives](/features/retrospectives/) — a retro that opens with your cycle's own delivery
  data already gathered, anonymity guaranteed at the storage layer, and actions that become real
  issues in the next cycle, at `/teams/<teamId>/retros`.
- [Delivery view](/features/delivery/) — the same delivery and flow figures a retro opens with, over
  a rolling window of 3, 6 or 12 completed cycles instead of one, read as a story at
  `/teams/<teamId>/delivery`: an annotated timeline of the cycle in progress, four stat readings each
  with a mini, a delta in words and a `how ·` that unfolds its own derivation, an open→merged
  distribution where one dot is one merged change, a cycle-flow band with carryover ribbons and
  review-rhythm small multiples that name no reviewer. Computed in your browser from rows already
  synced, so changing the window is instant and works offline; team-level only at every depth. It
  closes with one permanent line naming change failure rate, time to restore and deployment frequency
  as a rate as unmeasured, plus the coverage limit that a pull request linked to no issue is
  invisible to it.
- [Retro AI draft](/features/retro-ai-draft/) — opt in, per team, to have the AI draft up to three
  wins, losses and improvements into a retro at the moment the board is revealed, each citing a
  work-graph entity or one of yapm's own computed metrics. It reads no cards, no comments and
  nobody's name, and nothing it drafts becomes the team's conclusion until the team ratifies it —
  members privately agree or disagree, and one verdict per proposal is computed when the retro
  leaves voting. From a team's second retro it also reports whether the improvements the last one
  agreed actually shipped.
- [Notifications](/features/notifications/) — a keyboard-first per-user inbox at `/inbox` for
  assignments and comments on issues you are involved in, with an unread badge and optional batched
  email. No admin, of any role, can read your inbox. Turn mail on with
  [Email delivery](/self-hosting/email/).
- [Mentions](/features/mentions/) — type `@` in a description or comment to pull a teammate in,
  from a list that opens instantly and offline, tells you when a name cannot be reached, and
  subscribes the person you named to the issue — reversibly, from the issue itself.
- [Images, tables & code](/features/rich-text/) — press `/` for an insert menu of blocks, upload an
  image straight into a description, build a table you can Tab through, and write code blocks
  highlighted in your own theme. Every file an issue holds is listed in one Files section.
- [Markdown](/features/markdown/) — type markdown to format, paste markdown in, and copy markdown
  out that reads correctly in a terminal or a chat message. Rich text stays the storage format; an
  in-app copy/paste stays lossless.
- [Search](/features/search/) — `⌘K` or `/search`, answered instantly from rows your browser already
  holds and then completed by Postgres full-text over comments and your other teams, in two labelled
  groups that never reorder under your keyboard. Queries are never recorded. Operators: see
  [Search index](/self-hosting/search-index/).
