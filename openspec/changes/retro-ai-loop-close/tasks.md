## 1. The prior-retro facts, stripped at the source

- [ ] 1.1 Add `'retro_action'` to `RETRO_SEED_REF_KINDS` in
      `packages/schema/src/zero/retro/seed.ts`. Nothing else in that file changes: `buildRetroSeed`
      does not emit this kind, only the AI draft's proposals cite it.
- [ ] 1.2 Add the outcome vocabulary and the prior-retro fact shapes to
      `packages/schema/src/zero/retro/seed.ts` (or a sibling pure module — keep it pure, no DB
      import): `RETRO_ACTION_OUTCOMES = ['shipped', 'canceled', 'in_flight', 'not_converted']`, a
      pure `retroActionOutcome(issueStatus: IssueStatus | null)` implementing design §D5 (`done` ⇒
      `shipped`, `canceled` ⇒ `canceled`, any other status ⇒ `in_flight`, null issue ⇒
      `not_converted`), and a pure totals reducer. **`shipped` is `done` and nothing else.**
- [ ] 1.3 Extend `RetroFacts` in `packages/schema/src/db/retro-facts.ts` with
      `priorRetro: { cycleId, cycleName, actions: PriorRetroAction[], totals } | null`, where
      `PriorRetroAction = { id, body, outcome, issue: { id, number, title, status } | null }`. No
      assignee field exists on either shape — the type itself is the first line of the strip.
- [ ] 1.4 Implement the read in `retroFactsForCycle`, using the prior-cycle list it already computes
      (design §D7): select `retro` (`id`, `cycle_id` **only**) for those cycle ids newest-first;
      select `retro_action` (`id`, `retro_id`, `body`, `issue_id` **only**) for those retro ids; take
      the newest retro that has at least one action, else leave `priorRetro` null. Then a second,
      id-addressed `issue` select (`id`, `number`, `title`, `status` **only**) over the actions'
      non-null `issue_id`s. **No `selectAll()`, no `assignee_id`, no `card_id`, no `group_id`, no
      `facilitator_id`, no `created_by`** — design §D1/§D2.
- [ ] 1.5 Add every prior action id to `citableIds`, and add a prior-retro totals key to the citable
      set so a follow-up proposal can point at a count instead of typing one. Do not add issue ids
      the cycle read did not already contribute.

## 2. The follow-up bucket

- [ ] 2.1 Add `retroProposalBucket` to `packages/schema/src/zero/retro/ai-draft.ts`: pure, exported,
      returns `'follow_up'` when the proposal cites a `retro_action` reference and its stored
      `category` otherwise (design §D3). Export the bucket union and its canonical order
      (`win`, `loss`, `improvement`, `follow_up`).
- [ ] 2.2 Change `capRetroProposals` and `rankRetroProposals` to bucket by `retroProposalBucket`
      instead of by `category`. `RETRO_PROPOSALS_PER_CATEGORY` is unchanged and now applies per
      bucket. Storage is untouched: `category` still holds one of the three stored values and `rank`
      is still an integer.
- [ ] 2.3 Point change 19's ordering comparator (`packages/schema/src/zero/retro/ratify.ts`) at
      `retroProposalBucket` so contested-first ordering and the flat-list fallback stay consistent
      with the new bucket, and ranks within a bucket remain dense and unambiguous.
- [ ] 2.4 Verify no second definition of "is this a follow-up" appears anywhere: `retroProposalBucket`
      is the only function that inspects a proposal's references for the `retro_action` kind.

## 3. The prompt, the fact block and the baked reference label

- [ ] 3.1 Extend `RETRO_DRAFT_SYSTEM_PROMPT` in `apps/server/src/ai/retro-draft.ts` with the
      follow-up rule: report on the prior retro's agreed actions using the outcomes yapm computed,
      cite the action id, never assert an outcome yapm did not compute, and emit nothing in that
      bucket when no prior actions are given. Keep the existing rules verbatim.
- [ ] 3.2 Extend `buildRetroDraftInput` with the prior-retro block: the cycle those actions were
      agreed in, then each action's id, yapm-computed outcome, the converted issue's number and
      status when there is one, and the per-outcome totals with their citable key. Action **bodies**
      go inside the existing `<<<UNTRUSTED WORK-GRAPH DATA>>>` fence with the issue and PR titles —
      same class, same fence (design §D1). When `priorRetro` is null the block is **omitted
      entirely**, not emitted as "none".
- [ ] 3.3 After `sanitizeRetroDraft` and before the write, overwrite the `label` of every surviving
      `retro_action` reference with yapm's own text — the truncated action body plus its computed
      outcome (design §D4). A label the model wrote must not reach storage.

## 4. The follow-up group in the retro AI panel

- [ ] 4.1 Render a fourth group in `apps/web/src/retro/retro-ai-panel.tsx`, grouped by
      `retroProposalBucket`, headed with the cycle the actions were agreed in. When the bucket is
      empty the group renders **nothing** — no heading, no placeholder, no reserved space (design
      §D8). Reuse the shipped group/row components; do not fork them.
- [ ] 4.2 Render a `retro_action` reference as a plain non-navigating chip carrying the baked label
      and an outcome marker. It is not a link: the prior retro's rows are not synced into this view
      and this change adds no query.
- [ ] 4.3 Extend the category chip and change 19's flat contested-first list to use
      `retroProposalBucket`, so a follow-up is labelled a follow-up in both renderings.
- [ ] 4.4 Every colour and font through a semantic token; correct and AA in Warm, Focused and
      Editorial, light and dark; the group joins the existing tab sequence with the existing focus
      treatment. Nothing here newly waits on the network.

## 5. The rejected-proposal log

- [ ] 5.1 Add a team-level verdict read to `packages/schema/src/db` (a new module beside
      `cycle-digest.ts`): per-team totals by verdict, and the most recent rejected and contested
      proposals with summary, stored category, agree/disagree counts and the retro's cycle name.
      Explicit column lists. It reads `retro_ai_proposal`, `retro`, `cycle`, `team` and
      **never `retro_ai_reaction`** — design §D6.
- [ ] 5.2 Add one admin-gated `GET` to `apps/server/src/ai/admin-routes.ts` under the existing
      `AI_API_BASE`, behind the shipped `requireAdmin` middleware, returning that read for the
      caller's workspace. Additive under `/api/v1`.
- [ ] 5.3 Add the client call to `apps/web/src/settings/ai.ts` and render the log as a section in
      `apps/web/src/settings/ai-view.tsx`: per-team totals, then the recent rejected and contested
      proposals. Copy states plainly that it is a signal about the model's output, not about the
      team, and that no individual's reaction is recorded here. Tokens only, AA in all three presets
      light and dark, keyboard-operable.
- [ ] 5.4 No regenerate control, no per-team quality setting, no prompt editor. It is a read.

## 6. Tests

- [ ] 6.1 **The falsifiable check.** In `packages/schema/src/db/retro-facts.pg.test.ts`: seed a prior
      completed cycle with a retro holding two actions — one converted to an issue now `done`, one
      converted to an issue now `canceled` — where the action rows carry a non-null `assignee_id`
      and the converted issues carry a *different* non-null `assignee_id`, so nothing is vacuous.
      Assert (a) the recorded column tokens contain no `assignee_id`, `card_id`, `group_id`,
      `facilitator_id` or `created_by` and `selectAll` was never called; (b) `identityKeys()` over the
      returned `RetroFacts` is empty; (c) neither assignee **value** appears in
      `JSON.stringify(facts)`. Asserted against the built object, never against the prompt string.
- [ ] 6.2 Grow `ALLOWED_TABLES` in that file by exactly `retro` and `retro_action` and keep the
      **equality** assertion. Add an explicit assertion that `retro_ai_proposal`, `retro_card`,
      `retro_card_author`, `retro_draft`, `retro_vote`, `retro_vote_tally`, `retro_presence` and
      `comment` are absent.
- [ ] 6.3 pg test: the canceled action is reported `canceled`, is not in the shipped total, and the
      shipped total counts only the `done` one. A `not_converted` action and an `in_flight` one are
      reported under distinct outcomes.
- [ ] 6.4 pg test: a cycle whose prior cycles hold no retro, and one whose prior retro holds no
      actions, both return a well-formed bundle with `priorRetro === null` — no throw, no empty
      string, no partial object.
- [ ] 6.5 pg test: the prior retro is taken from two cycles back when the immediately-preceding
      cycle's retro has no actions, and the bundle names that cycle (design §D7).
- [ ] 6.6 Unit (`ai-draft.test.ts`): `retroProposalBucket` returns `follow_up` iff a `retro_action`
      reference is present; the cap gives three follow-ups **and** three improvements; rank is dense
      within each bucket.
- [ ] 6.7 Unit: a proposal citing an invented `retro_action` id, with no prior actions in
      `citableIds`, is dropped by the existing cite-or-omit validator and nothing lands in the
      follow-up bucket — the first-retro guarantee, proven through the shipped validator.
- [ ] 6.8 Unit (`apps/server/src/ai/retro-draft.test.ts`): with `priorRetro === null` the prompt
      contains no prior-retro block at all; with a prior retro, an action body containing an injected
      instruction and a roster name lands inside the untrusted fence and no stored proposal names a
      person; a `retro_action` reference's model-supplied label is replaced by yapm's text.
- [ ] 6.9 Unit (`retro-ai-panel.test.tsx`): with no follow-ups the panel renders byte-identically to
      today — no extra heading, no placeholder node; with follow-ups it renders one extra group whose
      heading names the prior cycle, with the chip and the non-navigating reference.
- [ ] 6.10 Unit/integration for the log: an admin gets per-team totals; a member and a viewer are
      refused **before** any read; the response contains no user identifier and the read issues no
      statement naming `retro_ai_reaction`.
- [ ] 6.11 `packages/ui/src/styles/contrast.test.ts`: pin any new token pair the follow-up group or
      the log section introduces. If it introduces none, say so rather than adding a vacuous case.

## 7. Documentation

- [ ] 7.1 `apps/docs/src/content/docs/features/retro-ai-draft.md`: the follow-up group, the outcome
      vocabulary, **the two-retro payoff curve stated plainly** (it reports nothing until a team has
      run two retros, and the first-retro surface is a clean absence), the stripping guarantee on both
      assignee columns, and the rejected-proposal log with its team-level-only promise.
- [ ] 7.2 `apps/docs/src/content/docs/features/retrospectives.md`: action items are now reported back
      on in the next retro, and what "shipped" means.
- [ ] 7.3 `ROADMAP.md` row 22 → built; `openspec/SCOPE-ai-features.md` §3's "optionally the rejected
      proposal log" resolved to built. Check `README.md` and `apps/docs/src/content/docs/index.md`
      for any claim this makes stale. No `.env.example` change — this change adds no variable.
- [ ] 7.4 Record every implementation decision in `design.md` under
      `## Decisions made during implementation`, including anything §D3's derived bucket forced that
      the design did not anticipate.

## 8. Verification

- [ ] 8.1 `pnpm turbo lint typecheck test build`.
- [ ] 8.2 The pg suite against a live Postgres on the assigned ports, from `down -v`.
- [ ] 8.3 `pnpm --filter @yapm/docs build`.
- [ ] 8.4 Confirm no migration was added and `packages/schema/src/migrations/` is unchanged.
