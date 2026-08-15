---
title: Team Home
description: The team page is a morning digest — an adaptive composition of the cycle's vitals, the exceptions that need a human, what happened overnight, and your own in-flight work, computed on your device from rows already synced.
---

**Team Home** is what `/teams/<teamId>` shows: not a settings screen, not a members roster,
but the page a teammate reads first thing in the morning. It answers *"where is the cycle,
what needs a human, what happened while I was away, and what is mine?"* — and it answers
from **rows your browser has already synced**. The page adds no query, no endpoint and no
table; every number and phrase on it is a pure function (in `packages/schema`) over the same
local data the issue list reads, so it renders instantly and is correct offline.

## The bands, in order

1. **Hero** — the active cycle's key as the title, a day band with one segment per cycle
   day, "Day N of M · ends *weekday*", status words (shipped / in review / and, only when
   non-zero, need attention), a short team narrative, artifact chips, and a vitals column:
   the scope band, a NEXT list, and "N days left".
2. **Needs attention** — the four exception classes, one number (below).
3. **Since yesterday** — a literal trailing 24-hour window (below).
4. **Yours** — your own in-flight work, and only yours (below).
5. **Ready for you** — the active cycle's unassigned, triaged, ready-to-start issues,
   urgent first, each with a *why it's clear* phrase produced by a real predicate (urgent;
   carried in; added mid-cycle; committed at planning). No phrase exists without a predicate.
6. **Ship cadence** — a weekly dot chart of the team's deployments: one dot per deploy that
   actually reached production (the write-once `deployedAt` fact), bucketed by UTC week,
   with month labels, a today caret, a tick at each closed retro, and an onward link to the
   [Delivery view](/features/delivery/) — where the same deployments are drawn along the cycle in
   progress, annotated with the release that went out and the retrospective that closed.
7. **Shipped this cycle** — the cycle's done issues, each badged **Live** when a deployment
   carried its merged pull request's merge commit to production, else **Built — not live**.
   The badge is the same exact merge-commit join the issue row's reality track uses — never
   inferred from status alone.

The page ends with a **composition record** — the rules actually applied to *this* render, never
a rule the code does not execute — carried behind one quiet `how ·` rather than printed, and an
onward footer (Issues · Board · Delivery · Retro · Roadmap, with the ⌘K hint). The doorways are
labels and stay visible; the record is a derivation and folds.

## Empty bands fold away

Every band renders only when it has content. An empty band does not render a header and an
apology — it is simply absent, and the digest stays a complete, honest page even when every
optional band folds:

- Attention count zero → no attention band, and no attention number anywhere on the page.
- Nothing in the last 24 hours → no *Since yesterday* band.
- Nothing unassigned and ready → no *Ready for you* band.
- No deployment has ever reached production → no cadence chart (never a hollow one).
- No active cycle → the hero degrades to the team name with a quiet line and a Cycles
  doorway, and every cycle-dependent band (day band, scope vitals, Shipped, Ready) folds.
- You have nothing in flight → *Yours* renders a single warmth line instead of an empty
  table — with a doorway to the ready work while the *Ready for you* band renders, and
  standing alone on a fully quiet day when that band has folded too (a doorway never points
  at a band that cannot render).

## The four exception classes

*Needs attention* is exactly four classes, each issue assigned to at most one by
precedence, so the count is a distinct-issue count by construction:

| Class | Derived from | Drawn evidence |
|---|---|---|
| Done in git — not on the board | The work-graph divergence (`status_behind_merge`) | The broken reality track with the `//` mark |
| Checks failing | Rolled-up CI health on the linked pull request | The tick-bar, with the failure age |
| Waiting on review over a day | An open, unapproved linked PR whose review age exceeds 24h | The waiting ages |
| New in triage | The team's [triage inbox](/features/triage/) | One dot per waiting issue |

One number is one number, and it is now **app-wide**: the band header, the hero's "need
attention" status word, [the deck's attention badge and the statusline's `N need
attention` segment](/features/app-frame/) all render the same value, from this one
derivation. There is exactly one place in the codebase that computes it. Each class row is a doorway to
the surface where the exception is fixed — the issue itself when the class holds exactly
one, the board or triage view when it holds several.

## Since yesterday

The window is a literal trailing 24 hours ending now — the page does not claim a
"you left Tuesday 6:40p" anchor it does not have. Three cards, folding independently:

- **Overnight** — deployments that went live in the window, naming the done issues whose
  merged pull request's merge commit each deployment carried (falling back to the
  deployment's own repo/environment fact when no issue matches).
- **Your review** — review outcomes submitted in the window on pull requests linked to
  issues assigned to you.
- **Inbox** — a summary of your unread [notifications](/features/notifications/) for this
  team in the window.

Every card carries a provenance line naming its source rows, and every card is a doorway.

## Yours — and never anyone else's

The *Yours* band lists **the signed-in user's** in-flight issues in this team, with the
issue list's row anatomy (status glyph, key, title, reality track) plus a two-line
say/git bifact. Its phrases come from the **shared phrase dictionary** described in
[The reality vocabulary](/features/reality-vocabulary/) — the same dictionary
[the issue list](/features/issue-list/) speaks, keyed by the same classifier over the same
real predicates, rendered here in the **personal** register. The band holds no phrase table
of its own, so the two surfaces cannot drift apart.
Rows waiting on someone else's review collapse into a single
"N of yours are waiting on others" line with the waiting ages.

Two honesty rules are structural here:

- The "No reviews owed" reciprocal line renders **only** when no open pull request linked
  to the team's issues awaits review at all. yapm has no reviewer↔user identity mapping, so
  a per-person "you owe X a review" claim cannot be verified — and a line that cannot be
  verified is not rendered.
- The band never contains another person's work, name, or per-person count. Its **lens
  definition** — assignee you, status before done, ordered by last movement, ending **"your work
  only — never compared"** — sits behind a `how ·` on the band's own header rather than being
  printed under the rows. The guarantee is structural either way: the band holds no other
  person's identity whether the affordance is open or shut. This is the same boundary the
  [Delivery view](/features/delivery/) keeps: personal surfaces show you your own work; team
  surfaces show the team; nothing ranks people.

## The narrative is never filler

The hero narrative is the stored [cycle digest](/features/cycle-digest/) narrative when one
with ready content exists for the active cycle (the "Cycle report" chip appears alongside
it). Otherwise it is a **computed, deterministic fallback of at most two sentences**
assembled only from verified counts — shipped, live, days left, the most severe attention
fact. Opening the page never calls a model, and a quiet day reads as a quiet day rather
than as generated enthusiasm.

## Where members management went

The roster, self-serve join/leave, and the admin rename/archive and roster controls that
used to be the team page now live at `/teams/<teamId>/members`, behind the quiet
**Members ›** doorway in the hero. Every control survived the move unchanged.

## Keyboard-first, like everything else

Every doorway on the digest — exception rows, cards, issue rows, ready rows, chips, onward
links — is focusable in document order, shows a visible focus state, and activates with
Enter. Nothing on the page waits on the network.

## What deliberately isn't here yet

A **Decided this cycle** band, Crit/Verify handoff lanes in *Ready for you*, and last-seen
anchoring for *Since yesterday* all wait on entities yapm does not have (a decision record,
handoff states, a per-user last-seen fact). Per the folding rules they are absent rather
than mocked — and the composition record never mentions them, because it only states rules the
code executed.
