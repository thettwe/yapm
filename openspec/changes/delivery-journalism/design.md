## Context

See proposal.md §Why. What shapes the approach here is what already exists and must be consumed
rather than rebuilt:

- **The formulas are done and shared.** `packages/schema/src/zero/metrics/scope.ts` holds one
  definition of every number, evaluated against a `DeliveryScope` (a set of cycles plus the issues
  that touched them). `descriptors.ts` holds the twelve label/unit/direction/caption declarations.
  `window.ts` turns a window into `{ value, trend, previous }` per metric. The retro's data panel
  and this page are both callers. **No formula may be re-derived by this change.**
- **The drawn vocabulary is done.** PR #32 shipped `RealityTrack`, `StatusGlyph`, `PriorityMark`,
  `ProvenanceMark`, `Peek*`/`usePeek`, `How`, `TickBar`, `CadenceChart` — the last of which is the
  precedent for a page-scale drawn chart: structural props, static inline SVG, every colour a
  `var()` token, one truthful `role="img"` label.
- **The frame is done.** `AppFrame` owns bands 1 and 3 and `⌘K`; `Masthead` owns band 2 with
  `kicker`/`title`/`count`/`lens`/`meta`/`actions` slots.
- **The four reads this page needs are already synced by Home**: `cycles.byTeam`,
  `issues.byTeam` (which carries the linked-delivery subtree: PRs, their CI checks and their
  reviews), `deployments.byTeam`, `retros.byTeam`. Zero has no aggregates, so everything is a pure
  function over rows in memory — that is not an optimisation here, it is the only shape available.
- **`apps/web/src/delivery/metric-tiles.tsx` is shared with the retro panel by construction** (its
  header comment says so, and `retro-seed-panel.tsx` passes its own `data-testid`s in as props).
  Whatever this page does, the retro's rendered markup must not move.
- **One honest limit stands from PR #28**: the PR→deployment join is exact
  (`pull_request.merge_commit_sha = deployment.sha`), it over-reports for a batched or retagged
  deploy, and it can never under-report. `buildDeploymentIndex` implements it and must be called,
  not re-implemented.

## Goals / Non-Goals

**Goals:**

- One derivation for the whole page, in `packages/schema`, with the view doing rendering and
  formatting only — the `buildTeamHome` precedent.
- Every drawn form in the mock, drawn from real rows: the annotated timeline, the distribution
  strip, the cycle-flow band, the review-rhythm small multiples.
- Every number carries a `how ·` and nothing else explains itself at rest; honesty is one line
  plus `more ·`; sections lead with a sentence.
- Every metric definition that exists today remains reachable on the page, and the mapping is
  asserted rather than promised.
- Blamelessness re-proven at the new entry point against the built object, not the rendered string.

**Non-Goals (design-level):**

- No new chart library, no motion, no canvas, no `<foreignObject>`. Inline SVG with token colours,
  exactly as `CadenceChart` does it.
- No hover-only information anywhere: a peek may open on hover, but nothing is *only* reachable by
  hover, and no chart carries a tooltip.
- No second median, no second population, no second clock. Where the page states a number twice
  (the tile and the strip), both read the same field of the same model.

## Decisions

### D1 — One builder in `packages/schema`, one render in `apps/web`

`packages/schema/src/zero/metrics/page.ts` exports `buildDeliveryPage(input, now)` returning a
`DeliveryPageModel` with one nullable field per section. The view maps that model to JSX and
formats nothing that the model could have decided.

*Why:* `buildTeamHome` set this precedent for the largest surface in the product, and it is what
makes the blamelessness walk (`collectKeys` over the built object) meaningful — a guarantee proven
against a model is structural; one proven against rendered HTML is a lint.

*Alternative rejected:* computing the sections inside `delivery-view.tsx`. It puts the identity
guarantee, the annotation-selection rules and the metric mapping beyond the reach of a unit test,
and it would need `packages/ui` chart props to be the model, coupling the drawings to the schema.

Row shapes (`DeliveryPageCycleRow`, `…IssueRow`, `…DeploymentRow`, `…RetroRow`) are declared
locally in `page.ts` as structural interfaces, matching the `team-home.ts` pattern; the same Zero
rows satisfy both without either module importing the other.

### D2 — Two scopes on one page, stated in the standfirst

The mock's standfirst is `Cycle 2 · last 6 completed cycles`, and those are two different scopes:

- **The timeline is the ACTIVE cycle.** Its axis runs `cycle.startDate → cycle.endDate`, the
  `today` caret sits at `now`, and `N days left` counts to the end. This is why the mock's axis
  reads Jul 30 → Aug 12 while the tiles read six cycles.
- **Every number below is the completed-cycle window**, unchanged from today.

With no active cycle the timeline section is `null` and stays blank (D11); the numbers still read.

### D3 — Annotations are derived; the mock's causal clause is not repeated

The mock hand-authors two things this change may not:

1. `Retro agreed: smaller PRs`. The agreed text lives in `retro_action.body`, which is reachable
   only through `retros.detail` (one query per retro) and carries `assigneeId` — an identity
   column. So the retro annotation states what `retro` itself carries: the retro's **title** and
   the moment it **closed** (`retro.closedAt`, within the cycle's span).
2. `— the dots have been denser since`. That is a causal claim about a retro's effect, and yapm
   does not get to make it. The subline states the neutral count instead — deployments in the
   cycle before the retro closed and after it — with no causal verb, and the timeline's `how ·`
   says it is a count either side of a date and not a claim about cause.

*Why:* the honesty rule this series runs on. A page that invents a correlation is worse than a
page that draws fewer words, and the honesty section of this very page is about not guessing.

### D4 — The release call-out is chosen by a stated, deterministic rule

The called-out deployment is **the first successful deployment of the ISO week, within the active
cycle, that carried the most successful deployments**; ties break to the earliest. Its annotation
names its `ref` when the row has one (`checkout-v2 went out here`) and otherwise says
`A deployment went out here`; the mono subline is `<date> · first of N that week`.

*Why:* the mock's call-out is the interesting one, and "interesting" has to become a rule or it
becomes a hand-authored string. Ties break deterministically so the drawing is stable across
renders and testable.

*Alternative rejected:* the most recent deployment. It is stable but says nothing — the mock's
call-out earns its space by pointing at the busiest moment.

### D5 — One dot is one merged pull request, and `pullRequests(scope)` de-duplicates

`pullRequests(scope)` currently `flatMap`s `issue.pullRequests`, so a pull request linked to two
issues in scope appears **twice** in every median and every rate. That is invisible in a tile and
glaring in a distribution strip, where it draws two dots for one change. `DeliveryPrInput` gains an
optional `id`; the projection populates it; `pullRequests` de-duplicates by it when present.

Consequences, both deliberate:

- The tile's median and the strip's dots are the same population by construction. The page cannot
  state two medians.
- **The retro's numbers change for a team that links one PR to two issues in the same cycle**, from
  double-counted to correct. `packages/schema/src/zero/retro/seed.golden.test.ts` is the tripwire:
  if it moves, the movement is a fixed double-count and the golden is updated *with the reason
  written beside it*. If it does not move (its fixture has no multi-linked PR), the dedupe is
  proven by a new unit test instead.

*Alternative rejected:* de-duplicating only inside the new distribution derivation. It leaves the
existing double-count in place and puts a different population behind the median quoted on the tile
than behind the dots under it — two numbers for one fact on the one page whose subject is honesty.

### D6 — The median is drawn where it falls, and the axis is linear with giants included

The strip's axis is linear from 0 to the largest observed open→merged duration, rounded up to a
readable tick. The median rule is positioned by that axis from the **same**
`flowMeasures.prCycleTimeHours` the tile shows — not re-derived. `ia.html`'s own `how ·` copy for
this number is `linear scale · giants included · team-level only`, and the `how ·` says exactly
that.

The cost is the mock's own: two 200h+ outliers compress the crowd into the left tenth of the axis.
That is the reading — which is why the outlier annotation exists, and why it states the count and
the fact (`two waited past 200h`) from the data rather than as decoration. No log axis, no clipped
axis, no "other" bucket: each would hide the shape the section exists to show.

### D7 — Every metric definition keeps exactly one home, and the mapping is total

| Definition (`descriptors.ts` key) | Where it is drawn |
|---|---|
| `shipped` | Shipped tile; the per-cycle bars in CYCLE FLOW |
| `pr_cycle_time` | Open to merged tile; the median rule in OPEN TO MERGED |
| `ci_failing_rate` | Checks failing tile (with its tick mini) |
| `issues_without_pr` | Not linked to a change tile |
| `total`, `canceled` | the Shipped tile's `how ·` |
| `carried_out`, `carried_in`, `added_mid_cycle` | CYCLE FLOW — the ribbons and the `+N added` caps |
| `carried_twice_plus` | CYCLE FLOW's `how ·`, and its standfirst when non-zero |
| `time_to_first_review`, `review_rounds` | REVIEW RHYTHM — the standfirst's two medians and each small multiple's segments |

A unit test walks `[...DELIVERED_METRICS, ...FLOW_METRICS]` and asserts every key appears in the
built model's declared mapping exactly once. *Why:* a redraw is exactly how a signal gets quietly
deleted, and "we redistributed them" is a claim only a total mapping can keep.

### D8 — The journalism tile is a new component; the retro's tiles do not move

`metric-tiles.tsx` renders a 224px card: label, mono value, sparkline, delta line, caption
sentence, optional action. The mock's stat tile is a different object: a 28px number with a unit,
a delta pill, a drawn mini flush right, a `how ·` under it, no caption sentence, and no border —
four of them separated by hairlines across the full measure.

So `apps/web/src/delivery/stat-tile.tsx` is new and `metric-tiles.tsx` is **untouched**, keeping
the retro's markup, classes, formatters and `retro-seed-*` selectors byte-identical. Its header
comment is corrected to name its one remaining consumer and to say why it stays where it is (it
renders the `DeliveryMetric` model that lives in `metrics/`). `metric-format.ts` is shared by both
and stays shared.

*Alternative rejected:* generalising `MetricTile` with a `variant` prop. Two tiles that share only
their input type would meet in a component whose every branch is one caller's, and the retro's
markup would be one careless default away from moving.

### D9 — The honesty statement is data, and it is corrected rather than ported

The model carries `honesty: { line: string; more: readonly string[] }`. The collapsed line names
what is genuinely unmeasured; `more ·` unfolds the rest. Content, fixed by what is true today:

- **Absent, and named as absent:** change failure rate and time to restore (both need an incident
  entity that does not exist), and **deploy frequency as a rate** — the page draws deployments as
  they happened and does not normalise them into a rate.
- **Not claimed as absent:** `merged → live`. It is derivable from `mergeCommitSha ↔ sha` against
  `deployedAt` and is already stated per change on the issue detail's rail, so the `more ·` says
  where it is stated rather than that it is missing. Repeating the mock's line here would ship a
  new false statement on the page whose subject is honesty.
- **The coverage limit, disclosed:** pull requests reach this page only through the issue subtree
  (`issue → issueLinks → pullRequest`), so a change linked to no issue is invisible in the
  distribution, the rhythm and every flow number. This has always been true and has never been
  said.

A unit test asserts the statement names the three absences and contains no claim that merged-to-live
is unmeasured.

### D10 — The peek's subject is the divergence set, and its trigger is a real link

The chip on the timeline is drawn for the divergence class this product already computes
(`computeDivergence` → `status_behind_merge`: done in git, not on the board), placed at the merge
moment of the diverged issue's pull request. When several issues have diverged, the chip is the one
whose merge is **newest** (and the peek's count says how many there are). The chip is a
`<Link>` to the issue, so `⏎` is the browser's own activation and the peek intercepts nothing;
`esc` closes and returns focus, both from the shipped `usePeek`. The panel carries the issue's
phrase from the shared dictionary and its `RealityTrack` — no new strings.

`PeekProvider` wraps the page, so "at most one peek open" is the provider's single nullable id
rather than a rule this page keeps.

### D11 — Blank means blank

Each section is `null` in the model when its input is empty: no active cycle → no timeline; no
merged PR in the window → no distribution and no rhythm; no completed cycle → the existing
whole-page empty state. The view renders `null` sections as nothing at all — not a heading, not an
axis, not a zero. *Why:* an empty chart is a claim that there is a shape to see.

### D12 — Accessibility: each chart states what it shows and what one mark is

Every drawn form carries a truthful `role="img"` label naming the form, the population and **the
unit of one mark** — `"18 merged changes by hours from open to merge; one dot is one merged pull
request; median 46 hours"`. Direction and outlier status are in words as well as colour (the delta
pill states `down 22h`, the outlier annotation states `two waited past 200h`). New token pairs go
into `packages/ui/src/styles/contrast.test.ts` for **every** theme block, light and dark:
annotation ink on the page ground, the median rule, the outlier ring, the carryover ribbon fill and
its ink, and the rhythm's review segment.

### D13 — Bounded work per render, and bounds derived from the model

A 12-cycle window can hold a lot of pull requests. The distribution draws one dot per merged PR
(bounded by the population, which is the honest reading). The rhythm's small multiples are
**capped** — the model publishes the cap and the count it drew, the section states
`showing N of M`, and the cap is a named constant in the model, never a magic number in a test.
Tests derive every bound from the rendered page or the model, never from a fixture's size (the
lesson from a red CI run in this series: e2e fixtures accumulate rows across specs).

### D14 — A `how ·` derivation belongs with the number, not with the drawing

Each `how ·` string pair (`body`, `constraint`) is built in `page.ts` beside the number it
explains, in the register `ia.html` draws (`Median of the last 26 merged changes, opened → merged,
drawn where it falls — not quoted from a summary.` / `linear scale · giants included · team-level
only`). The view passes them to the shipped `How` component and writes no copy of its own.

*Why:* a derivation that lives in the view drifts from the derivation that lives in the formula the
first time either changes; and this is the mechanism by which the page's whole caption budget was
replaced, so it has to be as testable as the numbers.

### D15 — The window selector keeps its native control, in the mock's register

The mock draws `Last 6 cycles ▾` as a button. The control stays a native `<select>` in the
`Masthead`'s `actions` slot, restyled to that register — the `issue-list-daylight` D7 precedent:
a passing keyboard assertion drives it, and a custom menu would be a keyboard regression bought
with a chevron. The visible `Window` label folds into the control's accessible name (chrome is
labels, and the standfirst already says what the window is).

## Risks / Trade-offs

- **The dedupe in D5 moves a shipped number** → the retro golden test is the tripwire; if it moves,
  the reason is recorded in this file and the docs table for the retro panel is checked for a claim
  that the old value made true.
- **The distribution's linear axis compresses the crowd** → accepted, and the section's outlier
  annotation exists precisely to name what the compression is caused by. Recorded as the mock's own
  trade-off, not discovered later.
- **Four new drawn components is the largest drawing surface this series has added at once** → all
  four take structural props with no schema import, all four get stories, and all four are proven
  by component tests over fixtures whose expected geometry is stated, so a drawing regression is a
  failing assertion rather than an eyeball.
- **A 12-cycle window on a busy team is the worst render on the page** → the rhythm is capped and
  the cap is in the model; the distribution's cost is one pass per merged PR; nothing is computed
  per pixel.
- **The peek floats over the timeline's right shoulder** (the mock's own self-critique: it hides
  the quiet stretch while open) → accepted; the peek is a transient and closes on `esc` or blur.

## Migration Plan

None. No migration, no table, no data backfill. The change is presentation over facts that already
sync, plus one de-duplication in a shared pure function. Rollback is a revert.

## Open Questions

None that would change the specs, the approach or the task breakdown.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables, no mutators, no migration.** Prefer **no new named query**; if one is genuinely
  required it carries the same team-scoped predicate as its siblings and the reason why the
  existing reads could not serve is written here.
- **The window unit is COMPLETED CYCLES** (3 / 6 / 12, max 12) — never days. The mock's "last 6
  cycles" is already correct; the selector keeps its behaviour and its one-history-entry-per-change
  rule.
- **`apps/web/src/delivery/metric-tiles.tsx` is shared with the retro panel by construction.** Do
  not break that consumer; if the tile must change shape, the retro panel is updated in the same
  change and proven to still render (D8 avoids the situation entirely).
- **Metrics stay team-level with NO identity dimension** — a VISION constraint, not a preference.
  No per-person series, no leaderboard, no reviewer names. `review.author` is a provider login with
  no mapping to a yapm user and must not be surfaced.
- **Every derived number carries `how ·`** and nothing else explains itself at rest; honesty
  collapses to one line plus `more ·`. Sections lead with a sentence — per `ia.html` this page's
  section standfirsts are the one place on a work surface where a full sentence is allowed, because
  they state what the data says.
- **Where there is no data the section stays BLANK** rather than drawing an empty chart or a zero.
- **Keyboard-first:** the peek and every `how ·` are focus-reachable and escapable, the window
  selector is operable without a pointer, and `⌘K` is owned globally by the frame — this surface
  *registers* commands and binds no listener of its own.
- **Sub-100ms:** render from already-synced rows; the page computes client-side today and keeps
  doing so. Watch the cost of per-PR distributions across a 12-cycle window.
- **Accessibility:** every drawn chart carries a truthful `role="img"` label stating what it shows
  and what one mark is, no fact is conveyed by colour alone, and theme contrast holds in **every**
  theme block (`packages/ui/src/styles/contrast.test.ts`).
- **Three hard-won CI lessons carried forward:** never hard-code a magic budget that encodes e2e
  fixture size (fixtures accumulate rows across specs — derive bounds from the page); never write a
  test whose premise is "this environment lacks X" (CI is Node 24, dev machines may be Node 26 —
  stub the environment explicitly); and when a count is displayed, be exact about its **unit** (the
  issue list shipped a bug where a slot count and a distinct-issue count were conflated — state per
  chart what one mark represents, and test it).
- **`openspec/specs/board/spec.md` still describes the board as "a peer to the issue list"** in
  pre-frame navigation vocabulary. This change does not touch the board's subject, so that text is
  left alone deliberately rather than by omission.

Taken during the build:

### The retro's golden did not move, so the dedupe is proven directly (task 2.3)

`DeliveryPrInput` gained an optional `id` and `pullRequests(scope)` now skips a repeat of the same
id. **Neither `retro/seed.golden.test.ts` nor `retro/seed.test.ts` moved**, because both fixtures
project pull requests without ids — the dedupe is a no-op for an id-less population by construction,
which is exactly the property D5 asked for. So the fix is proven directly instead, in
`metrics/scope.test.ts`: one merged change linked to two in-scope issues is one entry in the
population, one contribution to `prCycleTimeHours` (20h rather than the double-counted 30h) and one
to `ciFailingRate` (50% rather than 67%); an id-less projection keeps all three of its old numbers;
and the dedupe holds across the cycles of a window, not only within one cycle.

### Two projections of the same subtree, but only one population rule

`packages/schema` cannot import `apps/web`, and D1 requires `page.ts` to declare its row shapes
locally rather than sharing `team-home.ts`'s. `apps/web/src/delivery/rows.ts` also cannot be retired:
the retrospective's `seed-model.ts` projects through it. So the synced `issue → issueLinks →
pullRequest` subtree is projected in two places — `rows.ts` for the retro, `page.ts` for the page.
What is **not** duplicated is the thing that could produce two readings: the population rule (one
entry per change) lives once in `pullRequests(scope)`, and the per-change arithmetic lives once in
`scope.ts` (below). Two projections that both hand the same rows to the same population function
cannot measure two populations.

### `prCycleHours` and `prFirstReviewHours` extracted rather than re-derived

The distribution needs the open→merged duration of one change, and the rhythm needs one change's
first-review wait; both already existed inside `flowMeasures`' median expressions. Re-writing either
in `page.ts` would have put a dot's position and the median rule drawn over it behind two
arithmetics. Both are now exported one-liners in `scope.ts` that `flowMeasures` itself calls, so "no
formula is re-derived" is literally true rather than nearly true.

### `clampDeliveryWindowSize` exported from `window.ts`

`buildDeliveryPage` slices the completed cycles itself (it needs the window's rows for the flow band
and the prior window for the delta), so it has to bound the request with the same arithmetic
`buildDeliveryWindow` will apply — otherwise an oversized request would hand over a window of one
length and compare it against another. The private `clampSize` became exported rather than copied.

### Two `how ·` bodies state no denominator count, on purpose

`flowMeasures` publishes the CI failing **rate** and the unlinked-issue **count**, not the
populations underneath them. Quoting "N of M changes had a failing check" would have meant computing
M in `page.ts` — a second computation of a published number's own denominator. Those two derivations
state the rule instead ("a change with no checks at all is not in the denominator"), and only the
Shipped derivation quotes counts, because `total` and `canceled` are metric definitions it reads
straight off the window (D7 gives them that home).

### The week boundary is re-stated locally, not imported

The call-out rule buckets by ISO week, and `team-home.ts` already has a Monday-based UTC week start —
but D1 requires the two page models to stay independent of one another (the same Zero rows satisfy
both, and neither imports the other). `page.ts` therefore carries its own three-line `utcWeekStart`
with a comment naming the chart it agrees with, rather than creating an import edge between the two
largest models in the package.

### `metricMap` carries a `drawn` flag beside each placement

The totality rule is about definitions having a home; whether that home rendered today is a
different claim. A placement that said `flow` while the flow band was null would be a promise the
page did not keep, so each placement also states whether its section drew for this input. The
totality test walks the twelve keys regardless.

### The outlier rule, and the mock's un-derivable clause

The mock calls out "two waited 200h+ · both were single giant PRs". The threshold is now a stated
multiple — `DISTRIBUTION_OUTLIER_MULTIPLE = 4` times the median — so the call-out is a rule over the
data rather than a hand-picked pair of dots, and the annotation states the count and the slowest
observed hours. **"Both were single giant PRs" is not derivable at all** (nothing in the schema
carries a diff size) and is not said anywhere.

The review rhythm's axis is likewise a published constant, `REVIEW_RHYTHM_AXIS_HOURS = 96`, beside
`REVIEW_RHYTHM_CAP = 24`: a change that ran longer states its own duration in text (the mock's
`208h` / `236h`) instead of being clipped, and both numbers are read from the model by the tests
rather than written into them.

### The divergence class is bigger than the mock's one chip, and the model says so

An issue whose linked change merged while its status is still `todo`/`in_progress` diverges — which
in a realistic fixture is more than one issue. The peek names the newest merge (ties by id) and
carries `classCount` plus a `classLabel`, so the one chip never implies it is the only one.

### `deliveryCyclesOf` is exported

The proof that the distribution's median is the measure's own and not a second computation has to
build the exact scope the page read. Exporting the projection lets the test write
`flowMeasures(scopeOfCycles(deliveryCyclesOf(window, issues))).prCycleTimeHours` and compare, rather
than re-implementing the projection in the test and proving only that two copies agree.

### `window-model.ts` is deleted rather than orphaned

`buildTeamDeliveryFor` existed for exactly one caller, the shipped `delivery-view.tsx`, and
`buildDeliveryPage` now does what it did (slice the completed cycles, bound the request, build the
window and its predecessor) as one step of a larger derivation. Left in place it would have been a
second entry point into the same arithmetic with no consumer but its own test — which is how two
readings of one window start. `window-model.ts` and `window-model.test.ts` are both deleted; every
claim they made (the ceiling, the exclusion of the cycle in progress, the null for a team with no
completed cycle) is asserted in `metrics/page.test.ts` and in this change's view test. `rows.ts`
stays: the retrospective's `seed-model.ts` still projects through it.

### The stat mini draws the series, and only the series

The mock draws four different minis: a share bar for Shipped, a trend line for Open to merged, a row
of per-change ticks for Checks failing, and nothing for the fourth. Two of those are not derivable
from what the reading publishes — the share bar needs a denominator the model does not carry beside
the value, and the tick row is per-CHANGE where the reading's series is per-CYCLE. Rather than
compute a second population inside a 64px drawing, every mini is drawn from the reading's own
per-cycle series: a polyline for the three trend-shaped readings and per-cycle ticks for
`ci_failing_rate`, each with a truthful `role="img"` label naming the cycles and their values, and
**nothing at all** when fewer than two cycles have something to measure.

### The delta pill's sense is a ground, not an ink

The mock inks the pill green. `--status-done` as 11px TEXT is not an AA pair on any of the six
grounds, and the precedent (app-frame DI-2, issue-list-daylight) is that the reader wins. The sense
is carried by the pill's GROUND (a 10% `--status-done` wash, the `--urgent-soft` wash, or
`--bg-hover`), the ink stays `--text-1`, and the direction and the sense are both stated in words in
a visually-hidden span (`down 22h against the previous 6 cycles — better`). The new composite is
measured in `contrast.test.ts` in every theme block.

The same rule moved two more labels off the accent: the distribution's `median 46h` and the
timeline's `today · day 9 of 14`. This file's own frame assertion already records that
`--accent-strong` measures ~4.44 on `--bg` in editorial light. The RULE and the CARET keep the
accent, because a line is non-text drawing and answers to 3:1.

### The carryover ribbon's fill is scaffolding, and the contrast test says so

A 15% wash of `--status-in-progress` cannot clear the 3:1 non-text bar and should not: the ribbon's
fact is its COUNT, drawn on it in `--text-1` with a `--bg` halo, and restated in the chart's
`role="img"` label. The ink is asserted at AA over both composites; the fill is recorded as a
deliberate exemption with a lower bound, exactly as the reality track's empty station is — so a
later change that darkens the ribbon has to argue with the right number.

### Two chart labels the model publishes, and the drawing never composes

Each of the four components takes its whole `role="img"` label as a prop rather than assembling one
from its data. A drawing that composed its own label would be a second place where "what one mark
represents" is decided, and the population it names is the model's fact, not the SVG's.

### `provenance` is decided by the stat key, in the view

The model publishes no provenance flag. Which of the four readings comes from a connector is a
closed function of `DeliveryStatKey` (`pr_cycle_time` and `ci_failing_rate` do, the two
cycle-derived ones do not), so the mapping is a `Record<DeliveryStatKey, boolean>` in
`stat-tile.tsx`: exhaustive by the type, so a fifth reading cannot arrive without a decision, and it
never travels as data that could disagree with the dictionary's own provenance rule.

### Where the drawing deliberately differs from `delivery-full.png`

- **Band 2 keeps the frame's register.** The mock's `Delivery` is a 40px editorial title; band 2
  belongs to `app-frame` (PR #33) and is 15px on every surface in the product. Changing it here
  would fork the frame for one page.
- **The charts scale with the measure.** Each is a fixed `viewBox` at `w-full h-auto`, so at the
  1120px measure they draw at the mock's geometry and narrower they shrink proportionally. The
  alternative — a fixed intrinsic width with a horizontal scrollbar — puts a scroll region inside a
  reading surface.
- **The axis labels are the cycle's start and end**, not the mock's four interior dates: the model
  publishes the span, and interpolating interior tick dates would be a second calendar.
- **The mock's hollow rect above three of the six flow bars is not drawn.** It maps to nothing in
  the data (it appears on cycles 2, 4 and 6 and matches neither their carries nor their adds), so it
  would have been decoration.
- **`0h` rather than `0` at the distribution's origin**, because the suffix is applied to every tick
  by the same rule.

### The assembled page was not read in a browser

The four drawn components were rendered and read at 1440×900 in **all six theme blocks** through the
`packages/ui` workbench, which is where the geometry and the token work live; two real defects came
out of it (the crowd annotation overprinting the median label, and a story passing positions computed
against the wrong axis). The ASSEMBLED page was not: it needs the three-container stack, and the
instruction for this pass was explicitly not to start it. What stands behind the assembly instead is
`delivery-view.test.tsx` — section order, the standfirst, every `how ·`, the peek's focus and escape
behaviour, the honesty disclosure, the blank sections and the absence of any per-person string — plus
the full Playwright suite in CI. Recorded rather than glossed: nobody has yet looked at this page.

### A flow band with nothing to flow still gets a sentence

D11 says a section with no data does not render; a flow band with bars but no carries and no caps
**does** have data — it has the bars. Its standfirst states the true finding ("Nothing carried from
one of these 6 cycles into the next.") rather than folding, because the sentence a section leads with
introduces the drawing under it, and that drawing exists.

### The `+N added` cap became an outline, because the measurement said the stack was a lie

Enumerating this page's marks in `contrast.test.ts` (task 6.11) turned up a real defect rather than a
token to retune. `--status-in-progress` is an amber: it measures **2.17–2.87 on `--bg` in the three
light presets** — under the non-text bar — and **1.31–2.31 against `--status-done` in all six**.
Drawn as it first was, a solid block stacked flush on the shipped bar, the added cap and the shipped
bar read as ONE taller bar of shipped work in every theme. That is not a contrast nicety; it is the
drawing stating the opposite of the fact.

Raising the amber to 3:1 on a near-white ground is a product-wide decision — it inks the in-progress
status glyph, the issue row and the retro's caution card — and this change does not get to make it
for one chart. So the fix is in the drawing, and it is the shared vocabulary's own: `drawn.tsx`
§`ScopeBand` already draws "added" as an **outlined** block rather than a filled one. The flow band's
cap now matches it — an outline, separated from the shipped bar by 3px of page ground, so the two
quantities are two shapes at any contrast, with the count carried by the `+N added` label in
`--text-2` and by the chart's `role="img"` label. `delivery-charts.test.tsx` asserts the cap is
`fill="none"` and that its bottom edge sits above its own column's bar; the two measurements are
recorded in the contrast block rather than deleted.

### The retro tripwire mounts `RetroSeedPanel`, not the shared component beneath it

D8's tripwire originally mounted `MetricSection` directly. It now mounts the real consumer, because a
shared component with one remaining caller breaks in the CALLER's wiring as readily as in its own
markup — the panel's `action` prop reaching the tile is the part no type-check would catch if the
prop were quietly dropped. The test asserts one `retro-seed-add-card` per tile drawn, which is what
that wiring produces.
