## Why

`design-explorations/overhaul-2026-08/northstar/issues.html` is the canonical issue list, and
the shipped list is not it. PR #32 gave the row its drawn vocabulary and PR #33 gave the page
its frame; what is left is the work surface between them — and on that surface the shipped
list still shouts where the mock whispers, and stays silent where the mock speaks.

Three concrete gaps:

1. **The row has no phrase at rest.** The mock's rows say `Checks failing`,
   `Done in git, not on the board`, `Built — not live yet`, `In review — waiting 16h` — and
   quiet rows say nothing at all. The shipped row draws the track and stops there, so the
   list's whole reason for existing (the work graph is visible where the work is) is carried
   by a 118px drawing and an `aria-label` nobody reads.
2. **That same dictionary already exists, privately.** `packages/schema/src/zero/team-home.ts`
   has `sayPhrase` and `gitLine` as **module-private functions**. Home speaks them on its YOURS
   rows. If the list writes its own, `NORTHSTAR.md` §"Consistency check" ("same phrase
   dictionary strings … on issues rows, the delivery peek, and the issue rail") is broken the
   day the second copy is written, and nothing in CI notices.
3. **Band 2's second row shouts.** The mock draws a filter glyph then seven plain-text labels
   and a quiet `Group Status · Sort Priority` at the right. The shipped toolbar is seven
   outline buttons with `lucide` icons, two native `<select>`s and a chevron toggle. The
   capabilities are right; the register is wrong.

Plus two smaller ones the mock settles: group headers are not drawn as the mock draws them,
and the list has no fold at all — it renders every matching row, so the mock's `↓ 109 more`
has no counterpart, honest or otherwise.

Vision principles served: **sub-100ms** (every phrase derives from already-synced rows —
nothing here newly waits on the network), **keyboard-first** (the whole re-registered filter
bar and the new fold stay operable without a pointer), and the honesty principle that runs
through the reality vocabulary — a phrase may only be said when a stored fact supports it.

## What Changes

- **One shared phrase dictionary, in `packages/schema`.** `sayPhrase` is extracted from
  `team-home.ts` into an exported derivation over the same predicates
  (`computeDeliverySignal` + `computeDivergence`), keyed by a single classifier and rendered
  in **two registers**: `personal` (Home's YOURS — "Checks failing — the fix is yours") and
  `neutral` (the list — "Checks failing"). Both registers cover the identical key set, and a
  test fails if they diverge. Home's rendered strings do not change.
- **The row, as the mock draws it.** Priority tick · status arc · mono key · title · spring ·
  **phrase at rest** · reality track · mono age · label dot + name · mono updated · avatar.
  The phrase occupies a **reserved slot**, so a row never reflows when a signal populates. A
  quiet row's slot is genuinely blank. The selected row gains the mock's left accent rail plus
  tinted ground and accent-inked key.
- **Provenance on phrases.** The shared `ProvenanceMark` (GitHub, monochrome, 12px) is a
  **source suffix on check and deploy phrases only**. Which phrases carry it is a property of
  the dictionary entry, not a decision each surface makes.
- **The quiet filter bar.** The seven filter controls, the search input, the seven groupings,
  the six sort keys, the direction toggle and saved views are all **re-registered** as the
  mock's plain text — never cut. Every predicate, every grouping, every sort key and every
  saved-view behaviour survives unchanged.
- **Group headers** as drawn: status arc (or the grouping's own mark) + label + mono count on
  a quiet tinted band.
- **The fold.** A long result renders a bounded page of rows and states the **real** remaining
  count, focusable and operable from the keyboard. It is never decorative and never lies about
  how much is hidden.
- **Word diet.** No explanatory sentence renders on this page. Empty, loading and
  team-missing states are labels.
- **BREAKING (test-visible only):** the Issues masthead title becomes `Issues` (the mock's,
  and already Board's) rather than `<team> · Issues`; the deck states the team. E2E selectors
  that assert the old heading are updated, never weakened.

Non-goals — explicitly out of scope:

- **No Gallery lens.** No design-artifact entity backs it. It folds away; it does not ship
  disabled (precedent: `app-frame` design DI, Decisions).
- **No issue-detail restructuring.** `?open=<issueId>` keeps working exactly as it does; the
  detail page is the next change.
- **No board changes**, no new filter axis, no new sort key, no bulk-edit surface.
- **No new tables, named queries, mutators or migrations.** Nothing new syncs.

## Capabilities

### New Capabilities

<!-- none: this change re-registers and extends existing surfaces -->

### Modified Capabilities

- `issue-list`: the row's phrase-at-rest slot and its provenance suffix; the quiet filter
  bar's register with every capability intact; group-header anatomy; the fold that states the
  real remaining count; the page's word diet.
- `reality-vocabulary`: phrases at rest come from one shared dictionary with two registers,
  derived only from real predicates, and only check/deploy phrases carry a provenance mark.
- `team-home`: YOURS consumes the shared dictionary's `personal` register rather than a
  private table; rendered strings unchanged.

## Impact

- `packages/schema/src/zero/`: new `phrases.ts` (the dictionary + classifier + registers);
  `team-home.ts` loses its private `sayPhrase`; `index.ts` re-exports.
- `packages/ui/src/components/issue-row.tsx`: a reserved `phrase` slot and the selected-row
  treatment; `issue-row.stories.tsx` gains the mock's four cases.
- `apps/web/src/issues/issue-list.tsx`: the row's phrase wiring, the re-registered filter bar,
  group headers, the fold, the word diet.
- `apps/web/src/issues/delivery.ts`: the per-row phrase derivation joins `deliveryView`.
- `packages/ui/src/styles/contrast.test.ts`: the phrase's token pairs in all six theme blocks.
- E2E: `issues.spec.ts` (masthead heading), `cycles.spec.ts` (the `Group by` control's shape);
  every `Filter by <axis>` accessible name is preserved deliberately so the rest do not move.
- No dependency, env var, container, table, query or mutator is added or changed.

Docs: `apps/docs/src/content/docs/features/issue-list.md` (new — the row anatomy, the phrase
dictionary, the filter bar, the fold, the keyboard model), and updates to
`features/reality-vocabulary.md` (phrases at rest are part of the vocabulary),
`features/team-home.md` (YOURS speaks the shared dictionary), `features/delivery-signals.md`
(where the phrases are said), plus `README.md` and `ROADMAP.md` status rows.
