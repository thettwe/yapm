## Context

Everything this change touches already exists and already has one owner:

- `packages/ui/src/components/reality-track.tsx` owns both orientations. `HorizontalTrack` draws the
  stations and the reserved mono age column; `VerticalRail` draws the issue detail's rail. The shape
  is computed by `buildRealityShape(strip, { divergence })` / `buildRailShape(stations, …)`, and a
  fact-free horizontal shape is exactly `[empty, empty, empty, empty]` with three `dotted` segments
  and no `broken` segment.
- Every dense surface already passes a track through that one component. `issue-list.tsx` always
  passes `realityTrack`, with `age={null}` when there is no review age; `team-home.tsx` passes a
  track on its YOURS rows and on the divergence attention row; `issue-row.tsx`'s own
  `EmptyRealityTrack` fallback is what a caller that passes nothing gets. So the correction belongs
  in `HorizontalTrack`, not in three call sites.
- `packages/ui/src/components/status-glyph.tsx` draws all six statuses on one 20-unit grid with a
  1.6px round-capped stroke. `done` is currently `<circle r="7.6" fill="currentColor" />`, and the
  file's own comment argues the check away.
- `apps/web/src/zero/connection.ts` is the single place a connection state becomes words.
  `sync-indicator.tsx` renders `connection.label` and owns the four data hooks the e2e suite reads.
- `packages/ui/src/styles/globals.css` holds six token blocks; `contrast.test.ts` measures them and
  is the only mechanical guard on the palette.

Measured baseline, taken from the shipped tokens before any edit (sRGB, the same maths
`contrast.test.ts` uses):

| preset | `--status-in-progress` vs `--bg` |
|---|---|
| warm light | 2.69 |
| focused light | 2.17 |
| editorial light | 2.87 |
| warm dark | 8.80 |
| focused dark | 9.03 |
| editorial dark | 9.49 |

The three darks already clear both bars comfortably. Only the lights are broken.

## Goals / Non-Goals

**Goals:**

- A dense row with no delivery fact draws nothing in its reality slot, while the slot's reserved
  measure is bit-for-bit what a populated row's is.
- `done` reads as *finished* at the smallest size any surface draws it, in one family with the
  arcs and rings.
- Band 3's healthy state says `Synced`, and no other connection state's wording moves.
- `--status-in-progress` clears the contrast bar appropriate to each way it is actually drawn, in
  all six token blocks, with the measurement pinned in `contrast.test.ts` at the real bar.

**Non-Goals:**

- The vertical rail's empty station. Out of scope by explicit instruction and by argument: the rail
  is the issue detail's subject, and a page about the change that draws nothing where the change
  would be says less than one that states "no change linked yet".
- Any second connection label, any change to `data-testid="connection-status"`, `data-connection`,
  `data-recovery` or the retry affordance.
- Any schema, query, mutator or migration. Any new service. Any restyle beyond these four.

## Decisions

### D1 — The quiet rule is a property of the SHAPE, applied in one place

A horizontal track renders no ink when its shape carries **no fact and no break**: every station is
`empty` and no segment is `broken`. That predicate is computed once, inside `HorizontalTrack`, and
exported as a named helper so a test can assert the rule rather than re-derive it.

Rejected: a `quiet` prop that callers opt into. Three call sites setting a flag is three chances to
disagree about what "empty" means, and the constraint this vocabulary exists to enforce is that
there is exactly one empty state. Rejected also: fixing it in `issue-row.tsx`'s `EmptyRealityTrack`
fallback — `issue-list.tsx` never reaches that fallback, because it always passes a track built from
a possibly-null strip.

Consequence, stated plainly so the reviewer can object to it up front: **board cards go quiet too.**
`board-card.tsx` draws a horizontal track from `buildRealityShape(null)` and will now draw nothing
there. That is the same rule and the same mock behaviour, and forking a second empty state to spare
one surface is the bug this component was written to prevent.

A *partially* populated track is untouched: a strip with a PR but no deployment still draws its
hollow stations and dotted segments, exactly as `issues.html` draws them on ENG-115 and ENG-119.
The hollow ring is scaffolding **between facts**; with no facts at all there is nothing to scaffold.

### D2 — A quiet track is silent to assistive technology as well as to the eye

The blank slot renders as `aria-hidden`, with no `role="img"` and no "No delivery signal yet" label.

The alternative — keep the label — was considered and rejected. A screen reader reading a list
would announce "No delivery signal yet" on most rows on the page: the audible form of exactly the
ornament this correction removes. The precedent is in the same file: `issue-row.tsx`'s phrase slot
already documents that a row with nothing true to say renders "genuinely blank — never a dash,
never filler", and it carries no label either.

The label is **not** lost where it carries meaning: a track that draws any fact keeps its composed
`role="img"` label, and `realityTrackLabel(null)` still returns "No delivery signal yet" for the
surfaces that state it in words (the board card's own accessible text, the docs' description of the
label contract). What changes is that a blank drawing does not announce itself.

Fallout, both directions: `apps/web/e2e/issues.spec.ts` asserts `getByLabel('No delivery signal
yet')` is visible on a freshly created row — that assertion is rewritten to assert the reserved,
quiet slot. `apps/web/e2e/connectors.spec.ts` twice asserts that label has count 0 once a PR syncs
in; those would become vacuously true, so they are rewritten to assert the quiet marker is absent,
which keeps them meaningful.

### D3 — The reserved measure is proven by measurement, not by inspection

The slot keeps `width: REALITY_TRACK_WIDTH` and, when the surface draws an age column, the
`AGE_COLUMN_WIDTH` child. `reality-track.test.tsx`'s existing width-parity test is **kept and
strengthened**, not replaced: a quiet track and a populated one at the same measure must report the
same reserved width and the same age-column width, and additionally the quiet one must contain no
node, no segment and no break element. The alignment guarantee is the thing this correction is most
able to break, so it gains an assertion rather than losing one.

A `data-quiet` attribute on the slot gives the e2e suite something to point at that is not a colour.

### D4 — `done` carries a check as a knockout, and the knockout ink is a token

`done` stays a filled disc on the same grid; the check is drawn **inside** it, in a colour that
contrasts against the disc. Two candidate tokens were measured against every hue the glyph is ever
inked with (`--status-done`, and `--status-urgent`, which `team-home.tsx` applies to the glyph on an
urgent say row):

| preset | `--bg` vs done | `--bg` vs urgent | `--on-accent` vs done | `--on-accent` vs urgent |
|---|---|---|---|---|
| warm light | 3.82 | 3.85 | 4.09 | 4.11 |
| focused light | 5.00 | 3.66 | 5.00 | 3.66 |
| editorial light | 3.85 | 3.60 | 3.95 | 3.70 |
| warm dark | 6.06 | 5.39 | 6.06 | 5.39 |
| focused dark | 5.27 | 5.34 | 5.27 | 5.34 |
| editorial dark | 7.23 | 7.69 | 7.23 | 7.69 |

Both clear 3:1 everywhere. **`--bg` is chosen**: the check reads as the page showing through the
disc, which is the same knockout idiom the vertical rail already uses for its node haloes, and it
keeps the brand accent's ink token off a status mark (`component-library`: the accent never denotes
status). `contrast.test.ts` gains an assertion covering both hues so a later token edit has to argue
with the number.

The check itself keeps the family: round caps, the shared stroke constant, endpoints on the same
20-unit grid. If the 1.6px shared weight proves illegible at the 14px a dense row renders —
1.12 device px — the build may step the check's stroke up by one value **and record the exact value
and the reason here**, because a stroke weight the family does not share is a divergence the next
reader deserves to find written down.

`canceled` is untouched: it is the product's sixth status, already redrawn on this grid, and nothing
about it is wrong.

### D5 — `Synced` replaces `Connected`, at the one place a state becomes words

The edit is one string in `summarizeConnection`. Nothing else in that function moves — `connecting`,
`disconnected`, `needs-auth`, `error` and `closed` each already say something true and specific, and
"Synced" would be a lie in every one of them. `sync-indicator.tsx` is not edited at all: it renders
`connection.label`, and that is the correct seam.

Four unit-test fixtures across `apps/web/src` hard-code `label: 'Connected'` as a stub; those are
fixtures, not assertions, but they are updated so the stubs describe the product. The one real
assertion (`sync-indicator.test.tsx`) and `connection.test.ts` move to `Synced`.

The e2e suite reads `data-connection="connected"` — the state name, not the label — in fifteen
specs. None of them changes, which is exactly why the attributes are named in the spec.

### D6 — The amber is retuned in the lights, and the token SPLITS rather than being dragged to 4.5

`--status-in-progress` is drawn two different ways:

| usage | kind | bar |
|---|---|---|
| the in-progress half-arc (`status-glyph.tsx`) | non-text drawing | 3:1 |
| the label dot on an issue row (`issue-row.tsx` `LABEL_TONE`, a `bg-current` dot) | non-text drawing | 3:1 |
| the attention amber square (`team-home.tsx`) | non-text drawing | 3:1 |
| the connecting / needs-auth sync dot (`sync-indicator.tsx`) | non-text drawing | 3:1 |
| the project and roadmap `active` dots | non-text drawing | 3:1 |
| the retro caution card's mark | non-text drawing | 3:1 |
| the flow band's added-block outline (`flow-band.tsx`, `drawn.tsx`) | non-text drawing | 3:1 |
| the scope band's `+` in an added block (`drawn.tsx`, 9px bold) | **text** | 4.5:1 |
| the hero's in-progress count (`team-home.tsx`, 20px bold) | **large text** | 3:1 |

Only one usage is normal-size text, and it is 9px. Dragging one amber to 4.5:1 on a near-white
ground lands it around `#9a671c`–`#9c6d19`: a brown, not an amber, and in editorial light it closes
on that preset's `--status-urgent` (`#cc6b13`, itself an orange) rather than staying clearly apart
from it. That fails two of the three stated constraints to satisfy the third.

So the token **splits**, following the precedent already in this palette:

- `--status-in-progress` — the drawn hue. Retuned in the three light blocks until it clears **3:1**
  against `--bg`, staying recognisably amber and staying clearly separated from `--status-done` and
  `--status-urgent`. Unchanged in the three darks (8.80–9.49 measured), which are asserted rather
  than assumed.
- `--status-in-progress-ink` — the text ink, clearing **4.5:1** against `--bg` and against the two
  composited grounds amber text is drawn on. In the darks it aliases `--status-in-progress`, exactly
  as `--status-urgent-ink` does in two of the three dark blocks. The 9px `+` takes it.

This is the same shape as `--status-urgent` / `--status-urgent-ink` (PR #31), for the same reason,
and it means the amber stays amber. The alternative — one token at 4.5 — is recorded here so that a
later change wanting it finds the measurements rather than re-taking them.

The `>= 2.1` / `>= 1.3` pair in `contrast.test.ts` §"records the added cap's tint as reinforcement"
is **replaced** by real bars. The surrounding decision — that the flow band's added cap is an
outline separated by page ground rather than a stacked fill — stands on its own (two quantities must
be two shapes at any contrast, and amber-vs-green never reaches 3:1 in any preset), so the drawing
does not revert; only the assertion that documented a break becomes an assertion that prevents one.

### D7 — The mock is wrong about the amber, and `NORTHSTAR.md` says so

The northstar files carry the failing amber verbatim from the Warm LIGHT block. Accessibility wins.
`NORTHSTAR.md` §"What the build kept, and the two places it had to diverge (PR #33)" is the
established form for recording this; a third divergence is appended there with its measured numbers,
so a future assembly pass does not "fix" the product back to the mock.

The other three corrections move the product **toward** the mocks, so they need no divergence note.

### D8 — Scope, settled before the build starts

No new tables, no new queries, no mutators, no migration — this is drawing and tokens. These four
corrections are the whole change. Keyboard-first and the sub-100ms budget are untouched: nothing
here adds a network wait, a layout pass or a focus stop.

## Risks / Trade-offs

- **The quiet rule reaches board cards.** Argued and accepted in D1, but it is the one place where
  the correction's blast radius exceeds its brief. If a reviewer wants board cards to keep the
  placeholder, the honest answer is a second empty state and a reason written down, not a prop.
- **Silence for screen readers (D2).** Removing the label removes an announcement some reader may
  have relied on. Mitigated by the label surviving everywhere a fact is drawn, and by the phrase
  slot's identical precedent — but it is a judgement call, not a measurement.
- **The check's legibility at 14px cannot be settled by a test.** A geometry test can assert the
  path exists, that it is drawn on the shared grid with round caps, and that its ink is a token; it
  cannot assert that a human reads it as a check at 1.12 device px. That is eyes-on.
- **"Recognisably amber" is likewise not machine-checkable.** The contrast numbers are, and the
  separation from green and terracotta can be bounded numerically, but whether the retuned value
  still reads as amber in Warm light is a human call.
- **`--status-in-progress` is a `--chart-1` alias.** Retuning it moves any chart drawn from
  `--chart-1`. That is intended (the same hue, legible), but the delivery charts should be looked at
  once after the retune.
- **e2e churn.** Two spec files change assertions. The risk is weakening them by accident; both
  rewrites assert something *stronger* (the presence of a reserved-but-quiet slot, the absence of a
  quiet marker on a populated row) rather than deleting the check.
- `apps/web/e2e/projects.spec.ts` has shown timeout flake independent of any change. Re-run before
  diagnosing; do not loosen it.

## Decisions made during implementation

### DI-1 — The baseline was reproduced, not trusted

Re-measured from `globals.css` with `contrast.test.ts`'s own sRGB maths before any edit.
`--status-in-progress` against each block's `--bg`:

| preset | value | vs `--bg` |
|---|---|---|
| warm light | `#ce8a26` | **2.69** |
| focused light | `#e0a63c` | **2.17** |
| editorial light | `#c98a15` | **2.87** |
| warm dark | `#e7ab44` | 8.80 |
| focused dark | `#e0a63c` | 9.03 |
| editorial dark | `#e7a93a` | 9.49 |

Identical to §Context. D4's knockout table was reproduced too: `--bg` against `--status-done`
measures 3.82 / 5.00 / 3.85 / 6.06 / 5.27 / 7.23 and against `--status-urgent` 3.85 / 3.66 / 3.60 /
5.39 / 5.34 / 7.69, so the check clears 3:1 against both hues in all six blocks.

### DI-2 — The amber's bar is every ground a row is painted on, not `--bg` alone

The brief and D6 name 3:1 against `--bg`. Measuring the lights at that bar alone leaves the amber
at ~2.65 on the **selected** row's tint and on a selected board card's soft-accent wash — grounds
the in-progress half arc and the row's label dot are genuinely drawn on. That is a contrast
assertion written below the bar the usage requires, which is the one thing this change's own spec
delta forbids, and the palette already has the precedent: focused light's `--status-in-review` was
darkened in PR #32 for exactly that surface, with the reason written into `globals.css`.

So the bar is 3:1 on all seven grounds a row or card paints — `--bg`, `--bg-elevated`,
`--bg-sidebar`, the hover wash, the selected tint, a selected card's soft accent, and the divergence
row's urgent wash. Retuned by holding OKLCH hue and chroma and lowering lightness only:

| preset | before → after | vs `--bg` | worst of the seven |
|---|---|---|---|
| warm light | `#ce8a26` → **`#b67500`** | 2.69 → **3.55** | 3.12 (selected) |
| focused light | `#e0a63c` → **`#b47e00`** | 2.17 → **3.54** | 3.11 (selected) |
| editorial light | `#c98a15` → **`#b37900`** | 2.87 → **3.62** | 3.13 (selected) |

The three darks measure 8.00–9.49 on the same seven grounds and were left alone — measured, not
assumed, and now asserted.

### DI-3 — Separation is a HUE bound, because it was never a luminance one

Task 6.3 asks for a numeric separation bound. Contrast ratio is the wrong instrument for it: amber
against green measures **1.31–2.31** across the six presets *before* this change and 1.03–1.71
after, and no lightness that leaves both recognisable ever reaches 3:1. What actually separates the
three statuses is hue — and, on the status glyph, shape. So the assertion is an OKLCH hue-angle
bound (`>= 60°` from `--status-done`, `>= 18°` from `--status-urgent`), and the amber-vs-green
contrast is kept as a **recorded lower bound with its reason**: it is why the flow band's added cap
is an outline separated by page ground rather than a stacked fill.

Because the retune held hue exactly, the measured separations are **unchanged** by this change:
86.7–162.6° from the done hue and 20.9–46.0° from the urgent one. The tightest pair is editorial
light's amber against its orange `--status-urgent` at 20.9°, which is what it has always been. This
change neither improves nor worsens it; nudging the hue to widen it was considered and rejected as
an unrequested restyle, and it is recorded here so a later change wanting it finds the number.

### DI-4 — The token splits (D6 confirmed), and only one usage moved

Every `--status-in-progress` occurrence in the product was enumerated and classified. D6's list is
accurate and complete: the status glyph's half arc, `issue-row.tsx`'s `LABEL_TONE` `bg-current`
dot, `team-home.tsx`'s attention square, `sync-indicator.tsx`'s connecting/needs-auth dot,
`projects-view.tsx` and `roadmap-view.tsx`'s active dots, `retro-card.tsx`'s caution mark,
`issue-detail.tsx`'s warm activity dot and `flow-band.tsx`'s ribbon and added-block outline are all
**non-text drawing** and stay on `--status-in-progress`. `team-home.tsx`'s 20px-bold in-progress
hero count is **large text** (3:1) and stays. The single normal-size text usage — `drawn.tsx`
§ScopeBand's 9px bold `+` — moved to the new `--status-in-progress-ink`.

The ink clears 4.5:1 against `--bg`, `--bg-elevated`, `--bg-sidebar` and the hover wash:
`#935e00` (4.57–5.47), `#956800` (4.56–4.93), `#946300` (4.56–5.19). The three darks alias it to
`--status-in-progress`, which measures 8.00–9.49 there, exactly as two of the three dark blocks do
for `--status-urgent-ink`. `--color-status-in-progress-ink` is registered in `@theme` beside its
base token, mirroring the urgent pair.

### DI-5 — What the retune does to the charts, measured

`--chart-1` aliases this token, so the delivery page's flow band moved. Measured rather than
eyeballed (the showcase pass is 8.4, Close phase):

- The carryover **ribbon** (`--status-in-progress` at 15% over `--bg`) goes `#f2e7d3 → #f0e4cd` in
  warm light and equivalently in the other two lights. `--text-1` over it measures 11.91–15.26, so
  the count drawn on the ribbon is if anything more legible. The existing assertion still passes.
- The ribbon's **outline** (the same hue at 40%) rises from ~1.4 to **1.59** against `--bg` in all
  three lights — still deliberately below the non-text bar, still scaffolding, and now slightly
  easier to see. The assertion that records it as scaffolding is a lower bound, so it holds.
- The flow band's **added-block outline** is a full-strength stroke and gains the whole retune: it
  goes from 2.17–2.87 to 3.54–3.62 against the page ground, which is the one chart mark that was
  actually failing.

Nothing on the page reads differently in kind; the amber is deeper. Eyes-on confirmation of that in
all six presets belongs to task 8.4.

### DI-6 — The check keeps the shared 1.6 stroke

Drawn as `M6.3 10.3 8.9 12.9 13.7 7.3` on the 20-unit grid, `stroke="var(--bg)"`, round caps and
round join, `strokeWidth` from the shared `STROKE` constant. D4 permits stepping the stroke up one
value if 1.6 proves illegible at `size-3.5`; it was **not** stepped, and the reason is a ratio
rather than a guess: 1.6 on a 20-unit box is a stroke-to-viewBox ratio of 0.080, and the icon set
this glyph family reads beside (Lucide's `circle-check`, 2 on 24) is 0.083. Every vertex sits
inside r=7.6 with the half-stroke clear of the edge, asserted in `status-glyph.test.tsx`.

The ratio has to be paid at the **smallest** size the product draws, and that is not the dense
row's `size-3.5`: `delivery-view.tsx` draws the glyph at `size-[13px]` in the Delivery peek's chip
and its panel. So the numbers are 1.04 device px for this check against Lucide's 1.08 at 13px
(1.12 against 1.17 at 14px) — the same ordering, one step smaller. The judgement that survives
testing — whether a human reads it as a check at 1.04 device px — is task 8.4's, which now steps
both sizes, and if it fails there the one-step stroke increase is still available with this note to
amend.

`backlog`, `todo`, `in-progress`, `in-review` and `canceled` are byte-unchanged; confirmed by diff
and by a test asserting no other status draws a `currentColor`-filled disc.

### DI-7 — The three quiet call sites needed no edit, confirmed by reading

`issue-list.tsx` (~703) always passes `realityTrack` built from a possibly-null strip, so it never
reaches `issue-row.tsx`'s `EmptyRealityTrack` fallback — the correction had to be in the component,
not at the call site, exactly as D1 says. `team-home.tsx`'s divergence attention row (~438) and its
YOURS rows (~787) both pass a `RealityTrack` directly, as does `board-card.tsx` (~110) for its own
fallback. All four route through `HorizontalTrack`, and none was edited. Board cards therefore go
quiet too — argued and accepted in D1.

`issue-row.tsx`'s `EmptyRealityTrack` still composes `realityTrackLabel(null)`; the label is simply
not rendered while the slot is quiet. It is left in place because it is what the slot would announce
the moment it has a fact, and removing it would make the fallback differ in shape from every real
call site.

### DI-8 — The e2e rewrites assert something stronger, not something weaker

`issues.spec.ts` asserted a newly created row shows `getByLabel('No delivery signal yet')`. It now
asserts the slot is present, carries `data-quiet="true"`, is `aria-hidden`, has a **non-zero
measured width read off the element itself** (never a hard-coded number, and nothing that encodes
fixture size), draws no status-inked or `border-border-strong` node, and no longer announces the
absence.

`connectors.spec.ts`'s two `getByLabel('No delivery signal yet')` count-0 assertions would have
become vacuously true — a quiet slot has no label to find. Both now assert
`[data-slot="reality-track"][data-quiet]` has count 0 on the populated row, which still fails if the
track ever stops populating.

### DI-9 — `Synced` moved one string, and four fixtures

`summarizeConnection`'s `connected` case is the only production edit; `sync-indicator.tsx` is
byte-unchanged, and `data-testid="connection-status"`, `data-connection`, `data-recovery` and the
retry control are untouched — grepped and confirmed, and the fifteen e2e specs read the **state
name**, not the label. `connection.test.ts` gained an assertion that only the healthy state says
`Synced` and that no other state's wording contains it, in every recovery phase. The four
`label: 'Connected'` stubs in `sync-indicator.test.tsx`, `search-view.test.tsx`,
`use-server-search.test.tsx` and `issues/command.test.tsx` now describe the product.

### DI-10 — Constraints, confirmed by inspection

No table, no query, no mutator, no migration; `packages/schema` is untouched. No new container. No
literal colour was added anywhere — the check's ink is `var(--bg)` and the `+`'s is a token class.
Nothing was added to the keyboard path and nothing new waits on the network: the quiet branch is a
pure render-time predicate over an already-computed shape, and the token retune is CSS.

### DI-11 — One of the new assertions could not have failed, and now can

Task 6.1 asked for the amber-vs-green measurement to be kept "as a recorded lower bound with its
reason". It was written as `toBeGreaterThanOrEqual(1.0)`, and a contrast ratio is `>= 1` by
definition — the assertion could not fail under any palette, which is the one property this
repository's tests are not allowed to have. It was a comment wearing an `expect`.

The claim the comment actually makes is that the pair stays **below** the non-text bar, which is
why the flow band's added cap is an outline separated by the page ground rather than a stacked
fill. That is the falsifiable form, so the bound is now `toBeLessThan(AA_LARGE)`: it measures
1.03–1.71 today, and the day a retune makes amber and green clear 3:1 against each other is the day
the outline's premise is gone and someone should look at the drawing again rather than find the
recorded reason quietly untrue. Failing on an improvement is the correct behaviour here — the test
guards a *decision*, and the decision's input changed.

The other thirteen new assertions were checked against `main`'s sources rather than argued about:
reverting `reality-track.tsx`, `status-glyph.tsx`, `globals.css` and `connection.ts` to `main` and
running the suite fails **15 tests** — the three quiet-track cases, the three check cases, and nine
contrast cases across the six presets. The width-parity pair does *not* fail on `main`, correctly:
it is an invariant that must hold on both sides. It was proven falsifiable separately by mutation —
pinning the quiet slot's width to `0px` fails both `reality-track.test.tsx`'s parity test and
`issue-row.test.tsx`'s.

### DI-12 — The docs sweep found three stale claims, not zero

Task 7.4's four pages: `team-home.md`, `app-frame.md` and `board.md` needed nothing (`app-frame.md`
already drew `● Synced` in its statusline example; `board.md` describes the card without mentioning
its track at all, which is a pre-existing omission this change does not create). **`issue-list.md`
did need it**, in two places the first pass missed:

- The phrases-at-rest table collapsed two different facts into one row — *"Deployed, or nothing has
  happened yet … *(nothing — the track already says it)*"*. After this change the track says it
  only in the deployed case; when nothing has happened the row is blank **and so is the track**, so
  the parenthetical was half false. Split into two rows that each state what is drawn.
- The row anatomy and the reserved-measure paragraph described the slot's width without saying it
  draws nothing, which is the correction itself. Both now say it, with the pointer to the
  vocabulary page.

Task 7.5's root sweep found two more. `DESIGN.md` §1 said the row "renders a quiet 'not linked'
state" pre-connectors — the sentence this change falsifies most directly; it now states the inkless
reserved slot and names the rail as the deliberate exception. And **`ROADMAP.md` had no row for
this change at all**: the convention every recent change follows is that the feature PR adds its
row as `🚧 in progress` and the archive commit flips it to `✅ built & archived (PR #N)` — confirmed
by reading `31de6e0`, which added row 34 in exactly that state. Row 35 is added the same way.
`README.md`, `TECHSTACK.md`, `VISION.md` and `.env.example` make no claim this change falsifies, and
no environment variable moved, so the Zod schema and `.env.example` stay in step by not moving.

No new docs page was needed, so the sidebar in `apps/docs/astro.config.mjs` is unchanged; the three
pages this change edits were already wired.

### DI-13 — Quietness is read from the FACTS, not from the nodes the drawing filled

D1 states the rule as "every station is `empty` and no segment is `broken`", and the first
implementation read exactly that off the drawn shape. The two are not the same predicate, and the
gap is a real row: `prNode` fills `empty` for `pr: 'closed'`, because the node vocabulary has no
closed kind, and `reviewNode` fills `empty` whenever the PR is not open, approved or merged. A
change that was closed without merging, with no check runs, therefore drew four empty nodes while
the strip held two facts — `PR closed` and the review age — both of which `realityTrackLabel`
states and the age column draws. Read off the nodes, that row went inkless, `aria-hidden` and
unlabelled: the drawing's blind spot deciding what the row is allowed to say.

So `TrackShape` gained `factless`, recorded by `buildRealityShape` because the builder is the only
thing that sees the strip: true when the strip is null or all four axes are absent. `isQuietTrack`
requires it *in addition to* the all-empty and no-break tests, which stay — they are what makes an
inkless slot safe, and dropping them would let a shape a caller assembled by hand go quiet with ink
in it. D1's property is unchanged: one predicate, computed once, exported so a test can assert the
rule rather than re-derive it.

`buildRailShape` states `factless: false`, as do the four hand-built rail shapes in the showcase,
the stories and the tests. A rail names its own stations rather than handing over a strip, and it
is excluded from the quiet rule by the surface that draws it, so `false` is both the honest value
and the safe default: the failure mode of getting it wrong is drawing scaffolding nobody needed,
not silently discarding a fact.

### DI-14 — Two shipped capability specs asserted the placeholder this change deletes

`openspec/specs/issue-tracking/spec.md`'s delivery-seam requirement says an unlinked issue yields
"the quiet 'not linked' placeholder", with a scenario whose THEN says the same; and
`openspec/specs/work-graph/spec.md`'s linked-entities requirement says such a row "renders the
quiet unlinked state exactly as before". Both are the shipped description of behaviour this change
removes, and neither is in the proposal's modified-capabilities list — so `openspec/specs/` would
have contradicted the product from the moment this change archived.

Both now have deltas under this change's `specs/`, restating the full requirement with the reserved
inkless slot, the rail's exception, and (in `issue-tracking`) the DI-13 rule that fact-freeness is a
property of the signal's axes rather than of the drawn stations. The delta is the whole requirement
and its whole scenario list, as `delivery-journalism`'s `MODIFIED Requirements` block does.

### DI-15 — The check's smallest size is 13px, not 14px

The legibility constraint, its test name and task 8.4 were all written against `size-3.5` (14px),
the dense row's default — but `delivery-view.tsx` draws the same glyph at `size-[13px]` in the
Delivery peek's chip and panel, and `reality-vocabulary`'s scenario names "the smallest size any
surface draws it". So the constraint was being argued and checked at a size that is not the one the
spec asks about. The comment in `status-glyph.tsx`, the test name, §DI-6's ratio and task 8.4 now
all name 13px and the surface that draws it; the test renders both sizes. Nothing about the drawing
changed — the stroke argument survives the smaller number (1.04 device px against Lucide's 1.08)
— and whether a human reads it there is still 8.4's call.
