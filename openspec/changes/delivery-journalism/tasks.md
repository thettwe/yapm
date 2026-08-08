## 1. Read the rulebook first

- [x] 1.1 Read `design-explorations/overhaul-2026-08/northstar/delivery.html` and `delivery-full.png` top to bottom; read `NORTHSTAR.md` (the `delivery.html` row of the assembly table, §"Consistency check", §"The word diet", and the `delivery.html` self-critique about the peek floating over the timeline)
- [x] 1.2 Read `ia.html`: §"The word diet" (the binding rule appears once, on Delivery), §"Two patterns, drawn once" (the peek's ⏎/esc contract and the `how ·` drawn open — its copy is this page's `how · OPEN TO MERGED`), §"One attention number", §"Provenance"
- [x] 1.3 Read `reference/zero.md` (Zero 1.x — `defineQuery`/`defineQueries`/`createBuilder`/`handleQueryRequest`, never the 0.x `syncedQuery`/`PushProcessor`/`definePermissions`) plus the Tailwind 4.3 and TanStack Router references
- [x] 1.4 Read `packages/schema/src/zero/metrics/{scope,window,descriptors}.ts` and `packages/schema/src/zero/delivery.ts` — every formula, `DeliveryScope`, `buildDeploymentIndex`, and the exact list of the twelve metric keys. **Verify each of the four tiles against `scope.ts` before drawing it**
- [x] 1.5 Read `apps/web/src/delivery/{delivery-view,metric-tiles,metric-format,window-model,rows}.ts(x)` and `delivery-view.test.tsx` + `window-model.test.ts` — what ships today, what the retro shares, and which assertions must keep passing
- [x] 1.6 Read the vocabulary this change consumes and must NOT rebuild: `packages/ui/src/components/{peek,how,reality-track,rest-phrase,status-glyph,provenance-mark,drawn,cadence-chart}.tsx` and their stories; `apps/web/src/frame/masthead.tsx`; `apps/web/src/home/team-home.tsx` (the cadence chart is the drawn-chart precedent already shipped)
- [x] 1.7 Read `packages/schema/src/zero/team-home.ts` §row types and `buildTeamHome` — the model-builder precedent this page follows, and the shapes of the deployment and retro rows

## 2. The population fix in the shared scope (`packages/schema`)

- [x] 2.1 `metrics/scope.ts`: `DeliveryPrInput` gains an optional `id`; `pullRequests(scope)` de-duplicates by it when present, leaving id-less inputs byte-identical (design D5)
- [x] 2.2 `apps/web/src/delivery/rows.ts`: `SeedPrRow` and `pullRequestsOf` carry the pull-request `id` from the synced row
- [x] 2.3 Run `packages/schema/src/zero/retro/seed.golden.test.ts` and `retro/seed.test.ts`. If either moves, the movement is a fixed double-count: update the golden **with the reason written beside it** and record it in design.md §"Decisions made during implementation". If neither moves, add a unit test that proves the dedupe over a multi-linked pull request
- [x] 2.4 Unit test: a pull request linked to two in-scope issues is one entry in `pullRequests(scope)`, one contribution to `prCycleTimeHours`, and one contribution to `ciFailingRate`

## 3. The page derivation (`packages/schema/src/zero/metrics/page.ts`)

- [x] 3.1 New module with local structural row interfaces (`DeliveryPageCycleRow`, `…IssueRow`, `…PrRow`, `…DeploymentRow`, `…RetroRow`) and `buildDeliveryPage(input, now): DeliveryPageModel | null` — pure, deterministic, identity-free (design D1)
- [x] 3.2 The standfirst: cycle in progress · the window label · the binding rule, as model data rather than view copy (design D2, spec §"The binding team-level rule")
- [x] 3.3 The timeline section (design D2, D3, D4): the active cycle's span; one entry per successful deployment inside it; the retro marks from `retro.closedAt` + `retro.title`; the today marker (`day N of M`) and days remaining; the called-out deployment by the stated deterministic rule, naming its `ref` or nothing; the neutral before/after deploy counts around a closed retro with **no causal verb**. `null` when there is no active cycle
- [x] 3.4 The four stat readings (design D7): `shipped`, `pr_cycle_time`, `ci_failing_rate`, `issues_without_pr` — value, per-cycle series for the mini, delta and its direction **in words**, and a `how ·` pair (`body`, `constraint`) built here (design D14). The Shipped `how ·` carries `total` and `canceled`
- [x] 3.5 The distribution section (design D5, D6): one entry per distinct merged pull request with its open→merged hours; the axis maximum from the data; the median **as a position** read from the same `flowMeasures.prCycleTimeHours` the tile states; the left-crowd and outlier annotations derived with their counts; the stated unit of one mark. `null` when no merged change exists
- [x] 3.6 The cycle-flow section: per-cycle shipped bars, the carried-work connections between adjacent window cycles, the added-after-start caps, `carried_twice_plus` in the `how ·` and in the standfirst when non-zero, and a derived standfirst stating the carryover trend
- [x] 3.7 The review-rhythm section: per merged change, opened → first review → each subsequent review → merged; the published cap and the count drawn; a derived standfirst stating the `time_to_first_review` and `review_rounds` medians. **No reviewer field of any kind** (design D13)
- [x] 3.8 The peek subject (design D10): the diverged issue (`computeDivergence` → `status_behind_merge`) whose merge is newest, its dictionary phrase, its `DeliveryStrip`, its issue key and the count of the class. `null` when nothing diverged
- [x] 3.9 The honesty statement (design D9): one collapsed line naming change failure rate, time to restore and deployment frequency **as a rate**; `more ·` entries covering the coverage limit (a pull request linked to no issue is invisible here) and where merged→live *is* stated. **Never** a claim that merged-to-live is unmeasured
- [x] 3.10 The metric mapping (design D7): the model declares which section each of the twelve descriptor keys landed in, so the totality rule is checkable rather than promised
- [x] 3.11 Call `buildDeploymentIndex` for the merge-commit join; do not re-derive it. Confirm by reading that no table, query, mutator or migration was added
- [x] 3.12 Export the module and its types from `packages/schema/src/index.ts`

## 4. The drawn charts (`packages/ui/src/components/`)

- [x] 4.1 `annotated-timeline.tsx`: structural props, static inline SVG, every colour a `var()` token; deployment marks, retro marks, the today caret, the days-left label, the call-out with its leader line, and a slot for the page's one chip. One truthful `role="img"` label naming the span, the population and what one mark is
- [x] 4.2 `distribution-strip.tsx`: linear axis with derived ticks, one dot per merged change, the median rule at its own position with its label, and the crowd/outlier annotations. `role="img"` stating **one dot is one merged pull request** and the median
- [x] 4.3 `flow-band.tsx`: per-cycle bars, carryover ribbons between adjacent bars with their counts, `+N added` caps, per-cycle labels. `role="img"` naming the cycles, the shipped counts and what a ribbon means
- [x] 4.4 `review-rhythm.tsx`: the small multiples grid — open node, first-review segment, review nodes, merge node, and the over-cap arrow with its duration. `role="img"` naming the count drawn and what one row is
- [x] 4.5 A story per chart in the same file-adjacent `*.stories.tsx` pattern, including the empty/one-mark/heavy-outlier cases
- [x] 4.6 Confirm no chart imports `@yapm/schema` and no chart contains a literal colour, a motion property or a tooltip

## 5. The page (`apps/web/src/delivery/`)

- [x] 5.1 `stat-tile.tsx` (new, design D8): the mock's tile anatomy — label with optional provenance mark, big number + unit, delta pill with its direction in words, the drawn mini flush right, and the shipped `How` underneath. `metric-tiles.tsx` is **not** edited beyond correcting its header comment to name its one remaining consumer
- [x] 5.2 `delivery-view.tsx`: read the four already-existing queries (`cycles.byTeam`, `issues.byTeam`, `deployments.byTeam`, `retros.byTeam`), build the model once in a `useMemo`, and render sections in the mock's order. No formatting decision the model could have made
- [x] 5.3 Band 2: `Masthead` with `title="Delivery"`, the standfirst in `meta` (carrying the binding rule, once in the product), and the window `<select>` in `actions` restyled to the mock's button register with its label folded into its accessible name (design D15)
- [x] 5.4 The timeline section with the one peek: `PeekProvider` around the page, the chip as a `<Link>` to the issue so `⏎` is native activation, the panel carrying the dictionary phrase and the `RealityTrack`, `esc` returning focus (design D10)
- [x] 5.5 The four stat readings across the full measure, hairline-separated as the mock draws them
- [x] 5.6 The three drawn sections, each with its kicker, its derived standfirst and its section-level `how ·`
- [x] 5.7 The honesty line at the foot: one line plus `more ·`, nothing dismissible, no bordered panel. Delete the shipped `NotShownYet` bulleted panel and the two prose paragraphs above the tiles
- [x] 5.8 Every `null` section renders nothing at all — no heading, no axis, no zero (design D11). The whole-page "no completed cycles yet" empty state survives unchanged
- [x] 5.9 Register this surface's commands with the frame's `⌘K` owner; bind no global key listener
- [x] 5.10 Read the four drawn forms against `delivery-full.png` at 1440×900 in every theme (via the `packages/ui` workbench — the assembled page needs the three-container stack, which this pass was told not to start); every deliberate difference recorded in design.md §"Decisions made during implementation", including that nobody has yet read the assembled page in a browser

## 6. Tests

- [x] 6.1 **The falsifiable check** — `packages/schema/src/zero/metrics/page.test.ts`: over one fixture (an active cycle with deployments and a closed retro, six completed cycles, merged PRs with reviews and checks, one diverged issue, one PR linked to two issues), `buildDeliveryPage` (a) maps every key in `[...DELIVERED_METRICS, ...FLOW_METRICS]` to exactly one section, (b) states change failure rate, time to restore and deployment frequency **as a rate** as absent, and (c) contains no claim that merged-to-live is unmeasured. Fails on `main` because the module does not exist
- [x] 6.2 `page.test.ts`: the timeline — deployment entries at their own moments, a retro mark from `closedAt`/`title`, `day N of M` and days-left from the cycle's dates, the call-out chosen by the stated rule (including its tie-break), `ref`-less rows naming no release, and **no causal verb** anywhere in the annotations
- [x] 6.3 `page.test.ts`: the distribution — one entry per **distinct** merged pull request (the multi-linked PR appears once), the axis maximum from the data, and the median entry equal to `flowMeasures(scope).prCycleTimeHours` rather than a second computation
- [x] 6.4 `page.test.ts`: blankness — no active cycle ⇒ `timeline === null`; no merged change ⇒ distribution and rhythm `null`; no divergence ⇒ `peek === null`; and no section is ever a zero-valued object
- [x] 6.5 `page.test.ts`: blamelessness at the new entry point — `collectKeys` over the built model finds nothing in `FORBIDDEN_IDENTITY_KEYS`, run over input rows that carry `assignee`, `creator` and `review.author = 'octocat'`, **plus** a string check on the serialised model so an interpolated login fails even when the shape check passes
- [x] 6.6 `page.test.ts`: determinism — the same input yields an identical model, and the rhythm cap comes from the model's own published constant, not a literal in the test
- [x] 6.7 `packages/ui` component tests: each chart's `role="img"` label states its population and **what one mark represents**; the distribution draws exactly as many dots as entries; the flow band draws no ribbon for a zero carry; the rhythm's over-cap row states the duration in text
- [x] 6.8 `apps/web/src/delivery/delivery-view.test.tsx`: the four sections render in the mock's order with their standfirsts; each stat reading carries a `how ·` that opens and closes with Escape returning focus; the window selector still reports a **number** and changing it issues **no new read** (keep the existing read-count assertion); the honesty line is one line plus `more ·` and carries no dismiss control; and no control or reading mentions a person
- [x] 6.9 `delivery-view.test.tsx`: the peek — focus alone opens it, it carries the issue's dictionary phrase and its reality drawing, `Escape` closes it and returns focus without navigating, and only one peek is ever open
- [x] 6.10 `delivery-view.test.tsx`: the retro panel still renders its own tiles unchanged (mount `RetroSeedPanel` and assert its `retro-seed-*` selectors and markup), proving `metric-tiles.tsx`'s consumer did not break
- [x] 6.11 Extend `packages/ui/src/styles/contrast.test.ts` with this page's pairs — annotation ink on the page ground, the median rule, the outlier ring, the carryover ribbon fill and its ink, the rhythm's review segment — in **every** theme block, light and dark. Fix the tokens if a pair fails; record the measurement rather than deleting it
- [ ] 6.12 No new e2e spec (PROCESS.md §3 — this change touches one big-feature axis, signature UI). Run the full Playwright suite and the compose smoke test; if a spec touches the Delivery page, update the selector rather than weakening the assertion, and derive every bound from the page rather than from fixture size

## 7. Documentation

- [x] 7.1 Rewrite `apps/docs/src/content/docs/features/delivery.md` to the new page: the standfirst and the binding rule; the annotated timeline and exactly how each annotation is derived (including the call-out rule and why no causal claim is made); the four stat readings and their formulas; each drawn section and **what one mark represents**; the `how ·` and the peek; the window's rules (unchanged); and a corrected "what this doesn't show yet" naming deployment frequency **as a rate**, change failure rate and MTTR, plus the unlinked-pull-request coverage limit and where merged→live *is* stated
- [x] 7.2 Update `features/reality-vocabulary.md` (the peek and the `how ·` now have a product consumer, and this is the page that draws the one peek) and `features/team-home.md` (where the cadence mini's doorway leads)
- [x] 7.3 Update `README.md` (feature list) and `ROADMAP.md` (a status row for this change); confirm `.env.example`, `TECHSTACK.md`, `PROCESS.md`, `VISION.md`, `DESIGN.md` and `CLAUDE.md` are untouched by this change and therefore not stale (PROCESS.md §2). Note in the PR that `openspec/specs/board/spec.md`'s pre-frame navigation wording was left alone because this change does not touch the board's subject
- [x] 7.4 `pnpm --filter @yapm/docs build` passes

## 8. Gates

- [ ] 8.1 `pnpm turbo lint typecheck test build` green, with the actual output reported
- [ ] 8.2 The compose smoke test and the full Playwright e2e suite green in CI; no assertion weakened to get there
- [ ] 8.3 `npx -y @fission-ai/openspec@latest validate delivery-journalism` clean
- [ ] 8.4 Every scenario in `specs/delivery-metrics/spec.md` is true of the built page; every decision the specs did not anticipate is recorded in design.md §"Decisions made during implementation"
