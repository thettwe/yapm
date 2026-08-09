## 1. Read the rulebook first

- [x] 1.1 Read `design-explorations/overhaul-2026-08/destinations/projects.html` end to end **including its closing comments** (§(a) "What folded away, and why" — all 14 items, §(b) "Self-critique", the SET-RECONCILIATION and FIXTURE-RECONCILIATION passes with the table of nine canonical projects), and look at `projects.png` / `projects-full.png`
- [x] 1.2 Read `destinations/roadmap.html` end to end **including its closing comment** (§"What this surface draws, and from what", §"What folded away, and why" — all 12 items, §"What changed from the shipped roadmap", §"Self-critique"), and look at `roadmap.png`
- [x] 1.3 Read `destinations/DESTINATIONS.md` — the `projects.html` and `roadmap.html` rows, §"What the render showed" items 1 (the closed fixture reconciliation and its three costs), 3, 4 and 5 (the two correct spellings), and the two per-file self-critiques
- [ ] 1.4 Read `northstar/ia.html` — the three-band frame, the word diet's three tiers, the destination tree (`more▾` holds Projects `g p` and Roadmap `g m`), ONE attention number, the peek and the `how ·` drawn once each — and `northstar/delivery.html` for the drawn-chart manner
- [ ] 1.5 Read `reference/zero.md` (Zero 1.x: `defineQuery` / `defineQueries` / `defineMutator` / `createBuilder`; the 0.x names are fluent and non-functional), plus the Tailwind 4.3 and TanStack Router references
- [x] 1.6 Read `openspec/specs/projects/spec.md` (the requirements this change modifies rather than contradicts), `openspec/specs/reality-vocabulary/spec.md` (the quiet-row rule, the track's four facts, `role="img"` labels, the phrase dictionary, contrast) and `openspec/specs/issue-list/spec.md` (the row anatomy the project page reuses)
- [x] 1.7 Read the code this change consumes and must NOT rebuild: `packages/ui/src/components/{issue-row,reality-track,status-glyph,priority-mark,rest-phrase,provenance-mark,how,door,drawn,avatar}.tsx`, `apps/web/src/frame/masthead.tsx`, `apps/web/src/issues/{issue-list.tsx,delivery.ts,model.ts}`
- [x] 1.8 Read `packages/schema/src/zero/queries.ts` (`projects.all`, `projects.get`, `cycles.byTeam`, `deployments.byTeam`, `teamScoped`, `withLinkedDelivery`) and `schema.ts` (`project`, `cycle`, `issue` columns — confirm for yourself that no project start date exists)
- [x] 1.9 Read the "## Decisions made during implementation" sections of the three most recent archived changes (`2026-08-09-triage-daylight`, `2026-08-09-design-corrections`, `2026-08-08-issue-list-daylight`) — settled precedent, followed unless this change has a stated reason not to
- [x] 1.10 **Inventory before editing**: list every capability the two shipped views have today (design.md §"Decisions made during implementation" carries the starting list). Any capability this change removes is reported in design.md with its reason, before it lands

## 2. The two query extensions (`packages/schema`)

- [x] 2.1 `projects.all`: relate `cycle` on the already-`teamScoped` issues, so the roadmap can position an issue's mark from that cycle's own stored dates. Predicate, ordering and every other relation byte-unchanged
- [x] 2.2 `projects.get`: relate `labels` and wrap the issues in the shared `withLinkedDelivery(...)` — the same subtree `issues.byKey` and `issues.detail` carry — so the project page can draw the reality vocabulary. `teamScoped` and `isMember` unchanged
- [x] 2.3 Comment both with the one constraint the code cannot express: these relations hang off issues the team-scoped predicate already admitted, so they widen no read
- [x] 2.4 Confirm nothing else moved: no new named query, no new table, no migration, no mutator, no change to any predicate. `openspec/specs/projects` §"A workspace-level project query never widens issue reads" is the acceptance criterion
- [x] 2.5 Extend `packages/schema/src/zero/queries.test.ts` (or its pg sibling, whichever already asserts the project queries' shape) so the added relations are asserted rather than assumed

## 3. The derivations (`apps/web/src/projects/model.ts`)

- [x] 3.1 Status grouping: group projects by `ProjectStatus`, in the settled order, dropping any status with no projects; inside a group sort by target date with undated last, then by name
- [x] 3.2 The team split: from each project's readable issues' `team_id`, a list of `{ teamKey, count }` ordered by count then key. It sums to the project's issue total by construction — never a separate count
- [x] 3.3 The past-target reading: `target_date < startOfToday AND status !== 'completed'` → `{ passed: true, openCount }` where `openCount` is readable issues not at `done`. A project exactly on today's date has **not** passed. Pure over an injected `now`
- [x] 3.4 The issue state segments for the project page's state bar: counts per issue status in the shared status order, plus their fractions; total zero yields no segments (never `NaN`, never a zero-width rect)
- [x] 3.5 The target strip geometry: `created_at`, `target_date`, `now` → fractional positions plus which portion is the overrun. Undated project → no strip at all
- [x] 3.6 The roadmap axis: `(projects, cycles, now, ...)` → `{ window, monthTicks, cycleBands, nowFraction, rows }` where each row carries its target mark fraction (or null) and its issue marks positioned from **each issue's own cycle's** `startDate`/`endDate`. Window start is the current cycle's start when one exists, else the start of the current month; window end is the end of the month holding the latest target, with a minimum runway so a single near-term project is not crammed at the edge. Also returns where the last stored cycle ends, so the surface can state `no cycles past <date>`
- [x] 3.7 **Nothing in this module returns a start, a span, a duration or a width-per-project.** If a future reader looks for the bar, the absence is structural, not stylistic. `roadmapTimeline` is superseded — delete it rather than leaving it beside its replacement
- [x] 3.8 Every function pure and deterministic over an injected `now`, so it is unit-testable and renders sub-100ms

## 4. The Projects index (`apps/web/src/projects/projects-view.tsx`)

- [x] 4.1 Masthead: `Projects` + mono count + the dashed, workspace-marked scope chip in the `lens` slot + `+ New project` (writer-gated, unchanged dialog) in `actions`. `packages/ui` and `apps/web/src/frame/` are **not** edited
- [x] 4.2 The filter/sort line in the mock's register, stating `Group Status · Sort Target` — the grouping and sort this surface actually applies, never left implicit
- [x] 4.3 Group headers: the status's own glyph, its label, its count. A status with no projects draws **no** header — in particular no `Cancelled` header over zero rows
- [x] 4.4 The row: status glyph · name (quiet ink when completed/cancelled) · spring · phrase slot · team split · progress meter inked `--status-done` · `done/total` · lead avatar · mono target date (urgent ink when passed). No percent anywhere, no lucide `TargetIcon`
- [x] 4.5 The quiet states, per design D10: no issues → team/meter/count reserve their measure and draw nothing; no target → target slot reserved and blank; no lead → avatar slot reserved and blank. Nothing shifts when a fact arrives
- [x] 4.6 `Past target — N open` in `--status-urgent-ink`, as text, with a `how ·` stating the derivation and that the target is a single stored field with no record of re-agreement
- [x] 4.7 The mono footline: `workspace-scoped · counted over the issues in your teams`, with its `how ·`
- [x] 4.8 Keyboard: roving focus over rows (`j`/`k`/arrows), `Enter` opens the project page, focus never falls to `<body>` when the set shrinks
- [x] 4.9 The empty workspace: a label, not a paragraph. Distinguished from the incomplete-query state, so a premature "no projects" is never announced. The writer still gets `+ New project`
- [x] 4.10 Word diet: no explanatory sentence renders anywhere. `No projects yet. Create one to plan across teams.`, `Loading projects…` and `No project selected.` all go

## 5. One project's page (`apps/web/src/projects/project-page.tsx`, rendered when `?open=` is present)

- [x] 5.1 Reads `queries.projects.get({ id })` — the existing named query nothing renders today — plus `queries.teams.all()` for keys and `queries.users.all()` for the lead
- [x] 5.2 Breadcrumb back to the index (a real link, `?open` cleared) and `Escape` doing the same, so the page is leaveable from the keyboard
- [x] 5.3 Head: status glyph · name · status pill · the same scope chip · `Edit` (writer-gated, unchanged dialog, delete included)
- [x] 5.4 The facts line: `LEAD` (avatar + name, or the reserved-blank slot) and `TEAMS` (the split). No target icon; no room reserved for a description the entity does not have
- [x] 5.5 Vital one — ISSUES: `<done>` `/<total> done` over the segmented state bar, each segment inked from its status token, labelled in text beneath it, with a `how ·` on the band header
- [x] 5.6 Vital two — TARGET: the date, a delta pill when it has passed, and the created→target→today strip with the created end labelled **`created`** and the overrun drawn in the urgent token. Undated project → the band states there is no target and draws no strip
- [x] 5.7 The issue list, grouped by status, drawn through `IssueRow` with the shared anatomy: priority mark · status glyph · mono key · title · phrase (from the shared dictionary, `neutral` register) · reality track (reserved and inkless when there is no linked change) · age · labels · avatar. Clicking or `Enter` opens the issue in its own team's list
- [x] 5.8 Deployments per contributing team (design D5): one `deployments.byTeam` subscription per team that actually has an issue in this project, merged through the shared `buildDeploymentIndex`. Confirm by reading that a team the caller is not in returns nothing
- [x] 5.9 A fold over the done issues, stating the true remaining count, keyboard-operable — the pattern `issue-list` already ships
- [x] 5.10 `No issues yet` as a label where there are none — no empty chart, no empty list frame, no reserved panel

## 6. The Roadmap (`apps/web/src/projects/roadmap-view.tsx`)

- [ ] 6.1 Masthead: `Roadmap` + mono count + the axis window as a **mono label** (design: not a dropdown — the shipped page has no window control and a chevron over nothing is a lie about an affordance) + `+ New project`
- [ ] 6.2 The filter/sort line stating `Sort Target date`
- [ ] 6.3 The axis header: month ticks and labels; cycle bands drawn from real `cycle.start_date`/`end_date` via `queries.cycles.byTeam(teamId)`, each named; the `today` caret; and `no cycles past <date>` where the stored cycles run out. State whose cycles the bands are
- [ ] 6.4 The row: status glyph · name · lead (reserved-blank when none) · Done meter (one tick per readable issue, filled for done) · `done/total` · and the drawn axis
- [ ] 6.5 The drawn axis per row: gridlines on the cycle boundaries and the now line; the target mark at its date, shaped and inked by status; each cycled issue as a mark positioned from its own cycle's dates; `Target passed` in text where the date has passed and the status is not completed; `Nothing scheduled` where the project has issues but none in a cycle; `No issues yet` where it has none. **No bar, no span, no left edge**
- [ ] 6.6 `role="img"` with a truthful label on every row that draws a mark, naming the target, how it stands against today, the done-over-total and where the issue marks sit. A row that draws no mark carries **no** `role="img"` and no label
- [ ] 6.7 The `No target date` group header replacing the per-row italic ornament; those rows keep their meter and their issue marks
- [ ] 6.8 Rows sort by target date (not status-then-date), undated held aside; the roving-focus keyboard model preserved **verbatim** — `j`/`k`/arrows move, `Enter` opens the project page, the roving tabindex stays on a mounted row when the set shrinks
- [ ] 6.9 The footnote, in the mock's words: `What this page won't guess: a project's start — only a target is stored, so nothing here draws a bar.` plus its `more ·`
- [ ] 6.10 The empty roadmap: a label, distinguished from the loading state; the prose sentence `No projects yet. Create a project to see it on the roadmap.` goes

## 7. Tests

- [x] 7.1 `apps/web/src/projects/model.test.ts` (unit): status grouping and intra-group order including undated-last; the team split summing to the total; the past-target reading with the completed exclusion **and** the exactly-today boundary; the state segments over a zero-issue project (no segments, no `NaN`); the target strip including an undated project; the roadmap axis over real cycles — a window with no cycles at all, a cycle tail ending before the window does, an issue whose cycle belongs to a different team, and an issue with no cycle
- [x] 7.2 `apps/web/src/projects/model.test.ts` (unit): **the structural refusal** — no exported function returns a start date, a span, a duration or a per-project width, asserted over the module's returned shapes rather than by reading the source
- [x] 7.3 `apps/web/src/projects/projects-view.test.tsx` (component) — **the falsifiable check**: two projects sharing yesterday's target, one `active` with two issues not done and one `completed`, render `Past target — 2 open` on the first and no past-target statement on the second; the index draws `Active` and `Completed` group headers with their counts and no `Cancelled` header
- [x] 7.4 `apps/web/src/projects/projects-view.test.tsx`: the quiet rows — a project with no issues draws no ink in the team/meter/count slots while a project with six issues and none done states `0/6`; an undated project reserves its target slot and draws nothing; a leadless project reserves its avatar slot; the meter carries the done token and no accent, and no percent is rendered anywhere on the surface
- [ ] 7.5 `apps/web/src/projects/project-page.test.tsx` (component): both vitals render from a seeded project — the done-over-total with its labelled state bar, and the target reading with the created end labelled `created`; the issue rows carry the phrase and the reality track for a linked issue and a reserved-inkless track for an unlinked one; a project with no issues renders the label and no empty frame; a project with no target renders no strip
- [ ] 7.6 `apps/web/src/projects/roadmap-view.test.tsx` (component): the axis draws a band per stored cycle at its real dates and states `no cycles past <date>` beyond them; a project with issues in no cycle reads `Nothing scheduled` while one with no issues reads `No issues yet`; a passed target reads `Target passed` as text and a completed one does not; the footnote sentence refusing the bar is present; undated projects sit under one group header
- [ ] 7.7 `apps/web/src/projects/roadmap-view.test.tsx`: the keyboard model — `j`/`k`/arrows move the roving focus, the tabindex follows, `Enter` opens the project page, and focus survives the ordered set shrinking. This is the shipped behaviour and it must not regress
- [ ] 7.8 Extend `packages/ui/src/styles/contrast.test.ts` with this change's pairs in **every** theme block, light and dark: the Done meter's filled tick and its unfilled track on the row ground; the target mark's stroke on the axis ground and on the focused row's tint; the cycle band stroke; `Target passed` / `Past target — N open` ink on both grounds; the delta pill's ink on its urgent wash; the state bar's three segments on the page ground. Where a mock ink misses its bar the **ink moves and the mock loses** — record the measurement and the reason, never write the assertion at a lower bar
- [ ] 7.9 Update `apps/web/e2e/projects.spec.ts` where the surface moved: `project-rail-item` no longer exists, so the three tests that address it get the index row / project page selectors instead. Every existing claim survives — the viewer still reads the project and is offered no create control, the second client still converges without a reload, the roadmap is still keyboard-navigable and `Enter` still opens the project. **Never weaken an assertion to make a gate pass**
- [ ] 7.10 Add to `apps/web/e2e/projects.spec.ts` the one claim only the real stack can make: the roadmap's refusal sentence renders on the built page. No new spec file (PROCESS.md §3 — this change touches one big-feature axis, signature UI)
- [ ] 7.11 Re-run any failure of `projects.spec.ts:188` ('a viewer reads the workspace-level projects but cannot create one') or `:246` ('a project created in one client converges to another without a reload') **once** before investigating: both fail intermittently with `browserContext.close: Protocol error (Target.disposeBrowserContext)` for reasons unrelated to any diff, tracked separately. Read the failure and confirm it is that signature and not an assertion disagreeing. Do not loosen them, do not rewrite them, do not fix the flake here. Any OTHER failure is this change's
- [ ] 7.12 Confirm no test hard-codes a budget encoding e2e fixture size (fixtures accumulate across specs — derive bounds from the page), and no test's premise is what a Node runtime provides (CI is Node 24; dev machines here run 26)

## 8. Documentation

- [ ] 8.1 Rewrite `apps/docs/src/content/docs/features/projects.md`: the index's row anatomy left to right and its grouping; what a quiet row means; the past-target reading and why it does not join the attention count; the project page's two vitals and exactly what the created→target strip does and does not claim; the roadmap's axis, its cycle bands and its `no cycles past` statement; **the complete list of what neither surface will draw and why** (no bar, no start, no milestone, no dependency, no confidence score, no allocation, no budget, no description); the workspace-vs-team scope rule; and the keyboard model for all three surfaces
- [ ] 8.2 Update `README.md` if its feature line describes either surface's shape. **Do NOT edit `ROADMAP.md`** — two other destination rebuilds are in flight in parallel worktrees and that file is the guaranteed conflict; the maintainer adds the row at archive time
- [ ] 8.3 Confirm `.env.example`, `TECHSTACK.md`, `VISION.md`, `DESIGN.md`, `CLAUDE.md`, `PROCESS.md` and every `reference/` page are untouched by this change and therefore not stale (PROCESS.md §2)
- [ ] 8.4 `pnpm --filter @yapm/docs build` passes
- [ ] 8.5 Record every decision taken during the build in `design.md` under "## Decisions made during implementation" — what was ambiguous, what was chosen, why — including every deliberate difference from the two mocks and every capability deliberately removed

## 9. Gates

- [ ] 9.1 `pnpm turbo lint typecheck test build`
- [ ] 9.2 The compose smoke test
- [ ] 9.3 The full Playwright suite (subject to 7.11)
- [ ] 9.4 **Render the Projects index and one project's page** at 1440×900 over a seeded workspace carrying the mock's cases (a past-target project with open issues, a project with no issues, a project with no target, a project with no lead, a completed project) and compare against `projects.png` / `projects-full.png`. Record every deliberate difference in `design.md`
- [ ] 9.5 **Render the Roadmap** at 1440×900 over the same seeded workspace and compare against `roadmap.png`. Record every deliberate difference in `design.md`
- [ ] 9.6 **Look at the degenerate states rendered**, one screenshot each, per design D10's table — a workspace with no projects, a project with no issues, a project with no target date, a roadmap window with nothing scheduled, a project past its target. A panel that reserves a full measure over nothing is a defect even when every test passes
- [ ] 9.7 Eyes on all six theme blocks (three presets × light/dark) on both surfaces: the meter, the target mark, the cycle bands, the urgent ink and the state bar
