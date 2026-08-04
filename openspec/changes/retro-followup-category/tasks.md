## 1. The stored fourth category, and the migration that permits it

- [ ] 1.1 Add `RETRO_PROPOSAL_CATEGORY_CHECK` to `packages/schema/src/zero/context.ts` as a plain
      frozen string — `category in ('win', 'loss', 'improvement', 'follow_up')` — following the
      `AI_ARTIFACT_STATUS_CHECK` precedent (no kysely import, so the migration and the drift test
      spell it from the same constant). Design §D2: it is a frozen literal, never derived from the
      category array at runtime.
- [ ] 1.2 Add `'follow_up'` to `RETRO_PROPOSAL_CATEGORIES` in
      `packages/schema/src/zero/retro/ai-draft.ts`. Rewrite the constant's comment: it is now the
      four buckets the model classifies into, and `follow_up` is the one whose citation obligation
      the validator in 2.2 enforces.
- [ ] 1.3 Write `packages/schema/src/migrations/0022_retro_followup_category.ts`: drop
      `retro_ai_proposal_category_check` and re-add it from `RETRO_PROPOSAL_CATEGORY_CHECK` via
      `sql.raw`, exactly as archived change 22's design §D3 specifies. `down` restores the
      three-value constraint. Register it in `migrations/index.ts`. Leave `0018_retro_ai.ts`
      untouched — forward-only migrations are history, not source.
- [ ] 1.4 Apply the migration against the live dev stack (`POSTGRES_HOST_PORT=5447
      ZERO_CACHE_HOST_PORT=4855 YAPM_HOST_PORT=3007`, project `yapm-rfc`) from `down -v` with
      zero-cache running, and confirm a `follow_up` insert is accepted and a bogus value refused.
      Record the evidence in `design.md` under `## Decisions made during implementation`.

## 2. Delete the derivation; add the validator that replaces what it gave for free

- [ ] 2.1 Delete `retroProposalBucket`, `RETRO_PROPOSAL_BUCKETS`, `RetroProposalBucket` and
      `BucketableProposal` from `ai-draft.ts` and from `packages/schema/src/index.ts`'s exports.
      Keep `isRetroActionRef` — it is the reference-kind predicate the caption bake, the panel's
      origin lookup and the new validator use, not a definition of follow-up-ness (design §D1).
      `capRetroProposals` and `rankRetroProposals` key off `proposal.category`; their maps become
      `Map<RetroProposalCategory, number>`.
- [ ] 2.2 Add `dropUnbackedFollowUps(content)` to `ai-draft.ts`: drop any proposal whose
      `category === 'follow_up'` and whose `refs` contain no `retro_action` reference. Wire it into
      `sanitizeRetroDraft` **after** `bakeRetroActionRefs` and **before** `capRetroProposals`, and
      state in the chain comment why both halves of that position are load-bearing (design §D3).
- [ ] 2.3 `packages/schema/src/zero/retro/ratify.ts`: `RatifiableProposal` carries an optional
      `category: RetroProposalCategory` and an optional `rank`; `bucketIndex` becomes an index into
      `RETRO_PROPOSAL_CATEGORIES` read straight off `category`, with the "skip the leg when either
      side lacks the field" behaviour archived change 22's §L2 established left exactly as it is.
      Drop the now-unused `refs` from the interface only if nothing else reads it.
- [ ] 2.4 Confirm no `retroProposalBucket`, `RETRO_PROPOSAL_BUCKETS` or `BucketableProposal`
      identifier survives anywhere in `apps/`, `packages/` or `scripts/`, and that no second
      predicate for follow-up-ness has grown in their place.

## 3. The model may now say it

- [ ] 3.1 `apps/server/src/ai/retro-draft.ts` — update `RETRO_DRAFT_SYSTEM_PROMPT` per design §D6:
      the cap line names four buckets; a new line defines `follow_up` and states that such a
      proposal MUST reference the action's id with kind `retro_action` or be discarded; the existing
      "give it the category that fits what it says" sentence is restated per §D4 (a report on a
      prior action's outcome is `follow_up`; a repeat of the same problem the team should try again
      is an `improvement` that may also cite the action). Leave the "when no prior actions are
      given, emit nothing about a previous retro" line in place.
- [ ] 3.2 Verify the structured-output schema needs no separate edit: `retroDraftProposalSchema`
      reads `z.enum(RETRO_PROPOSAL_CATEGORIES)`, so the emitted JSON schema gains the value from
      1.2. Read the built provider payload rather than assuming it.
- [ ] 3.3 `apps/web/e2e/db.ts` — widen the seeded proposal's `category` union to the four values so
      an e2e fixture can seed a follow-up.

## 4. The surface reads the stored value

- [ ] 4.1 `apps/web/src/retro/ai-labels.ts` — both maps become `Record<RetroProposalCategory,
      string>`; `RETRO_CATEGORY_LABEL` gains `follow_up: 'Follow-up'` (the verdict log prints the
      singular). Rewrite the comment that calls `follow_up` a derived value.
- [ ] 4.2 `apps/web/src/retro/retro-ai-panel.tsx` — `groupByBucket`, the chip label, `BUCKET_UNIT`,
      `bucketUnit` and the `data-bucket` attribute all read `proposal.category`; the follow-up
      origin heading and row label keep working off the baked `origin` on the reference. Keep
      `data-category` and `data-bucket` both present and now identical, so no shipped selector
      (including the e2e suite's) breaks.
- [ ] 4.3 Leave `actionable` in the panel and `focusedAi.category === 'improvement'` in
      `retro-command.tsx` byte-identical — design §D4 is why the affordance stays on `improvement`
      alone rather than growing a second list of actionable categories.
- [ ] 4.4 Check every remaining `RetroProposalCategory` consumer compiles against four values:
      `apps/web/src/settings/ai.ts`, `packages/schema/src/db/types.ts`,
      `packages/schema/src/db/retro-verdict-log.ts`, `packages/schema/src/zero/schema.ts`.

## 5. Tests

- [ ] 5.1 `ai-draft.test.ts` — **the falsifiable check**: `sanitizeRetroDraft` given a proposal with
      `category: 'follow_up'` whose only reference is a valid, citable issue id returns zero
      proposals. Plus the bake-orphan case: a follow-up citing an unknown action id alongside a
      valid issue reference is dropped rather than stored backed only by the issue.
- [ ] 5.2 `ai-draft.test.ts` — four `follow_up` proposals in one draft are capped to three, and
      three follow-ups beside three improvements yield all six; assert both through
      `sanitizeRetroDraft` so it is the shipped code path, not a direct `capRetroProposals` call.
- [ ] 5.3 `ai-draft.test.ts` — an `improvement` citing a real prior action is stored as an
      `improvement` with its baked caption intact (the converse §D3 deliberately does not enforce).
      Rewrite the existing `retroProposalBucket` describe block into stored-category assertions
      rather than deleting its coverage.
- [ ] 5.4 `ratify.test.ts` — `contestedFirst` orders contested first, then the four categories in
      canonical order, then rank; a `{id, verdict}` row still ties on both legs.
- [ ] 5.5 `packages/schema/src/db/schema-drift.test.ts` — assert the live
      `retro_ai_proposal_category_check` definition equals `RETRO_PROPOSAL_CATEGORY_CHECK`, spelled
      from the exported constant, following the `pm_digest` CHECK precedent in that file.
- [ ] 5.6 A unit test pinning `RETRO_PROPOSAL_CATEGORY_CHECK` to name exactly the members of
      `RETRO_PROPOSAL_CATEGORIES`, so a fifth category added without a migration fails a test rather
      than an insert (design §D2).
- [ ] 5.7 `retro-ai-panel` test — a proposal row storing `improvement` and carrying a
      `retro_action` reference with baked `label`/`outcome`/`origin` renders under Improvements
      with its chip intact and nothing throws (design §D5, the pre-existing-row case).
- [ ] 5.8 `retro-draft.test.ts` (server) — the prompt names the follow-up category and its citation
      obligation, and an end-to-end draft run stores a `follow_up` row.
- [ ] 5.9 No new e2e. PROCESS §3's big-feature rule: this touches the synced schema and nothing else
      on the list (no mutator, no permission surface, no new signature UI), so it is unit +
      integration. The shipped `retro-ai.spec.ts` must keep passing unchanged.

## 6. Documentation

- [ ] 6.1 `apps/docs/src/content/docs/features/retro-ai-draft.md` — the follow-up section: a
      follow-up is a category the draft stores, not a shape inferred from what a proposal points at;
      a follow-up always cites the prior action it reports on, and one that does not is discarded;
      a repeat of the same problem arrives as an improvement (and keeps *Add as an action*).
- [ ] 6.2 `ROADMAP.md` — a row for this change, and a superseding note on row 22's "**`follow_up` is
      a derived bucket … not a fourth stored category**" and "No migration" prose, naming this change
      and migration `0022`. Row 22's text is history; it gets a pointer, not a rewrite.
- [ ] 6.3 Check `README.md`, `TECHSTACK.md`, `.env.example` and `reference/` for staleness — expected
      to be none (no dependency, no env var, no container), and say so rather than skipping the check.
- [ ] 6.4 `pnpm --filter @yapm/docs build` passes.

## 7. Verification

- [ ] 7.1 `pnpm turbo lint typecheck test build` and `node scripts/check-boundaries.mjs`.
- [ ] 7.2 The pg suites against the `yapm-rfc` stack from `down -v`: migrations, schema-drift.
- [ ] 7.3 The compose smoke test (this change ships a migration).
- [ ] 7.4 Record in `design.md` under `## Decisions made during implementation` what ran, what did
      not, and why — including anything CI is the first place to execute.
