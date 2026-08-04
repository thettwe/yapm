---
title: Retrospectives
description: A data-seeded retro whose gather-data phase is already filled in from your cycles, with anonymity guaranteed at the storage layer and actions that become real issues.
---

A **retrospective** is the surface where a team decides what to change. Every other retro tool
opens by asking the team what happened; yapm already knows. The cycle just closed, and yapm holds
the issues, the carries, the pull requests, and the CI runs behind them — so the retro starts from
the team's own delivery data instead of from whoever remembers the most.

The board itself is deliberately small: columns, cards, clusters, dots, actions. The two things
that make it worth opening are the **data panel** that seeds the conversation and the
**action → issue loop** that closes it.

A retro lives at `/teams/<teamId>/retros`, and one opens whenever a cycle completes — whether you
pressed **Complete cycle** yourself or the [scheduled rollover](/features/cycles/) closed it for
you. Both go through the same mutator, which is a no-op when the cycle already has a retro, so the
two can race and still produce exactly one. Any completed cycle that somehow has no retro — one
closed before you upgraded, say — offers **Open a retrospective** in the [Cycles](/features/cycles/)
view, and a completed cycle that has one links straight to it.

## Phases

A retro moves through six phases, in order:

`brainstorm` → `group` → `vote` → `discuss` → `actions` → `closed`

Each phase decides what the retro accepts. Drafts can only be written in `brainstorm`, cards can
only be moved and clustered in `group`, dots can only be spent in `vote`, and actions can only be
written in `discuss` and `actions`. A `closed` retro is read-only. That matrix is enforced by the
server when a write is applied, not by the buttons you see — so a write that races a phase change
is rejected rather than half-applied, and the buttons simply ask the same question the server does.

Phase changes are **adjacent-only**: exactly one step forward or exactly one step back. There is no
skip-to-closed and no rewind-to-brainstorm, because publishing and voting both depend on the retro
having passed through the phases in order.

Only the **facilitator** or a **workspace admin** changes phase, sets the format, turns anonymity
on, or sets the dot budget. A facilitator is never assigned for you — an auto-opened retro has none,
since the scheduler is not a person. Whoever is running the session claims the seat with **Run this
retro** in the header or the same entry in the command palette, and can hand it off later.

Four starter formats are available, chosen from the header (or the palette) while the retro is still
empty: Went well / Didn't / Actions (the default), Start / Stop / Continue, Mad / Sad / Glad, and
4Ls. Changing the format replaces the columns, so it is refused once anyone has written anything —
including a draft you cannot see, in which case the swap is rolled back and the header says why.

The format, anonymity and the dot budget are all **settings of an empty retro**. They are open while
the retro is in `brainstorm` *and* has no cards; stepping a retro back into `brainstorm` after cards
are published does not re-open them, because by then there is something to re-column and something
to attribute.

## Anonymity

Anonymity in yapm is a property of **where the data is stored**, not of what the interface chooses
to render.

Zero syncs whole rows and has no column-level read permission, so an `author_id` column on a synced
card would sit in every participant's browser regardless of what the UI drew. So the binding from a
card to its author lives in a **server-only table that the sync schema cannot name**. No synced
query can reference it, because it does not exist in the schema those queries are written against —
the leak is structurally unavailable rather than merely unwritten, and a test asserts the table
stays out of the sync schema.

The rest follows from that:

- **An anonymous card's synced row carries no author value at all.** There is no field to strip and
  nothing to accidentally render. In an attributed (non-anonymous) retro the author is written onto
  the card deliberately, and shown.
- **Your drafts sync only to you.** During `brainstorm` your cards are private drafts in their own
  table, filtered to your own user id — with **no workspace-admin bypass**, deliberately unlike the
  rest of the app's team-scoped reads. Nobody receives another person's draft, so nobody can learn
  its author. When the facilitator advances out of `brainstorm`, every draft is published to the
  board at once.
- **Your votes sync only to you.** Everyone sees the per-target tally; who cast which dot reaches
  nobody but the voter.
- **A published card's body is not editable by anyone**, because there is no client-visible owner to
  authorize an edit against. Your own draft is retained as your personal record, and it is what lets
  you retract your own card: hold the draft, and you may delete the published card — which is why a
  remove control appears only on your own cards. A facilitator or admin may also delete any card as
  moderation, which the server checks against the server-only author table.
- **Reveal-on-close is not offered.** No code path copies an anonymous card's author onto anything
  that syncs.

Anonymity is set while the retro is in `brainstorm` — before a single card exists — and is fixed
after that. A retro's anonymity is therefore decided before there is anything to attribute, and
stepping the retro back into `brainstorm` later does not reopen the question.

### What the server stores

Being precise about the boundary matters more than a bigger promise. The guarantee has two halves,
and both are worth stating plainly.

**Anonymous to every client, permanently and structurally.** The author is never synced, because the
card → author table is absent from the Zero schema. A query cannot name a table that schema does not
contain, so there is no query — present or future — that can return it, and no browser holds it.
That half is not a policy the code follows; it is a shape the code cannot escape.

**Stored server-side, all the same.** yapm **does** record which account wrote each card, so that
moderation and retraction can be authorized and so the record is auditable. Two components hold it:
your Postgres database, and `zero-cache`'s internal replica — Zero replicates with Postgres's default
`for tables in schema public` publication, so the row is copied there along with every other table
whether or not it is in the sync schema. That replica is a trusted component of your own
three-container deployment — the same boundary the encrypted
[connector secrets](/self-hosting/github-connector/) already sit behind.

What that means in practice: **no participant, workspace admin included, can learn who wrote an
anonymous card through the product.** Someone with direct access to your database can, because they
have direct access to your database. On a self-hosted instance, that is the operator — you.

## Dots

Voting is dot voting. Each participant gets a budget — **three** by default, settable from one to
ten in the header (or the palette) while the retro is still empty — and may **stack** them: two dots on the thing you
care most about is a legitimate use of the budget, not a bug. The header reads `2/3 dots left`
throughout the `vote` phase.

A dot goes on a card or on a **cluster**, never on a card inside one — a cluster votes as a unit, so
a dot on a member card would count twice. A clustered card therefore shows no pip of its own, and
pressing `v` while it is focused puts your dot on its cluster rather than refusing the keystroke.

The budget is enforced by the **server**, not by the button being disabled: casts in one retro are
serialised as they are applied, so you cannot spend four dots out of three by being fast in two
tabs. If a cast is refused after the fact, the optimistic dot is rolled back. Dots also come back
to you automatically whenever their target stops being votable — deleting a card you voted on,
dissolving a cluster, or (if the facilitator steps back to `group`) folding a voted-on card into a
cluster all refund those dots to spend again, rather than leaving them stranded against your budget.

## The data panel

Above the columns sits the seed: what actually happened last cycle, computed from your own work
graph. It is not a report to read out — each figure offers **add a card from this**, which opens the
column composer with the figure attached, so the conversation starts from evidence.

**Delivered** is always populated, from cycles alone, on an instance with **no connectors at all**:
shipped, carried out, carried in, carried twice or more, added mid-cycle, canceled, and total in
scope. Each is a trend against up to three prior cycles, with a plain-language caption.

**Flow** needs a connector. With [GitHub connected](/self-hosting/github-connector/) it shows median
PR cycle time, median time to first review, review rounds, issues with no linked pull request, and
the CI failing rate — speed and stability side by side, deliberately, so neither is traded for the
other. Without a connector the section shows one quiet empty state naming exactly what would light
it up, rather than a wall of zeros or an empty chart.

**Health** — DORA, MTTR — is **not produced at all** today. It is a later phase, and the panel has
no placeholder for it.

Three rules hold everywhere in the panel:

- **Trends lead, and direction is words, never color.** A figure reads "+2 vs. last cycle" or "no
  change"; nothing in the panel encodes better-or-worse in hue. A metric with no better direction —
  carried in, canceled, in scope — reports movement with no judgement at all. Fewer than two data
  points says "no history" rather than drawing a lonely dot.
- **Nothing is per-person.** There is no assignee, author, or reviewer dimension anywhere in the
  data the panel is built from — it structurally cannot render an individual's number. This is the
  same team-level, non-surveillance stance as the [cycle digest](/features/cycle-digest/).
- **It reads only what you already have.** The panel is computed in your browser from rows already
  synced for the team's list and board, so it is instant and correct offline. If the retro's cycle
  is outside your synced slice, the panel does not render at all rather than showing a board of
  zeros.

A card captured from a figure keeps an **evidence chip**. Activating the chip reveals the panel and
focuses the figure it came from, so a card and its number are a two-way link.

## Actions become issues

An action from a retro is not a checkbox that rots on a board. Converting one creates a **real
issue** through the same creation path as any issue you type by hand: the same per-team numbering,
the same triage defaults, the same permissions, the same [delivery signals](/features/delivery-signals/)
on its row. It lands in the retro's next cycle by default, or in whichever cycle you target.

From there it is an ordinary issue. If it does not get finished, the cycle's
[automatic rollover](/features/cycles/) carries it forward like anything else — which is exactly the
point: last retro's unfinished promise shows up in this cycle instead of quietly disappearing.

Converting is idempotent. A second conversion is a no-op, not a duplicate issue. The retro shows the
converted issue's live status inline, and an already-created action can still be converted from a
`closed` retro.

**And the next retro asks what became of them.** For a team with the
[AI draft](/features/retro-ai-draft/) turned on, the following retro can open with a fourth group —
*follow-ups* — where the draft reports on improvements agreed in the team's most recent previous
retro (up to three, with yapm naming which cycle they came from), each against the live status of the
issue it became: **shipped** (the issue is `Done`, and nothing else counts), **canceled**, **still
open**, or **never tracked** if it never became an issue at all. That answer is computed by yapm, not
written by the model, and the group appears only when there is something to report: on a team's first
retro it is simply not there.

Without the AI draft, the loop still closes the plain way — an unfinished action is an unfinished
issue, and the cycle's rollover puts it in front of you again.

## Keyboard

Every action below is also a command-palette entry, so nothing is keyboard-only or pointer-only.
The palette acts on whatever the keyboard last held — the focused card or cluster for a dot, the
focused action for a conversion.

Anywhere in the retro:

| Key | Action |
|---|---|
| `c` | New card in the focused column |
| `a` | New action |
| `]` | Advance a phase (facilitator) |
| `[` | Step back a phase (facilitator) |
| `t` | Start a timer (facilitator) |

On the board:

| Key | Action |
|---|---|
| `↑` `↓` (or `k` `j`) | Move focus within a column |
| `←` `→` | Move focus across columns |
| `v` | Spend a dot on the focused card or cluster |
| `Shift+V` | Take a dot back |
| `g` | Group the focused card with… |

Only the arrow keys are pure navigation; every other row above is an action the palette also
offers, alongside the ones with no key at all — claiming or handing off facilitation, changing the
format, setting the dot budget, turning anonymity on, and, on a focused
[AI proposal](/features/retro-ai-draft/#agreeing-and-disagreeing), agreeing with it, disagreeing,
clearing your reaction, or adding an agreed improvement as an action.

`Space` and `Enter` on a card are reserved for drag-and-drop: they pick a card up and drop it,
which is how you cluster cards without a pointer. On your own draft during `brainstorm`, `Enter`
opens the editor and `Backspace` (or `Delete`) removes it. In the actions list, `⌘/Ctrl+Enter`
converts the focused action into an issue. `Esc` always leaves the editor you are in.

## The AI draft

Optionally, and **off for every team until an admin turns it on**, a model reads the same cycle facts
the data panel is built from and drafts up to three wins, three losses and three improvements into the
retro — plus, from the team's second retro onward, up to three follow-ups on what the last one agreed
— each one citing a work-graph entity or one of the panel's own computed metrics. It appears
directly below the data panel, a few seconds after the facilitator reveals the board, and it is
labelled *AI-drafted, not agreed* until the team ratifies it — nothing the model writes becomes the
team's conclusion on its own.

It is drafted **at the `brainstorm` → `group` advance**, never before: while the retro is in
`brainstorm` the rows do not exist, so there is nothing for the team to anchor on while they are still
writing their own cards. It reads **no cards, no comments, no votes and nobody's name** — the anonymity
boundary above is untouched. It does read the previous retro's **agreed actions**, which are the
team's public output rather than anybody's testimony, and it reads neither the assignee on those
actions nor the assignee on the issues they became.

Each member then **agrees or disagrees** with each proposal, privately: the reaction syncs to nobody
but its author — not to another member, and not to a workspace admin — exactly like the dots above.
When the facilitator advances out of `vote`, yapm counts the reactions once and stamps each proposal
with a verdict. One disagreement is enough to make a proposal *contested* rather than agreed, and
contested proposals sort to the top of the discussion. An **agreed improvement** is one keystroke
from a real action item, which converts into a numbered issue through the same path as any
hand-written one — never with an owner filled in.

**Ratification applies to the AI's proposals and not to your own cards, on purpose.** Your cards
already have a ranking signal on this board: the dots. A second, differently-shaped one on the same
surface in the same session would be two scoreboards rather than symmetry, with a card able to be
top-voted and rejected at once. It also matches the underlying difference: a card is somebody's
testimony and does not need the team's endorsement to be true, whereas an AI proposal is a machine's
inference and is worth precisely what the team says it is worth. **Dot voting remains the only
ranking signal on human cards.**

With no team opted in, or with no AI provider configured, the retro is exactly the retro described
above and nothing renders — no draft, no reaction control, no verdict. See
[Retro AI draft](/features/retro-ai-draft/) for what the model is given, what it is never given, the
verdict rule in full, and the two residuals stated plainly.

## What is next

Nothing on this surface. The board, the draft, the team's ratification of it and the loop back to
last retro's actions are all in — see [Retro AI draft](/features/retro-ai-draft/) for the last of
those.

