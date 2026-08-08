## 1. Read the rulebook first

- [x] 1.1 Read `design-explorations/overhaul-2026-08/northstar/issues.html` and render `issues.png`; read `NORTHSTAR.md` (§"Consistency check", §"The word diet", the `issues.html` self-critique) and `ia.html` (§"The word diet", §"Provenance", §"Two patterns, drawn once")
- [x] 1.2 Read `reference/zero.md` (Zero 1.x — `defineQuery`/`defineMutator`/`createBuilder`, never the 0.x names) plus the Tailwind 4.3 and TanStack Router references
- [x] 1.3 Read the surfaces this change consumes and must not rebuild: `packages/ui/src/components/{issue-row,reality-track,status-glyph,priority-mark,provenance-mark,drawn}.tsx`, `apps/web/src/frame/masthead.tsx`, `apps/web/src/issues/issues-lens.tsx`, `apps/web/src/frame/command-registry.tsx`
- [x] 1.4 Read `packages/schema/src/zero/{team-home.ts,delivery.ts,filter.ts,queries.ts}` and `apps/web/src/home/team-home.tsx` — the phrase dictionary in situ, and what the extraction must not change

## 2. The shared phrase dictionary (`packages/schema`)

- [x] 2.1 New `packages/schema/src/zero/phrases.ts`: `RestPhraseKey`, `PhraseRegister` (`'neutral' | 'personal'`), `RestPhrase { key, text: string | null, urgent, source: 'github' | null }`, `classifyRestPhrase(status, signal, divergence)` and `restPhrase(key, register, context)` — the classifier reading ONLY `computeDeliverySignal` + `computeDivergence` output (design D1)
- [x] 2.2 Fill both register tables over the identical key set; neutral resolves the three quiet keys and `deployed` to `null` (design D2); personal reproduces `team-home.ts`'s four current strings byte-for-byte
- [x] 2.3 Review-age keys split by `reviewAgeFrom` (design D4): `review_unreviewed` → "In review — waiting {age}", `review_returned` → "In review — reviewed {age} ago", both formatted by the same `formatReviewAge` the track's age column uses
- [x] 2.4 `source: 'github'` on exactly `checks_failing`, `diverged_done_ci_failing` and `merged_not_deployed` (design D3); every other key `null`
- [x] 2.5 Delete `sayPhrase` from `team-home.ts` and re-express `buildYours` through `classifyRestPhrase` + `restPhrase(..., 'personal')`; leave `gitLine` where it is (design D1). Do not edit `team-home.test.ts` — it is the regression guard
- [x] 2.6 Export the dictionary from `packages/schema/src/index.ts`; confirm no new table, query, mutator or migration was added

## 3. The row (`packages/ui`)

- [x] 3.1 `issue-row.tsx`: an optional `phrase?: ReactNode` slot between the title's spring and the reality track, at a reserved `PHRASE_SLOT_WIDTH`, right-aligned, `flex-none`, non-wrapping (design D5) — reserved whether or not it is filled
- [x] 3.2 The selected row's treatment as the mock draws it: left accent rail, tinted ground, accent ink on the mono key
- [x] 3.3 Confirm the slot order matches the mock exactly: priority tick · status arc · key · title · spring · phrase · track · age · labels · updated · avatar
- [x] 3.4 `issue-row.stories.tsx`: the mock's four cases (checks failing, done-in-git, built-not-live, in-review) plus a quiet row and the selected divergent row (the mock's ENG-116 — phrase AND broken track together)

## 4. The work surface (`apps/web/src/issues/`)

- [x] 4.1 `delivery.ts`: extend `deliveryView` (or add a sibling) to return the row's `RestPhrase` from the SAME `computeDeliverySignal` result the track already uses — one signal computation per row, not two
- [x] 4.2 `issue-list.tsx`: render the phrase into the row's slot, with `ProvenanceMark provider="github" size={12} label={null}` appended when the entry carries a source; nothing rendered when `text` is `null`
- [x] 4.3 Group headers to the mock: quiet tinted band, the grouping's own mark (status arc / priority tick / label dot / none), label, mono filtered count; the labelled region survives
- [x] 4.4 The fold (design D8): `visible = ordered.slice(0, cap)`, a real `<button>` reading `↓ {ordered.length - cap} more`, rendered only when there is something hidden; `j`/`ArrowDown` from the last row reaches it, Enter/Space raises the cap and focus lands on the first newly revealed row; `ordered` (and so the masthead count, the selection targets and the ⌘K context) stays the full filtered set

## 5. The quiet filter bar

- [x] 5.1 Re-register the seven filter axes as plain-text triggers with the filter mark at the left — **`aria-label="Filter by <axis>"` preserved verbatim** on every one (four e2e specs drive them)
- [x] 5.2 Re-register the search input quietly, keeping `aria-label="Search issues"`
- [x] 5.3 `Group **X** · Sort **Y**` quiet at the trailing edge: grouping stays a native `<select aria-label="Group by">` restyled to the mock's register (design D7); sort becomes a menu whose direction pair replaces the chevron toggle, keeping named ascending/descending options
- [x] 5.4 Saved views to the mock's register: a quiet `Save view` text button plus a saved-views menu; save, apply and the cycle/project grouping downgrade all behave exactly as before
- [x] 5.5 Masthead title becomes `Issues` with the mono count, no status glyph (design D10); the `List | Board` lens is untouched
- [x] 5.6 Word diet (design D9): the three sentences become labels (`No matches`, `Loading…`, `Team not found`), each keeping its `role="status"`; verify no sentence renders anywhere on the page

## 6. Tests

- [x] 6.1 `packages/schema` unit — **the falsifiable check, part one**: both registers are total over `RestPhraseKey` and neither has a key the other lacks; the neutral register produces the mock's four strings for the mock's four predicate cases; the personal register produces `team-home.ts`'s four current strings unchanged
- [x] 6.2 `packages/schema` unit: `classifyRestPhrase` precedence — divergence, then failing checks, then merged-not-deployed, then approved/draft, then status; plus the case proving `merged_not_deployed` is unreachable in YOURS (an unfinished issue with a merged PR classifies as `diverged_behind_merge`), and the two review-age cases split by `reviewAgeFrom`
- [x] 6.3 `packages/schema` unit: a source-level assertion that the dictionary's strings appear in exactly one file, so a second phrase table turns CI red
- [x] 6.4 `apps/web` component — **the falsifiable check, part two**: render the list over the mock's four cases plus quiet rows and assert each row's phrase text, that quiet rows render no phrase, that the GitHub mark appears on exactly the check and deploy phrases, and that the selected divergent row shows its phrase and its `//` break together
- [x] 6.5 `apps/web` component: the fold states the real remaining count over a seeded set larger than the cap (derived from the rendered page, never a hard-coded budget), renders nothing when the result is short, and opens from the keyboard with focus landing on the first revealed row
- [x] 6.6 `apps/web` component: the re-registered bar keeps every capability — each of the seven axes toggles its predicate, all seven groupings group, all six sort keys sort, the direction toggle reverses, search filters, and a saved view saves and re-applies
- [x] 6.7 `apps/web` component: the keyboard model survives intact — `j`/`k`, arrows, `x`, Space, Enter/`→`, `c`, `s`/`a`/`l`/`p`; and the surface binds no ⌘K listener of its own (the frame owns it)
- [x] 6.8 Extend `packages/ui/src/styles/contrast.test.ts` with the phrase's token pairs — neutral phrase ink and urgent phrase ink on `--bg`, on `--bg-hover` and on the selected row's tinted ground — in all six theme blocks
- [x] 6.9 Update the e2e specs the row vocabulary moved: `issues.spec.ts`'s masthead heading assertion (`Issues`, not `<team> · Issues`) and `cycles.spec.ts`'s grouping control if its shape changed. Never weaken an assertion to make a gate pass; no new e2e spec is added (PROCESS.md §3 — one big-feature axis)

## 7. Documentation

- [x] 7.1 New `apps/docs/src/content/docs/features/issue-list.md`: the row anatomy left to right, the phrase dictionary and where else it is spoken, provenance on check/deploy phrases only, the quiet filter bar's full capability list, group headers, the fold, and the complete keyboard model
- [x] 7.2 Update `features/reality-vocabulary.md` (phrases at rest are part of the vocabulary — one dictionary, two registers, marks on sourced facts only), `features/team-home.md` (YOURS speaks the shared dictionary), `features/delivery-signals.md` (where each signal is said in words, and the `merged-not-deployed` over-reporting limitation restated where the filter is documented)
- [x] 7.3 Update `README.md` and `ROADMAP.md` (the change's status row); confirm `.env.example`, `TECHSTACK.md` and every other root doc are untouched by this change and therefore not stale (PROCESS.md §2)
- [x] 7.4 `pnpm --filter @yapm/docs build` passes
- [x] 7.5 Record every decision taken during the build in `design.md` under "## Decisions made during implementation", including anything that had to diverge from `issues.html` and why

## 8. Gates

- [x] 8.1 `pnpm turbo lint typecheck test build` green
- [x] 8.2 The compose smoke test green
- [x] 8.3 The full Playwright e2e suite green (CI is the gate of record)
- [x] 8.4 Walk every scenario in `openspec/changes/issue-list-daylight/specs/**` and confirm each is true of the built surface
- [x] 8.5 Compare the rendered page against `issues.png` side by side and note any deliberate divergence in `design.md` — the one judgement no assertion can make
