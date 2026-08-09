# Design — board-daylight

The rulebook is `design-explorations/overhaul-2026-08/northstar/ia.html`; the drawing is
`destinations/board.html` (renders `board.png`, `board-full.png`); the row a card restates is
`northstar/issues.html`, shipped as `packages/ui/src/components/issue-row.tsx` and wired in
`apps/web/src/issues/issue-list.tsx`. The mock's closing comment records what it folded and why,
and this file does not re-argue any of it.

## D0 — What the shipped board already does, inventoried before anything is moved

Nothing on this list may be lost. Each item names where it lives today.

| Capability | Where |
|---|---|
| Six fixed columns in category order | `board/model.ts` `buildColumns` over `STATUS_ORDER` |
| Pointer drag (4px activation), drop into column or between cards | `board.tsx` `PointerSensor` + `closestCorners` + `onDragEnd` |
| Keyboard move: Space pick up, arrows, Space drop, Esc cancel | `KeyboardSensor` + `sortableKeyboardCoordinates` |
| Live-region announcements + screen-reader instructions | `announcements`, `screenReaderInstructions` |
| Focus returns to the moved card, including into a virtualized column | `pendingFocus` effect + `VirtualColumnList` |
| `o` opens the focused issue (viewers too) | window `keydown` |
| `m` and ⌘K open "Move to status…" for the focused card (writers) | `MovePalette` + `useCommandSource('board')` |
| ⌘K declines to the frame when no card is focused / viewer / mid-drag | `openFromRegistry` returning `false` |
| Viewer read-only: no drag, `aria-disabled` stripped, Enter/Space opens | `SortableCard` `dragA11y` / `keyboardOpen` |
| Single-write fractional rank; no sibling renumbered | `rankForSlot` → `issue.move` |
| Lazy virtualization past 100 cards in a column | `shouldVirtualize` + `VirtualColumnList` |
| `prefers-reduced-motion` honoured (no drop animation, no layout animation) | `reducedMotion` |
| Pending issue number marker | `data-pending` |
| Column accessible name `"<Label>, <n> issues"` | `Column` `aria-label` — **e2e depends on this string** |

**Deliberate removal: exactly one.** The empty column's `No issues` sentence is replaced by a
reserved slot with no words (D5). The column's accessible name already states the count, so
nothing is lost to assistive technology.

## D1 — Band 2 comes from ONE shared filter bar, imported by both lenses

The mock's band 2 is `issues.html`'s masthead with the toggle flipped: mono count, `Save view`,
`+ New issue`, and the seven filter axes. The shipped board draws none of it, so switching lens
silently drops every filter the member had applied and every saved view.

Rejected: a second filter bar written for the board. Two bars over one filter model is how two
vocabularies start, and four e2e specs drive the axes by their accessible names — a copy would
have to reproduce all of them exactly and would then be free to drift.

**Decided: extract `issue-list.tsx`'s `Toolbar` into `apps/web/src/issues/filter-bar.tsx`, moved
rather than rewritten, and import it from both lenses.** The one parameter is the trailing
control: the list states `Group · Sort`, the board states `Order · Manual`. Everything else — the
axes, their options, their accessible names, the search input, the saved-view select and the
`Save view` popover — moves byte-for-byte.

Why the board's trailing control is a plain statement and not a control: a board's vertical order
is the manual `rank`, and its horizontal grouping *is* the status enum. Grouping and sort have
nothing to act on here. `Order · Manual` is a fact about this lens, in the register the mock
draws it, and it is the same words `issues.html` uses.

**Filter state stays per-lens and local.** Neither lens holds filter state in the URL today, so
carrying filters across the toggle would mean lifting the whole filter model into search params
for both surfaces — a change to the list, in a change about the board. Recorded as a known limit
rather than smuggled in; a member who filters on List and switches to Board gets an unfiltered
board, exactly as today.

**The filter is applied through the shipped model, not a second implementation.** The board calls
the same `buildGroups(rows, { filter, grouping: 'none', sort, … })` the list calls, takes its
`ordered` and `count`, and then lays those rows into columns with the existing `buildColumns`.
The masthead's count is that `count` — the filtered total, the same derivation as the list's — so
the two lenses can never disagree about how much work matches.

## D2 — A card carries the phrase and the derived track, from the seam the row already uses

The shipped `BoardCard` is handed `buildRealityShape(null)` at the call site, unconditionally.
Every card on every board therefore draws the quiet track no matter what git says, and no card can
carry the `//` break — on the one surface where a divergence is most legible.

**Decided: the board derives per-card delivery exactly as the list does and passes it in.** It
subscribes to `queries.deployments.byTeam` (the query the list already runs), builds the
`DeploymentIndex` once for the whole board rather than per card, calls `linkedEntitiesFor` +
`deliveryView`, and renders `RestPhraseText` plus a `RealityTrack` over
`buildRealityShape(view.strip, { divergence: view.divergence })` at the card's 86px measure with
`realityTrackLabel(...)`. No new query, no ZQL outside `packages/schema`, no second derivation.

Consequences stated rather than discovered:

- The phrase row exists **only when the register has something to say**. `sayRestPhrase` resolves
  to silence for a quiet issue, and a silent phrase renders nothing at all — no reserved line, no
  placeholder. A card is shorter when there is nothing true to say about it, which is what the
  mock draws (six of its nineteen cards carry no delivery ink and most carry no phrase).
- The **track slot** is the opposite: it always reserves its 86px, ink or no ink. That asymmetry
  is deliberate and is the shipped rule — a track's measure is reserved so nothing shifts when a
  fact arrives; a phrase is a sentence, and a reserved empty sentence is the triage panel's bug.
- `BoardCard`'s default `label="No delivery signal yet"` on an inkless track is **removed**. An
  inkless track states nothing to assistive technology (`reality-vocabulary`, D2 of
  `design-corrections`); today's default contradicts that requirement on this one surface.

## D3 — Six fluid columns, and the promise is measured rather than eyeballed

Shipped: `w-72 shrink-0` in an `overflow-x-auto` strip — 6 × 288px + gaps ≈ 1790px, so Canceled is
off-screen at 1440. The mock: `flex:1 1 0; min-width:0` inside the 40px page gutter, which is
216.67px a column at 1440 with a 12px gap, and holds at any width without a breakpoint.

**Decided: adopt the fluid measure, and assert the promise.** A component test asserts the board
region carries no horizontal-scroll class and each column is a `flex-1 min-w-0` sibling; the e2e
asserts `scrollWidth === clientWidth` on the board region at the suite's 1440 viewport. The mock's
own self-critique is inherited honestly: at ~1200 the phrase, the labels and the 86px track start
to compete inside one row, and unlike the list a board cannot drop a column. This change does not
invent a breakpoint the mock did not draw; it records the ceiling.

A column that overflows vertically **scrolls**, and past 100 cards it keeps the shipped lazy
virtualization.

## D4 — The mock's `↓ 103 more` fold is NOT adopted, and the reason is reachability

The mock draws Done as three cards and a fold line. Its own self-critique calls that "the least
honest cell on the page": a real Done column is the tallest thing on the board and the first place
a scroll appears.

**Decided: the column scrolls; it does not fold.** A fold on a board hides drop targets — a card
dragged or arrow-keyed toward a folded region has nowhere to land, and the focus-restore path
would have to teach the fold to open itself mid-move. The column header already states the true
total, which is the one thing the fold line was standing in for. Recorded as a deliberate
difference from `board.png`.

## D5 — An empty column reserves a slot; it does not caption itself

`No issues` in `--text-3` goes. In its place, one dashed reserved slot at the mock's `rest`
measure. The column's accessible name (`"Canceled, 0 issues"`) already states emptiness in words,
so this removes ink, not information.

## D6 — The drag is drawn in three static states, so it survives a still frame

The brief requires the affordance be legible **without motion**. Three drawings, none animated,
all correct under `prefers-reduced-motion: reduce`:

1. **The hole.** The picked-up card keeps its exact measure and empties: its content is hidden
   (`invisible`, so the box is unchanged), its background drops out and its border becomes the
   dashed reserved-slot border. This replaces the shipped 40% dim, which reads as a disabled card
   rather than a card that is elsewhere. Keeping the *same element* as the hole is what guarantees
   the hole is exactly the size of the card that left it.
2. **The drop slot.** While a drag is over a column that is not the card's own, that column draws
   a dashed accent slot on `--accent-soft` at the landing position — appended at the end, or in
   front of the card being hovered. Within the card's own column the sortable strategy's gap is
   already the slot, and drawing a second one would show two landing sites; so the slot is drawn
   for cross-column hovers only, which is also the only case dnd-kit leaves undrawn.
3. **The card in flight.** The `DragOverlay` card wears `--elevation-transient` and an accent ring
   — the page's whole elevation budget, spent on its one transient — plus a mono footer stating
   the contract that already works: `space drop · esc cancel · ← → column`. The footer is drawn
   only while a drag is live, so it is a state, not chrome.

The keyboard sensor drives all three identically: dnd-kit's `over` is the same value whether it
came from a pointer or an arrow key, so a keyboard move gets the hole, the slot and the footer
without a second code path.

The mock's self-critique of the flying card ("a drawing that needs a legend has lost an argument")
is answered by the medium: in the product the footer appears only during the second the drag
lasts, and the card actually tracks the keys, which is the reading the still frame could not give.

## D7 — Nothing here needs a new fact, and four board reflexes stay unbuilt

Restating the mock's folds as build constraints, because each is something a board implementation
reaches for by reflex:

- **No swimlanes by person** — no lane entity, and VISION §8 forbids the per-person row outright.
- **No WIP limits** — no per-column limit is stored anywhere; the number would be decoration and
  the alarm a lie.
- **No custom, added, or reordered columns** — the columns are the status enum.
- **No column dwell, aging dot, stale wash or entry timestamp** — there is no issue status-history
  table. Nothing on this page ages a card. The only ages drawn are the delivery seam's stored
  review clock, which the phrase and the track already carry.

## D8 — Contrast: the board draws on two grounds the test has never measured

Every other daylight surface is drawn on `--bg` or on a tint of it. The board has two new grounds:
the **card** (`--bg-elevated`) and the **column** (`--bg-sidebar` at 50% alpha over `--bg`, which
is the mock's `color-mix(in oklch, var(--bg-sidebar), var(--bg) 50%)` — the same result, so no new
token is introduced).

New assertions in `contrast.test.ts`, in **every** theme block, light and dark:

- the urgent phrase ink (`--status-urgent-ink`) and the neutral phrase ink (`--text-2`) on the
  card ground, at 4.5:1 — a card phrase is text;
- the reserved slot's `--border-strong` on the column ground, at 3:1 — it is the whole drawing of
  an empty column and of the hole, so it is load-bearing non-text;
- the drop slot's `--accent` border on `--accent-soft`, at 3:1;
- the in-flight ring's `--accent` on `--bg-elevated`, at 3:1;
- the column ground against the page ground recorded as **scaffolding measured below 3:1**, so
  the claim is falsifiable rather than assumed — the precedent is `design-corrections` DI-11 and
  `triage-daylight` B8. A surface tint is not required to meet a bar; what it may not do is
  quietly carry a fact.

If a pair misses its bar, the ink moves and the mock loses — `issue-list-daylight` DI-2 and
`triage-daylight` B8 are the standing precedent. `--text-3` is not used for any fact on this page.

## D9 — Scope, settled before the build starts

- **No new table, migration, named query, or mutator.** The move is `issue.move`, untouched.
- **`packages/` is touched in exactly two files**: `components/board-card.tsx` (board-only) and
  `styles/contrast.test.ts`. **A sibling parallel build (retros, projects+roadmap) may be inside
  `packages/ui` at the same time** — if either file conflicts at merge, this change rebases onto
  main and re-runs the gates rather than force-merging.
- **`apps/web/src/frame/` is not touched at all.** `Masthead` already takes `count`, `lens`,
  `meta` and `actions`.
- **`ROADMAP.md` is not edited.** The maintainer adds the row at archive time; it is the
  guaranteed conflict between parallel builds.
- `apps/web/src/issues/issue-list.tsx` shrinks by the extracted bar and gains an import. No axis,
  option, accessible name or behaviour changes.

## D10 — Test tiers, judged rather than assumed

PROCESS.md §3: all three tiers iff the change touches ≥2 of {synced entity/schema, mutator,
permission surface, signature UI}. This change touches **signature UI only** — no schema, no
mutator, no permission surface. So: unit + component, and **no new integration (pg) test**, which
would have no new Postgres surface to prove.

`apps/web/e2e/board.spec.ts` already exists and drives this page, so it is **maintained, not
added**: selectors updated where the surface moved, plus one new assertion that the board does not
scroll horizontally at 1440. Nothing is weakened; the viewer read-only, keyboard-move, palette,
reorder, virtualization and theme tests keep their claims verbatim.

## Risks / Trade-offs

- **The extraction is the riskiest edit in the change.** `Toolbar` carries seven axes whose
  accessible names four e2e specs drive by string. Mitigation: move the code, do not retype it;
  the list's own component test and the four e2e specs are the regression net, and they run
  unchanged.
- **Two elements competing for one 196px row.** At 216px a column, a two-line title plus a phrase
  plus labels plus an 86px track is tight, and the mock says so. Mitigation: the track and the
  avatar are a fixed-width tail with `flex-none`; labels wrap and truncate; the title clamps.
  The degenerate-state render task is the check, not inspection.
- **The drop slot changes column height mid-drag**, which can move the very cards the reader is
  aiming at. Mitigation: the slot's height is the reserved measure, and the hole the card left
  gives the same measure back in the source column, so a cross-column drag is height-neutral on
  the board as a whole.
- **`prefers-reduced-motion` is read once at mount** in the shipped board and stays that way; a
  member toggling the OS setting mid-session sees the old value until reload. Pre-existing, not
  introduced here, and not fixed here.

## Decisions made during implementation

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. The render task's findings — every deliberate difference from board.png,
     and the four degenerate states — are recorded here too. -->
