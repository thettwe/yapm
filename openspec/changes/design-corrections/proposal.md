## Why

The six-change northstar overhaul (PRs #31–#36) is landed, and the maintainer has now looked at the
rendered product beside `design-explorations/overhaul-2026-08/northstar/` for the first time. Four
things looked wrong. None is a missing feature; each is the drawing or a token disagreeing with the
rulebook, and three of the four are visible on the very first screen a member opens.

1. **Quiet rows are not quiet.** An issue with no linked change draws a dotted placeholder track —
   four hollow nodes joined by dotted segments — on every dense row. On a real list that is most of
   the page repeating one ornament, and `issues.png` lays down **no ink at all** there: the mock
   reserves the slot and draws nothing until there is a fact. `NORTHSTAR.md`'s own `issues.html`
   self-critique already states the intended behaviour — "quiet rows stay truly blank" — so the
   shipped list contradicts the rulebook it was assembled from.
2. **`done` lost its check mark.** PR #32 reconciled the status glyph to the mock's geometry, where
   status is cycle position and `done` is a plain filled disc. That was right about the family and
   wrong about the product: the glyph the product carried, and the one a reader recognises as
   *finished* rather than *filled*, has a check in it.
3. **The statusline says the wrong word.** Every northstar file draws band 3's right end as
   `● Synced`. The shipped statusline says `Connected`, inherited verbatim from the old header pill
   it replaced. `Connected` describes the socket; `Synced` describes what the reader has.
4. **The in-progress amber fails contrast, and the failure is currently codified.**
   `--status-in-progress` measures **2.17–2.87 against `--bg` in all three light presets** — under
   the 3:1 non-text bar (WCAG 1.4.11) — while `reality-vocabulary` §"The vocabulary is correct in
   every theme" already requires 3:1 for drawn elements and 4.5:1 for text-sized ones. The
   delivery-journalism change measured this, worked around it in the drawing, and deferred the
   retune as a cross-surface decision (that change's design.md, §"The `+N added` cap became an
   outline"). `packages/ui/src/styles/contrast.test.ts` currently pins the failure with a
   `>= 2.1` assertion and a comment explaining the deferral. The maintainer has approved the fix,
   so the assertion is raised to the real bar rather than left as documentation of a known break.

Vision principles served: **keyboard-first and sub-100ms are untouched** (this is drawing and
tokens; no query, no mutator, no new wait); **AA contrast in all three presets, light and dark** is
a standing constraint this change repays rather than defers; and the honesty rule the series runs
on — *the drawing says exactly what the data supports, and nothing where it supports nothing*.

## What Changes

- **A fact-free horizontal reality track draws no ink.** The slot keeps its exact reserved measure
  — stations column plus the mono age column — so a row that later acquires a pull request shifts
  nothing, but a track whose shape carries no fact and no break renders empty. **The issue detail's
  vertical rail is explicitly out of scope**: an unlinked issue's rail keeps its stated "no change
  linked yet" station, because a blank rail on a page whose subject is the change would be less
  honest, not more.
- **`done` is a filled disc carrying a check.** Same 20-unit grid, same round-capped stroke family
  as the arcs and rings, legible at the 14px a dense row renders it at, with a knockout ink taken
  from a token that clears the non-text bar against every hue the glyph is ever inked with.
- **The connected state's label becomes `Synced`.** Every other connection state keeps its current
  wording — connecting, reconnecting, offline, sign-in expired, sync error and closed each say what
  is actually true. `data-testid="connection-status"`, `data-connection`, `data-recovery` and the
  retry affordance are unchanged; fifteen e2e specs read them.
- **`--status-in-progress` is retuned in the three light presets** to clear the bar for how it is
  actually used, staying recognisably amber and clearly separated from `--status-done` and
  `--status-urgent`. Where the same hue serves both drawn marks and text-sized ink, it follows the
  precedent already in the token set (`--status-urgent` / `--status-urgent-ink`) rather than
  dragging one value to the stricter bar and losing the hue. The dark presets are **measured**, not
  assumed. `contrast.test.ts`'s `>= 2.1` assertion is replaced by the real bars.
- **`NORTHSTAR.md` records the one place the product deliberately diverges from the mocks** — the
  amber — in the same form PR #33's two divergences were recorded, so the mocks and the product
  stay honest with each other.

Non-goals:

- No new tables, no new synced queries, no mutators, no migration. Nothing in `packages/schema`
  changes.
- No restyle of anything outside these four. This change does not take the opportunity to revisit
  the phrase dictionary, the peek, the priority mark, or the board.
- No change to the vertical rail's empty station, to any connection state other than `connected`,
  or to any of the four connection data attributes.
- No new e2e specs. Existing e2e assertions that read the old drawing or the old word are updated
  to the new truth (PROCESS.md §3: this touches one of the four big-feature axes, so it is a small
  change — unit plus the existing suites, never e2e added reflexively).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reality-vocabulary`: the unlinked-issue empty state draws no ink in a dense row while reserving
  its measure (the vertical rail keeps its explicit statement); `done` is a filled disc carrying a
  check; and the contrast requirement gains the rule for a hue that serves both drawing and text.
- `issue-list`: a row whose issue has no linked entities draws a reserved but blank track slot
  rather than the dotted placeholder.
- `component-library`: the status glyph set's `done` drawing, and the issue-row primitive's quiet
  reality-track slot.
- `app-frame`: the statusline's healthy sync state reads `Synced`.

## Impact

- Code: `packages/ui/src/components/{reality-track,status-glyph,issue-row}.tsx`,
  `packages/ui/src/styles/{globals.css,contrast.test.ts}`, `apps/web/src/zero/connection.ts`.
  Read-only verification passes over `apps/web/src/issues/issue-list.tsx`,
  `apps/web/src/home/team-home.tsx`, `apps/web/src/frame/{statusline,sync-indicator}.tsx`,
  `packages/ui/src/components/board-card.tsx`.
- Tests: `packages/ui/src/components/reality-track.test.tsx`, a status-glyph geometry test,
  `packages/ui/src/styles/contrast.test.ts`, `apps/web/src/frame/sync-indicator.test.tsx`,
  `apps/web/src/zero/connection.test.ts`, and the fixture labels in three other web unit tests.
  E2E: `apps/web/e2e/issues.spec.ts` (the unlinked-row assertion) and `apps/web/e2e/connectors.spec.ts`
  (two assertions whose premise is the placeholder's presence).
- Docs: `apps/docs/src/content/docs/features/reality-vocabulary.md`,
  `apps/docs/src/content/docs/features/delivery-signals.md`,
  `apps/docs/src/content/docs/self-hosting/sync-recovery.md`, and
  `design-explorations/overhaul-2026-08/northstar/NORTHSTAR.md`.
- Dependencies, services, schema, API: none. The three-container promise is untouched.
