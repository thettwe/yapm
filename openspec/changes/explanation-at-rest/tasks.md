## 1. Read the rulebook first

- [x] 1.1 Read `openspec/SCOPE-legibility.md` end to end — the maintainer decisions (§"What the maintainer chose"), the five recorded positions (§"The recorded positions this family must re-argue"), the B1 row at `:152` **and** design D5 and D10 here, which narrow it: the row as first drafted carried the `app-frame:229` reversal and assigned Delivery's caption removal to B1, and this change declines both with reasons recorded
- [x] 1.2 Read `DESIGN.md:33-34` — the word diet, and "Nothing draws ink it has no fact for" — and `VISION.md` §"Product principles" 1 and 4
- [x] 1.3 Read `packages/ui/src/components/how.tsx` in full. The three facts that shape this change: the panel is `{open ? (…) : null}` at `:66-91` (absent from the DOM, not hidden), the trigger's accessible name is `How ${label} is derived` at `:58`, and Escape closes and returns focus at `:33-38`. **This component is not edited by this change**
- [x] 1.4 Read `openspec/specs/reality-vocabulary/spec.md:253-270` (the requirement being generalised) and `openspec/specs/delivery-metrics/spec.md:263-275` — both the page-scoped original at `:271-275`, which stays, and the journalism-cut requirement at `:263-266`, which **mandates** the section standfirsts this change refuses to remove (design D10)
- [x] 1.5 Read the two surfaces that already got it right and are the model: `apps/web/src/projects/roadmap-view.tsx:250-262` and `apps/web/src/cycles/cycles-view.tsx:558-570` — a refusal at rest with its own `how ·` beside it for the derivation it refused
- [x] 1.6 Read `openspec/specs/app-frame/spec.md:228-230`, `apps/web/src/delivery/delivery-view.test.tsx:272-281` and `packages/schema/src/zero/metrics/page.test.ts:856-865` — the promise this change **keeps**, and the two gates that prove it
- [x] 1.7 Read the "## Decisions made during implementation" sections of `openspec/changes/archive/2026-08-09-projects-roadmap-daylight/design.md` and `2026-08-08-issue-list-daylight/design.md` — settled precedent, followed unless this change has a stated reason not to

## 2. The derivation text (`packages/schema`)

- [x] 2.1 `packages/schema/src/zero/team-home.ts:363-364`: rename `YOURS_FOOTNOTE` → `YOURS_DERIVATION` and drop the `yours = ` prefix from its value. The clauses stay, in order, ending `your work only — never compared`
- [x] 2.2 Same file `:906`: the model field it feeds is renamed with it (`yours.footnote` → `yours.derivation`), and its type declaration follows at `:287` (`readonly footnote: string` in `TeamHomeYours`, declared `:280-288`)
- [x] 2.3 `packages/schema/src/index.ts:856`: the re-export follows the rename
- [x] 2.4 `packages/schema/src/zero/team-home.ts:339-340`, `:545-548`, `:561`: `footline` is **unchanged** — same name, same type, same assembly. Only where it is read moves (design D8). Confirm by reading that no clause is added, removed or reworded
- [x] 2.5 Confirm the change is confined to a constant and a field name: no new export, no new function, no query, no mutator, no migration

## 3. Home — the YOURS lens (`apps/web/src/home/team-home.tsx`)

- [x] 3.1 Delete the mono footnote block at `:834-836` (the `<div>` carrying `<span>yours =</span>` and `yours.footnote.replace(/^yours = /, '')`), together with the trailing hairline at `:833`, which exists only to divide that footnote from the rows. The `.replace` goes with it — a surface stripping a prefix off a shared constant is a seam nobody should have to remember
- [x] 3.2 Mount `<How label="yours">` in `BandHeader`'s existing `onward` slot (`:152` / `:157` / `:170`) on the YOURS band, beside the count. Body: the lens clauses in the register of the page; `constraint`: the mono form of the same clauses
- [x] 3.3 The slot is shared with the Runway doorway (`:735-746`), which renders only when `empty && runway !== null` (`:736`). The affordance renders only when the band has rows, so the two can never both be present — assert that in the component test rather than reasoning about it
- [x] 3.4 Nothing else on the band moves: rows, the waiting-on-others line (`:811-824`) and the `No reviews owed` line (`:825-832`) are untouched

## 4. Home — the page's composition record (`apps/web/src/home/team-home.tsx`)

- [x] 4.1 `Footline` (`:968-975`) renders one `<How label="this page">` where the mono line stood, keeping its `mt-12` position above the onward footer. The body lists `model.footline`'s clauses; nothing else renders at rest
- [x] 4.2 The affordance renders only when the record has at least one clause. `footline` always carries `empty bands fold away` (`packages/schema/src/zero/team-home.ts:548`), so this is a guard, not a branch anyone will see — write it anyway, because the requirement is about the record, not about today's assembly
- [x] 4.3 `OnwardFooter` (`:976`) and its one call site (`:128`) are untouched. `:127` is `<Footline model={model} />` — the line task 4.1 rewrites — so the two sit adjacent and only the first moves. Verify by reading the diff, not by intent

## 5. Projects — two spans go, two affordances stay

- [x] 5.1 `apps/web/src/projects/projects-view.tsx:222`: delete the `<span>workspace-scoped · counted over the issues in your teams</span>`. The `<How label="the counting rule">` at `:223-230` is **not edited** — its body already states the scope and the counting rule
- [x] 5.2 Same file: the foot's flex row (`:221`) keeps its position and spacing with one child; confirm the affordance does not jump when the span leaves
- [x] 5.3 `apps/web/src/projects/project-page.tsx:377`: delete the `<span>workspace project · counted over the issues in your teams</span>`. The `<How>` at `:378-384` is **not edited**
- [x] 5.4 The masthead `ScopeChip` (`apps/web/src/projects/project-controls.tsx:38-54`, mounted at `projects-view.tsx:141` and `project-page.tsx:226`) stays visible on both surfaces — it is a label, not a derivation

## 6. Retros — the empty state stops rendering over rows

- [x] 6.1 `apps/web/src/retro/retros-view.tsx:185-190`: render the quiet block only when the team has no retros, which is what `openspec/specs/retrospective/spec.md:403` already requires. The `retros.length > 0` branch closes at `:180`; the block currently sits outside it
- [x] 6.2 `nextClose` (`:92-99`) is unchanged, and the mono fact stays **beside** the sentence in the empty state rather than moving behind an affordance (design D6 — the obligation does not generalise)
- [x] 6.3 `data-testid="retros-quiet"` and `role="status"` survive on the block, so the existing empty-state assertions keep addressing the same node
- [x] 6.4 Nothing else on this surface is touched — not the card rows, not the pill badge, not the outlined buttons. `SCOPE-legibility.md:146` gives those to A1 `register-seam`, and this change is confined to `:185-190`
- [x] 6.5 Empty is gated on completeness, not on emptiness alone, and the whole `projects-view.tsx:168-173` idiom is adopted rather than half of it: one `role="status"` paragraph stays mounted whenever `retros.length === 0` and its *contents* swap — the quiet sentence when `retrosResult.type === 'complete'`, the label `Loading…` while it is not. A test mounts an unhydrated result and asserts both halves

## 7. Tests — what moves

- [x] 7.1 `apps/web/src/home/team-home.test.tsx:395` — `getByText(/your work only — never compared/)` now fails, because the panel is absent from the DOM at rest (design D3). Replace with two assertions: the string is **not** in the document at rest, and activating the YOURS band's `how ·` reveals it. Do not weaken it to a class check. Rename the test at `:382` with it — *"YOURS carries the bifact rows, the collapsed waiting line and the never-compared footnote"* names a footnote the page no longer draws, and a title that outlives what it proves is the next reader's wrong turn
- [x] 7.2 `apps/web/src/home/team-home.test.tsx:452` — `getByText(/composed =/)` asserts a string this change deletes outright. Replace with `queryByText(/composed =/)` returning null plus the presence of the foot's `how ·` by its accessible name (`How this page is derived`)
- [x] 7.3 `apps/web/src/home/team-home.test.tsx:453` — `getByText(/empty bands fold away/)` moves inside the opened panel. This is the quiet-day test, so it must still prove the *honesty* clause: on a fully folded day the opened record names the folding and names nothing else
- [x] 7.4 `packages/schema/src/zero/team-home.test.ts:12` — the import follows the rename to `YOURS_DERIVATION`
- [x] 7.5 `packages/schema/src/zero/team-home.test.ts:457` — `expect(model.yours.footnote).toBe(YOURS_FOOTNOTE)` is a **tautology**: it stays green through any change to the constant's value, so it proves nothing about the new text. **Strengthen** it rather than merely renaming it — assert the derivation states the assignee clause, the status clause, the ordering clause, that it ends `your work only — never compared`, and that it no longer begins `yours = `
- [x] 7.6 `apps/web/src/projects/project-page.test.tsx:343` — `getByText('workspace project · counted over the issues in your teams')` asserts the deleted span. Replace with: the string is absent at rest, and the surface's `how ·` (accessible name `How the counting rule is derived`) reveals the scope and the counting rule. The rest of that test (`:338-349` — the scope chip and the Escape route) is unchanged
- [x] 7.7 `apps/web/src/projects/projects-view.test.tsx` asserts **nothing** about its own footnote today — the deletion would have passed this file unedited. Close the gap: a test that the counting sentence is absent at rest and that the foot's `how ·` reveals it. Model it on the existing row-level test at `:149-174`, which already drives a `How` trigger by `keyDown`, asserts no navigation (`:172`) and asserts the panel is revealed (`:173`)
- [x] 7.8 `apps/web/src/retro/retros-view.test.tsx:101-105` and `:123` both mount teams with **no** retros, so both stay green unchanged — which is exactly why the defect survived. Add the missing case: an index mounted with at least one retro renders no `retros-quiet` node at all
- [x] 7.9 Every fold assertion checks **absence from the document**, not a class or an attribute. `how.tsx:66` makes `queryByText(...)` a real proof of absence; anything weaker would pass over a visually-hidden regression
- [x] 7.10 Every reveal is operable from the keyboard alone, and every reveal assertion asserts Escape folds it and returns focus to the trigger — the behaviour `how.tsx:33-38` implements and `reality-vocabulary` requires. The open half is the click a native `<button>` raises from Enter and Space; jsdom does not synthesize that translation, so the surface suites focus the trigger and fire the click it would raise, and `packages/ui/src/components/how.test.tsx` owns the proof that the trigger is a native button. A bare `keyDown(' ')` in a surface suite asserts jsdom's gap, not the control

## 8. Tests — what must NOT move

- [x] 8.1 `apps/web/src/delivery/delivery-view.test.tsx:278` and `:280` run **unedited**. `:280`'s `toHaveLength(1)` over `/never a per-person number/` is the tripwire: if this change ever drifted into folding the metrics promise, it goes to zero and says so
- [x] 8.2 `packages/schema/src/zero/metrics/page.test.ts:856-865` runs **unedited**. Note for the reader who checks: `:857` scopes it to four `src` roots and the walker at `:850` skips `.test`/`.spec`/`.stories`, so it is not a repo-wide grep and `apps/docs` is outside it
- [x] 8.3 No e2e spec is added or edited. Confirm by re-running the grep that established it: `apps/web/e2e` for `counted over`, `workspace-scoped`, `won't guess`, `per-person`, `composed =`, `yours =` and `A retro opens when a cycle closes` returns exactly one hit — a comment at `apps/web/e2e/retro.spec.ts:457`
- [x] 8.4 `packages/ui/src/styles/contrast.test.ts` gains no pairs, because `packages/ui` is not edited and every token in play is already asserted. If a pair is needed, `packages/ui` was edited and something has gone wrong
- [x] 8.5 No assertion anywhere is weakened to make a gate pass

## 9. Documentation

- [x] 9.1 `apps/docs/src/content/docs/features/reality-vocabulary.md`: the generalised rule and — the part worth writing carefully — **the boundary**. What folds (query definitions), what never does (refusals, a mandated promise, a derived section standfirst, an empty state's one line), and the reason: the fold removes text from the document for every reader, which is right for a scoping clause and wrong for a refusal
- [x] 9.2 `apps/docs/src/content/docs/features/team-home.md`: `:35` describes the mono footline as a rendered line, `:109` quotes the YOURS footnote as visible, `:139` explains what the footline never mentions. All three describe a page that no longer exists; rewrite them around the two affordances
- [x] 9.3 `apps/docs/src/content/docs/features/projects.md:26` quotes `workspace-scoped · counted over the issues in your teams` verbatim as a rendered mono footline. Rewrite as the counting rule behind the surface's `how ·`
- [x] 9.4 `apps/docs/src/content/docs/features/retrospectives.md:263` describes the quiet line; state plainly that it is the empty state and does not render over rows
- [x] 9.5 Confirm `README.md`, `TECHSTACK.md`, `VISION.md`, `DESIGN.md`, `CLAUDE.md`, `PROCESS.md`, `.env.example` and every `reference/` page are untouched by this change and therefore not stale (PROCESS.md §2). **Do NOT edit `ROADMAP.md`** — other proposals in this family are authored in parallel and that file is the guaranteed conflict, so the row is taken once by whoever integrates (`SCOPE-legibility.md:190-192`). The debt is already paid: **row 47 `explanation-at-rest` is in `ROADMAP.md`**, added by the integrator with row 46 `front-door`. Read it and confirm it still describes this change — including the boundary and the two departures (D6, D10) — rather than adding a second row
- [x] 9.6 Record every decision taken during the build in `design.md` under "## Decisions made during implementation" — in particular any site where the fold turned out to remove something a reader needed, which is the finding that would move D1's line

## 10. Render and look

- [x] 10.1 Team Home at 1440×900 over a seeded team with a working morning: the YOURS band header carries the affordance beside its count, the page foot carries one above the onward footer, and **no mono clause line is drawn anywhere on the page**
- [x] 10.2 The same page with both affordances open, one at a time: the panel's kicker names the subject (`how · yours`, `how · this page`), and the clauses read as prose rather than as the mono line relocated
- [x] 10.3 Team Home on a fully quiet day — every optional band folded — so the composition record is at its shortest. Confirm the affordance is not stranded over an otherwise-empty foot
- [x] 10.4 The Projects index and one project's page: **look at the bare `how ·` at the foot** (design D7, the change's one accepted aesthetic risk). If it reads as orphaned punctuation rather than a quiet affordance, that is the finding, and it belongs in design.md before it is worked around
- [x] 10.5 The Retros index in both states — a team with retros (no quiet block at all) and a team with none (sentence plus mono fact, unchanged)
- [x] 10.6 The Delivery view, unchanged: its masthead standfirst still carries the metrics promise (`delivery-view.tsx:146`), its refusal still stands at rest (`:435`), and `CYCLE FLOW` and `REVIEW RHYTHM` still lead with their derived sentences (`:376`, `:402`, drawn at `:335-341`) — mandated by `delivery-metrics/spec.md:263-266` and declined deliberately (design D10). This is the render that proves the change stayed inside its boundary
- [x] 10.7 All four folded sites in one dark theme block, to confirm nothing that was `--text-3` at rest became `--text-2` in the panel by accident

## 11. Gates

- [x] 11.1 `pnpm turbo lint typecheck test build`
- [x] 11.2 The full Playwright suite — expected green with **no spec edited** (task 8.3). A failure here means a string this change deleted was load-bearing somewhere the grep did not reach; investigate rather than edit the spec
- [x] 11.3 The compose smoke test
- [x] 11.4 `npx -y @fission-ai/openspec@latest validate --all`
