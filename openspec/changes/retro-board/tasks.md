# retro-board — tasks

Sequenced so the app runs after every task. The anonymity boundary (group 1–2) is designed and proven **before** any UI exists.

## 1. Schema: entities, the anonymity boundary, and the carryover facts

- [x] 1.1 Migration `0012_retro`: `retro` (unique `cycle_id`), `retro_column`, `retro_draft`, `retro_card`, `retro_group`, `retro_vote`, `retro_vote_tally` (PK = target id), `retro_action`, `retro_presence` (PK `retro_id`+`user_id`), the **server-only** `retro_card_author`, plus `issue.carryover_count` (not null, default 0) and `issue.cycle_assigned_at` (nullable), with the FK + lookup indexes the synced queries need
- [x] 1.2 `RETRO_PHASES`/`RetroPhase`, `RETRO_FORMATS` (`wentwell_didnt_action` default, `start_stop_continue`, `mad_sad_glad`, `4ls`) and `RETRO_VOTE_TARGETS` in `zero/context.ts`; every retro table + the two `issue` columns in the Kysely `DB` interface — `retro_card_author` in the `DB` interface but **not** in the Zero schema
- [x] 1.3 Zero schema: the nine synced retro tables + relationships (team↔retros, retro↔columns/cards/groups/actions/presence, card↔group, action↔issue), `issue.carryoverCount`/`issue.cycleAssignedAt`; `retro_card_author` deliberately absent
- [x] 1.4 Extend the schema-drift test: every new table/column, and `retro_card_author` added to the server-only Zero-exclusion assertion; verify against live Postgres
- [x] 1.5 Seed a demo retro on the seeded completed cycle (columns, a few published cards, a group, tallies, one action) so the surface has content on first run

## 2. Pure logic + mutators + queries (packages/schema)

- [x] 2.1 `retro/phase.ts`: the ordered phase list, `isAdjacentPhase`, `isRetroWriteAllowed(phase, op)` write matrix, and the format→column template map + unit tests (exhaustive over phase × operation)
- [x] 2.2 `retro.openForCycle` (call-site-minted retro + column ids, columns validated against the named format, no-op when the cycle already has a retro), `retro.configure` (format/anonymity/budget — `brainstorm` only), `retro.delete`, `retro.claimFacilitator`, `retro.setFacilitator` + unit tests
- [x] 2.3 `retro.setPhase` — adjacent-only, facilitator/admin only, `closed_at` stamped/cleared + unit tests for every illegal transition
- [x] 2.4 Draft mutators (`retroDraft.create/update/delete`, `brainstorm`-only, author from `ctx`) and the **server-only publish**: `retro.setPhase` server override publishes unpublished drafts into `retro_card` reusing the draft id, writes `retro_card_author` via the wrapped Kysely transaction, sets `author_display_id` only when the retro is not anonymous; idempotent + unit tests
- [x] 2.5 Card/group mutators: `retroCard.move` (single-write rank + group ref, rank computed at the call site), `retroGroup.create/label/dissolve`, `retroCard.delete` (facilitator/admin, authorized against `retro_card_author`) + unit tests reusing the existing rank helpers
- [x] 2.6 Vote mutators: `retroVote.cast/retract` — budget counted from the caller's own rows, stacking allowed, grouped-card target rejected, `retro_vote_tally` upserted by target id + unit tests for budget and target rules
- [x] 2.7 `retroAction.create/update/delete` and `retro.convertActionToIssue` (call-site-minted issue id, calls the shared `issue.create` mutator fn, phase ∈ discuss/actions/closed, idempotent when already converted) + its server override claiming the per-team issue number + unit tests
- [x] 2.8 `retro.startTimer/stopTimer` (facilitator/admin; server override recomputes `timer_ends_at` from the server clock) and `retroPresence.heartbeat` (self-write from `ctx`) + unit tests
- [x] 2.9 Extend `cycle.complete` to increment `carryover_count` and stamp `cycle_assigned_at` on each rolled issue (args-derived, idempotent); stamp `cycle_assigned_at` in `issue.create` and `issue.setCycle` + unit tests
- [x] 2.10 Synced queries: `retros.byTeam`, `retros.detail` (columns, cards, groups, tallies, actions→issue, presence — team-scoped), `retroDrafts.mine` and `retroVotes.mine` (**bare `ctx.userID` filter, no `teamScoped`, no admin bypass**, with the deviation commented), all denied by empty query otherwise; export the new surface
- [x] 2.11 `retro/seed.ts`: `buildRetroSeed` — Delivered from cycles alone (shipped / carried out / carried in / carried twice or more / added mid-cycle / canceled / total + trend against up to three prior cycles), Flow from linked PRs/reviews/checks (median PR cycle time, median time-to-first-review, review rounds, issues with no linked PR, CI failing rate), no Health section; blameless caption templates + unit tests including a **no-identity-dimension** structural assertion

## 3. Auto-open + presence pruning on the existing pg-boss pass (apps/server)

- [ ] 3.1 `runCycleMaintenance`: after each `cycle.complete`, mint the retro + column ids in the job and call `retro.openForCycle`; idempotent against the deliberate action
- [ ] 3.2 Prune `retro_presence` rows older than the heartbeat window in the same pass; no new job type and no new env var
- [ ] 3.3 Live-Postgres integration test: scheduled completion opens exactly one retro, a second pass changes nothing, stale presence is pruned

## 4. Retro surface (apps/web)

- [ ] 4.1 `/teams/$teamId/retros` and `/teams/$teamId/retros/$retroId` routes + the retro shell: phase stepper, facilitator controls, timer, presence — all token-driven
- [ ] 4.2 The board: columns, the brainstorm composer over drafts, published cards, drag grouping via dnd-kit reusing the board's single-write move, vote pips from the synced tally with a live remaining-budget readout
- [ ] 4.3 The data-seed panel: Delivered always, Flow when delivery data exists (quiet named empty state otherwise), sparkline trends, blameless captions, and "add a card from this widget" seeding a draft with its evidence ref
- [ ] 4.4 The actions list: create/assign/target-cycle, convert to issue, and the converted issue's live status rendered with the existing status tokens
- [ ] 4.5 Keyboard model + command palette: `c`, `Enter`, arrows, `v`/`Shift+V`, `g`, `a`, `⌘/Ctrl+Enter`, `]`/`[`, `t`, `Esc` — every action also a palette entry; affordances driven by the shared `isRetroWriteAllowed`
- [ ] 4.6 Entry points: a Retros entry in the view switch and a link from a completed cycle in the Cycles view

## 5. Tests

- [x] 5.0 Live-Postgres mutator harness (`zero/testing/pg-transaction.ts`, excluded from the build): a real authoritative `Transaction` over a Kysely transaction — ZQL AST compiled to SQL, writes written through, `dbTransaction.wrappedTransaction` for the server-only writes — so a mutator reads its own writes. `mutators.retro.pg.test.ts` on top of it: group/card/vote consistency after every write, the phase machine, publish idempotency and attribution, budget and target rules, delete authority, action→issue. The stubbed unit transaction now throws on an unstubbed read instead of answering `undefined` (see design.md D-14)
- [ ] 5.1 Unit (Vitest, no DB): phase machine + write matrix, format templates, publish mapping, vote budget/target rules, rank moves, `buildRetroSeed` + captions + the no-identity assertion, web-side retro model
- [ ] 5.2 Integration (live Postgres + zero-cache) — **the anonymity proof**: enumerate every query in the registry, evaluate each with a non-author member's context (including a workspace admin), and assert no result yields an anonymous card's author; assert drafts and votes never cross users
- [ ] 5.3 Integration: migration + drift (new tables/columns + `retro_card_author` exclusion — done in 1.4), phase enforcement end-to-end against the server mutators (skip, rewind, non-facilitator, write-in-wrong-phase — done in 5.0), publish idempotency (done in 5.0); still open: **vote budget under concurrency**
- [ ] 5.4 Integration: `convertActionToIssue` creates a numbered issue in the next cycle through the shared create path, is idempotent, and is rejected for a viewer (done in 5.0); still open: `carryover_count`/`cycle_assigned_at` across two consecutive rollovers
- [ ] 5.5 E2E (Playwright, real 3-container stack): two clients — brainstorm privacy then reveal on advance; a full keyboard-only retro (capture → group → vote → action → convert → close); anonymity verified from the second client's synced state; theme correctness across the three presets in light and dark

## 6. Documentation

- [ ] 6.1 `apps/docs` **Retrospectives** feature page: phases, the storage-layer anonymity guarantee, the data panel and how it degrades without connectors, the action→issue loop, the keyboard map; sidebar entry + home link; `pnpm --filter @yapm/docs build` passes
- [ ] 6.2 Root docs: README (status + feature list), ROADMAP (the `retro-board` row + Phase-2 status). Confirm `.env.example` and TECHSTACK need no change (no new env var, no new dependency) and say so in the PR

## 7. Gates

- [ ] 7.1 `pnpm turbo lint typecheck test build` green; boundaries check passes (no ZQL or mutators outside `packages/schema`)
- [ ] 7.2 Compose smoke test + the CI e2e job green on a fresh stack
