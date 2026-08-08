## 1. Read the rulebook and the shipped code first

- [x] 1.1 Read `design-explorations/overhaul-2026-08/northstar/issues.html` (the row markup: a quiet row carries **no** `.track` and no `.t-age` element; ENG-115 and ENG-119 show that a *partially* populated track still draws `tn empty` and `tseg dotted`), plus `issues.png`, `issue.html`, `delivery.html`, `home-digest-2.html` and `ia.html`'s band-3 drawing
- [x] 1.2 Read `NORTHSTAR.md` — §"Consistency check" (the statusline is byte-identical across all five files and ends `· Synced`), the `issues.html` self-critique ("quiet rows stay truly blank"), and §"What the build kept, and the two places it had to diverge (PR #33)", which is the form correction 4's divergence note must take
- [x] 1.3 Read `reference/tailwind.md` for Tailwind 4.3 arbitrary-value and token syntax; `reference/zero.md` only to confirm nothing here goes near sync (Zero 1.x is `defineQuery`/`defineMutator`/`createBuilder` — this change writes none of them)
- [x] 1.4 Read `packages/ui/src/components/{reality-track,status-glyph,priority-mark,issue-row,board-card,drawn}.tsx` and `reality-track.test.tsx`; confirm for yourself that `issue-list.tsx` always passes `realityTrack` and therefore never reaches `issue-row.tsx`'s `EmptyRealityTrack` fallback
- [x] 1.5 Read `packages/ui/src/styles/globals.css` (all six token blocks) and `contrast.test.ts` end to end — especially the `--status-urgent` / `--status-urgent-ink` split and the `records the added cap's tint as reinforcement` assertion this change replaces
- [x] 1.6 Read `apps/web/src/zero/connection.ts`, `apps/web/src/frame/{statusline,sync-indicator}.tsx`, `apps/web/src/issues/issue-list.tsx` §row rendering, `apps/web/src/home/team-home.tsx` §attention rows and §YOURS rows
- [x] 1.7 Read this change's `design.md` in full. D1, D2, D4 and D6 are decisions already made; implement them or argue with them in §"Decisions made during implementation", never silently

## 2. Correction 1 — a fact-free track draws no ink

- [x] 2.1 `reality-track.tsx`: export a predicate over a `TrackShape` that is true when every station is `empty` and no segment is `broken` (design D1). One implementation, named, so a test asserts the rule rather than restating it
- [x] 2.2 `HorizontalTrack`: when that predicate holds, render the reserved outer span with its `width` and its `data-slot="reality-track"`, plus `data-quiet` — and no station, no segment, no break and no age text inside it. When the surface draws an age column (`age !== undefined`), keep the reserved age child but leave it empty, so the measure is identical (design D3)
- [x] 2.3 The quiet slot is `aria-hidden`, carries no `role="img"` and no `aria-label` (design D2). `realityTrackLabel(null)` is **unchanged** — it still returns "No delivery signal yet" for surfaces that state the absence in words
- [x] 2.4 Verify by reading, and record what you found: `issue-list.tsx`, `team-home.tsx` (YOURS rows and the divergence attention row) and `board-card.tsx` need **no** edit, because all three already route through this component. If any does need one, that is a fact for `design.md`
- [x] 2.5 Confirm the vertical rail is untouched. `VerticalRail` gets no predicate, no `data-quiet`, no branch — the issue detail keeps its explicit unlinked station

## 3. Correction 2 — `done` is a filled disc carrying a check

- [x] 3.1 `status-glyph.tsx`: `done` draws the filled disc plus a check path on the same 20-unit grid, round-capped, from the shared stroke constant. The check's ink is `var(--bg)` as a knockout (design D4) — a token, never a literal
- [x] 3.2 Replace the file's comment that argues the check away with the constraint the code cannot express: the check must stay legible at the smallest rendered size, and its ink must clear the non-text bar against every hue the glyph is inked with
- [ ] 3.3 Check legibility at the dense-row size (`size-3.5`, 14px) in the showcase route across all six theme blocks. If the shared 1.6px stroke is illegible there, step the check's stroke up by one value and record the exact value and the reason in `design.md` §"Decisions made during implementation" (design D4) *(stroke held at the shared 1.6 with the ratio argument in §DI-6; the eyes-on step across six presets is still owed)*
- [x] 3.4 `canceled`, `backlog`, `todo`, `in-progress` and `in-review` are unchanged. Confirm by diff, not by memory

## 4. Correction 3 — the connected state says `Synced`

- [x] 4.1 `apps/web/src/zero/connection.ts`: the `connected` case's `label` becomes `'Synced'`. No other case changes, and `sync-indicator.tsx` is not edited at all (design D5)
- [x] 4.2 Confirm by grep that `data-testid="connection-status"`, `data-connection`, `data-recovery` and the retry affordance are byte-identical, and that no e2e spec reads the label text

## 5. Correction 4 — retune `--status-in-progress`, and split the ink

- [x] 5.1 Re-take the baseline measurement yourself with the same maths `contrast.test.ts` uses, and write the six numbers into `design.md` §"Decisions made during implementation". Do not trust the table in §Context without reproducing it
- [x] 5.2 Enumerate every usage of `--status-in-progress` in the product and classify each as non-text drawing or text-sized ink (design D6 has the list — verify it, it is a starting point, not an authority)
- [x] 5.3 `globals.css`: retune `--status-in-progress` in `[data-theme="warm"]`, `[data-theme="focused"]` and `[data-theme="editorial"]` (the three light blocks) until it clears **3:1** against `--bg`, staying recognisably amber and staying clearly apart from `--status-done` and `--status-urgent`. Measure the darks and change them only if a measurement says to
- [x] 5.4 `globals.css`: add `--status-in-progress-ink`, clearing **4.5:1** against `--bg` and against every composited ground amber text is drawn on, in all six blocks. In the darks it may alias `--status-in-progress` if measurement allows — exactly as `--status-urgent-ink` does. Register it in the `@theme` block beside `--color-status-urgent-ink`
- [x] 5.5 Point the one normal-size text usage at the new ink: `drawn.tsx` §ScopeBand's 9px bold `+`. Leave every non-text usage on `--status-in-progress`
- [ ] 5.6 Look at the delivery charts once after the retune — `--chart-1` aliases this token (design D6 risk). Record what you saw *(measured in design.md §DI-5 — ribbon, ribbon outline and added-block outline all re-measured and recorded; eyes-on confirmation is 8.4)*
- [x] 5.7 `NORTHSTAR.md`: append a third entry to §"What the build kept, and the two places it had to diverge", naming the amber, the measured numbers before and after, and why accessibility beat the mock. Update that section's heading and its "two divergences" wording so the file counts correctly

## 6. Tests

- [x] 6.1 `contrast.test.ts`: **replace** the `records the added cap's tint as reinforcement` assertion (`>= 2.1` amber-vs-`--bg`, `>= 1.3` amber-vs-`--status-done`) with real bars — `--status-in-progress` at `>= 3.0` against `--bg` in all six blocks, and `--status-in-progress-ink` at `>= 4.5` against `--bg` and each ground the amber `+` is drawn on. Keep the amber-vs-green measurement as a **recorded lower bound with its reason** (two quantities must be two shapes at any contrast), because it is why the flow band's added cap is an outline
- [x] 6.2 `contrast.test.ts`: assert the done glyph's check ink clears `>= 3.0` against `--status-done` **and** against `--status-urgent` (the glyph is inked urgent on the digest's urgent say rows), in all six blocks
- [x] 6.3 `contrast.test.ts`: assert the retuned amber stays separated from `--status-done` and `--status-urgent` by a stated numeric bound, so a later retune cannot quietly make the three statuses confusable
- [x] 6.4 `reality-track.test.tsx`: the quiet predicate is true for `buildRealityShape(null)` and false for every shape carrying any fact or a break — including a strip whose only fact is a draft PR
- [x] 6.5 `reality-track.test.tsx`: a quiet track renders no node, no segment, no break and no age text, and is not exposed with `role="img"` or an accessible label
- [x] 6.6 `reality-track.test.tsx`: **keep and strengthen** the existing width-parity test — a quiet track and a fully populated one at the same measure report the same reserved width and the same age-column width. This is the alignment guarantee; it may not be weakened
- [x] 6.7 `reality-track.test.tsx`: a partially populated track (PR open, no deployment) still draws its empty stations and dotted segments
- [x] 6.8 New `status-glyph.test.tsx`: `done` renders both the disc and a check path; the check is drawn with round caps on the 20-unit grid; its stroke resolves from a token and not a literal colour; every one of the six statuses still carries its accessible label
- [x] 6.9 `apps/web/src/frame/sync-indicator.test.tsx` and `apps/web/src/zero/connection.test.ts`: the connected state reads `Synced`, and each other state's wording is asserted unchanged. Update the `label: 'Connected'` fixtures in `search-view.test.tsx`, `use-server-search.test.tsx` and `issues/command.test.tsx` so the stubs describe the product
- [x] 6.10 `apps/web/e2e/issues.spec.ts`: the assertion that a newly created row shows `getByLabel('No delivery signal yet')` becomes an assertion that the row's reality slot is present, quiet and reserved. Derive any width bound from the page — never hard-code one, and never encode fixture size
- [x] 6.11 `apps/web/e2e/connectors.spec.ts`: the two `getByLabel('No delivery signal yet')` count-0 assertions would become vacuous; rewrite them to assert the quiet marker is **absent** on the populated row, so they still fail if the track stops populating
- [x] 6.12 Grep the whole repo for any other test or story asserting the empty nodes, the plain done disc, or the word `Connected` as a label, and update each to the new truth. Never weaken an assertion to make it pass

## 7. Documentation

- [x] 7.1 `apps/docs/src/content/docs/features/reality-vocabulary.md`: §"An issue with no linked activity still draws the track — four empty stations…" becomes the new behaviour (reserved measure, no ink, silent to assistive tech, and the rail's deliberate exception); the `| Done | A filled disc |` row becomes the disc with a check; §"Each station is a node" keeps its four shapes, which are unchanged
- [x] 7.2 `apps/docs/src/content/docs/features/delivery-signals.md`: "the track draws four empty stations and…" becomes the reserved-but-blank behaviour
- [x] 7.3 `apps/docs/src/content/docs/self-hosting/sync-recovery.md`: the state table's `**Connected**` row becomes `**Synced**`. The other five rows do not move
- [x] 7.4 `apps/docs/src/content/docs/features/{issue-list,team-home,app-frame,board}.md`: read each for a claim this change makes stale, and fix what you find. Report explicitly if nothing needed changing
- [x] 7.5 Root docs sweep — `README.md`, `ROADMAP.md`, `DESIGN.md`, `TECHSTACK.md`, `.env.example`: confirm none makes a claim this change falsifies, and say so in the PR description
- [x] 7.6 `NORTHSTAR.md`'s divergence entry (task 5.7) is documentation too — verify it is written before calling this group done

## 8. Verification

- [ ] 8.1 `pnpm turbo lint typecheck test build` — report the actual output, never a claim
- [ ] 8.2 The compose smoke test
- [ ] 8.3 The full Playwright e2e suite. `apps/web/e2e/projects.spec.ts` has known timeout flake independent of this change: re-run before diagnosing, and do not loosen it
- [ ] 8.4 Open the showcase route and step every one of the six theme blocks: the done glyph's check, a quiet issue row, a populated row beside it, the retuned amber on the status glyph, the attention square and the delivery charts
- [x] 8.5 Confirm the constraints by inspection and say so: no new table, query, mutator or migration; no new container; every colour from a token; nothing added to the keyboard path; no new network wait on any interaction
- [ ] 8.6 Fill in `design.md` §"Decisions made during implementation" with every call made along the way, and check that every task box above is honestly ticked
