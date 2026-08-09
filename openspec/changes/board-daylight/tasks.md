## 1. Read the rulebook first

- [x] 1.1 Read `design-explorations/overhaul-2026-08/destinations/board.html` end to end **including its closing comment** (§"What folded, and why", §"Changes against the shipped board", §"Divergences from the canonical set", §"Self-critique", §"Set-reconciliation pass"), and look at `board.png` and `board-full.png`
- [x] 1.2 Read `destinations/DESTINATIONS.md` — the `board.html` row, §"What the render showed" items 2–4, and the `board.html` self-critique
- [x] 1.3 Read `northstar/ia.html` (§"The word diet", the band-2 anatomy, one attention number, transients-are-never-destinations) and `northstar/issues.html` (the row anatomy a card restates, column for column, and the lens toggle)
- [x] 1.4 Read `openspec/specs/board/spec.md` and `openspec/specs/reality-vocabulary/spec.md` — the quiet-track rule, the track's four facts, the phrase dictionary, provenance. These are requirements to modify, never to contradict
- [x] 1.5 Read `reference/zero.md` (Zero 1.x — `defineQuery` / `defineMutator` / `createBuilder`; the 0.x names are non-functional) plus the Tailwind 4.3 and TanStack Router references
- [x] 1.6 Read the surfaces this change consumes and must NOT rebuild: `packages/ui/src/components/{issue-row,reality-track,rest-phrase,status-glyph,priority-mark,provenance-mark,avatar}.tsx`, `apps/web/src/frame/masthead.tsx`, `apps/web/src/issues/{issue-list.tsx,delivery.ts,model.ts}`, `apps/web/src/board/{board.tsx,model.ts,virtual-column.tsx}`
- [x] 1.7 Read `packages/schema/src/zero/{queries.ts,mutators.ts,delivery.ts}` — `issues.byTeam`, `deployments.byTeam`, `issue.move`, `computeDeliverySignal` / `computeDivergence` / `sayRestPhrase`
- [x] 1.8 Confirm D0's capability inventory against the code before editing anything; anything it missed is added to design.md

## 2. One filter bar, two lenses (`apps/web/src/issues/filter-bar.tsx`)

- [x] 2.1 Move `issue-list.tsx`'s `Toolbar` — the filter mark, the seven `FilterMenu` axes, the search input, `SavedViewControls`, `SaveViewButton`, `GroupSelect`, `SortMenu`, `QUIET_SELECT`, `toggle`, `useSaveView` and the label maps they need — into `filter-bar.tsx`. **Move, do not retype**: four e2e specs drive these accessible names by string
- [x] 2.2 Parameterize only the trailing control: the list passes `Group · Sort` (its existing controls), the board passes the plain statement `Order · Manual`. No axis, option, accessible name, placeholder or saved-view behaviour changes
- [x] 2.3 `issue-list.tsx` imports the bar; confirm its own component test and the four e2e specs that drive the axes still address the same names
- [x] 2.4 Comment only the constraint the code cannot express: why the board has no grouping or sort control (design D1)

## 3. The card (`packages/ui/src/components/board-card.tsx`)

- [x] 3.1 Add a `phrase` slot rendered above the labels/track row, drawn only when the caller supplies one — no reserved empty line (design D2)
- [x] 3.2 Remove the default `RealityTrack` with `label="No delivery signal yet"`: the caller composes the track, and an inkless track carries no label (`reality-vocabulary`; `design-corrections` D2). Keep the 86px card measure reserved either way
- [x] 3.3 Add the two register variants the drag needs: the **hole** (own measure kept, content hidden, dashed `--border-strong`, no fill) and the **in-flight** card (`--elevation-transient`, accent ring, and a footer slot). Both tokenized; neither depends on animation
- [x] 3.4 Extend `board-card.stories.tsx` (or add it) with: quiet card, card with a phrase and a full track, card with the `//` break, hole, in-flight, and a long-title card
- [x] 3.5 Confirm no other surface renders `BoardCard`, so no other page moves

## 4. The board (`apps/web/src/board/board.tsx`)

- [x] 4.1 Band 2: `Masthead` gains the filtered `count`, the `Save view` + `New issue` actions, and the shared filter bar in `meta`. The lens toggle stays. The team name is not repeated — band 1 carries it
- [x] 4.2 Apply the filter through the shipped model — `buildGroups(rows, { filter, grouping: 'none', sort, … })` — and lay its `ordered` rows into columns with the existing `buildColumns`. The masthead count is that model's `count`
- [x] 4.3 Subscribe to `queries.deployments.byTeam`, build the `DeploymentIndex` **once** for the board, and populate each card's `linked` via `linkedEntitiesFor` — one pass over the team's deployments, never per card
- [x] 4.4 Per card: `deliveryView` → `RestPhraseText` for the phrase and `RealityTrack` over `buildRealityShape(view.strip, { divergence: view.divergence })` at 86px with `realityTrackLabel(view.strip, DIVERGENCE_LABEL[...])`. Quiet cards draw nothing and announce nothing
- [x] 4.5 The column layout: six `flex-1 min-w-0` siblings in the page gutter, no horizontal scroll on the board region; a column scrolls vertically and keeps the lazy virtualization past 100 cards
- [x] 4.6 The empty column draws one reserved slot and no words; the column's accessible name (`"<Label>, <n> issues"`) is preserved **verbatim** — e2e depends on that string
- [x] 4.7 The drag's three drawn states (design D6): the source card becomes the hole; the destination column draws the landing slot for a cross-column hover (tracked from dnd-kit's `over` in `onDragOver`, cleared on end and cancel); the `DragOverlay` card wears the elevation, the ring and the mono footer `space drop · esc cancel · ← → column`
- [x] 4.8 Confirm every D0 capability still holds: `o`, `m`, ⌘K's declining registry opener, the viewer's read-only card, announcements, focus restore (plain and virtualized), reduced motion, `data-pending`, single-write rank
- [x] 4.9 Word diet: no explanatory sentence renders anywhere on this page; loading and team-missing states stay labels

## 5. Tests

- [x] 5.1 `apps/web/src/board/board.test.tsx` — **the falsifiable check**: a card whose linked PR is merged while the issue is not done draws the reality track with the `//` break and states the divergence phrase; a card with no linked change draws no track ink, exposes no `img` role for it, and draws no phrase line. Fails on main, where every card is handed `buildRealityShape(null)`
- [x] 5.2 `apps/web` component: the six columns are equal-fraction siblings and the board region carries no horizontal scroll; an empty column draws the reserved slot and no `No issues` text; a column's accessible name still reads `"<Label>, <n> issues"`
- [x] 5.3 `apps/web` component: band 2 states the filtered count, offers the same filter axes as the list by their accessible names, offers `Save view` and `New issue`, states `Order · Manual`, and offers **no** grouping or sort control; applying a filter narrows the columns and the count together
- [x] 5.4 `apps/web` component: while a card is picked up, the source card renders as the hole (its measure preserved, its content hidden), the hovered foreign column renders the landing slot, and the carried card renders the key footer — asserted with motion reduced, so nothing in the claim depends on animation
- [x] 5.5 `apps/web` component: a viewer gets no hole, no landing slot and no pick-up, and the card is still an operable button that opens the issue
- [x] 5.6 `apps/web` component (`issue-list.test.tsx`): the list's filter axes, search, saved views, grouping and sort survive the extraction unchanged
- [x] 5.7 Extend `packages/ui/src/styles/contrast.test.ts` with the board's pairs in **every** theme block, light and dark (design D8): urgent and neutral phrase ink on the card ground at 4.5:1; the reserved slot's border on the column ground at 3:1; the drop slot's accent border on its tint at 3:1; the in-flight ring on the card ground at 3:1; and the column ground against the page ground recorded as measured scaffolding below 3:1, so the claim can be falsified
- [x] 5.8 Update `apps/web/e2e/board.spec.ts` selectors where the surface moved, and add one assertion that the board region's `scrollWidth` equals its `clientWidth` at the suite's viewport. The viewer, keyboard-move, palette, reorder, virtualization and theme tests keep their claims **verbatim**. **Never weaken an assertion to make a gate pass**
- [ ] 5.9 Re-run any e2e failure once before investigating: the known multi-context flake (`projects.spec.ts:188`, `:246`, `pm-digest.spec.ts:306`, signature `browserContext.close: Protocol error`) is tracked separately and is not this change's to fix. Any OTHER failure is
- [x] 5.10 Confirm no test hard-codes a budget encoding e2e fixture size, and no test's premise is what a given Node runtime provides (CI is Node 24; dev machines here run 26)
- [x] 5.11 No pg test is added: this change touches no schema, mutator or permission surface (design D10). Confirm that is still true when the build is done

## 6. Documentation

- [x] 6.1 Update `apps/docs/src/content/docs/features/board.md`: the card's anatomy left to right and top to bottom, what a quiet card means, the six fixed columns and why there are exactly six, the complete keyboard move contract and the three drawn drag states, the empty column, what the board deliberately does not draw (swimlanes, WIP limits, custom columns, column dwell), and which controls the Board lens carries
- [x] 6.2 Update `features/issues.md` where it describes the List | Board toggle and what each lens offers
- [x] 6.3 Update `README.md` if it describes the board; confirm `.env.example`, `TECHSTACK.md`, `VISION.md`, `DESIGN.md`, `PROCESS.md` and the `reference/` pages are untouched by this change and therefore not stale (PROCESS.md §2). **Do not edit `ROADMAP.md`** — parallel builds share it and the maintainer adds the row at archive time
- [x] 6.4 `pnpm --filter @yapm/docs build` passes
- [x] 6.5 Record every decision taken during the build in `design.md` under "## Decisions made during implementation" — including anything that had to diverge from `board.html` and why

## 7. Gates

- [ ] 7.1 `pnpm turbo lint typecheck test build`
- [ ] 7.2 The compose smoke test
- [ ] 7.3 The full Playwright suite
- [ ] 7.4 **Render task.** Bring the built page up at 1440×900 over a seeded team, screenshot it, and compare it against `board.png` / `board-full.png`. Record **every** deliberate difference in `design.md` — the `↓ n more` fold (D4) is a known one; find the rest
- [ ] 7.5 **Render the degenerate states and look at them** (the lesson from the triage build, whose panel reserved its full measure over an issue with no description and passed every test): a board with exactly one card; a board where every column is empty; a column with 40 cards; a card whose title runs long; and a card with a phrase but no track. Each must read as composed, not as a hole. Record what each looked like and anything fixed because of it
