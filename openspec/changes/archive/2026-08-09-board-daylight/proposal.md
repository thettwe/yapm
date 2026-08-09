## Why

`design-explorations/overhaul-2026-08/destinations/board.html` is the approved drawing of the
Board. Board is the **Board lens** on Issues — the deck's Issues stop stays current and band 2 is
`northstar/issues.html`'s masthead with the toggle flipped — and `issues.html` drew that toggle
while the board behind it was never drawn at all. PR #33 gave the app its frame, PR #32 (corrected
by #38) gave the row its drawn vocabulary, PR #34 gave Issues its phrase dictionary and its filter
bar. The board took none of it: it still wears a pre-overhaul interior.

What the shipped board gets wrong, concretely:

1. **A card is not the list row's facts.** It draws status, key, title, priority, labels and
   assignee — and then hands `BoardCard` a hardcoded `buildRealityShape(null)`, so **every** card
   on **every** board draws the quiet track, whatever git says. There is no phrase, no `//`
   divergence break, no review age. The board is the one surface in the product that cannot tell
   you an issue is diverged, which is the product's whole wedge.
2. **Band 2 is a stub.** `Masthead title="Issues"` and the lens toggle, and nothing else: no mono
   count, no `Save view` / `+ New issue`, no filter axes. Switching from List to Board silently
   drops seven filter axes and the saved views.
3. **The columns are fixed-width and scroll horizontally.** `w-72 shrink-0` inside
   `overflow-x-auto` puts six 288px columns into 1440px of viewport, so the sixth column
   (Canceled) is off-screen at the width the product is designed for. The mock's promise is six
   readable columns at 1440 with no horizontal scroll, fluid so it holds at any width.
4. **An empty column is annotated rather than reserved.** `No issues` in `--text-3`. A column that
   is empty should look reserved, not captioned.
5. **The drag is legible only in motion.** The picked-up card dims to 40% and dnd-kit animates a
   `DragOverlay` carrying `shadow-lg`; there is no drawn hole where the card left, no drop slot
   where it will land, and nothing on screen states the keyboard contract that already exists
   (`space` / `esc` / `← →`). Under `prefers-reduced-motion` the affordance is close to invisible.

Vision principles served: **sub-100ms and offline-capable** (every fact on this page is derived
from rows Zero has already synced — the board adds one query the list already runs and no new
one), **keyboard-first** (the move contract is unchanged and is now *drawn*), **team-level metrics
only** (no swimlane, no per-person lane, no throughput anywhere), and the honesty principle that
runs through the overhaul: a surface may only state a fact some stored row supports.

## What Changes

- **Band 2 becomes the Issues masthead with the lens flipped.** The mono count, `Save view` and
  `+ New issue`, and the same seven filter axes the list draws — from **one** shared filter bar
  imported by both lenses, not a second copy. The trailing control states `Order · Manual`,
  because a board's order is the manual `rank` and grouping/sort do not apply to a surface whose
  columns *are* the grouping.
- **A card carries the same facts as a list row, in a different shape**: status glyph · mono key ·
  priority mark · title · **the rest phrase** · labels · **the derived reality track with its `//`
  break** · assignee. Both new facts come from the seam the list already uses
  (`deliveryView` over `linkedEntitiesFor`), so a card and a row can never disagree.
- **A quiet card draws no reality ink at all** — the slot reserves its measure and lays down
  nothing, and states nothing to assistive technology. This is now shipped behaviour
  (`reality-vocabulary`, D1/D2 of `design-corrections`); the board's hardcoded
  `label="No delivery signal yet"` on an inkless track is removed.
- **Six fluid columns, no horizontal scroll at 1440.** `flex-1 min-w-0` inside the page gutter.
  A column that overflows vertically scrolls; columns past ~100 cards keep the shipped lazy
  virtualization.
- **An empty column draws one reserved slot and no words.**
- **The drag becomes legible without motion**, in three drawn states: the **hole** the picked-up
  card leaves (its own measure, dashed, emptied of ink), the **drop slot** at the landing
  position in the destination column, and the **card in flight** wearing the page's whole
  elevation budget plus a mono footer stating the contract that already works —
  `space drop · esc cancel · ← → column`. All three are static drawings, correct under
  `prefers-reduced-motion: reduce` and visible in a screenshot.

Non-goals, folded deliberately — the mock's closing comment records each and the build honours it:

- **No swimlanes by person.** Folded twice over: no lane entity exists, and a per-person row of a
  team's work is the per-person scorecard VISION §8 forbids. Assignee stays one avatar at the
  card's tail, never an axis.
- **No WIP limits.** No per-column limit is stored on team or on status, so the number would be
  decoration and the alarm would be a lie. Column headers carry the count only.
- **No custom columns, no column add, no column reorder.** Status is a fixed six-value enum in
  category order. The columns are the enum.
- **No column dwell, no aging card, no stale wash, no "in this column 3d".** There is no issue
  status-history table: the product knows an issue's status *now*, never when it entered a column.
  The only ages drawn come from the delivery seam's stored review clock.
- **No blocked-by / blocks badges and no dependency arrows** — `issue_link` is issue→pull_request;
  there is no issue-to-issue table.
- **No estimate, points or t-shirt chips; no product-area chip; no design-artifact cover.**
- **No new table, no migration, no new named query, no new mutator.** The move is the shipped
  `issue.move`, unchanged.

## Capabilities

### New Capabilities

<!-- none: this change re-draws an existing lens over existing entities -->

### Modified Capabilities

- `board`: the card's full fact set (phrase + derived reality track with the `//` break, quiet
  when unlinked); six fluid columns readable at 1440 with no horizontal scroll; the empty
  column's reserved slot; band 2 carrying the count, the actions and the shared filter axes with
  `Order · Manual`; and a move whose affordance is legible without motion — the hole, the drop
  slot and the card in flight with its stated key contract.

## Impact

- `apps/web/src/issues/filter-bar.tsx` (new): the list's filter axes + search + saved-view
  controls, extracted verbatim from `issue-list.tsx`'s `Toolbar`, parameterized so a lens can
  state `Order · Manual` where the list states `Group · Sort`. `issue-list.tsx` imports it; no
  axis, option, accessible name or behaviour changes — four e2e specs drive those names.
- `apps/web/src/board/board.tsx`: band 2, the fluid column layout, the reserved empty slot, the
  three drag states, the delivery derivation per card, the filter application (through the same
  `buildGroups` the list uses, ungrouped) and the filtered count.
- `apps/web/src/board/model.ts`: unchanged ordering/rank logic; `BoardCardData` gains nothing —
  it already extends `IssueRowData`, whose `linked` field the board simply never populated.
- `packages/ui/src/components/board-card.tsx` (**shared package — a sibling parallel build may be
  in this directory; this change touches this one file and `contrast.test.ts` and nothing else
  under `packages/`**): a phrase slot, the composed reality-track slot with no default label, and
  the in-flight register (elevation, accent ring, the key footer).
- `packages/ui/src/styles/contrast.test.ts`: the board's own grounds — the card's `--bg-elevated`
  and the column's mixed ground — for the urgent phrase ink, the reserved slot's border, the drop
  slot's border on its tint, and the in-flight ring, in **every** theme block, light and dark.
- `apps/web/e2e/board.spec.ts`: selectors updated where the surface moved, plus an assertion that
  the board region does not scroll horizontally at 1440. No assertion is weakened.
- `apps/web/src/frame/masthead.tsx` is **not** touched: it already takes `count`, `lens`, `meta`
  and `actions`.
- No dependency, env var, container, table, migration, named query or mutator is added or changed.

Docs: `apps/docs/src/content/docs/features/board.md` (the card's anatomy, the six fixed columns,
the complete keyboard move contract and the drawn drag states, what a quiet card means, and what
the board deliberately does not draw), plus `features/issues.md` where it describes the lens
toggle and which controls the Board lens carries, and the `README.md` feature line if it describes
the board. `ROADMAP.md` is **not** edited here — parallel builds share it and the maintainer adds
the row at archive time.
