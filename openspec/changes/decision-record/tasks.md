## 1. Read the rulebook first

- [ ] 1.1 Read `design-explorations/overhaul-2026-08/plays/PLAY-decisions.md` — the graduates list, the stays-a-sketch list and both per-artifact self-critiques
- [ ] 1.2 Read `plays/decisions-thread.html` and `plays/decisions-record.html` in full, including their header comments
- [ ] 1.3 Read `northstar/ia.html` §the `more▾` menu drawn open, §the peek, and the word-diet rules; and `northstar/home-digest-2.html` §DECIDED THIS CYCLE
- [ ] 1.4 Read `reference/zero.md` §"Correctness gotchas" and the schema/query/mutator sections before writing any sync code — `defineQuery` / `defineMutator`, never the 0.x names
- [ ] 1.5 Read `packages/schema/src/migrations/0021_pm_digest.ts` and `0012_retro.ts` for the shape a new-table migration takes here, and `db/schema-drift.test.ts` for what it will demand

## 2. The table (`packages/schema`)

- [ ] 2.1 `packages/schema/src/zero/decisions.ts` (new): export `DECISION_SENTENCE_MAX = 240` and `DECISION_SENTENCE_CHECK` (the raw SQL predicate), so the Zod schema, the CHECK constraint and the composer counter share one source
- [ ] 2.2 `packages/schema/src/migrations/0024_decision.ts` (new): forward-only `up`/`down` creating `decision` per design D1 — `id` uuid pk; `team_id` → `team` cascade; `issue_id` → `issue` cascade; `sentence` text not null with the length CHECK; `decided_at` timestamptz not null; `source_comment_count` integer not null default 0; `first_comment_id`/`last_comment_id` uuid → `comment` **set null**; `revisit_cycle_id` uuid → `cycle` **set null**; `created_at`/`updated_at` defaulted. **No author column of any kind**, with the reason in the file comment
- [ ] 2.3 Same file: `decision_team_decided_at_idx` on `(team_id, decided_at desc)` and `decision_issue_idx` on `(issue_id)`
- [ ] 2.4 Register `0024_decision` in `packages/schema/src/migrations/index.ts`
- [ ] 2.5 `packages/schema/src/db/types.ts`: the `decision` table in the hand-written `DB` interface
- [ ] 2.6 `packages/schema/src/zero/schema.ts`: the `decision` table entry (camel columns `.from(...)` snake), its relationships (`team`, `issue`, `revisitCycle`, `firstComment`, `lastComment`), the `issue → decisions` many relationship, and registration in the schema's tables + relationships lists

## 3. Reading and writing (`packages/schema`)

- [ ] 3.1 `queries.ts`: `decisions.byTeam({ teamId })` — `teamScoped(...)` in the same shape as its siblings, `.related('issue', …labels)`, `.related('revisitCycle')`, ordered `decidedAt desc`. One query only; no workspace variant, no REST route (design D4)
- [ ] 3.2 `queries.ts`: `.related('decisions', …)` added **inside** the existing issue-detail query's existing `teamScoped(...)` call, so the pinned chip costs no new query
- [ ] 3.3 `mutators.ts`: `decision.record` — args `{ id, issueId, sentence, decidedAt, revisitCycleId? }`; `canWrite` + `loadIssueForWrite` before existence; `team_id` off the loaded issue; sentence trimmed and length-validated; **provenance derived in the mutator body** from the issue's comments ordered by `created_at` (count, first id, last id) and never taken from args (design D3)
- [ ] 3.4 `mutators.ts`: `decision.revise` (sentence and/or revisit marker) and `decision.retract` — team-scoped write access and **no author check**, because there is no author (design D3). Register all three in the mutators map and in `server-mutators.ts` where its siblings are
- [ ] 3.5 `decisions.ts`: the pure derivations over synced rows — `groupDecisionsByCycle(decisions, cycles)` (cycles newest first, decisions newest first within, a final `Outside a cycle` group), `matchesDecisionSearch(decision, query)` (case- and diacritic-insensitive over sentence + issue key), `decisionProvenance(decision)` (the mono line, never naming a person), `revisitPillText(cycle)` (the words the pill states)
- [ ] 3.6 `team-home.ts`: `TeamHomeDecided` band model — the active cycle's decisions, newest first, chip fields only; `null` when the cycle holds none or there is no active cycle; wired into `buildTeamHome`'s return and its footline clause **only when the band rendered**

## 4. The drawn mark (`packages/ui`)

- [ ] 4.1 `packages/ui/src/components/drawn.tsx`: `DecisionMark` — a filled dot (a fact) inside a ring (a promise) on the shared 20-unit grid, static, tokenised; `role="img"` with a truthful label when it stands alone and `aria-hidden` when the word `Decided` is beside it. **Additive only** — no existing export's signature or output changes

## 5. Deciding a thread (`apps/web/src/issues/issue-detail.tsx`)

- [ ] 5.1 The **Decide** control beside `Comment` in the composer, rendered exactly where a post control is rendered (writers only), in the tab order, with its own accessible name
- [ ] 5.2 The one-sentence field: single-line plain text, the remaining budget stated in words, an optional revisit-cycle chooser over the team's cycles, `Enter` submits, `Escape` closes and returns focus to the control. **`newId()` at the call site**
- [ ] 5.3 The pinned decision chip(s) above the thread, newest first: `DecisionMark` + the word `Decided`, the date, the sentence in plain type, the mono provenance line (`from a thread of N · the team's call, no owner`), the revisit pill where set, and the thread doorway **only when the source comments still exist**
- [ ] 5.4 The settled-thread collapse (design D7): comments at or before the newest decision's `decided_at` behind one `aria-expanded` control naming `N comments · settled`; later comments stay open; local state only; the section heading still counts every comment
- [ ] 5.5 The palette entry `Decide this thread…` on the issue-detail surface, so the keyboard route does not depend on composer focus. **No bare-letter shortcut** (proposal non-goal)

## 6. The record page

- [ ] 6.1 `apps/web/src/routes/teams.$teamId.decisions.tsx` (new) rendering a new `apps/web/src/decisions/decisions-view.tsx`, inside the shared frame with `current="decisions"`
- [ ] 6.2 Band 2: `Decisions` + mono count, the standfirst `Why did we do it this way? — answered here, six weeks from now.`, and the cycle filter
- [ ] 6.3 The search row: a real `<input type="search">` focused by `/`, plus the scope control (`Everything` · `Revisits due`), filtering locally through `matchesDecisionSearch`
- [ ] 6.4 Group headers per cycle (newest first, with the cycle's date range) and the final `Outside a cycle` group; chip-rows: mark, sentence (single line, ellipsised), area from the issue's first label **or nothing**, revisit pill, issue key, date. **No owner column and no cell that could hold one**
- [ ] 6.5 Row unfold in place — full sentence, the why/provenance line, the thread doorway — with the roving-focus keyboard model the roadmap and projects index already use; `Enter` toggles, `Escape` folds
- [ ] 6.6 The page foot: `Decisions never expire — they get revisited.` plus the count of revisits due, derived from rows
- [ ] 6.7 The empty page (a team with none): masthead, standfirst, one quiet line naming what will appear — **no search field, no scope control, no group header, no reserved measure** (design D12.1)
- [ ] 6.8 Nothing on the page varies with a decision's age: no opacity ramp, no stale class, no staleness ordering (design D5)

## 7. The two folds opened

- [ ] 7.1 `apps/web/src/frame/deck.tsx`: the `Decisions` item in `more▾` with the `g d` hint and `aria-current` when it is the current page; `DeckStop` gains `'decisions'`; Delivery's menu hint becomes `g s`
- [ ] 7.2 `apps/web/src/frame/go-to.ts`: `d` → the decisions route, `s` → delivery; the stale comment about Decisions being folded away is replaced by what is now true (design D10)
- [ ] 7.3 `apps/web/src/home/team-home.tsx`: the **DECIDED THIS CYCLE** band after SHIPPED THIS CYCLE and before the footline — chips as `home-digest-2.html` draws them, each a doorway to its issue, folding entirely when the model is null
- [ ] 7.4 The Home band and the record page subscribe to the one `decisions.byTeam` query; no second query anywhere

## 8. Tests

- [ ] 8.1 `packages/schema/src/zero/decisions.test.ts` (new) — **the falsifiable check**: `groupDecisionsByCycle` places a decision inside its cycle, one decided in a gap between cycles into `Outside a cycle`, orders cycles and rows newest first; `matchesDecisionSearch` matches sentence and issue key case- and diacritic-insensitively; `decisionProvenance` states the stamped count and contains no name; `revisitPillText` states the sentence the pill shows
- [ ] 8.2 Same file: a decision decided today and one decided 400 days ago produce identical presentation output — the record does not fade (design D5.1)
- [ ] 8.3 `packages/schema/src/zero/mutators.decision.test.ts` (new): `decision.record` rejects a viewer and a non-member before existence; derives provenance from the thread and ignores any caller-supplied count; copies `team_id` off the issue; refuses a sentence over `DECISION_SENTENCE_MAX`; `revise`/`retract` require write access and apply no author check
- [ ] 8.4 `queries.test.ts`: `decisions.byTeam` carries the team-scoped predicate and its two relations; the issue-detail query's `decisions` relation alias asserted beside the existing assertions, which are untouched
- [ ] 8.5 `packages/schema/src/db/schema-drift.test.ts`: the `decision` shape in `KYSELY_DB`, **plus** the absent-identity assertion over live Postgres and over the Zero schema (design D9) — appended beside the existing table entries without reordering them
- [ ] 8.6 `packages/schema/src/zero/queries.decisions.pg.test.ts` (new, `.pg`): a member reads their team's decisions and zero rows for another team; a viewer reads and cannot write; deleting every source comment leaves the decision standing with null references and its stamped count intact
- [ ] 8.7 `packages/schema/src/migrations/migrations.test.ts`: `0024_decision` applies and rolls back cleanly in the existing harness
- [ ] 8.8 `packages/schema/src/zero/team-home.test.ts`: the DECIDED band model — three decisions in the active cycle, folded when the cycle has none, absent with no active cycle, no per-person field on the output
- [ ] 8.9 `apps/web/src/decisions/decisions-view.test.tsx` (new): the empty page renders the quiet line and no search field or group header; one decision renders one group and one row; a 240-character sentence does not break the row; the revisit pill's accessible name is its sentence; no rendered node names a person
- [ ] 8.10 `apps/web/src/issues/issue-detail.test.tsx`: the Decide control is absent for a viewer and present for a writer; the chip states the provenance and drops the thread doorway when the source comments are gone; the settled block collapses comments at or before `decided_at` and leaves later ones open; the heading counts every comment
- [ ] 8.11 `apps/web/src/frame/app-frame.test.tsx` / the go-to test: `g d` navigates to decisions, `g s` to delivery, the `more▾` menu draws both hints, and neither fires while a text field holds focus
- [ ] 8.12 `packages/ui/src/styles/contrast.test.ts`: this surface's pairs in **every** theme block, light and dark — the chip's accent edge and ink, the revisit pill's border and text, the group header ground, the record row hairline. **Appended as a clearly delimited block at the END of the file**, never edited into the middle
- [ ] 8.13 `apps/web/e2e/decisions.spec.ts` (new): a member decides a thread from the composer with the keyboard and the chip pins above a collapsed thread; `g d` opens the record and search finds the sentence; a viewer sees the record and no Decide control

## 9. Documentation

- [ ] 9.1 `apps/docs/src/content/docs/features/decisions.md` (new): what a decision is, the ownerless guarantee and why it is structural (no author column, asserted in CI), deciding a thread, the chip, the record page's grouping and search, revisit markers — **and the plain sentence that resurfacing at planning arrives with the planning surface, which does not exist yet**
- [ ] 9.2 `apps/docs/src/content/docs/features/issue-detail.md`: the Decide affordance and the settled-thread collapse
- [ ] 9.3 `apps/docs/src/content/docs/features/app-frame.md`: `more▾` now lists Decisions; the keyboard table gains `g d` → Decisions and moves Delivery to `g s`
- [ ] 9.4 `apps/docs/src/content/docs/features/team-home.md`: the DECIDED THIS CYCLE band and its fold rule
- [ ] 9.5 `README.md` feature list gains the decision record. **`ROADMAP.md` is NOT edited** — the maintainer adds the row at archive time
- [ ] 9.6 `pnpm --filter @yapm/docs build` passes; every root doc this change makes stale is updated (PROCESS.md §2)

## 10. Render and look

- [ ] 10.1 Bring the record page up at 1440×900 over a seeded team, screenshot it, and compare against `plays/decisions-record.html` rendered to PNG; record every deliberate difference in `design.md`
- [ ] 10.2 Same for the issue detail with a pinned chip over a settled thread against `plays/decisions-thread.html`
- [ ] 10.3 Screenshot and **look at** each degenerate state (design D12): a team with no decisions; exactly one decision; a decision whose thread was deleted; a 240-character sentence in every place it appears; a decision with a revisit marker. Confirm none reserves a measure it cannot fill
- [ ] 10.4 The record page and the issue chip in Editorial dark
- [ ] 10.5 Every difference from the plays, and everything found by looking, appended to `design.md` under `## Decisions made during implementation`

## 11. Gates

- [ ] 11.1 `pnpm turbo lint typecheck test build` green
- [ ] 11.2 The schema-drift test green against live Postgres, including the absent-identity assertion
- [ ] 11.3 The compose smoke test green — a new table means the boot-time migration is on the critical path
- [ ] 11.4 The **full** Playwright suite. The known flakes are `projects.spec.ts:190`/`:248`, `pm-digest.spec.ts:306` and `retro.spec.ts:236` opening a second browser context (`browserContext.close: Protocol error`) — re-run once and **confirm the signature is that error rather than an assertion disagreeing**; any other failure is this change's
- [ ] 11.5 `npx -y @fission-ai/openspec@latest validate decision-record` clean
