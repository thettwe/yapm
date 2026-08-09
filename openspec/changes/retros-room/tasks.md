## 1. Read the rulebook first

- [x] 1.1 Read `design-explorations/overhaul-2026-08/destinations/retros.html` end to end **including its closing comment** (§(a) "What folded, and why" 1–8, §(b) "Self-critique", and the set-reconciliation pass), both frames
- [x] 1.2 Read `destinations/DESTINATIONS.md` — the `retros.html` row, §"What the render showed" items 2–5, §"Remaining drift", and the `retros.html` self-critique
- [x] 1.3 Read `northstar/ia.html` — the word diet, band-2 anatomy, the `more▾` menu (`g r`, the `g-retro` mark), and the rule that a transient never takes `aria-current`
- [x] 1.4 Read `plays/PLAY-warmth.md` and `plays/warmth-retro.html` — which moves graduated and which stayed a sketch (rotation, dog-ears, the LIVE stamp, the illustrations: none of them ship)
- [x] 1.5 Read `openspec/specs/{retrospective,retro-ai-draft,retro-ratification}/spec.md` and `openspec/specs/reality-vocabulary/spec.md` (§"a slot with no fact draws no ink", §"The drawn primitives live in one shared module", §"The how", §"Provenance marks carry source, never meaning")
- [x] 1.6 Read `reference/zero.md` (Zero 1.x — `defineQuery` / `defineMutator` / `createBuilder`; the 0.x names are non-functional) plus the Tailwind 4.3 and TanStack Router references. No query or mutator changes in this change — read them so that stays true
- [x] 1.7 Read the surfaces this change consumes and must NOT rebuild: `apps/web/src/frame/masthead.tsx`, `packages/ui/src/components/{drawn,status-glyph,provenance-mark,how,door,avatar,badge,button}.tsx`
- [x] 1.8 Inventory the shipped retro against design.md D1 and confirm the table is complete before writing any markup; add any capability the table missed

## 2. The two drawn marks (`packages/ui`) — the change's one shared-package addition

- [x] 2.1 `drawn.tsx`: add the anonymity figure — head plus a **dashed, unfilled** shoulder line — on the 20-unit grid at the shared 1.6 round-cap stroke, `aria-hidden`, colour from `currentColor`
- [x] 2.2 `drawn.tsx`: add the retro mark (`ia.html`'s `g-retro`: the loop with the return arrow), same grid, same stroke
- [x] 2.3 Both additive only — no existing export's signature or output changes (design D9). Note the shared-package touch in the commit body
- [x] 2.4 Cover both in the existing `drawn` story/test surface so a stroke or grid drift is caught

## 3. The paper note (`packages/ui/src/components/retro-card.tsx`)

- [x] 3.1 The note register: `--bg-elevated` ground, 3px radius, one 2px `--border-strong` hairline at the foot, the column accent as the rail. No rotation, no dog-ear, no shadow
- [x] 3.2 `RetroVotePips` returns `null` when `count === 0` (design D4) — the rule lives in the primitive so no caller can forget it
- [x] 3.3 The vote slot keeps a reserved height on the card so a column does not shift as dots land
- [x] 3.4 Where dots are drawn, the count is still stated as text; the accent-vs-hairline pip split is reinforcement, never the only channel
- [x] 3.5 `retro-card.stories.tsx`: a note with dots, a note with none, and a note inside a group, so the zero case is visible beside the non-zero one

## 4. The room (`apps/web/src/retro/retro-view.tsx`)

- [x] 4.1 Band 2: `Retro` + the cycle's name; **no team name, no resting format pill**. Right cluster: presence (`n here`), the timer, the facilitator. The format / anonymity / budget controls still render while `configurable`
- [x] 4.2 The phase stepper as the cycle day-band language (design D2): six fixed-width labelled bands — spent `--accent-soft`, now `--accent`, to come hairline on `--bg-hover` — the current one named and marked `now`, **no durations**. Keep the `<ol>`, `aria-current="step"`, `data-testid="retro-phase-step"` and `data-phase` verbatim
- [x] 4.3 The `[` / `]` controls keep their real focusable buttons, their `aria-keyshortcuts` and their sentence accessible names; the mock's keycaps are drawn inside them (`triage-daylight` B2 precedent). `retro-phase-back` / `retro-phase-forward` test ids unchanged
- [x] 4.4 The say line: `PHASE_HINT[phase]` unchanged, and during `vote` the budget drawn as spent/unspent dots beside the `n/m dots left` reading. Keep `data-testid="retro-vote-budget"`
- [x] 4.5 The anonymity guarantee (design D3): mono sentence beside the drawn figure, rendered **only** when `retro.isAnonymous`; the attributed truth in the same slot when it is not. No tooltip — the sentence is the visible text
- [x] 4.6 The room: `--bg-sidebar` tabletop holding the board, and the foot stating the two phase facts the state machine enforces (writing closed at the reveal; dots close when the clock runs out). The foot's wording must be true of `phase.ts` in every phase it renders
- [x] 4.7 Order below the tabletop: the seed door, then the AI draft band, then the action list — the mock's stacking, and the argument that the team's own material is read first
- [x] 4.8 Every keyboard binding survives byte-for-byte: `[`, `]`, `t`, `a`, `c`, and the board's `v` / `Shift+V` / `g` / arrows. No new listener, no changed guard
- [x] 4.9 Word diet: no explanatory paragraph anywhere; the loading and retro-missing states are labels

## 5. The tabletop (`apps/web/src/retro/retro-board.tsx`)

- [x] 5.1 Columns to the mock's anatomy: accent dot, name, mono count; the stack on felt
- [x] 5.2 Cards drawn through the paper-note register with the column accent rail; the group as the dashed `--accent-line` box carrying its label, its mono card count and — because the group is the vote target — the only pips in that subtree
- [x] 5.3 The vote control (design D4): no ink at zero, reserved measure kept, `−` absent when `mine === 0`, `+` present as the mock's affordance. `retro-cast-vote` / `retro-retract-vote` test ids unchanged
- [x] 5.4 Composer, draft card, evidence chip, group-with and moderation controls keep every behaviour and every test id; only their register changes
- [x] 5.5 Degenerate states drawn honestly (design D12): a column with no cards, a column with one card beside a column with a group, and a retro with no cards at all — none of them reserving an empty measure it cannot fill

## 6. The seed door and the action list

- [x] 6.1 `retro-seed-panel.tsx`: the collapsed register is the mock's one-line door — `Cycle n data` · `Delivered · Flow` · the mono note that seeding a card closed with brainstorm. Expandable, keyboard-reachable, every widget and every seed path intact
- [x] 6.2 `retro-view.tsx`: `seedOpen` initialises from `retroCan(phase, 'draft')` (design D5) and stays user-controlled thereafter
- [x] 6.3 `retro-actions.tsx`: the list renders when the phase permits an action write **or** an action exists (design D6); read-only in the latter case, stating when actions reopen
- [x] 6.4 The list's foot states that an action becomes a real numbered issue; the AI-origin path still creates actions with **no assignee** and nothing on it suggests, defaults or infers one. The human-created action keeps its optional assignee control
- [x] 6.5 Every action test id (`retro-action`, `retro-new-action`, `retro-action-composer`, `retro-convert-action`, `retro-action-issue`) unchanged

## 7. The AI draft band (`apps/web/src/retro/retro-ai-panel.tsx`)

- [x] 7.1 The header line: the drawn draft mark, `AI draft`, `AI-drafted, not agreed` (until a verdict exists), and the mono `reads the work graph only — never a card`
- [x] 7.2 One row per proposal to the mock's anatomy: category chip, the sentence, the citation chips right-aligned, the caller's own reaction at the end. The `how ·` door stays exactly where the shipped surface puts it
- [x] 7.3 A proposal with no surviving citation is not rendered; nothing in the band states a figure the reader cannot trace to a chip
- [x] 7.4 The band's foot during the reacting window: `your own reaction only · verdicts stamp at Discuss`
- [x] 7.5 From `discuss` the verdict replaces the reaction, contested first — the shipped ratification rules, untouched. Verdicts carry their word and reactions their drawn mark, so neither is colour-only
- [x] 7.6 Absence is unchanged and re-verified: AI off, `ai_off`, `failed`, or no surviving proposal renders **nothing** — no empty box, no error, no query. Keep the persistent live region and every `retro-ai-*` test id

## 8. The index (`apps/web/src/retro/retros-view.tsx`)

- [x] 8.1 Masthead: `Retros` + the mono count. The word `Retrospectives` and the lucide `MessagesSquare` both go
- [x] 8.2 The row: accent left edge, the drawn retro mark, title, phase pill, format, and the cycle's date range on the right. One keyboard-reachable link; `retro-link` test id unchanged
- [x] 8.3 The `completed without a retrospective` group kept (design D11), rendered only when it has rows, with `retro-open-for-cycle` unchanged and absent for a viewer
- [x] 8.4 The empty state: `A retro opens when a cycle closes.` plus the mono fact of when the next cycle closes **where a cycle exists to state one**, and nothing where none does. No create-a-retro control
- [x] 8.5 No per-person figure and no card/participant count on any row

## 9. Tests

- [x] 9.1 `apps/web/src/retro/retro-room.test.tsx` (new) — **the falsifiable check**: a retro rendered at `vote` states the anonymity guarantee verbatim; the stepper draws six phases with `vote` current and no duration text; the budget renders dots **and** its reading; a card with a zero tally renders no count, no pip and no retract control while a card with a tally renders all three
- [x] 9.2 Same file: the attributed retro renders the attributed sentence and **not** the anonymity guarantee; the room's masthead does not contain the team name or a resting format pill
- [x] 9.3 Same file: a retro at `vote` that already holds an action still lists it, read-only; a retro at `vote` with no actions renders no action list (design D6)
- [x] 9.4 Same file: `seedOpen` starts expanded at `brainstorm` and collapsed at `vote`, and the door names what is behind it (design D5)
- [x] 9.5 `apps/web/src/retro/retros-view.test.tsx` (new): the index's masthead reads `Retros` + count; a row states title, phase, format and the cycle range and nothing per-person; the never-run-one state renders the quiet line with no create control and no empty group heading; the owed-cycle group appears only with rows and is absent for a viewer
- [x] 9.6 Extend `retro-ai-panel.test.tsx`: the band states its read boundary and its unratified label; a proposal with no citation is not rendered; verdict words and reaction marks are present independent of colour. **Update assertions to the new surface; never weaken one**
- [x] 9.7 Extend `packages/ui/src/styles/contrast.test.ts` with this surface's pairs in **every** theme block, light and dark: the paper note's ink on `--bg-elevated` over `--bg-sidebar`, the mono fact ink on the felt, the accent-soft spent band and the accent now-band as non-text marks, the group's dashed accent-line border, the index row's accent edge, and the pip pair. Record the pairs that are non-text scaffolding as such, so the claim can be falsified
- [x] 9.8 `packages/ui`: `retro-card` renders no vote node at zero and a stated count above zero
- [x] 9.9 Update `apps/web/e2e/retro.spec.ts` selectors where the surface moved (the stepper, the budget reading, the anonymity statement, the index's heading). Every existing assertion survives; the budget and stepper assertions gain the drawn readings. **Never weaken an assertion to make a gate pass**
- [x] 9.10 Update `apps/web/e2e/retro-ai.spec.ts` selectors where the band moved. The absence tests (`ai_off`, opted-out, failed) must still assert absence, not emptiness
- [ ] 9.11 Re-run any e2e failure once before investigating: `retro.spec.ts:236` ("take a dot back") has a known intermittent, and the multi-context flake (`projects.spec.ts:188`, `:246`, `pm-digest.spec.ts:306`) is tracked separately and is not this change's to fix. Any OTHER failure is
- [x] 9.12 Confirm no test hard-codes a budget encoding e2e fixture size, and no test's premise is what a given Node runtime provides (CI is Node 24; dev machines here run 26)

## 10. Documentation

- [x] 10.1 Update `apps/docs/src/content/docs/features/retrospectives.md`: the room's anatomy at each phase, the phase stepper's language, the anonymity guarantee and **why it is true** (`retro_card_author` is absent from the Zero schema), the dot budget and the quiet slot, the seed door, the action list's visibility rule and its ownerless AI path, the complete keyboard model, and the index
- [x] 10.2 Update `apps/docs/src/content/docs/features/retro-ai-draft.md`: the band's placement below the room's own cards, its on-surface read boundary, the unratified label, and the citation rule
- [x] 10.3 Check `features/reality-vocabulary.md` for the quiet-slot rule's list of surfaces and add the retro's vote slot if it enumerates them
- [x] 10.4 Confirm `README.md`, `.env.example`, `TECHSTACK.md`, `VISION.md`, `DESIGN.md` and `reference/` are untouched by this change and therefore not stale (PROCESS.md §2). **Do NOT edit `ROADMAP.md`** — parallel builds share it and the maintainer adds the row at archive time
- [x] 10.5 `pnpm --filter @yapm/docs build` passes
- [x] 10.6 Record every decision taken during the build in `design.md` under "## Decisions made during implementation" — including anything that had to diverge from `retros.html`, and any capability removed with its reason

## 11. Gates

- [ ] 11.1 `pnpm turbo lint typecheck test build`
- [ ] 11.2 The compose smoke test
- [ ] 11.3 The full Playwright suite
- [x] 11.4 **Render and look** (design D12): bring the room up at 1440×900 over a seeded retro in `vote`, screenshot it, and compare against `retros.html` / its render. Then render and look at each degenerate state — no cards at all; a column with one card; AI off entirely; a draft that `failed`; the index for a team that has never run one — and confirm none of them reserves a measure it cannot fill. Record every deliberate difference in `design.md`
- [ ] 11.5 Verify in all three presets, light and dark, that no ink on either page is colour-only and that focus is visible on every interactive element
