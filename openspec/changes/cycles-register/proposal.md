## Why

`design-explorations/overhaul-2026-08/destinations/cycles.html` is the approved drawing of the
cycle page, and it makes one large product decision the shipped page never made: **Cycles is THE
REGISTER** — the history of cycles and the work that persists between them — not the active
cycle's plan.

That decision is forced by what already exists elsewhere. Home's hero owns *how is this cycle
going* (day band, committed / landed / added, the shipped list). Delivery owns the six-cycle trend
as journalism. The shipped Cycles page answers the first question a third time: a 256px rail of
cycle buttons beside a detail pane that redraws the progress bar and lists the featured cycle's
issues — a lens the issue list already owns (`cycles` spec, "Group and filter the issue list by
cycle"). What **no** surface in the product shows is the record itself: one row per cycle, and the
work that survived a cycle boundary. `carryover_count` and `rolled_over_from_cycle_id` are written
on every rollover and read by nothing a person can see.

What the shipped page gets wrong, concretely:

1. **It is a register wearing a sidebar.** Sixteen short rows split across a rail and a pane, so
   the one thing a register is for — reading cycles against each other — cannot be done at all.
2. **It is the third copy of Home's hero.** Progress bar, issue list, digest. Two of those three
   are answered better one stop to the left.
3. **The carry fact is invisible.** An issue that has moved cycles three times says so nowhere in
   the product, though the count is stored and monotone.
4. **Borrowed icons.** `CircleDashedIcon` on every rail row, `FlagIcon`, `MessagesSquareIcon`,
   `SparklesIcon` — where this product's own drawn vocabulary should stand. A cycle IS a loop
   filled as far as it has run, so its status belongs on the same 20-grid as an issue's status.
5. **Artifacts are not shown as artifacts.** The Cycle report and Wrapped are named artifacts in
   `ia.html`'s destination tree; on the shipped page one is a panel that always renders and the
   other is a text link.

Vision principles served: **sub-100ms and offline-capable** (every fact renders from rows Zero has
already synced — no new named query), **keyboard-first**, **team-level metrics only** (nothing on
this page has an identity dimension), and the honesty principle that runs through the whole
overhaul — a surface may state only what a stored row supports.

## What Changes

- **Band 2**: `Cycles` + a mono count, `Complete cycle` and `+ New cycle` in the actions slot.
- **THE REGISTER** — one row per cycle, newest first, full width, the active cycle selected:
  a cycle-status glyph drawn on the **issue-status grid** (dashed ring upcoming / half arc active /
  filled disc carrying its check completed), the mono cycle key, the name, the mono date range, a
  **scope ledger reusing the Home hero's own scope-band segments** at row scale, the carry fact,
  and the artifact chips (`Cycle report ·`, `Wrapped ·`) **only where the artifact exists**.
  Selecting a row re-points the two bands below it.
- **The register degrades visibly rather than lying.** `cycle.complete` overwrites
  `rolled_over_from_cycle_id`, so a cycle's committed denominator is reconstructible only until one
  of its carried issues carries again. Rows whose boundary is intact read `8/12` with a hollow
  remainder; older rows read `10 landed` with no remainder drawn. The register's `how ·` states
  that rule once — the mock's own self-critique names this degradation as correct and invisible,
  and `how ·` is the house mechanism for exactly that.
- **THE CARRY CHAINS** — the band that is this page's reason to exist. The work carried into the
  selected cycle: status glyph, key, title, phrase, the chain drawn from `carryover_count` (a node
  per boundary crossed, a named node for the one origin the schema still knows, a dotted lead-in
  for the hops it does not), and `carried N×`. The band **folds entirely** where nothing was
  carried, rather than drawing a zero.
- **THE LAST REPORT** — the selected cycle's stored digest, the one document on this page, with the
  existing narrative / evidence-fallback behaviour and its provenance line unchanged, plus the
  retro doorway and the product-share card.
- **The footnote**, once: *a cycle keeps no status history, so nothing here burns down.*
- **The featured cycle's issue list folds** (mock §5). It is Issues filtered by cycle, which the
  issue list already owns, and Home already answers the question it was there to answer. This is
  the one shipped capability this change deliberately removes; the scope ledger is the progress
  indicator that survives, and the carried rows still open an issue.

Non-goals, folded deliberately — the mock's closing comment records each and the build honours it:

- **NO BURNDOWN, and no burn-up.** There is no issue status-history table; only
  `last_human_status_at` (a scalar), `cycle_assigned_at`, `carryover_count` and
  `rolled_over_from_cycle_id` exist. Remaining-scope-over-time is not reconstructible at any
  fidelity. **Any line falling over time on this page would be an invention.**
- **No velocity, no capacity, no forecast.** Neither exists as a fact.
- **No per-person anything** — no load column, no throughput, no "who carried it". Team-level only
  is a VISION constraint, not a preference.
- **No second attention number.** A three-times-carried issue is not one of the four exception
  classes; it takes an amber wash, never urgent ink and never a badge.
- **No new table, no migration, no mutator, and no new named query.** Every row this page draws is
  already synced by `cycles.byTeam`, `issues.byTeam`, `retros.byTeam` and `digests.byTeam`.

## Capabilities

### New Capabilities

<!-- none: this change re-draws an existing destination over already-synced rows -->

### Modified Capabilities

- `cycles`: the "Cycle view with progress" requirement is rewritten as the register — one row per
  cycle with a truthfully-labelled scope ledger, the carried-in band, the last report, the
  artifact chips gated on artifact existence, the honest degradation of the committed denominator,
  and the removal of the featured cycle's issue list. The keyboard scenario moves with it.

## Impact

- `packages/schema/src/zero/cycle-register.ts` (new, pure — no ZQL): `buildCycleRegister`, the one
  derivation behind the register rows, the ledger, the denominator-intactness rule and the carry
  chains. Placed beside `team-home.ts` so the scope-band semantics (`added` = assigned after the
  cycle started; carry-ins stay committed) are stated once for the whole product.
- `packages/schema/src/index.ts`: the new module's exports.
- `apps/web/src/cycles/cycles-view.tsx`: rebuilt to the mock — masthead, register, carry chains,
  last report. The cycle rail and the featured-cycle issue list go.
- `apps/web/src/cycles/model.ts`: `cycleKey` becomes the register's mono key; `partitionCycles` and
  `cycleProgress` retire or move behind the new derivation if nothing else consumes them
  (`triage-view.tsx` imports `cycleKey`; `retro/model.ts` and `issues/` import the rest — verified
  before deleting anything).
- `packages/ui/src/components/`: the cycle-status glyph joins `status-glyph.tsx` (same grid, same
  stroke, same `DONE_CHECK`); the register row and the carry chain are drawn here if they earn a
  component, in `drawn.tsx`'s register. `ScopeBand` is **reused**, not re-drawn.
- `packages/ui/src/styles/contrast.test.ts`: this page's pairs in every theme block, light and dark
  — the selected row's ground, the carry band's amber wash, the chain's node inks, the chip border.
- `apps/web/e2e/cycles.spec.ts`: selectors updated where the surface moved. No assertion weakened;
  the rollover test gains a carried-in assertion, which is a stronger claim than the shipped one.
  `retro.spec.ts` (`new-cycle`, `complete-cycle`, `cycle-retro-link`), `digest.spec.ts`
  (`cycle-digest`) and `pm-digest.spec.ts` (`new-cycle`, `pm-digest-share`) drive this page too:
  **every one of those test ids is preserved verbatim.**
- No dependency, env var, container, table, migration, mutator or named query is added or changed.

Docs: `apps/docs/src/content/docs/features/cycles.md` (the register's row anatomy, the ledger and
what its segments mean, the denominator degradation and why, the carry chain's notation, the
artifact chips and when they appear, the footnote, and the complete keyboard model),
`features/cycle-digest.md` (where the report now lives), `features/team-home.md` and
`features/delivery.md` if either claims Cycles answers a question it no longer answers, plus the
`README.md` and `ROADMAP.md` status rows.
