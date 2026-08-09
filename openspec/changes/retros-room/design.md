# Design — retros-room

The rulebook is `design-explorations/overhaul-2026-08/northstar/ia.html`; the drawing is
`destinations/retros.html` (two frames: the room at `vote`, and the index) and its closing
comment; the play it was seeded from is `plays/PLAY-warmth.md` + `plays/warmth-retro.html`. The
mock's comment records what it folded and why, and this file does not re-argue any of it — it
records only the decisions the mock left to the build.

The governing sentence for the whole surface is `PLAY-warmth`'s: **every warm move must restate a
hard guarantee.** A sentence on this page earns its place by being true of the schema. That is why
*cards are anonymous by design — there is no author column* ships (D3) and why *reads the work
graph only — never a card* ships (D7): both are statements about storage, not tone.

## D0 — What already exists, and what is not being built

**No new tables, no migration, no new named query, no new mutator, no mutator signature change.**
The entities the room draws all exist: `retro`, `retro_column`, `retro_card`, `retro_card_author`
(server-only, absent from the Zero schema — the fact the guarantee rests on), `retro_group`,
`retro_vote`, `retro_vote_tally`, `retro_presence`, `retro_draft`, `retro_ai_draft`,
`retro_ai_proposal`, `retro_ai_reaction`, `retro_action`. This change is a redraw: markup, tokens,
placement and copy.

Three loud consequences: `packages/schema` is not touched at all; `packages/ui` is touched twice
and only additively (D9); `apps/web/src/frame/` is not touched.

## D1 — Capability inventory: everything the shipped retro does survives

Taken off the source before drawing anything, because "redraw" is where capabilities quietly die.
Each of these is a shipped behaviour that must still be true after this change:

| Capability | Where it lives | After |
|---|---|---|
| Phase machine `[` / `]`, facilitator-only, one step | `retro-view.tsx` `PhaseStepper` | Redrawn as the day band; keys, gating and `aria-disabled` behaviour unchanged |
| Format / anonymity / dot-budget configuration, brainstorm-and-empty only | `FormatControl`, `AnonymityControl`, `BudgetControl` | Kept, moved into band 2's meta row; the *resting* format and `Anonymous` pills go (D3) |
| Presence strip, durable timer, claim/hand off facilitation | `retro-view.tsx` | Kept; band 2's right cluster is exactly the mock's `n here` / clock / facilitator |
| Private drafts, `c` composer, publish-at-advance | `retro-board.tsx` | Unchanged |
| Grouping, `g` group-with, ungroup, labels | `retro-board.tsx` | Unchanged |
| Dot voting `v` / `Shift+V`, budget, tally, retract | `retro-board.tsx` | Unchanged except the zero-tally slot draws nothing (D4) |
| Card moderation (facilitator/author delete) | `retro-board.tsx` | Unchanged |
| Seeded data panel, every widget, seed-a-card with an evidence ref | `retro-seed-panel.tsx` | Kept; its default open-ness becomes phase-derived (D5) |
| AI draft band: pending line, live region, proposals, citations, `how`, private reactions, verdicts, contested-first, add-action | `retro-ai-panel.tsx` | Kept whole; redrawn and moved below the tabletop (D7) |
| Action rail: create, edit, delete, assignee, target cycle, convert to a real numbered issue, live issue status | `retro-actions.tsx` | Kept; visibility rule changes (D6) |
| Command palette: every retro action | `retro-command.tsx` | Unchanged |
| Retros index: list, phase, format, cycle range, "completed without a retrospective" + open one | `retros-view.tsx` | Redrawn; both sections kept (D11) |

**Deliberate removals: none.** Three things stop being *drawn at rest* and are recorded as such,
not as removals: the resting format pill, the resting `Anonymous` pill (replaced by the sentence
that says why it is true), and the action rail during phases that can neither hold nor write an
action (D6).

## D2 — The phase stepper is the cycle day-band language

`packages/ui/src/components/drawn.tsx` already ships `DayBand` — the grammar `cycles` and
`delivery` use for time passing. A retro's phases *are* its time passing, and the mock draws them
with the same 8px bands: spent (`--accent-soft`), now (`--accent`), to come (hairline on
`--bg-hover`).

`DayBand` itself is **not** reused: its segment union is `past | today | future` and it stretches
its segments to fill, while the stepper needs six fixed-width labelled columns. Reusing it would
mean widening a shared primitive's union for one caller — the thing `reality-vocabulary`
§"The drawn primitives live in one shared module" exists to prevent going the other way. The
stepper is drawn in `retro-view.tsx` to the same measurements and the same three tokens.

The bands are decoration over an `<ol>` whose items keep their `aria-current="step"` and their
`data-testid="retro-phase-step"` / `data-phase` hooks, so the existing e2e assertions hold. `[`
and `]` keep their real focusable buttons with `aria-keyshortcuts`; the mock's keycaps are drawn
*inside* them, and the accessible name stays the sentence (`Advance to Discuss`) — the
`triage-daylight` B2 precedent.

Spent phases carry no duration. Nothing stores one.

## D3 — The guarantee ships; it renders only when it is true

The sentence is `cards are anonymous by design — there is no author column`, in mono, beside the
drawn figure whose shoulders are dashed rather than filled.

It renders **only when `retro.is_anonymous` is true.** An attributed retro (a shipped, settable
option) draws a card's author, so the sentence there would be a lie, and a warm lie is worse than
no warmth. On an attributed retro the same slot states the truth for that retro —
`cards carry their author` — in the same register.

While the retro is still configurable (brainstorm, no cards) the facilitator's toggle stays where
it is; the sentence sits beside it rather than replacing it, because the toggle is the thing that
makes the sentence true and hiding it would strand the choice.

The sentence is a statement, not a control, and carries no title/tooltip: the shipped tooltip text
("Cards in this retro carry no author on any synced row") is now the visible text.

## D4 — A quiet vote slot draws no ink, and the controls follow the same rule

Two facts about the shipped surface. During `vote` a card renders `RetroVotePips count={0}` — a
mono `0` and five hairline pips — plus a `−` / `+` pair, on *every* unvoted card.
`openspec/specs/reality-vocabulary` §"The track draws only these four facts, and never claims what
the data cannot say" already made "a slot with no fact draws no ink" a shipped requirement, and
the mock draws `<div class="pips"></div>` — reserved measure, nothing in it — on its three unvoted
cards.

**Decided:**

- `RetroVotePips` returns `null` at `count === 0`. It is the primitive, so the rule cannot be
  forgotten by a caller.
- The slot keeps its **reserved height** so a column of cards does not jitter as dots land.
- The `+` control survives at zero — it is how the first dot is cast — but is drawn as the mock's
  affordance rather than a bordered button, and `−` is not rendered at all when `mine === 0`
  (today it renders `aria-disabled`). A control that cannot act and is not the way in is ink for a
  fact that does not exist. The keyboard path (`v` / `Shift+V`) is unchanged and remains the
  documented one, so nothing becomes pointer-dependent.
- The tally reading stays as text beside the dots wherever dots are drawn, so the count is never
  shape- or colour-only.

## D5 — The seed panel's open-ness is derived from the phase, once

The mock draws the panel collapsed to a door during `vote`, and its comment gives the reason: the
"add a card from this widget" path is `brainstorm`-only, so from `group` onward the panel is a
read-only wall of ten figures over a room whose live business is elsewhere.

**Decided:** the initial value of the existing `seedOpen` state is `retroCan(phase, 'draft')` —
open while a card can still be seeded from it, a door afterwards. It stays a user-controlled
toggle from then on, and the door states what is behind it (`Cycle n data · Delivered · Flow`) so
opening it is one keystroke away. No widget, no metric and no seed path is removed.

## D6 — The action rail renders when the phase can write one, OR when one exists

The mock folds the rail entirely at `vote`, correctly: `phase.ts` allows the `action` write only
in `discuss` and `actions`, and a rail that cannot be written to is chrome promising what the
phase refuses.

But a retro can be stepped **back** from `discuss` to `vote` with actions already recorded, and
the mock's fixture — a first retro reaching vote — cannot show that. Folding the rail on the
phase alone would hide real rows.

**Decided:** the rail renders when `retroCan(phase, 'action')` **or** `actions.length > 0`. At
`vote` with actions present it renders read-only, stating that actions reopen at Discuss. This
follows the mock everywhere the mock has an opinion and refuses to lose data where it does not.

Its foot keeps the one fact that matters and the mock has no room for: an action becomes a **real
numbered issue** through the shipped conversion path. Actions created from an AI proposal are
created with **no assignee** and nothing on that path suggests, defaults or infers one — already
true in `retro-ai-panel.tsx` and `retro-actions.tsx`, restated here because this change must not
lose it. A human-created action keeps its optional assignee control; that is a person choosing,
not a model inventing.

## D7 — The draft band moves below the tabletop, and says what it read

Placement is the argument. The band is subordinate to the team's own cards, so it sits *below*
them, directly under the seed door — still "adjacent to the auto-seeded data panel" in the sense
`retro-ai-draft` requires, now on the other side of it.

Three sentences ship on the band, each a statement about the pipeline:

- `AI-drafted, not agreed` — rendered until a verdict exists for the proposal; already the
  shipped `retro-ai-unratified` copy, promoted into the header line.
- `reads the work graph only — never a card` — the table allowlist, stated. The allowlist excludes
  every retro content table and the card→author binding; the sentence is what the allowlist means.
- `your own reaction only · verdicts stamp at Discuss` — why the reader sees no counts yet.

Every rendered proposal draws **at least one citation** — a work-graph entity chip or a yapm
computed-metric chip, with the shipped `how` door where the number is derived. A proposal with no
surviving citation does not render; the validator already drops one, and the surface now states
that rule rather than relying on it silently. The band never types a number of its own.

From `discuss` the private reaction is replaced by the verdict, contested first — the shipped
ratification rules, unchanged.

## D8 — Mono facts on the felt take `--text-2`, and the token does not move

`DESTINATIONS.md` §4 measures `--text-3` at 2.9:1 on `--bg` and names it the destinations' weakest
ink while stating that retuning it is a product change. `triage-daylight` B8 settled the trade for
this overhaul: **if a pair misses AA the ink changes and the mock loses, not the reader.**

This surface draws mono facts on a *third* ground — `--bg-sidebar` felt — and on the paper note's
`--bg-elevated`. Every stated fact (the dot budget reading, the tally, the room foot, the seed
door's line, the band's three sentences, the index's date range) is `--text-2`. `--text-3` survives
only where the frame already uses it: aria-hidden marks beside a word label, and the index's quiet
mono sub-line, which is measured and moved if it misses.

Every new pair goes into `packages/ui/src/styles/contrast.test.ts` in **all six theme blocks** —
including the pairs expected to *fail* the text bar and recorded as non-text scaffolding, so the
claim is falsifiable rather than assumed.

## D9 — Two drawn marks go into `packages/ui`, and that is a deliberate shared-package touch

**Stated loudly, because two other changes are building in parallel off the same main.** This
change adds two marks to `packages/ui/src/components/drawn.tsx`: the anonymity figure (a head with
a dashed, unfilled shoulder line) and the retro mark (the `more▾` menu's loop-with-a-return-arrow,
`ia.html`'s `g-retro`). Both are on the shared 20-unit grid at the shared 1.6 round-cap stroke.

They belong there and not in `apps/web/src/retro/` because `reality-vocabulary` §"The drawn
primitives live in one shared module" says so, and because the retro mark is the **deck's own
glyph** — the `more▾` menu will want it next. The change is purely additive: two new exports, no
existing export's signature or output altered, so a parallel branch that merges first conflicts at
most on an import list.

`packages/ui/src/components/retro-card.tsx` is the second shared touch: the note register and
`RetroVotePips`' zero rule (D4). Its only consumer is the retro board.

## D10 — The mock's one unresolved collision is not this change's to resolve

`retros.html` draws Cycle 1's retro live in `vote` on day 9 of Cycle 2, while `delivery.html`
annotates Jul 30 with "Retro agreed: smaller PRs" — implying it already closed. The mock states
the collision and hands it to the maintainer. It is a fixture question about the mock set, not a
product behaviour, and nothing in this change depends on which way it goes.

## D11 — The index keeps both sections; the mock folded one for arithmetic, not for design

`retros.html`'s index draws one row and no `completed without a retrospective` group, and its
comment gives the reason: on the set's cast, Cycle 2 is still running, so no cycle is owed a
retro — a ghost group would have drawn a list that team cannot have.

That is a statement about the fixture. The section is a shipped capability (it is the only way to
open a retro for a cycle that closed without one) and it stays, rendering exactly when it has
rows. A team with none sees the mock's frame verbatim.

The index's empty state is the mock's: `A retro opens when a cycle closes.` plus the mono fact
about the next boundary where a cycle exists to state one — and nothing where no cycle does, which
is the case for a brand-new team. No `+ New retro` button: a retro is opened *for a completed
cycle*, from that cycle's row.

## D12 — The degenerate states are rendered and looked at, not merely tested

The triage build shipped a decision panel that reserved its full measure over an issue with no
description and passed every test. The same trap is on this page in five places, so each is
rendered at 1440×900 and **looked at** before this change is called done:

1. A retro with no cards at all (the arrival state of every retro).
2. A column with exactly one card, beside a column with a group.
3. A retro on a team with AI off entirely — the band must be *absent*, not empty.
4. A retro whose draft run `failed` — same: absent, no error, seed panel is the whole fallback.
5. The index for a team that has never run a retro, and for a team whose cycles are all running.

Plus the room's own quiet cases: a card with zero votes (no ink), a retro with no facilitator, a
retro with no running timer, and a retro with no presence rows but the caller.

## D13 — Keyboard and offline are unchanged, and that is a claim to check

Every key the room binds today (`[`, `]`, `t`, `a`, `c`, `v`, `Shift+V`, `g`, arrows, `⌘/Ctrl+⏎`)
keeps its binding and its command-palette twin. Nothing on either page reads a new query, so both
pages are exactly as offline-capable as they were. The e2e suites are updated only where a
selector moved, and `retro.spec.ts:236` ("take a dot back") is a known intermittent — it is re-run
before it is investigated, and never loosened.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables, no migration, no new named query, no new or changed mutator** (D0).
- **Every shipped capability survives** (D1). Any removal discovered during the build is recorded
  here with its reason, not performed silently.
- **Keyboard-first**: every control on both pages reachable and activatable without a pointer;
  every action still in the command palette.
- **Sub-100ms, offline**: no new query, no new network wait on any interaction.
- **Team-level only**: no per-person count, no sentiment read, nothing that de-anonymises a card,
  for anyone including an admin. Each member's agree/disagree stays private exactly like a dot.
- **Not colour-only**: dots, verdicts, phase bands and column accents each carry a word or a drawn
  mark alongside their hue.
- **Contrast holds in every theme block, light and dark**, asserted in `contrast.test.ts` (D8).

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->
