# one-reality-vocabulary

## Why

The app draws PR/CI/deploy reality **two incompatible ways**, and neither is composable.

1. **The icon strip.** `RealityStrip` / `RealityStripPlaceholder` / `DivergenceFlag` in
   `packages/ui/src/components/issue-row.tsx` — a fixed `w-[86px]` slot of lucide icons: five
   git glyphs in `PR_GLYPH`, check/x/loader in `CI_GLYPH`, a `RocketIcon` for deployed, a mono
   review age, and a `TriangleAlertIcon` for divergence. Rendered by the issue-list row
   (`issue-list.tsx:546`) and, inside the issue detail, by one cramped
   `DetailField label="Delivery"` (`issue-detail.tsx:774–800`).
2. **The track.** `RealityTrack` in `apps/web/src/home/drawn.tsx` — a fixed `w-[118px]`
   four-station track of nodes and segments with a `//` divergence break, rendered by the team
   home's YOURS rows (`team-home.tsx:772`) and its divergence attention row
   (`team-home.tsx:432`).

They encode the same four facts in completely different shapes with **no shared type**
(`RealityStripProps` in `issue-row.tsx` vs `TeamHomeStrip` in `packages/schema/src/zero/team-home.ts`
— structurally identical, independently declared). The CI glyph is declared **twice with identical
semantics**: `CI_GLYPH` in `issue-row.tsx:92` and `CI_HEALTH_GLYPH` in `issue-detail.tsx:744`.

The northstar settles it: **the track wins.** Every mock
(`design-explorations/overhaul-2026-08/northstar/{issues,issue,delivery,home-digest-2}.html`)
draws reality as nodes + segments + the `//` break, and never as icons. `NORTHSTAR.md` records
that vocabulary as shared across surfaces by construction ("Chip anatomy and track vocabulary
shared: same phrase dictionary strings, same node/line/`//` grammar on issues rows, the delivery
peek, and the issue rail").

Why now: three page rebuilds (issues list, issue detail, delivery) are queued behind this. Today's
`RealityTrack` cannot serve any of them — `TrackNode`, `TrackSegment`, `TrackShape`, `trackShape`,
`segmentBefore`, `NODE_CLASS` and `SEGMENT_CLASS` are all module-private, `broken` forces a
hardcoded shape, and the width and orientation are baked in, so a reuser gets the whole 118px
horizontal widget or nothing. The issue detail's rail (`issue.html`: idea → designed → built → live)
is **vertical with a label and fact lines per station** and cannot be expressed at all. If the three
page changes each start from that, the vocabulary forks three more times. `drawn.tsx`'s own header
comment says promotion waits for "a real second consumer"; that consumer now exists three times over.

Vision principles served: **the work-graph wedge** (VISION — one language for reality on every
surface, not a per-page dialect); **keyboard-first** (CLAUDE.md #10 — the peek and the how are
opened and escaped without a pointer); **sub-100ms** (#9 — every drawing renders from
already-synced rows, and nothing added here waits on the network); **accessibility as part of
done** (the track is `role="img"` with a truthful label; theme contrast is asserted in every theme
block).

## What Changes

- **One generalized track replaces both drawings.** `RealityTrack` is generalized and promoted:
  node kinds, segment kinds and the shape builder become exported; orientation
  (`horizontal | vertical`), width and station set become composable; the `//` break becomes a
  property of the computed shape rather than a hardcoded `broken` array. All three forms compose
  from the one implementation — the compact list-row track, the wider home-row track, and the
  issue detail's **vertical rail with a label and fact lines per station**.
- **One shared strip type.** The incompatible `RealityStripProps` / `TeamHomeStrip` pair collapses
  into a single shared shape that both the schema derivations and the UI primitive speak.
- **The icon strip and the divergence triangle are retired.** `RealityStrip`,
  `RealityStripPlaceholder`, `DivergenceFlag`, `PR_GLYPH`, `CI_GLYPH`, `CI_HEALTH_GLYPH` and the
  lucide imports behind them are deleted. Divergence is drawn as the `//` break on the track plus
  the existing sentence — never a warning triangle.
- **Status arcs and priority ticks are reconciled to the mock geometry.** `status-glyph.tsx` and
  `priority-mark.tsx` predate the northstar. They are corrected against `issues.html`'s `<defs>` —
  status is **cycle position** (backlog = dashed ring, todo = open ring, in-progress = half arc,
  in-review = three-quarter arc, done = filled), priority is **weight as ticks** with one tick
  standing alone for urgent, all on the 20-grid with 1.6px round-cap strokes. Reconciled in place;
  no third set is added.
- **The drawn primitives are promoted out of `apps/web/src/home/`** into one shared module every
  page imports: `DayBand`, `ScopeBand`, `TickBar`, `TriageDots`, the generalized track, and
  `CadenceChart`. `team-home.tsx` is refactored onto the shared module in this change — **no
  duplicate copy survives**.
- **Three shared patterns are drawn once**, per `ia.html` §"Two patterns, drawn once" and
  §"Provenance":
  - **The peek** — anything dotted opens something; hover **or** keyboard focus opens it; `⏎` goes
    to the thing, `esc` stays. **At most one peek open per page, enforced in component state**, not
    by convention. Elevation is permitted here; transients are the only elevated surfaces.
  - **The how** — a derived number never explains itself at rest; it carries a quiet mono `how ·`,
    opening reveals the derivation, closing returns the surface to quiet.
  - **The provenance mark** — monochrome, 12–14px, `currentColor`, placed **after** the fact it
    sourced; never replacing a status arc, never colored, never larger than the text. Figma on
    link-kind artifacts only; uploads carry no mark. Built so a second provider is additive.
- **Every current consumer migrates, minimally.** The issue-list row and the issue detail's
  Delivery field swap the primitive and keep their present layout; `packages/ui` stories/tests and
  `apps/web/src/routes/showcase.tsx` are updated. Those pages are **not** restructured — the next
  two changes rebuild them.

## Non-goals

- **No new table, no new named query, no mutator, no migration, no container.** This is
  presentation over facts that already sync.
- **No new fact.** The track shows exactly: PR state (`draft|open|merged|closed`, plus the
  synthesized `approved`), CI health from `ci_check.conclusion`, review age, and the deploy join
  (`repo + mergeCommitSha == deployment.sha`, earliest successful `deployedAt`, **no `headSha`
  fallback**). Two honest limits stay honest: `ci_check` has no start/finish times, so "checks took
  4m" is not computable; and there is no review-requested event, so `reviewAgeMs` falls back to PR
  open time and the surface never claims "waiting on a reviewer since X".
- **No new divergence kind and no new sentence.** The three existing kinds
  (`status_behind_merge`, `status_ahead_of_pr`, `done_but_ci_failing`) and their existing
  `DIVERGENCE_LABEL` strings are unchanged; only the drawing changes.
- **No page rebuild.** The issues list, issue detail and delivery layouts are owned by the three
  changes that follow. This change owns the shared visual vocabulary only.
- **No new provider.** GitHub is the only provider that exists; the provenance component is built
  so a second one is additive, and no second one is added.

## Capabilities

### New Capabilities

- `reality-vocabulary`: the one drawn language for delivery reality across every surface — the
  generalized track (node kinds, segment kinds, the `//` break, orientation, station sets), the
  status arcs and priority ticks as cycle position and weight, the shared drawn-primitive module,
  the peek, the how, and the provenance mark.

### Modified Capabilities

- `component-library`: the issue-row primitive's reality slot becomes the track slot and the
  divergence-flag slot is retired (divergence is the break on the track); the status-glyph and
  priority-mark requirement gains the northstar geometry it is reconciled to.
- `issue-list`: the row's delivery signal is drawn as the reality track rather than the icon strip,
  and divergence is expressed by the `//` break rather than a warning triangle. The facts shown,
  the alignment guarantee and the unlinked state are unchanged.
- `issue-detail`: the Delivery field draws the same track vocabulary rather than the icon strip;
  the CI glyph duplicated inside the detail is removed in favor of the shared vocabulary.

## Impact

- **Code**: `packages/ui/src/components/issue-row.tsx` (strip + flag removed, track slot in),
  `status-glyph.tsx`, `priority-mark.tsx`, `board-card.tsx`; new shared drawn module in
  `packages/ui/src/components/` (reality track, day band, scope band, tick bar, triage dots,
  cadence chart) plus new peek, how and provenance-mark components;
  `apps/web/src/home/{drawn.tsx,cadence-chart.tsx,team-home.tsx}` (refactored onto the shared
  module, duplicates deleted); `apps/web/src/issues/{issue-list.tsx,issue-detail.tsx,delivery.ts}`;
  `apps/web/src/routes/showcase.tsx`; `packages/schema/src/zero/{team-home.ts,delivery.ts}` (one
  shared strip type); `packages/ui/src/styles/globals.css` only if a token is missing.
- **No server code, no migration, no env var, no dependency change.** Lucide imports shrink.
- **Sync reads**: unchanged query surface; the compose smoke test must stay green.
- **Existing e2e**: `connectors.spec.ts` asserts `[data-slot="reality-strip"]` in four places and
  `issues.spec.ts` references the strip slot. Selectors are **updated to the new slot name, never
  weakened** — every existing assertion keeps asserting the same fact about the same row.
- **Contrast**: `packages/ui/src/styles/contrast.test.ts` is extended so the track's node/segment
  and break colors, and the peek's elevated surface, are asserted in every theme block, light and
  dark.
- Docs: new `apps/docs/src/content/docs/features/reality-vocabulary.md` (the track, the peek, the
  how, the provenance rule); `features/delivery-signals.md` updated where it describes the strip as
  icons and a rocket; README feature list where it names the "reality strip"; ROADMAP change row;
  `DESIGN.md` where it describes the row's reality slot. No configuration-reference impact (no env
  vars).
