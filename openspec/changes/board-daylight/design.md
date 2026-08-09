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

### DI-1 — The reserved slot's ink is `--text-2`, not the mock's `--border-strong`

D8 asked for `--border-strong` on the column ground at 3:1. **Measured, it is 1.31–1.44 in all six
theme blocks** — the dashed outline that is the whole drawing of an empty column, and of the hole a
picked-up card leaves, would be a line the reader cannot see. `--text-3` was the next candidate and
misses too (2.73 warm light, 2.73 editorial light). `--text-2` measures 5.25–7.28 and is what
shipped, in both places the outline is drawn (`board-card.tsx`'s hole and `board.tsx`'s
`ReservedSlot`).

This is D8's own rule applied — if a pair misses its bar the ink moves and the mock loses — and it
is the third time the precedent has been exercised (`issue-list-daylight` DI-2,
`triage-daylight` B8). `contrast.test.ts` keeps BOTH numbers: the bar the shipped ink clears, and
the mock's ink recorded **below** the bar, so the day a palette retune makes `--border-strong`
legible the quieter ink is available again and someone will see it.

The drop slot's accent border (3.73–5.43 on its tint over the column) and the in-flight ring
(4.55–5.83 on the card) needed no change. The column tint against the page ground measures
1.00–1.05, recorded as scaffolding below 3:1 exactly as D8 asked.

### DI-2 — `CommandProvider` is mounted BELOW `BoardBody`, and the reason is ⌘K precedence

Band 2 needs `New issue`, which reaches the ambient composer through `CommandProvider` — the
provider the board never mounted before. But that provider registers a ⌘K opener that **never
declines**, and the frame's registry consults the most recently registered source first. React runs
effects children-before-parents, so a provider wrapping the board would always register after the
board's own opener and swallow the card move (D0: `m`/⌘K open "Move to status…").

**Decided: `CommandProvider` wraps band 2 only**, as a child of the component that registers the
board's opener. The board therefore gets first refusal, declines with no card focused / mid-drag /
for a viewer, and the issues palette answers instead — which is a better fallback than the frame's
bare group palette the board fell through to before. The ordering is load-bearing and invisible, so
it is stated in a comment at the registration site and guarded by a component test that mounts the
real `CommandRegistryProvider` and a stub provider registering exactly as the real one does.

### DI-3 — Saving a view from the board persists the default grouping and sort

`savedView.create` stores filter + grouping + sort, and the board has no grouping or sort to store.
It writes `DEFAULT_GROUPING` / `DEFAULT_SORT`, so a view saved on the board opens on the list
grouped by status — the list's own default — rather than inventing a third state. Applying a saved
view **on the board** applies its filter and ignores its grouping and sort, because neither has
anything to act on here.

### DI-4 — The page gutter is the frame's `px-5`, not the mock's 40px

`board.html` draws a 40px gutter because its own masthead uses one. The shipped `Masthead` is
`px-5`, and a board indented twice as far as the band above it reads as a second page. The columns
stay fluid either way and the no-horizontal-scroll promise is unaffected — it is measured, not
assumed. **Recorded as a deliberate difference from `board.png`.**

### DI-5 — A virtualized column draws no landing slot

The three drawn drag states hold for every column except the append position of a column past the
~100-card virtualization threshold, where the landing site sits a hundred cards below the rendered
window. A slot drawn there would be a promise the reader cannot see, so it is not drawn; the hole,
the in-flight card and the live-region announcement still carry the move. Cross-column moves INTO a
virtualized column still work exactly as before.

### DI-6 — A move made under a filter ranks against the visible neighbours

`rankForSlot` reads the destination column's cards, and under a filter those are the cards that
matched. A card dropped between two visible neighbours therefore takes a rank between THEM, which
can place it anywhere among the hidden rows in between. The alternative — ranking against the
unfiltered column — would put the card somewhere the reader did not drop it. Neither is wrong; the
drawn one wins, and no sibling is renumbered either way.

### DI-7 — Two files outside the surface had to move, and both are flagged for the parallel builds

- `apps/web/src/routes/teams.$teamId.board.tsx` no longer draws band 2: the masthead states the
  FILTERED count, so only the surface that owns the filter can draw it. The route now hands the
  lens toggle to `Board`, exactly as the issues route hands it to `IssueList`.
- **`apps/web/src/frame/app-frame.test.tsx`** — the one file under `frame/` this change touches,
  and only its `Board` stub. That stub used to render an empty div while the ROUTE drew the
  masthead the test asserts against; it now renders the real `Masthead` with the lens it is handed.
  The assertion is unchanged, byte for byte. **A sibling parallel build touching that file will
  conflict here.**

`packages/ui` is touched in three files, not D9's two: `board-card.tsx`, `styles/contrast.test.ts`
and `components/board-card.stories.tsx` (tasks 3.4). Same conflict warning applies.

### DI-8 — What the component tier could not prove, and who proves it instead

dnd-kit's keyboard sensor drives a pick-up and an arrow move under jsdom, so the hole, the
in-flight card's footer and the cross-column landing slot are all asserted there with motion
reduced. Its **Escape cancel** does not fire under jsdom, so the "cancel puts every drawn state
away" claim is not asserted at that tier; `board.spec.ts`'s `Escape cancels a pick-up and writes no
change` keeps the claim verbatim at the e2e tier. Which column an arrow key reaches is geometry and
jsdom has none, so the component test asserts that a FOREIGN column draws exactly one slot, never
which column.

### DI-9 — Loading and missing-team states now read as the list's do

`This team no longer exists.` and `Loading team…` became `Team not found` and `Loading…` — the same
two labels the list uses, and the only sentence on the page is gone (task 4.9).

### DI-10 — The card primitive gets its own test, because the board tier cannot fail for it

`BoardCard` is a `packages/ui` primitive with three registers this change invents (the quiet card,
the hole, the card in flight) and one it removes (the default track labelled
`No delivery signal yet`). The board's component test drives all of them, but only through the
board: a regression in the primitive would surface there as a confusing board failure, and the
package that owns the file would have no test at all — `packages/ui` had none for this component
before this change.

**Decided: `packages/ui/src/components/board-card.test.tsx`, six cases, props only** — no board, no
dnd-kit, no Zero. A card handed no track draws nothing in its slot and exposes no image role while
still reserving the 86px; the phrase and the footer are absent rather than blank when nothing is
supplied; a long title is stated in full with the labels, the assignee and the track slot still
under it and no fixed card height; the hole is the same box with its content hidden; the in-flight
card is raised and carries its keys. **Run against main's `board-card.tsx` all six fail**, which is
the check that they are not describing the framework instead of the change.

### DI-11 — The degenerate states are covered at the tier that can be run here, and the render is still owed

The triage lesson is that a reserved measure over nothing reads as a hole and passes every test.
Three of the five degenerate states are now asserted in `board.test.tsx`: a board with **nothing**
on it (six drawn columns with their labels and a mono `0`, six reserved slots, no words, and a
count of zero — not a blank page), a board with **exactly one** card (the five columns it is not in
each reserve one slot; the column it is in reserves none), and a **forty-card** column (all forty
drawn, the true total in the header and the accessible name, a vertical scroller, and no fold).
The long title is asserted on the primitive (DI-10).

This is not a substitute for task 7.5 and should not be read as one: **a component test cannot see
a hole.** It can prove that the ink exists and that nothing was dropped; whether the composition
reads is a question only the render answers. 7.4 and 7.5 remain unrun and unticked.

### DI-12 — The no-sideways-scroll e2e is measured at 1440, not only at the suite's default

The spec's scenario names 1440 and the Playwright project runs Desktop Chrome at 1280, so an
assertion "at the suite's viewport" would have proven a width the requirement does not mention.
The test now sets 1440×900, measures `scrollWidth === clientWidth` and that Canceled is in the
viewport, then does the same at 1280×720 — the claim is that the promise holds **without a
breakpoint**, so it is asserted at two widths rather than one.

### DI-13 — Three docs outside this surface had gone stale, and a sibling build may be in two of them

Beyond `features/board.md` and `features/issue-list.md`:

- `features/reality-vocabulary.md` opened by listing the surfaces that draw one vocabulary — "an
  issue row, an issue page, the team's morning digest and the Delivery view". A board card is now
  one of them, and that sentence is the page's whole premise.
- `index.md`'s Board entry described the pre-overhaul board (columns and nothing else).
- `features/app-frame.md` says a surface palette that is about something you have not selected
  hands `⌘K` back. True, and now incomplete: on the Board lens what answers next is the Issues
  palette (DI-2), not the frame's own.

`app-frame.md` and `reality-vocabulary.md` are pages a **sibling parallel build may also be
editing**; both edits here are a single sentence and local to the board's claim.

### Still outstanding at the end of this pass

The **render task (7.4) and the degenerate-state renders (7.5) have not been run**: no screenshot
of the built page at 1440×900 has been compared against `board.png`, and the one-card /
all-columns-empty / 40-card / long-title / phrase-without-track states have not been *looked* at —
three of them are asserted at the component tier (DI-11) and that is a different claim. Everything
recorded above as a difference from the mock was decided from the code and the token measurements,
not from a render. Nothing in this section should be read as "the page was looked at".

The full build, the compose smoke test and the Playwright suite (7.1–7.3) were **not run locally**
on this pass; the PR is open, so CI runs them on the push. What was run here and is green: the
typecheck, Biome, the whole Vitest suite for every package downstream of main (`@yapm/web` 621,
`@yapm/ui` 489), the boundary check, and the docs build.
