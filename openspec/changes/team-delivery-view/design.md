## Context

`buildRetroSeed` already computes twelve team-level metrics as a pure function over synced rows.
Nothing about that computation is retro-specific except its **scope**: the input is one cycle plus up
to three priors. This change widens the scope and gives the result a permanent home, without
duplicating a single formula and without changing one byte of the retro's behaviour.

Three constraints shape every decision below:

1. **Zero has no aggregates** (`reference/zero.md:2599`). The view must stay a pure client-side
   function over already-synced rows. No `count()`, no server round trip, no materialized table.
2. **`review.author` is a real GitHub login in a synced table** (`0009_connectors.ts:122`).
   CLAUDE.md #8 makes it radioactive. The guarantee must be structural at the new entry point, not
   editorial.
3. **Team-level only.** No per-person breakdown of any kind, at any depth, in any affordance.

## Goals / Non-Goals

**Goals**

- One definition of each metric formula, shared by the retro panel and the new view.
- A rolling-window reading of those metrics that is *exact*, not an approximation stitched from
  per-cycle results.
- The retro's surface byte-identical in behaviour, its tests untouched.
- Blamelessness proven at the new entry point against the assembled model.
- Honest copy about which DORA metrics this view does not carry.

**Non-Goals**

- Deploy metrics of any kind (owned by the concurrent `deploy-history-edge` build).
- Custom date ranges, cross-team roll-ups, per-person anything, CSV export, alerting.
- Renaming the shipped `RetroSeed*` types across the codebase (§D9).

## Decisions

### D1 — The window is measured in **completed cycles**, not days

A day-based window (last 30/60/90 days) is what a generic DORA dashboard shows. It is the wrong unit
here, for two reasons that are properties of the existing metrics rather than of taste:

- Four of the seven Delivered metrics — carried out, carried in, carried twice or more, added
  mid-cycle — are **defined relative to a cycle boundary**. "Carried out of the last 30 days" is not
  a thing. A day window would force those four to be dropped or redefined, which is the formula
  duplication this change exists to avoid.
- The team already reasons in cycles: the cycles view, the digest, the retro and the rollover are all
  cycle-shaped. A second time axis would be a second vocabulary for "recently".

**The window is therefore the last N cycles of the team that have `status === 'completed'`, ordered
by the existing `compareCycles` total order.** An in-progress cycle is **excluded** — a half-finished
cycle drags every count down and would make the trend lie about a decline that is only the calendar.
This matches the precedent `priorCyclesFor` already set for the retro's sparkline (`seed-model.ts:99`
filters on `status === 'completed'`). The page names the exclusion in one line of copy rather than
leaving the reader to wonder where the current cycle went.

N is selectable: **3, 6 or 12; default 6.** See §D4 for why 12 is the ceiling.

### D2 — One scope type, one copy of every formula

`deliveredCounts` and `flowMeasures` move to `packages/schema/src/zero/metrics/scope.ts` and take:

```ts
export interface DeliveryScope {
  // The cycles that constitute this scope: id → startDate. For a retro, exactly one entry.
  readonly cycleStarts: ReadonlyMap<string, number>
  // Every issue that TOUCHED any of those cycles — still pointing at one, or carried out of one.
  readonly issues: readonly DeliveryIssueInput[]
}
```

Every membership test that today compares against `cycle.id` becomes a lookup in `cycleStarts`:

| Today (`seed.ts`) | Generalized |
|---|---|
| `i.cycleId === cycle.id` | `i.cycleId != null && cycleStarts.has(i.cycleId)` |
| `i.rolledOverFromCycleId === cycle.id && i.cycleId !== cycle.id` | `i.rolledOverFromCycleId != null && cycleStarts.has(i.rolledOverFromCycleId) && !inScope(i)` |
| `inCycle && i.rolledOverFromCycleId != null && !== cycle.id` | `inScope(i) && i.rolledOverFromCycleId != null && !cycleStarts.has(i.rolledOverFromCycleId)` |
| `inCycle && i.cycleAssignedAt > cycle.startDate` | `inScope(i) && i.cycleAssignedAt > cycleStarts.get(i.cycleId)` |

For a single-entry map every row reduces to today's expression exactly — including the null cases
(`cycleId === null` is false under both, `rolledOverFromCycleId === cycle.id` already implies
non-null). The last row is the one that *changed shape*, and deliberately: "added mid-cycle" compares
against **the start of the issue's own cycle**, which is the same value as the scope start for a
one-cycle scope and is the only reading that stays exact for a window. Without it, the window's
"added mid-cycle" would mean "assigned to any cycle after the window opened" — nearly every issue,
and a lie.

That is why the delivered metrics need **no summing special case**: all seven are evaluated once
against the window scope and every one is exact. `total` counts distinct issues (no double-count of a
twice-carried issue), `carried_out` counts issues that left the *window* (not the sum of intra-window
carries), `shipped` counts issues done in a window cycle.

**Consequence to document, not hide:** the window's `carried_out` is *smaller* than the sum of its
sparkline points, because a carry from cycle 9 to cycle 10 is a carry out of cycle 9 but not out of
the window. The tile caption says which one it is.

`flowMeasures` needs no change at all beyond the membership swap: it already pools PRs across
`scope.issues`, so the window's medians are computed over the pooled PR set — a true window median,
not a median of medians.

### D3 — value = window aggregate, trend = per-cycle series, delta = the preceding window

`toMetric` today derives `trend` and `delta` from one `history` array (`seed.ts:321`), which is
correct only when value and history are the same kind of number. The window's value is a *window*
number and its sparkline points are *cycle* numbers, so the spec becomes explicit:

```ts
interface MetricSpec { value: number | undefined
                       trend: readonly (number | undefined)[]  // full series, oldest first
                       previous: number | undefined            // the comparison basis
                       … }
```

- **Retro**: `trend = [...history, value]`, `previous = definedHistory.at(-1)`. Identical output to
  today, via a `fromHistory()` helper used at that one call site.
- **Window**: `trend` = the metric evaluated against each cycle in the window individually,
  oldest first; `previous` = the metric evaluated against **the preceding window of the same
  length**. "Median 18h, −4h vs. the previous 6 cycles" is a rolling comparison; comparing a window
  aggregate to its own last sparkline point would not be.
- If a full preceding window does not exist, `previous` is `undefined` and `delta` is `null` — the
  tile then renders no delta line, which is the path `formatSeedDelta` already takes. Comparing a
  6-cycle window against a 2-cycle one would be arithmetic on incomparable things.

### D4 — The bound is 12 cycles, and it is the answer to "no server"

The rolling window makes the synced row set larger, and the brief's instruction is explicit: bound
the window rather than reach for the server. It is bounded twice over:

- **The sync set does not grow at all.** The view reads `queries.cycles.byTeam` and
  `queries.issues.byTeam` — both already synced by the issue list *and* by the retro view
  (`retro-view.tsx:65-68`), and `issues.byTeam` already carries the `issueLinks → pullRequest →
  {ciChecks, reviews}` subtree via `withLinkedDelivery` (`queries.ts:81`). This change adds **zero**
  new query surface. Whatever the issue list costs today, this view costs nothing more.
- **The computation is bounded at 12 completed cycles**, a hard ceiling in the schema package, not a
  UI convention. At a two-week cadence that is ~6 months of history. A team wanting more is asking a
  different question (year-over-year), which is a reporting feature, not this view.

If profiling later shows the window computation is the bottleneck rather than the sync, the fix is
memoization inside the builder, not an aggregate query. Recorded here so the next reader does not
reach for the server first.

### D5 — The presentation is lifted, and the retro's DOM must not move

`apps/web/src/delivery/` gains:

| Module | Holds |
|---|---|
| `metric-format.ts` | `formatSeedValue`, `formatSeedDelta`, `seedTrendTone`, `sparklineGeometry` — moved verbatim from `retro/seed-model.ts` |
| `metric-tiles.tsx` | `MetricTile`, `Sparkline`, `MetricSection` — lifted from `retro/retro-seed-panel.tsx` |
| `rows.ts` | `SeedIssueRow` / `SeedCycleRow` / `SeedPrRow` and the row→`DeliveryScope` projection, shared by both builders |
| `window-model.ts` | `buildTeamDeliveryFor(cycles, issues, size)` — the window-scoped input builder, **beside** `buildRetroSeedFor`, not a fork of it |
| `delivery-view.tsx` | the page |

Two constraints on the lift:

1. **`retro/seed-model.ts` re-exports the moved formatters** under their existing names, so
   `apps/web/src/retro/seed-model.test.ts` compiles and passes **untouched**. A re-export is cheaper
   than editing a test this change is not allowed to change the meaning of.
2. **`MetricTile` takes its `data-testid` from a prop.** The retro panel passes
   `retro-seed-widget` / `retro-seed-sparkline` / `retro-seed-no-trend` / `retro-seed-empty` and
   keeps `data-metric`, because those selectors are load-bearing in `retro.spec.ts`, `retro-ai.spec.ts`
   and the retro's own tests. The delivery view passes its own. Same component, same markup, same
   classes.

### D6 — Blamelessness is proven at the new entry point, against the built object

The single most important test in the change. Today's walker lives inline in `seed.test.ts:85`. It
becomes one shared helper, `packages/schema/src/zero/testing/blameless.ts`, exporting
`collectKeys(value)` and `FORBIDDEN_IDENTITY_KEYS`, reached from `apps/web` through a new
`@yapm/schema/testing` export subpath. One walker, one list, three call sites:

- `seed.test.ts` — unchanged assertion, now importing the shared list (the list only grows).
- `metrics/window.test.ts` — the same walk over `buildDeliveryWindow`'s output.
- `apps/web/src/delivery/window-model.test.ts` — the strongest form, and the one the brief asks for:
  the input rows are **supersets** carrying `assignee: { name, email }`, `creator`, and
  `pullRequest.reviews[].author = 'octocat'` — exactly the shape `queries.issues.byTeam` really
  returns. The test asserts (a) `collectKeys(model)` contains no forbidden key at any depth, and
  (b) `JSON.stringify(model)` contains none of the planted strings. Assertion (b) is what makes it
  a *leak* test rather than a shape test: a caption that interpolated a login would pass (a) and
  fail (b).

The forbidden list gains `login`, `githubLogin`, `email`, `handle`, `avatar`, `image` alongside the
existing assignee/author/reviewer/creator/voter/facilitator/user/member entries.

### D7 — The page says what it does not show

Four DORA keys, and this view carries one and a half:

| DORA key | Status here |
|---|---|
| Lead time for changes | **Partial** — `pr_cycle_time` is open→merge only. Commit→deploy is absent. |
| Deployment frequency | **Absent.** Needs the durable deploy history `deploy-history-edge` is building; lands in a later change. |
| Change failure rate | **Absent.** Needs an incident entity that does not exist (VISION Phase 3). |
| Time to restore (MTTR) | **Absent.** Same. |

This is rendered as a short, permanent "What this doesn't show yet" block at the foot of the page —
not a dismissible banner, not a tooltip, not a roadmap link that rots. A page that shows five flow
metrics under a DORA-adjacent heading and says nothing is implying four keys it does not have; that
is the specific dishonesty this block exists to prevent. `pr_cycle_time`'s own caption says
"open to merge", which it already does today (`seed.ts:454`).

### D8 — Route, URL and keyboard

- **`/teams/$teamId/delivery`**, file route `teams.$teamId.delivery.tsx`, following the seven
  siblings exactly: `Authenticated` → header with `Switcher` + `ViewSwitch current="delivery"` +
  `ConnectionStatus` + `ThemeControls` + `UserMenu` → the view.
- **`?window=6`** validated by `validateSearch` to the literal union `3 | 6 | 12`, defaulting to 6,
  so a view is shareable and the back button behaves — the precedent `/search?q=` set.
- The window selector is the existing `@yapm/ui/components/select`, which is keyboard-operable.
  `ViewSwitch` gains an eighth `<Link>` (`GaugeIcon`, verified present in the installed
  `lucide-react`) with `aria-current="page"`, so the view is reachable by Tab alone from any team
  surface. A *Go to… Delivery* command joins the palette's `navigate` group
  (`issues/command.tsx:795`).
- Every tile is a non-interactive `<article>` here (no "Add a card from this" — that button is a
  retro affordance and stays behind the retro's `canDraft` prop). Nothing on the page requires a
  pointer.

### D9 — `RetroSeed*` type names stay; the canonical types get honest names

The canonical types are defined in `metrics/` as `DeliveryMetric`, `DeliverySection`,
`DeliveryUnit`, `DeliveryEmptyState`. `retro/seed.ts` re-exports them as `type RetroSeedMetric =
DeliveryMetric` and so on.

Renaming the ~15 call sites (`retro-ai-panel.tsx`, `ai-draft.ts`, `ratify.ts`, the panel, the tests)
would be a diff with no behavioural content, in files this change otherwise does not touch. The
precedent is archived change `retro-followup-category` §L5: *"collapsing them is a rename with no
behavioural content that would enlarge this diff into files this change otherwise does not touch."*
Two names for one structural type is a real (small) cost, paid to keep this change legible. Worth a
later cleanup; not worth smuggling in here.

### D10 — A team with no connector, and a team with no completed cycle

- **No connector**: the `Flow` section renders the same single quiet empty state the retro seed
  renders, worded for the window. `Delivered` is fully populated from cycles alone. This falls out of
  the shared descriptor table — it is not re-implemented — and is asserted by a test on both teams.
- **No completed cycle at all** (a brand-new team, or one not using cycles): the page renders **one**
  empty state naming what would fill it, not twelve zeros and not an empty sparkline. This is the
  same principle as the Flow empty state, applied one level up.
- **Fewer than N completed cycles**: the window is what exists, its label says so ("Last 3 completed
  cycles" when 3 is all there is), and the delta is `null` per §D3.

## Risks / Trade-offs

- **The window's `carried_out` will not equal the sum of its sparkline.** Correct (§D2) and
  surprising. Mitigated by the caption naming the window explicitly; a reader who adds the sparkline
  up and gets a different number is the failure mode to watch for in review.
- **The scope generalization touches the retro's hottest tested code.** Mitigated by the retro's
  existing tests being **untouched** — if they need editing, the generalization is wrong — plus a
  golden snapshot of `buildRetroSeed`'s full output committed before the refactor and asserted after.
- **The `./testing` export subpath is new surface on `@yapm/schema`.** It exports two test helpers and
  is imported by test files only. Cheaper than two walkers that can drift, which is precisely the
  failure the brief warns about.
- **Excluding the in-progress cycle means the page can look stale mid-cycle.** Accepted, and named on
  the page. The alternative — a partial bar that always trends down — is worse.

## Migration Plan

None. No schema change, no migration, no data backfill, no new synced entity. Highest migration on
main is `0022` and this change adds none. The refactor is source-compatible: every currently exported
name keeps its meaning.

## Open Questions

None blocking. Two settled by fiat and logged above rather than left open: the window unit (§D1) and
the delta basis (§D3).

## Decisions made during implementation

### `seed.test.ts` keeps its own walker; the shared list is added beside it, not swapped in

§D6 lists `retro/seed.test.ts` as one of the three call sites of the shared `collectKeys` /
`FORBIDDEN_IDENTITY_KEYS`. It is not, and deliberately: the brief's second tripwire is that
`seed.test.ts` passes **with the file unedited** after the scope generalization, and swapping its
inline walker for the shared import is an edit. Changing the file at all would forfeit the evidence
that the refactor preserved the retro exactly — the one thing that test is here to prove in this
pass. `metrics/window.test.ts` and (in pass 2) `delivery/window-model.test.ts` use the shared helper;
folding `seed.test.ts` into it is a one-line cleanup for a later change, once the refactor it guards
is no longer the thing under review.

### `tsconfig.build.json` now emits the whole `testing/` directory, not a hand-listed subset

`packages/schema/tsconfig.build.json` excluded `src/**/testing/**` wholesale, so `blameless.ts`
would not have been emitted and the new `./testing` export subpath would have resolved to nothing.
The alternatives were naming the three existing harness files (`pg-transaction.ts`, `query-ast.ts`,
`query-walk.ts`) in the exclude list, which silently breaks the next file added there, or emitting
everything. Everything is emitted: the package is private, the three harness files already typecheck
under `tsc --noEmit`, and the cost is four extra files in `dist/` against a fragile list that fails
open. The exclude is now just `src/**/*.test.ts`.

### `scopeOfCycles` pools issues by id

§D2 says the window's `total` counts distinct issues. Concatenating the per-cycle issue lists does
not give that: an issue the rollover carried from one window cycle to the next appears in both, and
would be counted twice. `scopeOfCycles` therefore keys the pool by issue id (first occurrence wins;
the rows are the same row). This is what makes `total = inScope + carriedOut` a distinct count at
window scope rather than only at cycle scope.

### `previous` requires **two** full windows, not just a full preceding one

§D3 says `previous` is `undefined` when the preceding window is not full. `buildDeliveryWindow`
also requires the *current* window to be full (`cycles.length === size`), which is the reading task
3.2 asserts: the delta is `null` until `2 × size` completed cycles exist. A team with four completed
cycles and a size of 3 would otherwise compare a 3-cycle window against a 1-cycle one.

### The `'window'` branch of every caption names the window

Six of the seven Delivered captions named the window naturally; `added_mid_cycle`'s did not, because
its wording is already relative to *a cycle* rather than to the period. It now reads "…across the
last N completed cycles" in both its zero and non-zero forms. Without that, a tile on the team view
would read exactly like the same tile inside a retro while reporting a different number — the
specific confusion §D2's `carried_out` note exists to prevent, one metric over.

### The grep proof (task 3.8)

```
grep -rn "mergedAt as number\|reviewSubmittedAt\|rolledOverFromCycleId ===\|carryoverCount" \
  apps packages --include='*.ts' --include='*.tsx'
```

Every **formula** site is in `packages/schema/src/zero/metrics/scope.ts`:

- `mergedAt as number` — `scope.ts:169` only.
- `reviewSubmittedAt` as a measurement — `scope.ts:174,181,182` only. `seed-model.ts:55` and
  `db/retro-facts.ts:333` are row *projections* (they build the input shape from synced rows and
  from Postgres respectively); neither computes a median or a wait.
- `carryoverCount >= 2` — `scope.ts:103` only. The other hits are the Zero column
  (`schema.ts:131`), the rollover mutator that increments it (`mutators.ts:1070`), seed data and the
  same two projections.
- `rolledOverFromCycleId ===` — zero hits outside a comment. Every membership test is now a
  `cycleStarts.has` lookup in `scope.ts`.

### `formatSeedDelta` gained one optional parameter rather than being moved strictly verbatim

Task 2.1 says move the six formatters verbatim. Five of them are. `formatSeedDelta` hard-coded
`vs. last cycle`, which is a lie on the team view — §D3's own worked example is *"Median 18h, −4h vs.
the previous 6 cycles"*, and the delta there is measured against the preceding **window**, not the
preceding cycle. The alternatives were a second formatter (the duplication this change exists to
avoid, in the file whose whole job is to be the single copy) or a caption that misnames its own
basis. It now takes `basis`, defaulting to `'last cycle'` — so the retro's output is unchanged
character for character and `retro/seed-model.test.ts` passes untouched, which was the constraint the
"verbatim" instruction was protecting.

### `rows.ts` exports a cycle projection, not a `DeliveryScope`

Task 2.2 asks for `scopeOfCycles(cycles, issues): DeliveryScope`. That signature was written before
stage 1 settled `buildDeliveryWindow`'s input, which takes `cycles` and `priorCycles` as
`DeliveryCycleInput[]` rather than a scope — because it needs the *per-cycle* scopes for the
sparkline and the *preceding window's* scope for the delta, neither of which is recoverable from one
pooled `DeliveryScope`. `rows.ts` therefore exports `toDeliveryCycle` / `toDeliveryCycles`, and the
pooling stays where stage 1 put it, in `scopeOfCycles` in the schema package. The name would also
have collided with the schema export of the same name at every call site that needs both.

### `window-model.ts` applies the upper bound before slicing the preceding window

`buildDeliveryWindow` clamps `size` internally, by design (§D4), so no caller can widen the window.
But the *preceding* window is sliced here, and slicing it against an unclamped size while the current
window is clamped would compare twelve cycles against an arbitrary number of them. One
`Math.min(size, MAX_DELIVERY_WINDOW)` — reading the schema's own constant, deriving nothing — keeps
both slices the same length. The route's `validateSearch` already narrows to 3/6/12, so this only
matters for a direct caller.

### `routes.test.tsx` needed a `@/zero/connection` mock

Every `/teams/$teamId/*` route calls `useConnectionSummary()` in its own component body, above
`Authenticated` — a shape this route follows exactly, per task 2.7. That hook talks to the live Zero
client, so the first routing test to touch a team route failed on `useZero must be used within a
ZeroProvider`. The mock is added beside the file's existing `@/zero/provider` one rather than by
restructuring seven shipped routes to move the hook below the gate; the routing facts this file
asserts do not involve the connection pill.

### The `ViewSwitch` link and the palette command both supply `?window=6`

`window` is a required search param on the route, so a `<Link>` to it must carry one. Both entry
points hand over the default rather than trying to preserve a window the caller last chose: a
switcher entry that remembered a window would make the same link mean different things on different
days, and there is nowhere team-scoped to persist it that is not new synced state.

### Task 3.9 — no new e2e spec, recorded

PROCESS.md §3's big-feature rule asks whether the change touches a synced entity or schema, a
mutator, a permission surface, or a signature UI. It touches **one**: a new read-only surface. There
is no new entity (no migration), no mutator (the view writes nothing), and no permission predicate
(both queries are the shipped `cycles.byTeam` / `issues.byTeam`). It is a small change and takes unit
and integration coverage only. The shipped `retro.spec.ts` and `retro-ai.spec.ts` still exercise the
lifted tiles through the retro's own selectors, which is the regression this change could plausibly
cause and the one an e2e spec would have been for.

### The identity walker is calibrated, because every other blamelessness assertion is read through it

Both entry-point tests prove their claim the same way: collect the model's key set, find nothing
forbidden in it. That is an argument from an *absence*, and an absence is only evidence if the
instrument was pointed at something. A `collectKeys` that returned an empty set — or a build that
returned `null` — would make `metrics/window.test.ts` and `delivery/window-model.test.ts` pass
while measuring nothing, and the change's most important guarantee would be a test that cannot fail.

Three things now stand behind it. `testing/blameless.test.ts` calibrates the instrument: the walker
is shown finding a key at depth, through arrays, and planted in the exact `sections[].metrics[]`
shape a `DeliveryWindow` has; it is shown returning nothing for `null`, which is *why* the call sites
assert non-null first; and `FORBIDDEN_IDENTITY_KEYS` is asserted to still name the columns the synced
work graph actually carries, so the list cannot quietly lose `author` and take every assertion built
on it with it. Both entry-point tests then assert *positively* that the walk reached `sections`,
`metrics`, `caption` and `trend` before claiming anything about what it did not reach.

And the chain was verified by mutation rather than by reading. Adding the drill-down a future change
would plausibly reach for — `return { ...built, issues }` in `buildTeamDeliveryFor`, handing the raw
synced rows back with the window — fails **both** identity assertions: the key walk finds `assignee`,
`creator` and `author`, and the string check finds `Ada Lovelace`, `ada@example.com` and `octocat`.
Worth recording alongside it: leaking an identity into the *input* projection alone does not fail the
test, and correctly so — `toSeedIssue` spreading the whole row changes nothing observable, because
nothing in `buildDeliveryWindow` copies an input into its output. The assertion is on the assembled
model, which is the thing the view renders and therefore the thing that can leak.

### "Carried twice or more" is read per cycle in scope, not against the window's outer edge

`carriedOut` and `carriedIn` are relative to the whole scope by design (§D2): a carry from one window
cycle into the next never left the window, so neither counts it. Computing `carriedTwicePlus` off
`carriedOut` inherited that scoping, and it is wrong for this metric — an issue the rollover has
moved twice *between two cycles of the same window* is precisely what the metric exists to surface,
and the window reading would have said zero while the tile's own sparkline plotted a one, under a
caption reading "the plan is holding". It now counts any issue with `carryover_count >= 2` whose
`rolled_over_from_cycle_id` names a cycle in scope, whether or not the issue then left the scope —
**except** an issue whose `cycle_id` is that same cycle, which is the one input where dropping the
old `carriedOut` scoping would have changed a number the retro already reports. Such an issue was
assigned back into the cycle it rolled out of, undoing the hop the marker records; it is a carry of
nothing at either scope, and the old expression excluded it via `i.cycleId !== cycle.id`. With that
exclusion restored the one-cycle reading is exactly the expression it replaced, on every input rather
than on every input a test happened to carry. `scope.test.ts` pins the number at both scopes.

### A window trend keeps one slot per cycle; the retro's compaction moved to its own call site

`toMetric` dropped `undefined` points out of `trend`. For a retro that is harmless — the history is
"the last few readings", and a prior cycle nobody linked a PR to simply is not one of them. For a
window it is not: the series is one point *per cycle*, so dropping a gap re-spaces the survivors as
if they had been consecutive and makes the sparkline's own `aria-label` claim a cycle count the
window does not have. `DeliveryMetric.trend` is now `(number | undefined)[]`, the compaction moved
into `fromHistory` where the retro's semantics live, and `sparklineGeometry` spends an unmeasured
cycle's x position and breaks the line across it — returning one `points` string per unbroken run,
which for a gapless series is one segment and one `<polyline>`, exactly what the retro rendered
before.

A run of one carries its coordinate **twice**. A single-point polyline has no length to stroke and
paints nothing, so a window whose measured cycles are each isolated by a gap — an intermittently
linked connector, which is the common shape — would have rendered an empty 64×18 box with only the
accent dot on it, several real readings and no ink. Repeated, the point is a zero-length segment,
which `stroke-linecap="round"` renders as a dot. A gapless series is unaffected, so the retro's SVG
is still byte-identical.

### `MetricSection` takes the host page's heading level

The lifted section hard-coded `<h3>`, correct under the retro panel's own `<h2>` and a skipped level
under the Delivery page's `<h1>`. It now takes `headingLevel`, defaulting to 3 so the retro's DOM is
byte-identical; the Delivery page passes 2, giving that page a flat `h1 → h2 → h2 → h2` outline.

### Changing the window pushes a history entry rather than replacing one

The window navigation used `replace: true`, which erased the previous window from history — so Back
left the view entirely rather than returning to the window the reader came from, contradicting the
"the back button behaves" reason the window is in the URL at all. Each selection now pushes one
entry.
