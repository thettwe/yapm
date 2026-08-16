# Tasks — phrase-is-news

Sequenced so the app runs after each group. Groups 1–3 make the drawing able to carry the fact;
only then does group 4 take the words away.

## 1. The drawing must be able to carry the fact (D2, D4)

- [x] 1.1 `packages/ui/src/components/reality-track.tsx:45-50` — `prNode` maps `approved` to the
      `open` node and only `merged` to `done`. `reviewNode` (`:59-63`) is unchanged: it already
      draws `done` for approved, which is what separates the two tracks.
- [x] 1.2 `packages/ui/src/components/reality-track.tsx:229-236` — give each of the six node kinds
      its own non-colour channel. Export the per-kind form as a value (fill × form × stroke style)
      that `NODE_CLASS` is derived from or asserted against, so the property is testable over the
      vocabulary rather than over rendered pixels. Design D4 offers one assignment; the measure at
      7px on a dense row decides it.
- [x] 1.3 `RAIL_NODE_CLASS` (`:280-287`) is **not** edited. Its stations carry a label line and a
      mono fact line (`:470-481`), so no reader tells them apart by eye — D4.
- [x] 1.4 `packages/ui/src/components/reality-track.test.tsx:63-82` — the node-mapping test gains
      the approved case: `pr: 'approved'` draws `['open', …, 'done', 'empty']`, and the merged
      fixture still draws `done` at the change station.
- [x] 1.5 New test in the same file: over the six node kinds, no pair is separated by colour alone.
      Asserted over the exported form descriptors.
- [x] 1.6 Re-run `packages/ui/src/styles/contrast.test.ts` unedited. No hue moves, so no pair is
      added; a thinner or dashed mark is the same ink on the same ground and the file is the record
      that says so. If a measurement moves, the drawing moves — never the assertion's bar.

## 2. The dictionary learns a third resolution (D1, D5)

- [x] 2.1 `packages/schema/src/zero/phrases.ts:54-63` — `RestPhrase` gains `spoken: string | null`
      beside `text`. Invariant, stated in a comment and asserted in 2.6: a drawn entry has
      `spoken === text`; a quiet entry has `text === null` and `spoken !== null`; a silent entry has
      both null.
- [x] 2.2 `packages/schema/src/zero/phrases.ts:52` — `PhraseRegister` gains `'news'`.
- [x] 2.3 A `NEWS` register table beside `NEUTRAL` (`:96-121`) and `PERSONAL` (`:123-138`), total
      over `REST_PHRASE_KEYS` (`:33-48`). Drawn: the four keys in `URGENT` (`:79-84`) plus
      `review_returned`. Quiet: `merged_not_deployed`, `pr_approved`, `pr_draft`,
      `review_unreviewed`. Silent: the five `NEUTRAL` already silences. The quiet entries' words are
      `NEUTRAL`'s own — one source, not a copy.
- [x] 2.4 `restPhrase` (`:182-195`) resolves the third state and leaves `URGENT` and `SOURCED`
      (`:73-77`) untouched. `source` stays `text === null ? null : …`, so a quiet phrase carries no
      mark (D9) with no new branch.
- [x] 2.5 `NEUTRAL` and `PERSONAL` are **not edited**. Every key they resolve stays drawn or silent.
- [x] 2.6 `packages/schema/src/zero/phrases.test.ts:31-59` — keep the existing `neutral` silence
      assertion (`:53-58`) **character-for-character** as the proof the register did not move, and
      add a sibling over `news` pinning the drawn / quiet / silent sets separately, so a key drifting
      from quiet to silence fails rather than passing as "still not drawn". Extend `REGISTERS`
      (`:15`) to all three so the totality tests (`:32-51`) cover `news`.
- [x] 2.7 New test in the same file, and it is the gate: **no key is quiet and inkless at once.** For
      every key `news` resolves to quiet, the representative strip's `isQuietTrack`
      (`reality-track.tsx:221-227`) is false. If this ever fails, a row has gone silent in both
      channels.
- [x] 2.8 New test in the same file: the quiet and silent keys are **pairwise distinguishable** by
      their drawn stations. Without task 1.1 this fails on `pr_approved` versus
      `merged_not_deployed` — which is why it exists.
- [x] 2.9 `packages/schema/src/zero/phrases.test.ts:220-266` — the one-file guard runs on the same
      eight `DICTIONARY_STRINGS` (`:225-234`), unedited. No string is added, rewritten or deleted.
- [x] 2.10 `packages/schema/src/index.ts:683-688` — the type re-export block, where `PhraseRegister`
      (`:684`) and `RestPhrase` (`:685`) are the two widened names. The value re-exports
      (`:689-694`) need no edit.

## 3. The words move into the accessible name (D3)

- [x] 3.1 `packages/ui/src/components/reality-track.tsx:198-210` — `realityTrackLabel` takes the
      quiet words and leads the label with them, before the facts. Additive parameter; every
      existing call site keeps its meaning.
- [x] 3.2 The same function's contract: a caller hands over the register's words **only** where the
      register quieted them; words the register drew are never passed. The divergence sentence
      (`DIVERGENCE_LABEL`, `apps/web/src/issues/delivery.ts:35-39`) is a different sentence about a
      different aspect and keeps its place in the label — which is what `issue-list.tsx:618-621`,
      `project-page.tsx:611-614` and `board.tsx:761` already pass, and why they need no correction.
      `apps/web/src/home/team-home.tsx:791-793` is the shipped instinct — *"a screen reader should
      hear it once"* — and it stays as it is, stricter than this rule requires because it omits the
      divergence sentence as well.
- [x] 3.3 `packages/ui/src/components/reality-track.tsx:365-384` — the inkless branch is unchanged.
      Task 2.7 is what proves it never has to carry a quiet phrase.
- [x] 3.4 `packages/ui/src/components/reality-track.test.tsx` — new tests: a quiet phrase's words
      lead the label; a drawn phrase's words appear in it nowhere.
- [x] 3.5 **The one shipped violation of 3.2.** `apps/web/src/delivery/delivery-view.tsx:284` passes
      `peek.phrase` — the neutral register's words, drawn in visible bold one line below at `:286`
      by `PeekFact` — into the track's `role="img"` name, so the panel says
      `Done in git, not on the board` twice. Pass `DIVERGENCE_LABEL.status_behind_merge`
      (`apps/web/src/issues/delivery.ts:35-39`) instead, matching the three list-shaped surfaces;
      the peek's shape is already built with that divergence (`:256`), so the break keeps its
      sentence. The register does not change — the peek stays `neutral` (task 4.7) and its visible
      phrase is untouched. Found by auditing the rule against the code rather than assuming the
      product already obeyed it (design D3).

## 4. The three surfaces that speak `news` (D5)

- [x] 4.1 `apps/web/src/issues/delivery.ts:55-75` — `deliveryView` takes a `PhraseRegister`,
      defaulting to `'neutral'` (`:61`), so every caller not named below is unchanged by
      construction rather than by review. Its `DeliveryView.phrase` doc comment (`:25-26`) follows.
- [x] 4.2 `apps/web/src/issues/issue-list.tsx:609-620` — the row passes `'news'` and hands the
      phrase's `spoken` words to `realityTrackLabel`.
- [x] 4.3 `apps/web/src/projects/project-page.tsx:602-616` — the same, on the same `IssueRow`
      primitive.
- [x] 4.4 `apps/web/src/board/board.tsx:751-771` — `deliveryRender` passes `'news'`; `spoken`
      (`:764`) composes from the phrase's `spoken` rather than its `text`, so the card's explicit
      name (`:959`) carries the words whether they were drawn or quieted.
- [x] 4.5 `packages/ui/src/components/board-card.tsx:10` — `CARD_TRACK_WIDTH` grows by
      `AGE_COLUMN_WIDTH + 6` (`reality-track.tsx:332`) and `board.tsx:758-762` passes `age`, so the
      review age is drawn on the card rather than living only in a phrase the register quiets.
      Measure the labels row at 1440/6 before believing it fits — `board/spec.md` promises six
      readable columns there.
- [x] 4.6 `packages/ui/src/components/issue-row.tsx:51` — `PHRASE_SLOT_WIDTH` is **unchanged**. The
      longest surviving entry is still `Done in git, not on the board`, and the slot is reserved on
      every row (D7).
- [x] 4.7 The three `neutral` speakers are untouched and verified as such:
      `apps/web/src/cycles/cycles-view.tsx:492-495` and `:529-531` (no track on that row — D5),
      `apps/web/src/issues/issue-detail.tsx:1014` and `:1069` (B3's surface), and
      `packages/schema/src/zero/metrics/page.ts:1176` (classifies `status_behind_merge` only). The
      peek's **register** is what is untouched here; its track's accessible name is corrected by
      task 3.5, which is a different question.
- [x] 4.8 `packages/schema/src/zero/team-home.ts:882` keeps `'personal'`. Home's YOURS band is out
      of scope and the register is not edited — D6.

## 5. Roadmap: the note goes quiet and the label stops lying (D8)

- [x] 5.1 `apps/web/src/projects/roadmap-view.tsx:644-649` — `emptyNote` drops its third branch
      (`:647`). `No issues yet` (`:645`) and `Nothing scheduled` (`:646`) are unchanged; the second
      is required by `openspec/specs/projects/spec.md:186-189`.
- [x] 5.2 `apps/web/src/projects/roadmap-view.tsx:658-671` — `schedulePhrase` gains the branch it is
      missing: a row with `scheduledCount > 0` and no marks says its work is scheduled beyond the
      drawn window. Today `:668` announces `no issues scheduled in a cycle` for exactly that row,
      which is false by construction.
- [x] 5.3 `apps/web/src/projects/roadmap-view.test.tsx:177` asserts `Nothing scheduled` and is
      **unedited** — the branch that survives.
- [x] 5.4 New tests in the same file: a row whose issues sit in cycles outside the window draws no
      note, and its `rowLabel` (`:674-690`) says the work is scheduled beyond the window rather than
      denying it exists.

## 6. Tests over the surfaces, and the three suites that must not move (D10)

- [x] 6.1 `apps/web/src/issues/issue-list.test.tsx:202-214` — the phrase test splits. Kept and drawn:
      `Checks failing` (`:209`) and `Done in git, not on the board` (`:210-212`). Now quiet:
      `Built — not live yet` (`:213`) and `In review — waiting 16h` (`:214`) — each asserted as
      **absent from the row and present in the track's accessible name**, both halves in one test.
- [x] 6.2 `apps/web/src/issues/issue-list.test.tsx:230-251` — the provenance test. `Address
      autocomplete on shipping step` (`checks_failing`) keeps its GitHub mark (`:241`); `Persist
      cart across sessions` (`merged_not_deployed`) has no phrase for a mark to follow, so `:242`
      inverts to `false` and gains the reason beside it (D9). `:244-245` are unchanged in outcome —
      the divergence row still draws a phrase with no mark, and the review row is now quiet, so
      neither is marked. The status-arc assertion (`:248-250`) is unchanged.
- [x] 6.3 `apps/web/src/issues/issue-list.test.tsx:217-228` (a quiet row renders no phrase, slot
      still reserved) and `:253-259` (the divergent row shows its phrase and its `//` break) are
      **unedited** — the first is the reserved-measure guarantee, the second the exception that
      keeps its words.
- [x] 6.4 New test in `issue-list.test.tsx`: an approved row and a merged-not-deployed row are both
      silent **and** draw different tracks — the surface-level form of task 2.8.
- [x] 6.5 `apps/web/src/board/board.test.tsx:225` and `:252` — the divergence card keeps its phrase
      and its name; add a card whose key is quiet, asserting no phrase line and the words in the
      card's `aria-label`.
- [x] 6.6 `apps/web/src/projects/project-page.test.tsx:278` asserts a linked row's phrase contains
      `Checks failing` — an exception key, so it stays green. Add the quiet case beside it.
- [x] 6.7 **Run unedited, and report them as the proof `neutral` and `personal` did not move:**
      `packages/ui/src/components/rest-phrase.test.tsx` (all four tests, every one calling
      `restPhrase(…, 'neutral')` — `:9`, `:24`, `:31`, `:36`);
      `apps/web/src/issues/timeline-view.test.ts:167-198` (reads `deliveryView`'s default register
      and pins `/^In review — waiting /` at `:177`);
      `packages/schema/src/zero/team-home.test.ts:453` and `:502` (the personal register's strings).
- [ ] 6.8 **No e2e spec is edited.** `apps/web/e2e/connectors.spec.ts:10` pins
      `Done in git, not on the board` and asserts it at `:104` and `:155` on the issue detail's
      `divergence-pill` — a `neutral` surface and an exception key. Run the suite and confirm rather
      than assume.
- [x] 6.9 PROCESS.md §3's big-feature rule: this change touches no synced entity, no mutator and no
      permission surface — one of four axes, so unit + integration only. **No e2e spec is added.**
- [x] 6.10 `apps/web/src/delivery/delivery-view.test.tsx:388-410` — the peek test gains the second
      half of what it already claims to check (task 3.5): the panel's track name states the facts
      and does **not** contain the phrase drawn at `:286`. Its existing
      `getByRole('img', { name: /PR merged/ })` (`:401`) matches the facts rather than the phrase,
      so it stays green unedited — confirm that rather than assume it.

## 7. Documentation

- [x] 7.1 `apps/docs/src/content/docs/features/issue-list.md:49-60` — the phrase table gains a
      *drawn / spoken* column. `:44-46` already claims the rule (*"or one whose delivery state adds
      nothing the track has not already drawn, stays genuinely blank"*) and becomes true rather than
      aspirational.
- [x] 7.2 `apps/docs/src/content/docs/features/issue-list.md:70-73` — "two voices" becomes three,
      and names which surfaces speak which.
- [x] 7.3 `apps/docs/src/content/docs/features/reality-vocabulary.md:244-262` — the register table
      and the paragraph at `:256-258` (*"a register may resolve a key to silence"*) carry the third
      state and the rule that quiet words are spoken by the drawing.
- [x] 7.4 `apps/docs/src/content/docs/features/reality-vocabulary.md:264-270` — the accessibility
      section states the node-shape rule beside the contrast bars.
- [x] 7.5 `apps/docs/src/content/docs/features/board.md:52-59` — the card's phrase, its name, and
      the age column it now draws.
- [x] 7.6 `apps/docs/src/content/docs/features/projects.md:141-142` — two roadmap notes, not three,
      and what the absence of a note means.
- [x] 7.7 `apps/docs/src/content/docs/features/delivery-signals.md:130-137` — the phrase column is
      the `neutral` register's; say so, and point at the list page for what a row actually draws.
- [x] 7.8 Root docs: grep the **quieted strings** across `*.md` (`grep -rn "Built — not live yet"`
      and the other three), not the changed files — a phrase that stops being drawn makes stale
      every doc that quoted it as rendered prose. This is B1's recorded lesson
      (`explanation-at-rest/design.md`, *"Task 9.5's premise was wrong about README"*), applied
      before the fact instead of after it.
- [x] 7.9 `pnpm --filter @yapm/docs build`.

## 8. The ROADMAP amendment, for whoever integrates

- [x] 8.1 **This change does not edit `ROADMAP.md`.** Sibling proposals in this family are authored
      in parallel and that file is the guaranteed conflict, so the row and the amendment are taken
      once by the integrator (`SCOPE-legibility.md:190-192`). The wording is drafted here so it is
      not invented later.
- [ ] 8.2 `ROADMAP.md:94` §Differentiation commitments, first bullet — replace *"and **says** it, in
      words from one shared phrase dictionary (`Checks failing`, `Done in git, not on the board`,
      `Built — not live yet`)"* with a clause that says the row draws its signal always and **says**
      it when the signal is news — an exception the reader has to act on — carrying the dictionary's
      words in the drawing's accessible name otherwise, so the row is never quieter to a screen
      reader than to an eye. Keep the sentence's tail about the genuinely blank unlinked row: this
      change strengthens it rather than replacing it.
- [x] 8.3 The `phrase-is-news` row joins `ROADMAP.md` alongside rows 46 (`front-door`) and 47
      (`explanation-at-rest`), status flipped at archive time rather than added twice.

## 9. Verification

- [ ] 9.1 `pnpm turbo lint typecheck test build`.
- [x] 9.2 `pnpm turbo check-boundaries` — `packages/schema` gains no UI dependency; the register is
      a dictionary property, not a component one.
- [ ] 9.3 Run the Playwright e2e suite with **no spec edited** (task 6.8) and report where it ran.
      CI is the harness of record (PROCESS.md §4).
- [x] 9.4 Report every gate with its actual output. A gate not run is reported as not run.
- [x] 9.5 `npx -y @fission-ai/openspec@latest validate --all` — green, item count grown by one.
- [x] 9.6 **Pre-archive, and `validate --all` cannot do it for you (PROCESS.md §1).** Re-run
      `grep -rl "Requirement: <name>" openspec/changes/*/specs/` for all eight requirement names
      this change restates — board 1, projects 2, issue-list 2, reality-vocabulary 3. At authoring time none was claimed by `explanation-at-rest`,
      `front-door`, `destination-budget`, `decision-record`, `config-wait` or `delivery-legibility`,
      so this change imposes **no archive order**. If a later sibling claims one, write the union
      and record the order here before archiving — a `## MODIFIED Requirements` block replaces the
      whole requirement, and whoever archives last wins silently.

## 10. Looked at, not reasoned about

- [ ] 10.1 The issue list at 1440×900, seeded Engineering team, **default lens** — the lens
      `front-door` shipped. Does a phrase column drawn on two rows of seven read as calm, or as
      broken? This is the judgement the whole family is ultimately measured on and no assertion
      settles it. Record what looking found, including if it looks worse.
- [ ] 10.2 The same list with the status axis cleared, which is where the scope's nine consecutive
      `Built — not live yet` rows actually live after `front-door` (design D7).
- [ ] 10.3 The six node kinds at 7px on a dense row, light and dark, all three presets: are they six
      to the eye, or four and two guesses? Task 1.2's assignment is a proposal and this is what
      decides it.
- [ ] 10.4 The same, with a colour filter over the page: can every station still be named?
- [ ] 10.5 A screen reader over one quiet row and one exception row on the list, and over both on
      the board: the quiet row's words are heard once and the exception row's are not heard twice.
      Then the same over Delivery's open divergence peek (task 3.5), which says the phrase twice
      today — the reason that surface is in this change at all.
- [ ] 10.6 The board at 1440 after task 4.5's widening — six columns, no horizontal scroll, and the
      card's labels row not shoved off its own card.
- [ ] 10.7 The roadmap with the note gone from ten of ten rows. Does the axis read as scheduled work
      somewhere else, or as an empty roadmap? If the second, that is the finding and it belongs in
      design.md before anyone works around it.
