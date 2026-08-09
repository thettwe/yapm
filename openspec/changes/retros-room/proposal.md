## Why

`design-explorations/overhaul-2026-08/destinations/retros.html` is the approved drawing of the
retro room (at its **vote** phase) and the retros index. Retros is a `more▾` destination (`g r`)
sitting inside the shipped three-band frame with a pre-overhaul interior: PR #33 gave it the
frame, PR #34 gave the product its phrase dictionary and its quiet-row rule, PR #38 retuned the
tokens — and these two pages were never drawn.

Retros is also the one surface in this product allowed to be about 10% more human than the rest.
`plays/PLAY-warmth.md` names the condition on that licence: **every warm move must restate a hard
guarantee**, so the warmth is the voice of the architecture rather than decoration. The model
sentence is already true of the schema and is nowhere on the screen — *cards are anonymous by
design; there is no author column* — and it is true because `retro_card_author` is a server-only
table the Zero schema cannot name.

What the shipped surfaces get wrong, concretely:

1. **The phase machine reads as a segmented control, not as a session moving.** Six pill segments
   in a rounded tray. The mock draws the **cycle day-band language** — six filled/unfilled bands
   with the current phase named and marked `now` — the same grammar `cycles` and `delivery`
   already use for time passing, which is what a retro's phases are.
2. **The anonymity guarantee is a bare pill reading `Anonymous`.** It states a setting and not the
   reason it can be trusted. The mock replaces it with the sentence and the drawn figure whose
   shoulders are not filled in.
3. **A card with no votes still draws ink.** During `vote` the pips render at `count={0}`, so
   every unvoted card carries a mono `0` and a `−`/`+` pair. `openspec/specs/reality-vocabulary`
   §"The track draws only these four facts" made "a slot with no fact draws no ink" a shipped
   requirement, and this surface violates it on most of its rows.
4. **The dot budget is a mono fraction with nothing drawn.** `2/5 dots left` and no dots. The
   mock draws the budget as spent and unspent dots *and* keeps the reading, so it is never
   colour- or shape-only.
5. **The tabletop is not a tabletop.** Cards are `rounded-card` app cards on the page ground; the
   mock puts them on `--bg-sidebar` felt as flat 3px-radius paper with one hairline of thickness
   at the foot — the half of `plays/warmth-retro`'s paper grammar that graduated. (Rotation and
   dog-ears did not; `PLAY-warmth` filed both as sketch and the mock already dropped them.)
6. **The AI draft band sits ABOVE the room's live business** and states neither what it read nor
   that it is unagreed until the section header is reached. The mock pins it below the tabletop —
   subordinate by placement — labels it `AI-drafted, not agreed`, and writes its read boundary on
   the surface: `reads the work graph only — never a card`.
7. **The index is titled `Retrospectives`, wears a lucide `MessagesSquare`, and explains itself in
   a sentence.** The mock draws `Retros` + a mono count, rows with an accent left edge and the
   drawn retro mark, and one quiet line — `A retro opens when a cycle closes.` — with the mono
   fact under it.
8. **The masthead repeats the team name and the format.** Band 1 owns the team; the three column
   headings already say the format. `ia.html`'s word diet forbids both.

Vision principles served: **keyboard-first** (nothing on either page becomes pointer-only),
**sub-100ms and offline** (every fact renders from rows Zero has already synced — no new query),
**team-level metrics only** (no per-person contribution count, no sentiment read, nothing that
de-anonymises a card), and the honesty principle running through the whole overhaul — a surface
may only state a fact some stored row supports, and a warm sentence must be a true one.

## What Changes

**The room, at every phase — drawn at `vote`, correct in all six.**

- **Band 2**: `Retro` + the cycle's name; presence (`n here`), the facilitator's timer, and who is
  facilitating on the right. The team name and the format pill go.
- **The phase stepper** becomes the cycle day-band language: six bands, spent / now / to come, the
  current one named and marked `now`, with `[` and `]` drawn as keycaps for the facilitator. No
  per-phase durations — nothing stores one.
- **The say line**: what the phase asks of the room (the shipped `PHASE_HINT`, unchanged), and
  during `vote` the **dot budget drawn as dots** beside its `n/m dots left` reading.
- **The anonymity guarantee** on the surface, in mono, beside the drawn anonymous figure —
  rendered only when the retro is actually anonymous, because on an attributed retro the sentence
  would be false.
- **The tabletop**: `--bg-sidebar` felt, the format's columns, cards as flat paper notes with the
  column's accent rail, groups as the dashed accent-line box that is the vote target. The vote
  slot keeps its reserved measure and **draws nothing at zero**.
- **The room foot** states the two phase facts that are true of the machine: writing closed at the
  reveal, dots close when the clock runs out.
- **The seeded data panel** keeps every widget and every seed-a-card path, and collapses to the
  mock's one-line door (`Cycle n data · Delivered · Flow`) whenever the phase cannot take a card —
  which is the shipped `seedOpen` state, defaulted by phase rather than always-open.
- **The AI draft band** moves below the tabletop, beside the seed door: `AI draft` ·
  `AI-drafted, not agreed` · `reads the work graph only — never a card`, then one line per
  proposal — category chip, the sentence, its citation chips (a work-graph entity or a yapm
  computed metric, with the `how ·` door where the number is derived), and the caller's own
  private reaction. From `discuss` the verdict replaces the reaction, contested first.
- **The action rail** renders whenever the phase can write an action **or** an action already
  exists, so stepping back never hides a real row (see design D6). Its foot states that an action
  becomes a real numbered issue, and the AI path creates actions **with no assignee**.

**The index** — the frame the `more▾` menu lands on: `Retros` + a mono count, one row per retro
(the drawn retro mark, title, phase pill, format, the cycle's date range), the
`completed without a retrospective` group kept for the cycles that are owed one, and — for a team
that has never run one — the mock's quiet line plus the mono fact about when the next one opens.

Non-goals, folded deliberately (the mock's closing comment records each; this change honours them):

- **No new tables, no migration, no new named query.** Every retro entity this needs already
  exists.
- **No per-phase duration or phase history.** `retro` stores one live timer, not a transition log.
- **No per-person anything**: no contribution count, no per-column participation, no "who voted",
  no sentiment or tone read, no author reveal for anybody including an admin. Each member's own
  agree/disagree stays private, synced to nobody else, exactly like their dots.
- **No note rotation, no dog-ears, no illustration.** `PLAY-warmth` filed all three as sketch.
- **No AI verdict without a human stamp**, and no AI-written number: a proposal points at a
  citation, it never types a figure.

## Capabilities

### New Capabilities

<!-- none: this change re-draws two existing surfaces of an existing capability -->

### Modified Capabilities

- `retrospective`: the drawn room — the phase stepper in the cycle day-band language, the
  anonymity guarantee stated on the surface, the tabletop and its paper notes, the vote budget
  drawn and read, the quiet vote slot that draws no ink, and (added) the retros index as a
  destination with its own row anatomy and its honest empty state.
- `retro-ai-draft`: the draft band's placement below the room's live business, its on-surface
  statement of what it read, its `AI-drafted, not agreed` label until a verdict exists, and the
  rule that every rendered proposal draws at least one citation.
- `retro-ratification`: verdicts and reactions are never colour-only — each carries a word or a
  drawn mark as well as a hue.

## Impact

- `apps/web/src/retro/retro-view.tsx`: band 2, the phase stepper, the say line and dot budget, the
  anonymity guarantee, the room's ground and foot, and the new order of the seed door / draft band
  / action rail.
- `apps/web/src/retro/retro-board.tsx`: the tabletop and the paper note; the vote slot's reserved
  measure and its no-ink-at-zero rule. Every keyboard path (`c`, `v`, `Shift+V`, `g`, arrows) and
  every mutator call is untouched.
- `apps/web/src/retro/retro-ai-panel.tsx`: the band's header line, the per-proposal row, the
  citation chips and the reaction/verdict slot. No query, no mutator, no ratification rule moves.
- `apps/web/src/retro/{retro-seed-panel,retro-actions,retros-view}.tsx`: the seed door's collapsed
  register, the action rail's visibility rule and foot, and the index redrawn.
- `packages/ui/src/components/retro-card.tsx`: the paper note register and `RetroVotePips`
  returning `null` at zero. Consumers: the retro board only.
- `packages/ui/src/components/drawn.tsx`: the anonymity figure and the retro mark, on the shared
  20-unit grid beside the existing drawn marks — the one shared-package addition, and it is
  additive (design D9 states why it belongs there and not in `apps/web`).
- `packages/ui/src/styles/contrast.test.ts`: the tabletop's grounds and every new ink pair, in
  every theme block, light and dark.
- `apps/web/e2e/retro.spec.ts` and `retro-ai.spec.ts`: selectors updated where the surface moved.
  No assertion weakened; the phase-stepper and vote-budget assertions gain the drawn readings.
- No dependency, env var, container, table, migration, mutator or named query is added or changed.

Docs: `apps/docs/src/content/docs/features/retrospectives.md` (the room's anatomy at each phase,
the anonymity guarantee and why it is true, the dot budget, the draft band's read boundary and its
labels, the action rail's ownerless AI path, and the index), plus `features/ai.md` if it describes
where the draft band renders. `README.md` and `ROADMAP.md` are the maintainer's at archive time.
