## 1. Schema and migration

- [x] 1.1 Add `RETRO_REACTION_VALUES` (`agree | disagree`), `RETRO_PROPOSAL_VERDICTS`
      (`agreed | contested | rejected | unrated`) and their CHECK-constraint strings to
      `packages/schema/src/zero/context.ts`, following the `AI_ARTIFACT_STATUS_CHECK` precedent — a
      plain string, no kysely import, so the migration and the TypeScript union cannot drift.
- [x] 1.2 Write `packages/schema/src/migrations/0020_retro_ratification.ts`: create
      `retro_ai_reaction` (`proposal_id` uuid FK cascade, `user_id` text with no FK per the
      `retro_presence` precedent, `retro_id` uuid FK cascade, `team_id` uuid FK cascade, `value`
      text with CHECK, `created_at`, `updated_at`, PK `(proposal_id, user_id)`, indexes on
      `retro_id` and `team_id`); add nullable `verdict` (CHECK), `agree_count`, `disagree_count`,
      `ratified_at` to `retro_ai_proposal`; add `retro_action.ai_proposal_id` uuid referencing
      `retro_ai_proposal(id)` **on delete set null**. Register it in `migrations/index.ts`.
- [x] 1.3 Extend the hand-written Kysely `DB` interface in `packages/schema/src/db/types.ts` with
      `RetroAiReactionTable` and the new columns on `RetroAiProposalTable` and `RetroActionTable`.
- [x] 1.4 Add the `retro_ai_reaction` table to the Zero schema in
      `packages/schema/src/zero/schema.ts` with the compound primary key, and add the four
      written-once columns to `retroAiProposal` and `ai_proposal_id` to `retroAction`.
- [ ] 1.5 Apply the migration against the live dev stack (ports 5443/4851/3003, project `yapm-rr`)
      from `down -v` with zero-cache **running**, and confirm from the change-streamer log that both
      the new table and the altered columns reach the replica. Record the evidence in `design.md`
      under `## Decisions made during implementation`.

## 2. The write op, the verdict rule and the reaction mutators

- [x] 2.1 Add `'react'` to `RETRO_WRITE_OPS` with `ALLOWED_PHASES.react = ['group', 'vote']` in
      `packages/schema/src/zero/retro/phase.ts`. Change nothing else in that file.
- [x] 2.2 Write `packages/schema/src/zero/retro/ratify.ts`: the pure `retroProposalVerdict(agree,
      disagree)` implementing design §D3, and a pure contested-first comparator over proposal rows.
      No I/O, no ZQL.
- [x] 2.3 Add `setRetroAiReaction` and `clearRetroAiReaction` to
      `packages/schema/src/zero/mutators.ts` in the prologue order of design §D7 — `canWrite` first,
      before any read; then the proposal load; then `loadRetroForWrite(..., 'react', ...)`. The user
      component comes from `ctx.userID`, never from an argument; `retro_id`/`team_id` are
      denormalized from the loaded rows. Register both in the client mutator map and export their
      mutator-name constants.
- [x] 2.4 Add the optional `aiProposalId` to `createRetroActionArgs`, validated to name a proposal in
      the same retro, defaulting to null. Do not touch `convertRetroActionToIssue`.
- [x] 2.5 Add `queries.retroAiReactions.mine({ retroId })` to `packages/schema/src/zero/queries.ts`
      — self-filtered on `ctx.userID` behind `isMember`, denying by empty query, carrying the
      explicit no-admin-bypass deviation comment in the same words as `retroDrafts.mine` (~:244) and
      `retroVotes.mine` (~:313).
- [x] 2.6 Export the new types, constants, query and mutator names from `packages/schema/src/index.ts`.

## 3. Ratification at the phase advance

- [x] 3.1 Write the server-only helpers beside change 18's `ai-draft-writes.ts`:
      `ratifyRetroAiProposals(tx, retroId, at)` — one read of every reaction row for the retro, a
      TypeScript tally, the pure verdict function, one `tx.mutate.retro_ai_proposal.update` per
      proposal — and `clearRetroAiVerdicts(tx, retroId)`. Neither is ever registered in the client
      mutator map. **No counter is written anywhere on the reaction path.**
- [x] 3.2 Wire both into the existing `retro.setPhase` override in
      `packages/schema/src/zero/server-mutators.ts`: `vote → discuss` ratifies, `discuss → vote`
      clears. Both are server-location-only and both no-op when the retro has no draft. Leave the
      `brainstorm → group` and `group → brainstorm` branches untouched.

## 4. The ratification surface

- [x] 4.1 Add the reaction controls to `apps/web/src/retro/retro-ai-panel.tsx`: two `aria-pressed`
      toggle buttons per proposal, rendered only when `retroCan(phase, 'react', { canWrite })`,
      reflecting **only** the caller's own reaction from `queries.retroAiReactions.mine`. Toggling
      the pressed value clears it. No count and no other member's state is rendered before the
      stamp.
- [x] 4.2 Add the verdict display from `discuss` onward — a tokenized badge plus the agree/disagree
      counts with no per-person dimension — and apply the contested-first comparator from §2.2. Keep
      the "AI-drafted, not agreed" line while the verdict is absent.
- [x] 4.3 Add the one-keystroke "add as action" control on an agreed improvement, calling
      `retroAction.create` with `aiProposalId` and **no assignee**, and thread it through
      `apps/web/src/retro/api.ts`.
- [x] 4.4 Thread the retro phase into `RetroAiPanel` from `apps/web/src/retro/retro-view.tsx`, and
      add the command-palette entries (agree / disagree / clear my reaction / add this improvement as
      an action) in `apps/web/src/retro/retro-command.tsx`, acting on the focused proposal via the
      existing `onFocusCapture` last-focused-element pattern.
- [x] 4.5 Verify every new control is reachable and operable with the keyboard alone, that every
      colour and font comes from a semantic token, and that the surface is AA-contrast in Warm,
      Focused and Editorial in both light and dark.

## 5. Tests

- [x] 5.1 Unit: `ratify.test.ts` — the verdict function over the full table of (agree, disagree)
      pairs including 0/0, 1/0, 0/1, 4/1, 2/3, 3/3; and the contested-first comparator's stability
      within the non-contested tail.
- [x] 5.2 Unit: the reaction mutators — **a viewer's call is rejected before any existence check**
      (assert with a proposal id that does not exist, and assert the error is indistinguishable from
      the same call against a real id and that no row was read); a reaction in `discuss` is rejected
      with the phase error; the user component comes from `ctx`, not from an argument.
- [x] 5.3 Unit: `createRetroAction` with `aiProposalId` — a proposal from another retro is rejected;
      the created action's `assigneeId` is null.
- [x] 5.4 Integration (pg): **two concurrent reactions on one proposal, then `vote → discuss`** —
      the stored counts and verdict match a hand-count of the reaction rows, and a recorded-statement
      assertion proves no `UPDATE ... SET count = count ± 1`-shaped write occurred on the reaction
      path and that no counter column exists on either table.
- [x] 5.5 Integration (pg): **a member's reaction row never reaches another member and never reaches
      a workspace admin** — evaluate `retroAiReactions.mine` as the author, as a second team member,
      and as a workspace admin, asserting the admin case explicitly (the no-admin-bypass deviation),
      plus an unauthenticated/non-member empty result.
- [x] 5.6 Integration (pg): **a converted improvement's issue has a NULL assignee** — create an
      action from an agreed improvement, convert it, assert the issue row's `assignee_id` is null and
      that its per-team number was server-assigned.
- [x] 5.7 Integration (pg): stepping back `discuss → vote` clears verdict, counts and stamp while
      every reaction row survives; advancing again recomputes including a reaction added in between.
- [x] 5.8 Integration (pg): the schema-drift test covers the new table, its compound primary key and
      the new columns on `retro_ai_proposal` and `retro_action`.
- [x] 5.9 Integration (pg): the registry anonymity walk (`queries.anonymity.pg.test.ts`) grows by
      exactly the new query with no allowlist edit.
- [x] 5.10 Component: `retro-ai-panel.test.tsx` — reaction controls absent when the team has not
      opted in and when the phase is `discuss`; only the caller's own reaction is rendered before the
      stamp; contested sorts first after it; the counts render no name; the whole flow is driven by
      keyboard events only.
- [x] 5.11 Regression: with AI off, opening a retro and advancing `vote → discuss` fires no new
      query, renders no new element, logs no error and does no ratification work — the change-10
      retro stays byte-identical. The same claim one level down: a draft that ended `ai_off`,
      `failed` or `ready` with no surviving proposal issues no reaction query either.
- [x] 5.12 Component: `retro-command.test.tsx` — the four AI palette entries act on the proposal the
      keyboard last held; "clear my reaction" is offered after a reaction taken with the INLINE
      TOGGLE, which moves no focus and therefore leaves the palette's snapshot stale; the reaction
      commands vanish once the window shuts; a retro with no AI panel carries no AI entry at all.
- [x] 5.13 E2E: the palette's four AI commands and the panel's "add as an action" control, driven by
      the keyboard alone, with the resulting actions' provenance and NULL assignee read back from
      Postgres.

## 6. Documentation

- [x] 6.1 `apps/docs/src/content/docs/features/retro-ai-draft.md`: a ratification section — how to
      react, the phase window, the fixed knob-free verdict rule stated in full (including that one
      disagree means contested and that there is no setting to change it), contested-first ordering,
      and the improvement→issue path **stating that no owner is ever suggested and why**.
- [x] 6.2 Same page: the two residuals, written the way retro-board documented its own boundary —
      plainly, as known limits rather than solved problems. (a) A tally in a two- or three-person
      team is partly self-identifying. (b) A proposal can echo the substance of someone's anonymous
      card; the pipeline never read it, and here is why that is structurally true, but the perception
      is real.
- [x] 6.3 `apps/docs/src/content/docs/features/retrospectives.md`: the AI section is no longer
      opinion-free; state the AI-proposals-only asymmetry and that human cards keep dot voting as
      their only ranking signal.
- [x] 6.4 Update `apps/docs/src/content/docs/index.md` — its Retro AI draft bullet ends "nothing it
      drafts is agreed by the team", which this change makes false — plus `README.md` (feature list)
      and `ROADMAP.md` (row 19 status). Confirm `.env.example` needs no change — this change adds no
      environment variable — and say so in the PR body.
- [x] 6.5 Update `openspec/SCOPE-ai-features.md` §9 to record items 8, 9 and 10 as answered, and
      item 1 as **raised and consciously waived**, pointing at `design.md` §G1.
- [x] 6.6 `pnpm --filter @yapm/docs build` passes.

## 7. Verification

- [ ] 7.1 `pnpm turbo lint typecheck test build` clean.
- [x] 7.2 The boundary check passes: no ZQL or mutator outside `packages/schema`, no package
      importing an app, no second spend accessor or validator walker.
- [ ] 7.3 The compose smoke test passes on the `yapm-rr` project and ports, from `down -v`.
- [x] 7.4 Walk every scenario in the change's four spec files and confirm each is true.
