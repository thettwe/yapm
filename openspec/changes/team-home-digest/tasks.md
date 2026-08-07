# team-home-digest — tasks

Read first: `reference/zero.md` (1.x names: `defineQuery`/`defineMutator` — never the 0.x
API), `reference/` for TanStack Router + Tailwind 4.3, the two mocks
(`design-explorations/overhaul-2026-08/northstar/home-digest-2.html`,
`home-digest-2-quiet.html`), design.md §D1–§D13, and the existing
`packages/schema/src/zero/{delivery.ts,cycle-facts.ts,metrics/scope.ts}` plus
`apps/web/src/issues/issue-list.tsx` for row/glyph precedents.

## 1. The page model (packages/schema) — build pass 1

- [x] 1.1 Create `packages/schema/src/zero/team-home.ts` with `buildTeamHome(input): TeamHomeModel`
      taking structural rows (cycles, issues-with-linked-subtree, triage inbox, deployments,
      digest, retros, notifications, team) plus explicit `now` and `viewerId`. Reuse
      `computeDeliverySignal` / `computeDivergence` / `assembleLinkedEntities` /
      `buildDeploymentIndex`, `currentCycle`-style cycle selection (`compareCycles`), and
      the `metrics/scope.ts` added-mid-cycle semantics. No `Date.now()` inside; no identity
      field anywhere in the output types except the viewer's own rows (design §D1).
- [x] 1.2 Attention model (§D2): four disjoint classes by precedence
      (`status_behind_merge` → checks failing → open PR review age > 24h → triage inbox),
      per-class evidence data (track break, failing tick ages, waiting ages, dot count),
      and `attention.count` = the summed distinct-issue total used everywhere.
- [x] 1.3 Hero model (§D3): day band segments, day N of M + ends-weekday (UTC, matching
      `formatCycleRange`), status words, scope numbers/band (committed/landed/added),
      artifact-chip presence flags, NEXT list (open retro only, no times), days left, and
      the no-active-cycle degraded form.
- [x] 1.4 Narrative (§D3): stored digest narrative passthrough when ready content exists;
      else the deterministic two-sentence fallback over real counts with the quiet-day
      degradation. Pure, templated, unit-testable strings.
- [x] 1.5 Since-yesterday model (§D4): 24h window; overnight deployments joined to done
      issues via the merge-commit index (fallback to repo/environment fact); viewer-issue
      review outcomes; team-scoped unread-notification summary; per-card fold flags.
- [x] 1.6 Yours model (§D5): viewer's unfinished rows ordered by `updatedAt` desc, bifact
      phrase dictionary keyed on (status, signal) predicates, waiting-on-others collapse,
      the team-level zero-open-reviews predicate for the reciprocal line, footnote text.
- [x] 1.7 Runway model (§D6): unassigned/untriaged todo-or-backlog issues of the active
      cycle, urgent-first ordering, predicate-keyed why-clear phrase dictionary.
- [x] 1.8 Cadence + shipped models (§D7–§D8): `cadenceWeeks` UTC weekly buckets with month
      labels, today caret index, retro ticks from closed retros; shipped list with
      Live / Built-not-live from `deployedAt`.
- [x] 1.9 Footline composer (§D9): assemble the rule clauses from the fold flags actually
      computed; no static aspirational string.
- [x] 1.10 Export the model API from `packages/schema/src/index.ts`;
      `pnpm --filter @yapm/schema typecheck test` green.

## 2. Tokens and drawn primitives — build pass 1

- [x] 2.1 Add `--row-hairline`, `--statusline-bg`, `--urgent-soft` to every theme block in
      `packages/ui/src/styles/globals.css` (warm-light literal mock values; other variants
      derived from their own tokens, §D11) and wire them through the `@theme inline`
      mapping so utilities like `border-row-hairline` exist.
- [x] 2.2 Search-first reuse pass: identify the existing status glyph, priority mark, and
      reality-strip components the issue list renders; list what is reusable as-is vs.
      what the mock's track vocabulary adds (the `//` break, empty-urgent node). Extend,
      don't fork, where the same component can carry the addition.
- [x] 2.3 Build the new drawn components in `apps/web/src/home/` as static inline SVG, no
      motion: `DayBand`, `ScopeBand`, `TickBar`, `TriageDots`, `BrokenTrack` (or the
      extended strip), `CadenceChart` (weeks, dots, months, today caret, retro ticks) —
      tokens only, sized per the mock.

## 3. The digest page — build pass 2

- [ ] 3.1 Create the page component (`apps/web/src/home/team-home.tsx`): the eight
      `useQuery` reads (§D1 table), one `useMemo`d `buildTeamHome`, and the band layout
      per the mock (max-width column, band hairlines, mono kickers, spacing).
- [ ] 3.2 Hero spread: title, day band, day line, status words, narrative, artifact chips,
      vitals column (scope, NEXT, days left); the degraded no-active-cycle form.
- [ ] 3.3 NEEDS ATTENTION: four class rows with drawn evidence, urgent-lift on the
      divergence row, each row a Link doorway (issue, board, issue, triage).
- [ ] 3.4 SINCE YESTERDAY: three-card grid with mono kickers and provenance lines; each
      card a doorway; per-card and whole-band folding.
- [ ] 3.5 YOURS: rows (status glyph + key + title + track + bifact), collapsed
      waiting-on-others row, conditional reciprocal line, mono footnote, warmth empty
      state with Runway doorway.
- [ ] 3.6 READY FOR YOU: Runway header + count, priority glyphs, predicate phrases,
      doorways; folds per §D6.
- [ ] 3.7 SHIP CADENCE + SHIPPED THIS CYCLE: chart band with Delivery onward link;
      two-column shipped grid with Live / Built-not-live badges.
- [ ] 3.8 Footline + onward footer: composed clauses from the model; footer links Issues ·
      Delivery · Retro · Roadmap (accessible name "Issues" — `issues.spec.ts` clicks it)
      + ⌘K hint.

## 4. Route swap and members relocation — build pass 2

- [ ] 4.1 New route `apps/web/src/routes/teams.$teamId.members.tsx` rendering the existing
      management surface (roster, join/leave, admin rename/archive/roster controls)
      unchanged in behavior.
- [ ] 4.2 Swap `teams.$teamId.index.tsx` content to the digest inside the existing
      `Authenticated` + `AppShell`; add the quiet "Members ›" doorway on the digest.
- [ ] 4.3 Keyboard pass: every doorway a real focusable Link/button in document order,
      Enter activates, visible focus ring; verify no interaction waits on the network.
- [ ] 4.4 All three themes × light/dark sanity pass on the page (tokens resolve, AA holds,
      no literal hex in components); `pnpm turbo lint typecheck build` green.

## 5. Tests

- [x] 5.1 Unit (`packages/schema/src/zero/team-home.test.ts`): the falsifiable check —
      with fixture rows (one `status_behind_merge` issue, one failing-checks issue, two
      PRs waiting > 24h, three triage rows) `buildTeamHome` reports `attention.count === 7`
      and the same value in every place the model exposes it; an issue matching two
      classes counts once; all-quiet fixtures fold every optional band flag; scope
      committed/landed/added matches the delivery-metrics semantics; cadence buckets are
      UTC-stable; the narrative fallback is deterministic and ≤ 2 sentences; the footline
      contains only executed-rule clauses; the `blameless` key-walker finds no identity
      key in the model outside the viewer's own rows.
- [ ] 5.2 Unit (web): page component tests with fixture query results — full morning
      renders all bands in order; quiet day renders no attention/since-yesterday/ready
      band and the YOURS warmth line; the attention number is identical at every DOM
      occurrence; doorways have accessible names and hrefs; Live badge only with a
      matching deployment.
- [ ] 5.3 Existing suites stay green untouched where behavior is untouched:
      `issues.spec.ts`'s team-page "Issues" link path, `auth.spec.ts` members-list (on
      workspace home). Update only tests whose subject genuinely moved (team-detail
      component tests, if any, follow the members route).
- [ ] 5.4 Gates: `pnpm turbo lint typecheck test build`; compose smoke test (sync reads
      touched); CI e2e green. Not a big feature under PROCESS.md §3 (signature UI only —
      no new synced entity, mutator, or permission surface): no new e2e spec; existing
      e2e must pass unmodified except where 5.3 says the subject moved.

## 6. Documentation

- [ ] 6.1 New `apps/docs/src/content/docs/features/team-home.md`: what the digest shows,
      the four exception classes, the adaptive folding rules, the personal-lens boundary
      ("your work only — never compared"), where members management lives now.
- [ ] 6.2 README feature list: the team Home digest line; ROADMAP: this change's row.
      Sweep for any doc describing the team page as a members list.
- [ ] 6.3 `pnpm --filter @yapm/docs build` green; no env/config reference changes (none
      added).
