## 1. Read the rulebook before touching a pixel

- [ ] 1.1 Read `openspec/SCOPE-legibility.md` in full, and its "Found while walking" bullet at `:218-229` twice — the second half of it is a record of this exact problem being mis-assigned once already. This change is that bullet and nothing else
- [ ] 1.2 Read `openspec/specs/delivery-metrics/spec.md` **in full**, not just the two sections being changed. The four requirements in play are `:261-290` (the journalism cut), `:395-410` (cycle flow), `:412-436` (review rhythm) and `:223-259` (keyboard-first and tokenized, which is **not** deltaed and which every new mark must satisfy)
- [ ] 1.3 Read `openspec/changes/explanation-at-rest/design.md` §D10 (`:332-377`) — it is the decision that handed this problem forward, and the condition it handed it on was that the standfirsts survive. Confirm for yourself, by reading, that nothing in this task list deletes, shortens or folds one
- [ ] 1.4 Read `openspec/changes/explanation-at-rest/specs/reality-vocabulary/spec.md:1-58` — the merged product-wide rule that makes a **legend** a derivation. This change adds no legend; read it so you can tell the difference under review pressure (design D1)
- [ ] 1.5 Read `packages/ui/src/components/distribution-strip.tsx` in full. It is the working model for everything here: ticks with the unit inside the label (`:182-203`), a labelled rule (`:205-225`), and `layoutDistributionNotes` (`:81-123`) with its `NOTE_CHAR_W` note at `:52-56`. **Copy its discipline, do not import from it**
- [ ] 1.6 Open the running app on a seeded team's Delivery page and look at both sections before changing anything, so the before is a memory rather than a screenshot in a proposal

## 2. The model — `CYCLE FLOW` (`packages/schema/src/zero/metrics/page.ts`)

- [ ] 2.1 `DeliveryFlowCycle` (`:257-264`) gains `countLabel: string`. `shipped` stays a number — the drawing still needs it for the bar height, and a test that asserts a count should assert the number, not parse a string
- [ ] 2.2 `buildFlow` (`:952-1045`): `countLabel` is `` `${shipped} shipped` `` for the **first** cycle in `windowRows` order and `` `${shipped}` `` for every later one. The word matches the statusline's own idiom (`design-explorations/overhaul-2026-08/northstar/delivery.html:270`), which is where this vocabulary already lives
- [ ] 2.3 Same function, `:971`: `addedLabel` becomes `+N added` on the **first cycle whose `added > 0`** and `+N` on every later one. A cycle with `added === 0` keeps `null` — `flow-band.tsx:163` draws nothing for it, and that is `DESIGN.md:34` working
- [ ] 2.4 Same function, `:990-998`: `carry.label` becomes `N carried` on the **first entry of `carries`** — the filtered, drawn list at `:998`, never `pairs` at `:982`, which holds zeros that draw nothing — and `${count}` on every later one. This is the mock's own device (`northstar/delivery.html:255`: `2 carried`, then `1`, `3`, `2`, `4`) and it **removes** four words from the shipped page
- [ ] 2.5 The three "first" choices are made independently. Write that as a comment at the call site, because the tempting bug is one `index === 0` guard shared by all three: a window can draw six bars, zero ribbons and one cap
- [ ] 2.6 `markUnit` (`:1037`) is unchanged and stays undrawn on this section (design D7 — the bar labels `5 ago … last` already say one bar is one cycle). The `role="img"` `label` (`:1038`) is unchanged: it already states every cycle, its count, and what a bar, ribbon and cap each mean
- [ ] 2.7 Do **not** touch the standfirst assembly (`:1013-1026`), the carry narrowing (`:975-998`), the `twiceClause` (`:1000-1004`) or the `how ·` body (`:1039-1043`). None of them is a drawing

## 3. The model — `REVIEW RHYTHM` (same file)

- [ ] 3.1 `DeliveryRhythmSection` (`:297-308`) gains `axisTicks: readonly number[]`, `markNames: { readonly opened: string; readonly merged: string }` and `workedIndex: number | null`
- [ ] 3.2 `buildRhythm` (`:1051-1112`): `axisTicks` is derived from `REVIEW_RHYTHM_AXIS_HOURS` (`:122`) as start, midpoint and end — never a literal `[0, 48, 96]`, because the constant is the published axis and a literal would silently disagree with it the day it moves. Three ticks, not five: `linearAxis` (`:438-447`) would give `0/24/48/72/96` and five mono labels do not fit a 166px track (`review-rhythm.tsx:39-40`)
- [ ] 3.3 Same function: `markNames` is `{ opened: 'opened', merged: 'merged' }`. **`first review` is deliberately absent** — design D6 gives both reasons and the fallback if the eyeball pass (task 12.2) overturns it
- [ ] 3.4 Same function: `workedIndex` is the index of the **first `change` in the drawn list whose `overAxis` is false**, or `null` when every drawn change is over-axis. An over-axis row draws an arrow and its duration instead of a merge mark (`review-rhythm.tsx:110-140`), so naming `merged` on it would name a mark that is not there. State the rule in a comment as a rule over the data, per `openspec/specs/delivery-metrics/spec.md:312-313`
- [ ] 3.5 Same function, `:1104`: `markUnit` shortens to `one row · one merged pull request`, matching `apps/docs/src/content/docs/features/delivery.md:115`'s own words. The clause it drops — *"from its open to its merge"* — is what the ruler and the two names now draw. The `role="img"` `label` (`:1105`) keeps the full sentence and is **not** edited
- [ ] 3.6 Do **not** touch the sort and cap (`:1058-1063`), the per-change mapping (`:1064-1082`), the standfirst (`:1084-1093`), `capLabel` (`:1101-1102`) or the `how ·` (`:1106-1110`)
- [ ] 3.7 Confirm by reading `:1058-1082` that no field added in this group could carry a reviewer, and that `DeliveryRhythmChange` (`:283-295`) still has nowhere to put one

## 4. The drawing — `packages/ui/src/components/flow-band.tsx`

- [ ] 4.1 `FlowBar` (`:8-14`) gains `countLabel: string`; the count `<text>` at `:178-188` renders `bar.countLabel` instead of `{bar.shipped}` (`:187`). `shipped` stays on the interface for the height at `:59`. The component formats nothing — that is the file's own header contract (`:1-6`) and `delivery-view.tsx:43-46`
- [ ] 4.2 A bar whose `shipped === 0` draws a **stub** instead of the zero-height `<rect>` `:139-146` currently produces: a flat mark at the baseline, `BAR_W` wide, ~2px tall, `rx={1}`, `fill="var(--status-done)"`. Same token as the bar, no new pair (design D10)
- [ ] 4.3 The stub is drawn **inside the same `<g>`** as the bar it replaces, so `container.querySelectorAll('rect')` counts remain one-per-bar-plus-one-per-cap and `delivery-charts.test.tsx:311` keeps meaning what it says. If a different element is used, that assertion changes and the reason goes in the test's comment, not in a commit message
- [ ] 4.4 Confirm by reading that nothing else in this file decides text: `addedLabel` (`:163-174`) and `label` (`:175-177`) already arrive finished from the model. Do not add a formatter here
- [ ] 4.5 Check the widened first label at the window bound: `delivery-metrics/spec.md:23` bounds the window at 12 cycles, so `slot` (`:50`) is `(1060−60)/12 ≈ 83px` and `8 shipped` at 11px mono is roughly 65px. It fits; verify it rather than trusting this line, and if it does not, the finding goes in `design.md` §"Decisions made during implementation" before anything is worked around
- [ ] 4.6 No new constant carrying a colour, no literal hex, no `title` element, no `<tspan>` carrying a second sentence

## 5. The drawing — `packages/ui/src/components/review-rhythm.tsx`

- [ ] 5.1 `ReviewRhythmProps` (`:20-26`) gains `axisTicks: readonly number[]`, `markNames: { opened: string; merged: string }` and `workedIndex: number | null`. Structural props only; the component still formats nothing
- [ ] 5.2 Draw the tick ruler **under the worked track only**: tick lines and mono labels in the idiom `distribution-strip.tsx:182-203` ships — `fontSize={10}`, `fontFamily="var(--type-mono)"`, `fill="var(--text-2)"`, `stroke="var(--border)"` on the tick. The unit rides inside the label (`48h`), never as an axis title (`delivery-metrics/spec.md:280`)
- [ ] 5.3 Draw `markNames.opened` and `markNames.merged` **above** the worked track, anchored at that row's own `x0` and `merge` (`:47-56`) — `text-anchor="start"` and `"end"` respectively, so neither runs off its slot
- [ ] 5.4 Export a pure `layoutRhythmMarkNames({ opened, merged, x0, merge, charWidth, gap })` mirroring `layoutDistributionNotes` (`distribution-strip.tsx:81-123`). Where the two names would not clear `gap`, **drop `merged`** and keep `opened`: a track whose ends coincide has nothing for the second name to disambiguate. The char-width constant must not under-measure any face a preset binds to the mono role — read `distribution-strip.tsx:52-56` for why 7.2 was chosen at 11px and scale it honestly for 9–10px rather than guessing
- [ ] 5.5 The worked track keeps its grid cell — `x0` (`:47`) is not changed for it or for any other row, so it still shares a baseline with the five tracks beside it. The room comes from three places: `FIRST_ROW_Y` (`:31`) grows by one label baseline above the worked row; a ruler band is inserted **between the worked row and the row beneath it** for the tick baseline; and the computed `height` (`:42`) grows by both. `ROW_H` (`:30`) itself is **not** changed — every other pair of rows keeps today's spacing, and the grid must not get looser because one cell got annotated
- [ ] 5.6 `workedIndex === null` draws the ruler under the **first drawn track** and no names at all — the scale is still the scale when no row can be worked (design D6). Confirm this branch exists before writing the happy path, because a window in which every drawn change ran past 96 hours is a real window
- [ ] 5.7 Do not change the segments, the review nodes, the open node, the merge node or the over-axis arrow (`:71-141`). The marks are right; only their key was missing

## 6. The view — `apps/web/src/delivery/delivery-view.tsx`

- [ ] 6.1 `Rhythm` (`:398-420`): the `aside` becomes the mark unit joined with `capLabel` — `rhythm.markUnit` alone when `capLabel` is `null`, `` `${rhythm.markUnit} · ${rhythm.capLabel}` `` otherwise. Join in the view, because it is a drawing decision about one slot; the two strings stay separately authored in `packages/schema`
- [ ] 6.2 Same component: pass `axisTicks`, `markNames` and `workedIndex` through to `ReviewRhythm`
- [ ] 6.3 `Flow` (`:374-396`): pass `countLabel` through in the `bars` map. **Pass no `aside`** — design D7, and a comment saying so, because the asymmetry with `Rhythm` will look like an oversight to the next reader
- [ ] 6.4 `Section` (`:307-346`) is **not** edited. `aside` already exists — destructured at `:311`, typed `aside?: string | null` at `:317` — is already drawn in the mono label register (`:330`), and already renders on this section
- [ ] 6.5 Nothing else in this file moves: not the masthead (`:117-149`), not the standfirst (`:138-148`), not `StatRow` (`:170`), not `flowAbsence` (`:174-181`), not `Distribution` (`:348-372`), not `TimelineBand` (`:202-248`), not `DivergedChip` (`:252-291`), not `Honesty` (`:426-471`)

## 7. Tokens and contrast

- [ ] 7.1 Confirm by reading `packages/ui/src/styles/contrast.test.ts` that every token used in groups 4 and 5 is already asserted for this page: `--status-done` at `:603`, and `--text-1` / `--text-2` as the delivery charts' inks. **`contrast.test.ts` should gain no pair.** If a task made you reach for a new token or a new ground, the design is wrong — record it in `design.md` §"Decisions made during implementation" and stop
- [ ] 7.2 Confirm the zero stub is told apart by **shape**, not by hue: it is a flat mark at the baseline where a bar would rise. `DESIGN.md:12` is the standing reason, and the count `0` beneath it is the second carrier
- [ ] 7.3 Confirm no new mark carries information by colour alone (`delivery-metrics/spec.md:235-239`)

## 8. Unit and component tests

- [ ] 8.1 `packages/schema/src/zero/metrics/page.test.ts`: the first drawn bar's `countLabel` names the quantity and every later one does not; over a window with one cycle, the only bar still names it
- [ ] 8.2 Same file: the first **drawn** carry names itself and later ones do not — with a fixture where an early adjacent pair carries zero, so a test that keyed off `pairs` rather than `carries` fails
- [ ] 8.3 Same file: the first cap with `added > 0` names itself and later caps do not — with a fixture where the leftmost cycle added nothing, for the same reason
- [ ] 8.4 Same file: `axisTicks` is derived from `REVIEW_RHYTHM_AXIS_HOURS` — assert against the constant, never against `[0, 48, 96]`, or the test cannot catch the axis moving
- [ ] 8.5 Same file: `workedIndex` skips a leading over-axis change; and is `null` when every drawn change is over-axis
- [ ] 8.6 Same file: `markUnit` on the rhythm section states one row is one merged pull request, and the `role="img"` `label` (`:1105`) is unchanged — assert both in one test, so a future shortening of the label is caught by the test that shortened the unit
- [ ] 8.7 `packages/ui/src/components/delivery-charts.test.tsx:298-331`: `getByText('3 carried')` and `getByText('+2 added')` still pass with model-shaped labels, and a second bare-labelled mark is asserted absent of the word
- [ ] 8.8 Same file, `:333-342` ("nothing carried and nothing added"): extend to a bar with `shipped: 0` and assert the stub is drawn and the column is not empty
- [ ] 8.9 Same file, `:347-388` / `:390-405`: the ruler is drawn once for the section rather than once per row; the worked track carries `opened` and `merged` and no other row carries either word; a rows-list whose only entries are over-axis draws the ruler and no names
- [ ] 8.10 Same file: `layoutRhythmMarkNames` gets its own direct test at the shape it exists for — an open and a merge close enough that both names would run together, asserting `merged` is dropped and `opened` survives
- [ ] 8.11 Same file, `:409-466` (`no chart paints a literal colour`): extend the `FlowBand` and `ReviewRhythm` props to the new shape. This test **gains no new token**, which is task 7.1's assertion expressed as code
- [ ] 8.12 `apps/web/src/delivery/delivery-view.test.tsx`: the rhythm section's aside states what one row is beside the count drawn; the flow section draws **no** aside
- [ ] 8.13 No e2e spec is added or edited. PROCESS.md §3's big-feature rule: this change touches one of four axes (signature UI) — no synced entity, no mutator, no permission surface. Re-run the evidence rather than trusting this line: `grep -rn "cycle-flow\|review-rhythm\|carried" apps/web/e2e` returns no `cycle-flow` and no `review-rhythm` match, and its fifteen `carried` matches are all on other surfaces — `cycles.spec.ts` (the Cycles carryover band, `cycles-view.tsx:501`), `retro.spec.ts:223` (the Retro seed widget), `connectors.spec.ts:210`/`:218` (the English word, in comments), `fixtures.ts:168` and `e2e/README.md:21` (prose). Confirm the stronger fact too: nothing under `apps/web/e2e` navigates to `/teams/$teamId/delivery`, so no drawing this change edits is under Playwright today

## 9. The assertions that must NOT move

- [ ] 9.1 `apps/web/src/delivery/delivery-view.test.tsx:243-269` runs **unedited**: the three sections in order, and every one of them still leading with a sentence ending in `.`. If this fails, a standfirst moved and `explanation-at-rest` D10 was broken
- [ ] 9.2 `apps/web/src/delivery/delivery-view.test.tsx:272-281` runs **unedited**, including `:280`'s `toHaveLength(1)` over `never a per-person number`
- [ ] 9.3 `packages/schema/src/zero/metrics/page.test.ts:856-865` runs **unedited** — the binding rule is declared in exactly one source file across four `src` roots
- [ ] 9.4 `packages/schema/src/zero/metrics/page.test.ts:454` and `:511` run **unedited**: the timeline's and the distribution's `markUnit` are not this change's business
- [ ] 9.5 The metric-placement totality test over `metricMap` (`page.ts:1232-1318`) runs unedited: no metric definition is added, retired or moved to a different section

## 10. Documentation

- [ ] 10.1 `apps/docs/src/content/docs/features/delivery.md` §"Cycle flow" (`:91-109`): what each mark is called on the drawing, that the name is drawn once, and that a cycle which shipped nothing draws a mark rather than nothing
- [ ] 10.2 Same file §"Review rhythm" (`:110-124`): where the 96-hour axis is now stated at rest, what the worked example is and how the row is chosen, and that `one row · one merged pull request` sits beside the count drawn
- [ ] 10.3 Same file `:163` — *"not a heading, not an axis, not a zero"* is about a **section** with no data and stays true; add the one-clause distinction from a cycle inside a rendered section that measured zero, or a reader will take the two sentences as contradicting
- [ ] 10.4 `README.md:174-175` and `apps/docs/src/content/docs/index.md:66-67` both describe these two drawings in one sentence each. Reread them **after** the change and rewrite only what became false
- [ ] 10.5 Run the grep that actually finds stale docs — over the **changed strings**, not the changed files: `grep -rn "carried\|+.* added\|one row is one merged" --include="*.md" apps/docs/ README.md DESIGN.md`. `explanation-at-rest` learned this one the hard way; the lesson is in its `design.md` §"Task 9.5's premise was wrong about README"
- [ ] 10.6 `DESIGN.md:12` mentions the flow band's added cap as an outline — confirm it stays true (it does; the cap's shape is not changed) rather than assuming it
- [ ] 10.7 `pnpm --filter @yapm/docs build` passes
- [ ] 10.8 `ROADMAP.md` is **not** edited by this change (`SCOPE-legibility.md:190-193`); the build flips its row's status at archive time

## 11. The northstar annotation

- [ ] 11.1 `design-explorations/overhaul-2026-08/northstar/NORTHSTAR.md`: a fourth entry under §"What the build kept, and the three places it had to diverge" (`:54-83`), and update that heading's count. Register: the amber entry at `:71-83` is the model
- [ ] 11.2 The entry must say the unflattering half: on `REVIEW RHYTHM` the build did **not** diverge — `delivery.html:261` draws the same unlabelled micro-tracks the product shipped — and the illegibility entered in the same word-diet correction that was right about everything else (`delivery.html:6`, `NORTHSTAR.md:35`)
- [ ] 11.3 It must also record that the build's all-ribbons-labelled regularisation of `delivery.html:255` is reversed **toward** the mock, so a later reader does not read this as the product walking away from the northstar wholesale
- [ ] 11.4 Do **not** re-render the five HTML files or their PNGs. `NORTHSTAR.md:40-41`'s `md5` consistency check across all five is real and this change has nothing to add to four of them (design D11)

## 12. Look at it

- [ ] 12.1 Render a seeded team's Delivery page at 1440×900, Warm light and Warm dark. `CYCLE FLOW`: is `8 shipped` under the leftmost bar read as a label, or as a stray word? Does the eye carry the noun rightward to the bare counts?
- [ ] 12.2 Same render: is the unnamed review dot genuinely carried by the standfirst above it (design D6), or is a reader left with an unexplained mark? **This is the judgement most likely to overturn a decision in this change**; if it fails, the fallback is written down in D6 and takes a third baseline and a leader line
- [ ] 12.3 Same render: does one ruler under one track read as governing the whole grid, or as belonging to that track alone? Design's own risks section names this as the sharpest aesthetic risk
- [ ] 12.4 Same render: does the zero stub read as a measured zero, or as a very short bar?
- [ ] 12.5 A window of 12 (`delivery-metrics/spec.md:23`'s bound) and a window of 3: does `8 shipped` still fit its slot, and does the rhythm's ruler still fit under a single-column grid?
- [ ] 12.6 A team with no merged change: `REVIEW RHYTHM` does not render at all (`delivery-metrics/spec.md:155-158`) — confirm nothing added here draws a ruler over an absent section
- [ ] 12.7 Record what looking found in `design.md` §"Decisions made during implementation", including the things that were fine. A pass that only records failures is a pass nobody can audit

## 13. Verification

- [ ] 13.1 `pnpm turbo lint typecheck test build`
- [ ] 13.2 `pnpm turbo check-boundaries` — `packages/ui` still imports nothing from `packages/schema`, which the new props are shaped to preserve
- [ ] 13.3 CI is the gate of record for the Playwright suite and the compose smoke test (PROCESS.md §4). Neither is expected to move; report the run rather than the expectation
- [ ] 13.4 `npx -y @fission-ai/openspec@latest validate --all` green

## 14. Pre-archive

- [ ] 14.1 **Re-run the delta-hazard grep before archiving**, because the answer in `design.md` §Appendix is only true as of the hour it was asked — two siblings (`phrase-is-news`, `config-wait`) appeared *while this proposal was being written*, and the appendix records that. `grep -rl "Requirement: Cycle flow is drawn as bars" openspec/changes/*/specs/` and the same for the other three requirement names. If a sibling has since claimed one, write the union and record the order here
- [ ] 14.2 Confirm this change still imposes no archive-order obligation on `explanation-at-rest` → `destination-budget` → `decision-record` (`SCOPE-legibility.md:202-204`), and inherits none
- [ ] 14.3 Walk every scenario in `specs/delivery-metrics/spec.md` against the running app, not against the test suite. The scenarios are the acceptance criteria
- [ ] 14.4 Confirm `openspec/specs/delivery-metrics/spec.md`'s `## Purpose` line (`:3-9`) is not made stale by this change — a delta cannot reach it, so if it is, that is a hand edit in the archiving commit (PROCESS.md §1)
