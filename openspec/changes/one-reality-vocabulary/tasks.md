# one-reality-vocabulary — tasks

Sequenced so the app runs after each numbered group.

## 1. Read the rulebook before writing code

- [x] 1.1 Read `design-explorations/overhaul-2026-08/northstar/ia.html` (§"Two patterns, drawn
      once", §"Provenance") and `northstar/NORTHSTAR.md`.
- [x] 1.2 Read `issues.html` (`<defs>` for the arcs/ticks; `.track`/`.tn`/`.tseg`/`.tbreak`/`.t-age`
      CSS), `issue.html` (`.metro`/`.stop`/`.break-mark` — the vertical rail), `delivery.html` (the
      peek and `how ·`), `home-digest-2.html` (the track on attention and YOURS rows).
- [x] 1.3 Read `reference/zero.md` (Zero 1.x names, not 0.x) and the Tailwind 4.3 reference note.
- [x] 1.4 Read `packages/ui/src/components/{issue-row,status-glyph,priority-mark,board-card}.tsx`,
      `apps/web/src/home/{drawn,cadence-chart,team-home}.tsx`,
      `apps/web/src/issues/{issue-list,issue-detail,delivery}.ts(x)`, and
      `packages/schema/src/zero/{delivery,team-home}.ts`.

## 2. The one shared type and the generalized track

- [x] 2.1 Collapse `RealityStripProps` (`packages/ui`) and `TeamHomeStrip`
      (`packages/schema/src/zero/team-home.ts`) into one shared delivery-strip shape (design §D3);
      update `packages/schema/src/index.ts` exports and every reference.
- [x] 2.2 Add the generalized track model to `packages/ui`: exported `TrackNodeKind`,
      `TrackSegmentKind`, `TrackStation`, `TrackShape`, and the `buildRealityShape(strip, {divergence})`
      builder. The `//` break is a **segment kind**, not a `breakBefore` index, and its position is
      derived from the divergence kind (design §D1).
- [x] 2.3 Implement `RealityTrack` with composable `orientation` (`horizontal` | `vertical`),
      width and station set (design §D2). Horizontal preserves today's node/segment class maps;
      vertical draws the `issue.html` metro: gutter node, 2px connector, per-station label line and
      mono fact line, dashed connector + `//` at the break.
- [x] 2.4 Accessibility: horizontal track is `role="img"` with the composed truthful label
      (preserving the existing `RealityStrip` label composition, plus the divergence sentence when
      the break is drawn); vertical rail is a list of stations (design §D11).
- [x] 2.5 Verify: `pnpm turbo lint typecheck` green; the app still builds and runs.

## 3. Arcs and ticks reconciled to the mock geometry

- [x] 3.1 Rewrite `packages/ui/src/components/status-glyph.tsx` to the `issues.html` `<defs>`
      geometry — 20-grid, 1.6px round-cap strokes, dashed ring / open ring / half arc /
      three-quarter arc / filled disc. Exported API (`StatusKind`, `STATUS`, `role="img"` +
      `<title>`) unchanged. `canceled` is redrawn on the same grid (design §D5).
- [x] 3.2 Rewrite `packages/ui/src/components/priority-mark.tsx` to the mock's tick geometry —
      round-capped tick strokes, unfilled ticks at `.35` opacity, urgent as one standing tick plus a
      dot. `no-priority` renders all three ticks quieted. Exported API unchanged.
- [x] 3.3 Verify: every existing consumer of both components compiles and renders unchanged in API
      terms; `pnpm turbo lint typecheck` green.

## 4. Promote the drawn primitives into one shared module

- [x] 4.1 Move `DayBand`, `ScopeBand`, `TickBar`, `TriageDots` and `CadenceChart` from
      `apps/web/src/home/{drawn,cadence-chart}.tsx` into `packages/ui/src/components/`, taking plain
      structural props (design §D4). Confirm each is genuinely free of app/schema dependency; if one
      is not, record why in design.md and place it in a shared app module instead.
- [x] 4.2 Refactor `apps/web/src/home/team-home.tsx` onto the shared module — both `RealityTrack`
      call sites (`:432` broken form → the divergence-derived shape; `:772` the YOURS row) and every
      band primitive.
- [x] 4.3 **Delete** `apps/web/src/home/drawn.tsx` and `apps/web/src/home/cadence-chart.tsx` — no
      re-export shim, no duplicate copy anywhere in the repo.
- [x] 4.4 Verify: `rg` for a second implementation of any drawn primitive returns nothing; team home
      renders identically to before (same bands, same evidence).

## 5. Retire the icon strip and migrate every consumer

- [x] 5.1 Delete `RealityStrip`, `RealityStripPlaceholder`, `DivergenceFlag`, `PR_GLYPH`, `CI_GLYPH`
      and the now-unused lucide imports from `packages/ui/src/components/issue-row.tsx`; replace the
      `realityStrip` + `divergenceFlag` slots with one `realityTrack` slot that reserves the track's
      width. Keep `formatReviewAge` (still used by `inbox-view.tsx`).
- [x] 5.2 `apps/web/src/issues/issue-list.tsx` — swap the primitive at `:546`, drop the
      `divergenceFlag` prop at `:548`, keep the row's present layout. Pass the divergence kind into
      the shape so the break is drawn.
- [x] 5.3 `apps/web/src/issues/issue-detail.tsx` — `DeliveryDetail` draws the horizontal track;
      delete `CI_HEALTH_GLYPH` and `CiHealthMark` and express CI through the shared vocabulary. Keep
      the `DetailField label="Delivery"` layout; do **not** restructure the page.
- [x] 5.4 `apps/web/src/issues/delivery.ts` — `DeliveryView.strip` takes the shared type.
- [x] 5.5 `packages/ui/src/components/board-card.tsx` — the placeholder becomes the track's empty
      shape at the card's measure.
- [x] 5.6 `apps/web/src/routes/showcase.tsx` — render the new vocabulary; the divergence-triangle row
      becomes a broken-track row.
- [x] 5.7 Verify: `pnpm turbo lint typecheck build` green; `rg "RealityStrip|DivergenceFlag|CI_GLYPH|CI_HEALTH_GLYPH"`
      over `apps` and `packages` returns nothing.

## 6. The three shared patterns

- [x] 6.1 The `Door` affordance — the dotted underline that means "this opens something"
      (`ia.html` `.door`), accent-hot variant included.
- [x] 6.2 The **peek**: `PeekProvider` + `usePeek(id)` holding `openPeekId: string | null`, so at
      most one peek is open **by construction** (design §D6). Hover **or** focus opens; `Enter`
      navigates; `Escape` closes and restores focus. `aria-expanded` on the trigger, accessible name
      on the panel, no focus trap. Elevated via `--bg-elevated` + a tokenized shadow.
- [x] 6.3 The **how**: `<How label="…">derivation</How>` — mono `how ·` at rest, click/`Enter`
      opens, `Escape` closes and restores focus, `aria-expanded` on a real button (design §D7).
- [x] 6.4 The **provenance mark**: `<ProvenanceMark provider="github" | "figma" />` — monochrome,
      12–14px, `currentColor`, no color prop, no upload member, additive provider record
      (design §D8).
- [x] 6.5 Verify: all three fully operable from the keyboard; `pnpm turbo lint typecheck` green.

## 7. Tests

- [x] 7.1 Rewrite `packages/ui/src/components/issue-row.test.tsx` onto the track: the empty track
      reserves the same width as a populated one; a diverged shape draws the break; the accessible
      label states the facts drawn.
- [x] 7.2 Unit test `buildRealityShape` — each of the three divergence kinds puts the break on a
      different segment; the four facts map to the documented node kinds; no fifth axis is drawn.
- [x] 7.3 Unit test the shared-type assignability guard (design §D3): the UI's mirrored `PrState` /
      `CiHealth` / day-band unions and the schema's are assignable both ways, so a schema-side
      addition cannot silently diverge.
- [x] 7.4 Component test the peek's single-open invariant: opening a second peek closes the first;
      focus opens it; `Escape` closes it and returns focus to the trigger.
- [x] 7.5 Component test the how: quiet at rest, opens and closes from the keyboard, focus restored.
- [x] 7.6 Extend `packages/ui/src/styles/contrast.test.ts` — every track node color and the `//`
      break ink asserted against `--bg`, `--bg-hover`, `--accent-soft` and `--urgent-soft` in all six
      theme blocks, at 3:1 for drawn nodes and 4.5:1 for the break and mono fact lines (design §D11).
- [x] 7.7 Update `packages/ui/src/components/issue-row.stories.tsx` and add stories for the
      vertical rail, the peek, the how and the provenance mark.
- [x] 7.8 Update the e2e selectors that name the retired slot — `apps/web/e2e/connectors.spec.ts`
      (four `[data-slot="reality-strip"]` assertions, including the three-preset light/dark loop) and
      `apps/web/e2e/issues.spec.ts`. Every assertion asserts the **same fact about the same row**;
      none is weakened or deleted.
- [x] 7.9 No new integration test and no new e2e test beyond the selector updates: this change adds
      no query, no mutator and no permission surface, so PROCESS.md §3's big-feature rule does not
      trigger. Record the check in design.md.
- [x] 7.10 Run the gates: `pnpm turbo lint typecheck test build`, the compose smoke test, and the
      Playwright e2e suite. Lint, typecheck and the unit/component suites run locally; the full
      build, the compose smoke test and Playwright are CI's on PR #32, which is the gate of record.

## Documentation

- [x] 8.1 New `apps/docs/src/content/docs/features/reality-vocabulary.md` — the track and its
      stations, what the four facts are and the two things the data cannot say, divergence as the
      break, status as cycle position and priority as weight, the peek (hover or focus, ⏎ goes, esc
      stays, one at a time), the how, and the provenance rule.
- [x] 8.2 Update `apps/docs/src/content/docs/features/delivery-signals.md` where it describes the
      strip as glyphs and a rocket; cross-link the new page.
- [x] 8.3 Sweep the docs site for any other page describing the reality strip as icons or the
      divergence flag as a warning glyph, and fix each.
- [x] 8.4 Update `README.md` (feature list wording where it names the "reality strip") and
      `DESIGN.md` (the row's reality slot).
- [x] 8.5 Add the ROADMAP change row (row 30) with an honest status.
- [x] 8.6 Verify: `pnpm --filter @yapm/docs build` passes and
      `apps/server/src/config/env-example.test.ts` is green (no env drift).
