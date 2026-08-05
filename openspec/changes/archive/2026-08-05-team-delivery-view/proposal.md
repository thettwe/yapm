## Why

README's headline promise is *"DORA and code-review health are just views, not a $30/developer/month
add-on."* Half of it is already TRUE and completely invisible.

`packages/schema/src/zero/retro/seed.ts` computes five flow metrics as a **pure function over rows
the client has already synced** — `pr_cycle_time` (:447), `time_to_first_review` (:457),
`review_rounds` (:466), `issues_without_pr` (:476), `ci_failing_rate` (:486) — plus seven Delivered
counts. The trend/delta math, the `betterWhen` direction, the blameless captions, the empty states
and the sparkline geometry are all built and tested. `ls apps/web/src/routes/` has **no insights,
metrics or DORA route**: the only way to see any of it is to open one retro, of one cycle, on one
team, and expand a collapsible panel. The single thing scoping those numbers to a retro is that the
builder takes a cycle plus its three priors.

This change gives the numbers a home: a team-level **Delivery** view over a rolling window of
cycles, sitting beside List / Board / Cycles / Triage / Retros / Projects / Roadmap. It adds no
metric, no query, no table and no service — it removes an accident of where the code was first
needed.

Vision principles served: **"Metrics are views, not a product"** (VISION §Principles) — the view is
computed client-side from already-synced rows and costs nothing to run; **"metrics are team-level
only"** (CLAUDE.md #8) — the guarantee is extended structurally to a second entry point rather than
re-argued; **sub-100ms interactions** (#9) — no server round trip is added, so the window is as fast
as the retro panel.

## What Changes

- **The metric formulas are generalized from "a cycle" to "a measurement scope" and there stays
  exactly ONE definition of each.** `deliveredCounts` and `flowMeasures` move to
  `packages/schema/src/zero/metrics/` and take a set of cycle ids rather than a single cycle id. For
  a one-cycle scope they reduce to today's behaviour exactly; for a window scope they are the
  window-level reading of the same count. No formula is copied.
- **New: `buildDeliveryWindow(input)`** beside `buildRetroSeed`, producing the same
  `Delivered` + `Flow` section shape over a rolling window of completed cycles: value = the window
  aggregate, trend = the per-cycle series across the window, delta = the immediately preceding
  window of the same length.
- **`buildRetroSeed` becomes a thin adapter over the shared core.** Its input types, its output, its
  captions and its empty-state strings are unchanged, asserted by its existing tests **untouched**.
- **New route `/teams/$teamId/delivery`**, reachable from the existing `ViewSwitch` and from the
  command palette's *Go to…* group, with a keyboard-operable window selector (3 / 6 / 12 completed
  cycles, default 6) carried in the URL so a view is shareable.
- **The shared presentation is lifted out of `apps/web/src/retro/`** into `apps/web/src/delivery/`:
  one tile, one sparkline, one section renderer, one set of value/delta/tone formatters. The retro's
  panel renders from that implementation and keeps every `data-testid` and `data-metric` selector the
  retro tests and the shipped e2e suite depend on.
- **The identity guarantee is extended to the new entry point structurally.** The object-graph walker
  and its forbidden-key list become one shared helper (`@yapm/schema/testing`), asserted against the
  *built model* at both entry points — and at the web entry point against input rows deliberately
  carrying a GitHub login, an email and an assignee, proving those strings reach nothing.
- **The page states what it does not show.** Deployment frequency, change failure rate and MTTR are
  absent and are named as absent; lead time here is open→merge only. No page copy implies four DORA
  metrics when the view carries one and a half.

## Capabilities

### New Capabilities

- `delivery-metrics`: a team-level delivery view over a rolling window of completed cycles, computed
  client-side from already-synced rows with no aggregate query and no server round trip; blameless by
  construction at every entry point; degrading to the data that exists; and honest in copy about
  which DORA metrics it does not yet carry.

### Modified Capabilities

_None._ The retrospective's auto-seeded data panel keeps every requirement it has today, byte for
byte — this change moves where its metric core lives, which is not spec-level behaviour. The
`retrospective` spec's "no per-person dimension of any kind" requirement is unchanged and is now
enforced by the same shared walker the new capability uses.

## Impact

- **New** `packages/schema/src/zero/metrics/scope.ts` (the formulas, one copy each),
  `metrics/descriptors.ts` (the metric table + `toMetric` + period-aware captions),
  `metrics/window.ts` (`buildDeliveryWindow`), `zero/testing/blameless.ts` (the shared walker and
  forbidden-key list).
- **Modified** `packages/schema/src/zero/retro/seed.ts` — becomes the cycle-scope adapter; keeps
  every exported name (`RetroSeed*` types become aliases of the canonical `Delivery*` types, so no
  call site churns). `packages/schema/src/index.ts` and `package.json` gain the `./testing` subpath
  export.
- **New** `apps/web/src/delivery/` — `rows.ts` (the shared row→scope projection), `metric-format.ts`,
  `metric-tiles.tsx`, `window-model.ts` (`buildTeamDeliveryFor`), `delivery-view.tsx`.
- **Modified** `apps/web/src/retro/seed-model.ts` (keeps `buildRetroSeedFor`, `priorCyclesFor`,
  `findSeedMetric`; re-exports the lifted formatters so `seed-model.test.ts` is untouched),
  `apps/web/src/retro/retro-seed-panel.tsx` (renders the lifted tile, same DOM),
  `apps/web/src/board/view-switch.tsx` (an eighth entry), `apps/web/src/issues/command.tsx` (a
  *Go to… Delivery* command), `apps/web/src/routes/teams.$teamId.delivery.tsx` (new).
- **No migration** (highest on main is `0022`, and none is needed), **no new Zero query** (the view
  reads `queries.cycles.byTeam` and `queries.issues.byTeam`, both already synced by the issue list
  and the retro), **no new mutator**, **no new permission predicate**, **no new dependency**, **no
  new container**.
- **Untouched, and deliberately so** — a sibling build (`deploy-history-edge`) owns them:
  `deployment`, migration `0023`, `apps/server/src/connectors/github/map.ts`, `reconcile.ts`,
  `packages/schema/src/zero/work-graph.ts`, and the `merged-not-deployed` predicate in
  `packages/schema/src/zero/filter.ts`.

Docs: **new** `apps/docs/src/content/docs/features/delivery.md` (what the view shows, how the window
is defined, why a connector-less team still sees Delivered, and the explicit "not shown yet" list);
**updated** `README.md` (feature list + the "Next:" line at :161, which currently promises this),
`ROADMAP.md` (a row for this change **and** an amendment to §Post-v1 Phase 2, which this partly
delivers), `VISION.md` §Phase 2 only if its wording is made stale, and
`apps/docs/src/content/docs/features/retrospectives.md` if the panel's description moves.

## Non-goals

- **No DORA deploy metrics.** No deployment frequency, no lead time to *deploy*, no change failure
  rate, no MTTR. Deployment frequency lands here in a later change once `deploy-history-edge` gives
  it durable data; change failure rate and MTTR need an incident entity that does not exist (VISION
  Phase 3).
- **No per-person anything.** Not a filter, not a drill-down, not a tooltip, not a hover. `review.author`
  is a real GitHub login in a synced table (`0009_connectors.ts:122`) and it reaches nothing here.
- **No server round trip, no aggregate query, no materialized table, no new synced entity.** Zero has
  no aggregates (`reference/zero.md:2599`); the answer is a bounded window, not a server.
- **No cross-team or workspace-wide roll-up.** The view is team-scoped, like every other view on the
  switcher.
- **No custom date range.** The window is measured in completed cycles, bounded at 12 — see
  `design.md` §D1 and §D4.
- **No second definition of any metric.** If a formula would have to be copied, it is extracted
  instead; a `grep` in the tasks proves it.
- **No change to the retro's own surface.** Its tests pass untouched or the change is wrong.
