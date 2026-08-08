## Why

`design-explorations/overhaul-2026-08/northstar/delivery.html` is the canonical Delivery page and
the last surface in the northstar set that has not been built. The shipped page (PR #29) got the
numbers right and the reading wrong: twelve tiles in a wrapped grid, each with a 64px sparkline and
a full sentence of caption under it, a `Window` `<select>` labelled with a `<label>`, two
paragraphs of explanatory prose, and a bordered `What this doesn't show yet` panel with a
three-item bulleted list. It is a metrics dump. `delivery.html` is a **journalism cut**: each
section leads with a sentence stating what the data says, then draws the evidence, and every
derived number carries a quiet mono `how ·` and nothing else.

Four concrete gaps:

1. **The page never states what happened.** No annotated timeline: no deployment dots along the
   cycle axis, no called-out release, no retro marker, no `today · day 9 of 14`, no `5 days left`.
   The one fact a reader wants in the first second — *did we ship, and when* — is not on the page,
   even though `deployment.deployedAt` has been durable since PR #28 and Home already draws it.
2. **Three of the mock's four drawn forms do not exist.** The distribution strip (one dot per
   merged change, the median drawn **where it falls** rather than quoted), the cycle-flow band
   (bars with a carryover ribbon flowing between them and `+N added` caps), and the review-rhythm
   small multiples (open → first review → rounds → merge, one per change) are all computable from
   rows the page already syncs, and all are currently reduced to a 64px line and a number.
3. **The shipped vocabulary has no consumer here.** PR #32 landed the peek and the `how ·` as real
   components; `ia.html` names Delivery as the one product page that draws a peek, and this page
   is the heaviest intended consumer of the `how ·` in the product. Neither appears on it.
4. **The honesty panel now contains a lie of its own.** It says deployment frequency's metric
   "lands here in a later change" and describes lead time as open-to-merge only — but `merged →
   live` **is** derivable today (`pull_request.mergeCommitSha = deployment.sha`, joined against
   `deployment.deployedAt`), and the mock's own line ("merged-to-live isn't measured yet") would
   ship a *new* false statement on the page whose subject is honesty. What is genuinely unmeasured
   is change failure rate, time to restore, and deploy frequency **as a rate**. And the real
   coverage limit is undisclosed: pull requests reach this page only through the issue subtree, so
   a change linked to no issue is invisible here.

Vision principles served: **metrics are free views over native data** (four drawn forms, zero new
tables and zero new queries), **team-level only — never a per-person number** (the binding rule
line lives on this page, once in the whole app), **sub-100ms** (every number stays a pure function
over already-synced rows; changing the window issues no read), **keyboard-first** (the peek, every
`how ·` and the window selector are all operable and escapable without a pointer), and the honesty
rule this series runs on: **a sentence may only be said when a stored fact supports it.**

## What Changes

- **The standfirst becomes the mock's**: `Cycle 2 · last 6 completed cycles · team-level only —
  never a per-person number.` One label-register line in band 2, carrying the binding rule that
  `ia.html` places exactly once in the entire product — here.
- **An annotated timeline** over the **active** cycle's span (the window governs the numbers
  below; the timeline is *this* cycle): one dot per successful deployment, a called-out release
  with how many went out that week, a marker at each closed retro, the `today · day N of M`
  caret and `N days left`. **Every annotation is derived** — from `deployment.deployedAt`,
  `retro.closedAt` and the cycle's own dates. Nothing is hand-authored.
- **Four stat tiles** in the mock's anatomy — label, big number with unit, delta pill, a small
  drawn mini, and a quiet mono `how ·` that unfolds the derivation and folds back: **Shipped**
  over the window (`deliveredCounts.shipped`), **Open to merged** as a median with its delta
  (`flowMeasures.prCycleTimeHours`), **Checks failing** as a rate (`ciFailingRate`), and **Not
  linked to a change** (`issuesWithoutPr`).
- **OPEN TO MERGED — a distribution strip.** One dot per merged change on a linear open→merged
  axis, the median drawn at its own position on that axis, with the crowd at the left and the
  outliers at the right called out from the data (`two waited past 200h`). One dot = **one merged
  pull request**, stated on the chart and asserted by a test.
- **CYCLE FLOW — bars with a carryover ribbon**, one bar per cycle in the window, ribbons flowing
  between adjacent cycles for carried work, `+N added` caps, over a standfirst that states the
  carryover trend.
- **REVIEW RHYTHM — small multiples**, one per merged change: open → first review → rounds →
  merge, over a standfirst stating the first-review and rounds medians.
- **The one peek.** An issue chip on the timeline (the divergence set — done in git, not on the
  board) opens a peek answering *what is this?* with the issue's own phrase from the shared
  dictionary and its reality track; `⏎` goes to the issue, `esc` stays. One open at a time, by
  the shipped provider's construction.
- **The honesty line collapses to one line + `more ·`, and is corrected rather than ported.** It
  names change failure rate, time to restore and **deploy frequency as a rate** as unmeasured;
  it does **not** repeat the mock's merged-to-live claim, because merged→live is derivable and
  already stated per change on the issue detail's rail; and it discloses the coverage limit — a
  pull request with no linked issue is invisible on this page.
- **Every metric definition keeps a home.** The twelve descriptors in
  `packages/schema/src/zero/metrics/descriptors.ts` are redistributed across the four sections
  rather than dropped: the four tiles, the flow band (carried out / carried in / added mid-cycle /
  carried twice or more), the rhythm band (time to first review / review rounds) and the Shipped
  tile's `how ·` (in scope / canceled). A test asserts the mapping is total, so a redraw cannot
  quietly delete a signal.
- **Where there is no data, the section stays blank** — no empty chart, no zero, no placeholder
  axis. The whole-page empty state (no completed cycle) survives.
- **The window selector keeps its behaviour**: completed cycles, 3/6/12, default 6, max 12, in
  the URL, one history entry per change, operable by keyboard.
- **The retro's data panel does not move.** `apps/web/src/delivery/metric-tiles.tsx` is shared
  with it by construction; the journalism tiles are a different shape, so they are a new
  component and the retro's tiles, selectors and markup are untouched.

Non-goals — explicitly out of scope:

- **No new table, no new mutator, no migration, no new synced entity, no new service.** The four
  reads this page needs (`cycles.byTeam`, `issues.byTeam`, `deployments.byTeam`,
  `retros.byTeam`) all already exist and are all already synced by Home.
- **No new named query.** If one turns out to be genuinely required it carries the same
  team-scoped predicate as its siblings and the reason is recorded; the intent is zero.
- **No day-based window.** The unit is completed cycles (design §D1 of `team-delivery-view`
  stands).
- **No incident entity, no change failure rate, no MTTR, no deploy-frequency rate.** They are
  named as absent, which is the point of the honesty line.
- **No per-person anything at any depth** — no series, no leaderboard, no reviewer name.
  `review.author` is a provider login with no mapping to a yapm user and must not be surfaced.
- **No changes to Home, the issue list, the issue detail or the retro board.**
- **No new e2e spec** (PROCESS.md §3: this change touches one of the four big-feature axes —
  signature UI). The full suite must stay green and no assertion may be weakened.

## Capabilities

### New Capabilities

<!-- none: this change rebuilds an existing surface -->

### Modified Capabilities

- `delivery-metrics`: the page's reading changes from a tile grid to the journalism cut — the
  standfirst carrying the binding rule; the annotated timeline over the active cycle with derived
  annotations only; four stat tiles each carrying a `how ·`; the distribution strip with the
  median drawn where it falls and a stated unit per mark; the cycle-flow band; the review-rhythm
  small multiples; the one peek; a section with no data staying blank; and the honesty statement
  corrected to name what is genuinely unmeasured plus the page's real coverage limit. Every
  existing requirement about the window, the single definition of each formula, blamelessness,
  client-side computation and keyboard operation is preserved, and the requirement that every
  metric definition remains reachable somewhere on the page is made explicit.

## Impact

- `packages/schema/src/zero/metrics/page.ts` (new): `buildDeliveryPage(input, now)` — the pure
  derivation of the whole page: standfirst, timeline with its annotations, the four tiles with
  their `how ·` derivations, the distribution, the flow band, the rhythm band, and the honesty
  statement. Identity-free by construction and re-exported from `packages/schema/src/index.ts`.
- `packages/schema/src/zero/metrics/scope.ts`: `DeliveryPrInput` gains an optional `id`, and
  `pullRequests(scope)` de-duplicates by it — a pull request linked to two issues in scope is one
  change, and the tile median and the strip's dots must be the same population.
- `apps/web/src/delivery/rows.ts`: the projection carries the pull-request id, the per-PR
  timestamps the distribution and rhythm need, and the deployment/retro rows.
- `apps/web/src/delivery/delivery-view.tsx`: the page rebuild, top to bottom.
- `apps/web/src/delivery/stat-tile.tsx` (new): the journalism tile (number + delta + mini +
  `how ·`), separate from the retro's shared `metric-tiles.tsx`, which is untouched.
- `packages/ui/src/components/`: the four drawn charts as shared, structural-prop components with
  stories — annotated timeline, distribution strip, flow band, review rhythm — beside the existing
  `cadence-chart.tsx`.
- `packages/ui/src/styles/contrast.test.ts`: this page's new token pairs (annotation ink on the
  page ground, the median rule, the outlier ring, the carryover ribbon's fill and its ink, the
  rhythm's review segment) in **every** theme block, light and dark.
- No dependency, env var, container, table, mutator, permission predicate or migration is added
  or changed. `openspec/specs/board/spec.md` still describes the board in pre-frame navigation
  vocabulary; this change does not touch the board's subject and leaves that text alone.

Docs: `apps/docs/src/content/docs/features/delivery.md` rewritten to the new page (the four
sections, what each mark represents, how each annotation is derived, the `how ·` and the peek, and
a corrected "what this doesn't show yet" that names deploy frequency as a rate, change failure
rate and MTTR plus the unlinked-PR coverage limit), plus updates to
`features/reality-vocabulary.md` (the peek and the `how ·` have a product consumer),
`features/team-home.md` (where the cadence mini leads), `README.md` and `ROADMAP.md`.
