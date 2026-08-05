## 1. The measurement scope: one definition of every formula (build pass 1)

- [x] 1.1 Commit a golden snapshot **before touching anything**: add
      `packages/schema/src/zero/retro/seed.golden.test.ts` asserting `buildRetroSeed`'s full output
      (both sections, every metric, every caption, every empty state) for a fixture with one cycle
      plus three priors, one connector-less variant, and one flow-populated variant. This is the
      tripwire for the whole refactor — if it needs editing afterwards, the refactor is wrong.
- [x] 1.2 Create `packages/schema/src/zero/metrics/scope.ts`. Move `median`, `round`, `HOUR_MS`,
      `plural`, `deliveredCounts`, `flowMeasures`, `pullRequests`, `reviewWaitDominates`, `NO_FLOW`
      and the `DeliveredCounts` / `FlowMeasures` interfaces out of `retro/seed.ts` verbatim, then
      generalize the four membership expressions exactly as design §D2's table specifies:
      `DeliveryScope` carries `cycleStarts: ReadonlyMap<string, number>` and `issues`, `inScope`
      tests `cycleStarts.has`, and `addedMidCycle` compares against `cycleStarts.get(issue.cycleId)`
      rather than a scope-wide start. Export `DeliveryIssueInput`, `DeliveryPrInput`, `DeliveryScope`
      and `scopeOfCycle(cycle)`. Do **not** use the directory name `delivery/` — `zero/delivery.ts`
      already exists and the two would be ambiguous to resolve.
- [x] 1.3 Create `packages/schema/src/zero/metrics/descriptors.ts`: the canonical `DeliveryUnit`,
      `DeliveryMetric`, `DeliveryEmptyState`, `DeliverySection` types; the generalized `MetricSpec`
      of design §D3 (`value`, `trend`, `previous`); `toMetric`; a `fromHistory(value, history)`
      helper for the retro's one call site; `DeliveryPeriod = { kind: 'cycle' } | { kind: 'window',
      cycleCount: number }`; and the two descriptor tables `DELIVERED_METRICS` and `FLOW_METRICS`
      holding key / label / unit / betterWhen / `read(measures)` / `caption(value, ctx)`. Each
      caption is ONE function with a branch per period kind, and the `'cycle'` branch returns today's
      string character for character. `flowEmptyState(period)` likewise.
- [x] 1.4 Rewrite `packages/schema/src/zero/retro/seed.ts` as the cycle-scope adapter: `buildRetroSeed`
      builds a one-cycle `DeliveryScope` per cycle, walks the two descriptor tables, and assembles the
      same `RetroSeed`. Keep **every** currently exported name; `RetroSeedUnit` / `RetroSeedMetric` /
      `RetroSeedEmptyState` / `RetroSeedSection` become type aliases of the `Delivery*` types
      (design §D9), and `RetroSeedIssueInput` / `RetroSeedPrInput` / `RetroSeedCycleInput` /
      `RetroSeedInput` keep their shapes. Nothing outside this file changes its imports.
- [x] 1.5 Run 1.1's golden test and the whole existing `seed.test.ts` **unedited**. Both must pass
      before continuing. If either needs a change, stop and fix the generalization, not the test.
- [x] 1.6 Create `packages/schema/src/zero/metrics/window.ts`: `DELIVERY_WINDOW_SIZES = [3, 6, 12]`,
      `MAX_DELIVERY_WINDOW = 12`, and
      `buildDeliveryWindow(input: { cycles, priorCycles, size }): DeliveryWindow` where
      `DeliveryWindow = { label, cycleCount, sections }`. Value = the metric against the whole-window
      scope; `trend` = the metric against each window cycle's own scope, oldest first; `previous` =
      the metric against the preceding window's scope, or `undefined` when that window is not full
      (design §D3). Clamp the input cycle list to `MAX_DELIVERY_WINDOW` inside this function, not at
      the call site. Return `null` when the window contains no cycle.
- [x] 1.7 Create `packages/schema/src/zero/testing/blameless.ts` exporting `collectKeys(value)` (the
      walker moved out of `seed.test.ts:85`) and `FORBIDDEN_IDENTITY_KEYS` (the existing list plus
      `login`, `githubLogin`, `email`, `handle`, `avatar`, `image`). Add the `./testing` export
      subpath to `packages/schema/package.json` and make sure `tsconfig.build.json` emits it.
- [x] 1.8 Export `buildDeliveryWindow`, `DeliveryWindow`, `DELIVERY_WINDOW_SIZES`,
      `MAX_DELIVERY_WINDOW`, `DeliveryMetric`, `DeliverySection`, `DeliveryUnit`,
      `DeliveryEmptyState`, `DeliveryScope`, `DeliveryIssueInput`, `DeliveryPrInput` from
      `packages/schema/src/index.ts`.
- [x] 1.9 `pnpm --filter @yapm/schema typecheck test` and `pnpm turbo build` — the whole workspace
      must still compile, because `RetroSeed*` is imported in eight places outside this package.

## 2. The team Delivery view (build pass 2)

- [x] 2.1 Create `apps/web/src/delivery/metric-format.ts` and move `formatSeedValue`,
      `formatSeedDelta`, `seedTrendTone`, `SeedTrendTone`, `SparklineGeometry` and
      `sparklineGeometry` there **verbatim** from `retro/seed-model.ts`. Re-export all six from
      `retro/seed-model.ts` under their existing names so `retro/seed-model.test.ts` stays untouched
      (design §D5).
- [x] 2.2 Create `apps/web/src/delivery/rows.ts`: move `SeedPrRow`, `SeedIssueRow`, `SeedCycleRow`,
      `pullRequestsOf`, `toSeedIssue`, `issuesTouching` there and add `scopeOfCycles(cycles, issues)`
      returning a `DeliveryScope` for a set of cycles. `retro/seed-model.ts` imports them and keeps
      re-exporting the three row types.
- [x] 2.3 Create `apps/web/src/delivery/metric-tiles.tsx`: lift `SeedWidget` → `MetricTile`,
      `Sparkline`, `TONE_GLYPH` and the section body out of `retro/retro-seed-panel.tsx`, unchanged
      in markup and classes. Every `data-testid` comes from props (`testId`, `sparklineTestId`,
      `noTrendTestId`, `emptyTestId`); `data-metric` and `tabIndex={-1}` stay. The "Add a card from
      this" affordance stays behind an optional `action` render prop supplied only by the retro.
- [x] 2.4 Rewrite `apps/web/src/retro/retro-seed-panel.tsx` to render `MetricTile` / `MetricSection`,
      passing `retro-seed-widget`, `retro-seed-sparkline`, `retro-seed-no-trend`,
      `retro-seed-empty` and `retro-seed-section`. `seedRefForMetric` and `seedWidgetSelector` stay
      exported from this file — `retro-view.tsx` and `retro-ai-panel.tsx` import them.
- [x] 2.5 Create `apps/web/src/delivery/window-model.ts`:
      `buildTeamDeliveryFor(cycles, issues, size): DeliveryWindow | null` — filter to
      `status === 'completed'`, sort by `compareCycles`, take the last `size` as the window and the
      `size` before that as the prior window, project both through `rows.ts`, and call
      `buildDeliveryWindow`. This sits **beside** `buildRetroSeedFor`; it must not re-derive a
      formula or a projection either one already owns.
- [x] 2.6 Create `apps/web/src/delivery/delivery-view.tsx`: reads `queries.cycles.byTeam` and
      `queries.issues.byTeam` (no new query), memoizes `buildTeamDeliveryFor`, renders the window
      label, the keyboard-operable size `Select`, the two sections, the no-completed-cycle empty
      state (design §D10), and the permanent "What this doesn't show yet" block from design §D7.
      Tokens only; no per-person control of any kind.
- [x] 2.7 Create `apps/web/src/routes/teams.$teamId.delivery.tsx` following
      `teams.$teamId.retros.index.tsx` exactly, with `validateSearch` narrowing `window` to
      `3 | 6 | 12` (default 6) and `ViewSwitch current="delivery"`.
- [x] 2.8 `apps/web/src/board/view-switch.tsx`: add `'delivery'` to the `current` union and an eighth
      `<Link>` with `GaugeIcon` (verified present in the installed `lucide-react`), placed after
      Retros. Update the file's leading comment, which enumerates the views.
- [x] 2.9 `apps/web/src/issues/command.tsx`: add a *Go to {team} delivery* command to the `navigate`
      group beside the existing team commands.

## 3. Tests

- [x] 3.1 `packages/schema/src/zero/metrics/scope.test.ts` — the reduction proof: for a table of
      fixtures, every metric evaluated against `scopeOfCycle(cycle)` equals the value asserted in
      `seed.test.ts` today, including the absent cases; and the window-scope readings of `total`,
      `carried_out` and `added_mid_cycle` are the exact ones design §D2 specifies (distinct issues,
      carries out of the *window*, and mid-cycle relative to the issue's own cycle).
- [x] 3.2 `packages/schema/src/zero/metrics/window.test.ts` — value/trend/delta composition (§D3):
      the sparkline is per-cycle and the value is not its sum; the delta is `null` when fewer than
      `2 × size` completed cycles exist; the window clamps at 12; an empty window returns `null`;
      the flow section is `empty` with the connector empty state when no window issue has a linked
      PR. **Plus the identity walk** over `buildDeliveryWindow`'s output using
      `collectKeys` / `FORBIDDEN_IDENTITY_KEYS`.
- [x] 3.3 **The falsifiable check.** `apps/web/src/delivery/window-model.test.ts` — build the model
      from issue rows that are supersets carrying `assignee: { name, email }`, `creator`, and
      `issueLinks[].pullRequest.reviews[].author = 'octocat'` (the shape `queries.issues.byTeam`
      really returns), then assert (a) `collectKeys(model)` contains no member of
      `FORBIDDEN_IDENTITY_KEYS` at any depth and (b) `JSON.stringify(model)` contains none of the
      planted names, logins or email addresses. Assert against the built object, never the rendered
      string.
- [x] 3.4 `apps/web/src/delivery/window-model.test.ts` (same file) — the two-team case: a team whose
      issues have linked PRs renders both sections `ready`; a team with the same issues and no links
      renders Delivered `ready` and Flow `empty` with the connector empty state, and no zeroed flow
      metric.
- [x] 3.5 `apps/web/src/delivery/delivery-view.test.tsx` — renders the window label, the size
      selector and the "What this doesn't show yet" block naming deployment frequency, change
      failure rate and MTTR; renders the single empty state for a team with no completed cycle;
      exposes no control that mentions a person.
- [x] 3.6 `apps/web/src/routes.test.tsx` — a test that `/teams/$teamId/delivery?window=6` is
      registered, parses its search param, and is gated behind `Authenticated`, following the
      `/search` test's shape.
- [x] 3.7 Run `apps/web/src/retro/seed-model.test.ts`, `retro-ai-panel.test.ts` and
      `packages/schema/src/zero/retro/seed.test.ts` **unedited**. Any edit needed to any of the three
      means a regression, not a test that needs updating.
- [x] 3.8 The grep proof, recorded in `design.md` under `## Decisions made during implementation`:
      `grep -rn "mergedAt as number\|reviewSubmittedAt\|rolledOverFromCycleId ===\|carryoverCount"
      apps packages --include='*.ts' --include='*.tsx'` returns exactly one definition site per
      formula, all under `packages/schema/src/zero/metrics/scope.ts`.
- [x] 3.9 No new e2e spec. PROCESS.md §3's big-feature rule: this change touches **one** of
      {synced entity/schema, mutator, permission surface, signature UI} — no entity, no mutator, no
      permission predicate — so it is a small change and takes unit + integration only. Record that
      judgement in `design.md`.

## 4. Documentation

- [x] 4.1 New `apps/docs/src/content/docs/features/delivery.md` — what the view shows, how the window
      is defined (completed cycles, why the in-progress one is excluded, the 12 ceiling), why a
      connector-less team still sees Delivered, that everything is computed on the client from
      already-synced rows, that no metric is ever per-person, and the explicit "not shown yet" table
      from design §D7. Add it to the Starlight sidebar beside `retrospectives.md`.
- [x] 4.2 `README.md` — add the Delivery view to the feature list, and rewrite the "Next: DORA and
      review-health metrics…" line at :161, which this change partly delivers and therefore makes
      stale. Say precisely what now exists and what still does not.
- [x] 4.3 `ROADMAP.md` — add the row for this change, and amend §Post-v1 **Phase 2** (:74): the
      review-health and CI-health half of "DORA + review-health + CI-health views (team-level only)"
      now ships as the team Delivery view; what remains in Phase 2 is deploy ingestion and deployment
      frequency. Do not claim more than that.
- [x] 4.4 `VISION.md` §Phase 2 (:89) — amend only if 4.3 makes its wording untrue; if it stays
      accurate, say so in `design.md` rather than editing it for symmetry.
- [x] 4.5 `apps/docs/src/content/docs/features/retrospectives.md` — one sentence pointing at the
      Delivery view for the same metrics outside a retro. The panel's own description does not change.
- [x] 4.6 `pnpm --filter @yapm/docs build` passes, and `apps/server/src/config/env-example.test.ts`
      still passes (no new env var, but the docs-page assertions in it cover new pages).

## 5. Verification

- [ ] 5.1 `pnpm turbo lint typecheck test build` green from the repo root.
- [ ] 5.2 Boot the dev stack on this build's ports
      (`POSTGRES_HOST_PORT=5451 ZERO_CACHE_HOST_PORT=4859 YAPM_HOST_PORT=3011 docker compose -p
      yapm-tdv -f docker/docker-compose.dev.yml`) and walk the view by keyboard only: from the issue
      list, Tab to the Delivery switcher entry, activate it, change the window with the keyboard,
      and confirm focus is visible throughout and nothing requires a pointer.
- [ ] 5.3 Check the view in all six theme blocks, light and dark, for AA contrast on the tile text,
      the caption, the delta line and the sparkline.
- [ ] 5.4 Confirm the retro's own surface is unchanged in the running app: open a retro, expand the
      data panel, and confirm the tiles, captions, empty state and "Add a card from this" behave
      exactly as before.
- [ ] 5.5 Tear down with
      `docker compose -p yapm-tdv -f docker/docker-compose.dev.yml down -v`.
