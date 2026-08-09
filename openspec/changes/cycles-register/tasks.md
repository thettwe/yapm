## 1. Read the rulebook first

- [x] 1.1 Read `design-explorations/overhaul-2026-08/destinations/cycles.html` end to end **including its closing comment** (§(a) "What folded, and why" 1–9, §(b) "Self-critique", and the set-reconciliation pass), and look at `cycles.png` and `cycles-full.png`
- [x] 1.2 Read `destinations/DESTINATIONS.md` — the `cycles.html` row, §"What the render showed" 2–4, §"Remaining drift" (the `C10`–`C16` numbering), and the `cycles.html` self-critique
- [x] 1.3 Read `northstar/ia.html` (the word diet's three tiers, the band-2 anatomy, Cycles' destination subtree with its two artifacts, one-attention-number), `northstar/home-digest-2.html` (the scope band this page reuses at row scale) and `northstar/issues.html` (row anatomy)
- [ ] 1.4 Read `reference/zero.md` (Zero 1.x — `defineQuery` / `defineQueries` / `createBuilder`; the 0.x names are non-functional) plus the Tailwind 4.3 and TanStack Router references
- [x] 1.5 Read the surfaces this change consumes and must NOT rebuild: `packages/ui/src/components/{status-glyph,drawn,how,door,issue-row,rest-phrase,provenance-mark}.tsx`, `apps/web/src/frame/masthead.tsx`, `packages/ui/src/components/team-home.tsx` (the hero's scope band, drawn)
- [x] 1.6 Read `packages/schema/src/zero/{queries.ts,cycles.ts,team-home.ts,metrics/scope.ts}` — `cycles.byTeam`, `issues.byTeam`, `retros.byTeam`, `digests.byTeam`, `compareCycles` / `nextCycleId` / `isUnfinished`, and `buildHeroCycle`'s scope-band and chip rules
- [x] 1.7 Read `openspec/specs/cycles/spec.md` (the requirements this change modifies rather than contradicts) and the "Decisions made during implementation" of `archive/2026-08-09-triage-daylight`, `archive/2026-08-09-design-corrections` and `archive/2026-08-08-delivery-journalism`
- [x] 1.8 Inventory the shipped page's capabilities against design.md's table before deleting a line of it, and note every test id other specs drive it through (`new-cycle`, `complete-cycle`, `cycle-retro-link`, `cycle-open-retro`, `cycle-digest`, `pm-digest-share`, `cycle-issue-row`)

## 2. The derivation (`packages/schema`)

- [x] 2.1 Extract the scope-band rule out of `buildHeroCycle` into one exported function (`added` = `cycleAssignedAt > cycle.startDate`, carry-ins stay committed, `landed` = `done`, one block per issue) and make `buildHeroCycle` call it — Home and the register must be incapable of disagreeing (design D1)
- [x] 2.2 New `packages/schema/src/zero/cycle-register.ts`: `buildCycleRegister(input)`, pure, no ZQL, no React, `now` as an argument. Input rows are the already-synced cycles, issues, retros and cycle digests
- [x] 2.3 Register rows: newest first by the canonical cycle order (`compareCycles`, reversed), each with cycle id, key, name, start/end, status, glyph kind, ledger, carry-forward count, and the two artifact chip flags
- [x] 2.4 The denominator-intactness rule (design D2): known for an open cycle and for the latest completed cycle with no completed cycle after it; unknown for every earlier completed cycle. A known-denominator completed cycle's ledger is the issues still pointing at it **plus** those with `rolledOverFromCycleId = C`; an unknown one is the pointing set only, with no open remainder and a `landed` reading
- [x] 2.5 Artifact chips: `cycleReport` = a digest row with `status === 'ready'` and non-null `content`; `wrapped` = a retro for that cycle with `closedAt != null` — the same predicates `buildHeroCycle` uses, extracted rather than copied (design D5)
- [x] 2.6 `carriedIn(selectedCycleId)`: the selected cycle's issues with `carryoverCount > 0`, each carrying its depth, the origin cycle id and name where `rolledOverFromCycleId` still names one, and the chain node model — derived from the count alone, **never** from cycle ordering (design D7)
- [x] 2.7 Comment only the constraints the code cannot express: why the denominator degrades, and why the chain has one nameable hop
- [x] 2.8 Export from `packages/schema/src/index.ts`

## 3. The drawn vocabulary (`packages/ui`)

- [x] 3.1 The cycle-status glyph joins `status-glyph.tsx` on the same 20-grid, the same 1.6 stroke and the same `DONE_CHECK` constant: dashed ring (upcoming), half arc (active), filled disc carrying the check (completed). Each carries a truthful `aria-label`. No new geometry, no `lucide` icon
- [x] 3.2 `ScopeBand` is **reused** at row scale, not re-drawn: whatever sizing the row needs arrives as a prop with the Home default unchanged, and the existing `aria-hidden` treatment is preserved so the label lives on the cell (design D4)
- [x] 3.3 The carry chain drawing (design D7) — nodes from the depth, a named origin node, an accent now-node, hollow unnamed hops, a dotted lead-in; `aria-hidden`, with the fact stated as text on the row
- [x] 3.4 Stories for the new glyph and the chain, including the degenerate cases (depth 1, no named origin)

## 4. The Cycles destination (`apps/web/src/cycles/cycles-view.tsx`)

- [x] 4.1 Band 2: `Masthead` with `title="Cycles"`, the mono count, and `Complete cycle` + `+ New cycle` in the actions slot. The `new-cycle` dialog is untouched; `complete-cycle` keeps its test id and acts on the **selected** row (design D6), hidden for viewers and for a completed cycle
- [x] 4.2 THE REGISTER band: header (`THE REGISTER`, mono count, `how ·`), then one row per cycle newest-first — glyph, mono key (`cycleKey()`, the product's numbering, not the mock's `C16` lettering), name, mono dates, ledger, carry fact, artifact chips right-aligned. The selected row takes the accent left border and the selected tint
- [x] 4.3 The register's `how ·` states the denominator-degradation rule in one sentence with its constraint line — the mock's own named fault, closed with the house mechanism (design D2)
- [x] 4.4 The ledger cell: `ScopeBand` plus its mono reading (`8/12` where known, `10 landed` where not), `role="img"` with a truthful label; **absent** for a cycle with no issues (design D4/D8)
- [x] 4.5 Rows are keyboard-operable: arrow keys move, `Enter`/`Space` selects, `aria-current` marks the selection, the current cycle is selected on arrival. Selection is local state and waits on nothing
- [x] 4.6 CARRIED IN band: header (`CARRIED IN`, count, `out of <cycle>` where the origin is nameable, `how ·` for the notation), then one row per carried issue — glyph, key, title, rest phrase, chain, `carried N×`. The whole band is **absent** where nothing carried (design D8). A row opens its issue by pointer and by keyboard
- [x] 4.7 THE LAST REPORT band: `CycleDigestPanel` for the selected cycle, keeping `data-testid="cycle-digest"` and its existing narrative / evidence-fallback behaviour and provenance line; the retro doorway (`cycle-retro-link`, else `cycle-open-retro` for a writer) in the band header (design D5); `PmDigestShareCard` below it, unchanged
- [x] 4.8 The footnote, once: a cycle keeps no status history, so nothing here burns down — with `more ·` in the mock's register
- [x] 4.9 Remove the cycle rail, the progress bar and the featured cycle's issue list, and delete `cycle-issue-row` with it (design D3). Check every import of `apps/web/src/cycles/model.ts` before removing anything from it — `triage-view.tsx` imports `cycleKey`
- [x] 4.10 Word diet: no explanatory sentence at rest anywhere on the page except the report's document voice and the one footnote. Loading, empty and team-missing states are labels
- [x] 4.11 Every colour and font via tokens; no non-token hex; the carry wash `color-mix`'d off `--status-in-progress`, never urgent ink and never a badge (mock §8)

## 5. Tests

- [x] 5.1 `packages/schema/src/zero/cycle-register.test.ts` — **the falsifiable check, part one**: over three cycles where an issue is carried twice, the rows come back newest-first with the right glyph kinds; the active and latest-completed cycles publish a known denominator while the earlier completed one publishes `landed` only with no open remainder; `carriedIn` names the issue with depth 2 and the cycle it last left
- [x] 5.2 `packages/schema` unit: the extracted scope-band rule produces the identical band and counts for `buildHeroCycle` and `buildCycleRegister` over the same cycle — the two surfaces cannot disagree (task 2.1)
- [x] 5.3 `packages/schema` unit: the chip predicates — a digest that is not `ready`, or is `ready` with null content, draws no report chip; an open retro draws no wrapped chip and a closed one does
- [x] 5.4 `packages/schema` unit: the degenerate inputs — a team with no cycles, a team with exactly one cycle and no history, a cycle with no issues, a cycle with no carryover — each produce an absent section rather than a zero
- [x] 5.5 `apps/web/src/cycles/cycles-view.test.tsx` — **the falsifiable check, part two**: the page renders one register row per cycle newest-first with no cycle rail and no `cycle-issue-row`; the carry band is absent when nothing carried and states `carried 1×` when something did; no `Cycle report ·` chip renders where no digest row exists
- [x] 5.6 `apps/web` component: the register is keyboard-operable — arrows move, `Enter` selects, `aria-current` follows, and selecting a row re-points the carried-in band and the report
- [x] 5.7 `apps/web` component: a viewer sees every row, ledger and chip and is offered no `complete-cycle`, no `new-cycle` and no `cycle-open-retro`
- [x] 5.8 `apps/web` component: nothing on the page is conveyed by colour alone — the ledger cell's label states the counts, the chain is `aria-hidden` with `carried N×` as text, and each glyph carries its status word
- [x] 5.9 Extend `packages/ui/src/styles/contrast.test.ts` with this page's pairs in **every** theme block, light and dark: the selected register row's ground and its ink, the mono key on the selected row, the carry band's amber wash and the ink drawn on it, the chain's node strokes, and the chip border and chip ink
- [x] 5.10 Update `apps/web/e2e/cycles.spec.ts` where the surface moved — the rollover test asserts the carried issue appears in the CARRIED IN band with `carried 1×` (**stronger** than "the issue appears under cycle B", not weaker); the theme test re-anchors on the register row and its glyph label, which is present in every state including a cycle with no issues; the keyboard test drives the register rows instead of the rail. **Never weaken an assertion to make a gate pass**
- [x] 5.11 Confirm `retro.spec.ts`, `digest.spec.ts` and `pm-digest.spec.ts` still pass **untouched** — if one needs an edit, that is a preserved-test-id failure, not a spec to change
- [x] 5.12 Re-run any e2e failure once before investigating: the known multi-context flake (`projects.spec.ts:188`, `:246`, `pm-digest.spec.ts:306`, signature `browserContext.close: Protocol error`) is tracked separately and is not this change's to fix. Any OTHER failure is
- [x] 5.13 Confirm no test hard-codes a budget encoding e2e fixture size (cycles accumulate across specs — derive the row count from the page), and no test's premise is what a given Node runtime provides (CI is Node 24; dev machines here run 26)

## 6. Documentation

- [x] 6.1 Rewrite `apps/docs/src/content/docs/features/cycles.md`: the register's row anatomy left to right, the ledger's three segments and what they mean, the denominator degradation and the schema fact behind it, the carry chain's notation and its one nameable hop, the artifact chips and when they appear, the burndown refusal, and the complete keyboard model
- [x] 6.2 Update `features/cycle-digest.md` (where the report now lives on the page) and check `features/team-home.md` / `features/delivery.md` for any claim that Cycles answers a question it no longer answers
- [x] 6.3 Update `README.md` and `ROADMAP.md` (the destination-rebuild status row — Cycles leaves the list of six); confirm `.env.example`, `TECHSTACK.md`, `VISION.md`, `DESIGN.md` and the `reference/` pages are untouched by this change and therefore not stale (PROCESS.md §2)
- [x] 6.4 `pnpm --filter @yapm/docs build` passes
- [x] 6.5 Record every decision taken during the build in `design.md` under "## Decisions made during implementation" — including anything that had to diverge from `cycles.html` and why

## 7. Gates

- [x] 7.1 `pnpm turbo lint typecheck test build` (green in CI on PR #43, run 31288746299)
- [x] 7.2 The compose smoke test (green in CI, 4m41s)
- [x] 7.3 The full Playwright suite (green in CI, 22m11s — no flake, no re-run needed)
- [ ] 7.4 **Render the built page at 1440×900 over a seeded team, screenshot it, and LOOK at it** against `cycles.png` / `cycles-full.png`. Record every deliberate difference in `design.md`
- [ ] 7.5 Render and look at each degenerate state (design D8): a workspace with one cycle, a cycle with no issues, a cycle with no carryover, a cycle whose digest was never generated, and a team's very first cycle. Each must read as composed, not as a hole — the triage build shipped an empty box that passed every test and was found only this way
- [ ] 7.6 Decide the carry chain with the render in front of you: keep the graphic, or fall back to the mono column the mock's own self-critique proposes. Record the decision either way (design D7)
