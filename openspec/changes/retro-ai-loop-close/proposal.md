## Why

A retro that cannot remember is a meeting, not a loop. Change 18 drafts Improvements, change 19 lets
the team ratify one and turn it into a tracked issue — and then nothing ever asks whether it
happened. Next cycle the model reads the same work graph with no memory of what the team decided
last time, so it can propose the same improvement twice and neither the team nor the artifact will
notice.

This change adds the one fact that makes the retro compound: **the prior retro's action items and
the live status of the issues they became.** From it the draft can say "you agreed to split the
release check last cycle; ENG-142 shipped and flow time fell 11%" or, just as usefully, "ENG-158 was
canceled and the same complaint is back".

**Be plain about the payoff curve: this change is worth nothing until a team has run two retros.**
There is no prior retro to report on before then, and the honest first-retro behaviour is a clean
absence — no empty state, no apology, no group heading with nothing under it. That is the design,
not a limitation to be papered over.

It serves VISION **#3 Reality over ritual** (an improvement nobody checks on is ritual; the status is
already in the work graph and yapm is the one system that can join it), **#4 Metrics for teams,
never surveillance** (this is the closest the AI layer ever comes to per-individual data, and the
answer is a structural strip rather than a filter), and **#2 Opinionated defaults, real escape
hatches** (a rejected-proposal log the operator can read, with no knob to tune and no per-person
column in it).

## What Changes

- **`retroFactsForCycle` gains the prior retro's actions and their converted issues' live statuses.**
  The read's table allowlist grows by exactly two tables — `retro` and `retro_action` — and by a
  second, id-addressed read of `issue`. Every other retro table stays forbidden: no cards, no
  card→author binding, no drafts, no votes, no presence, no comments.
- **`assignee_id` is stripped structurally, at the source, on both tables that carry one.**
  `retro_action.assignee_id` and `issue.assignee_id` are never named in a select list, and
  `retro_action.card_id` and `.group_id` are never selected either, so an action can never be joined
  back to the anonymous card it came from. This is the only place the fact assembly touches a table
  with an identity-bearing column, and it gets its own test asserted **against the built object**,
  not against the prompt string.
- **A fourth proposal bucket, `follow_up`, derived from a new `retro_action` reference kind.** A
  proposal is a follow-up exactly when it cites a prior retro action — so "the prior retro had no
  actions" produces no follow-up proposal *for free*, through change 18's existing cite-or-omit
  validator rather than through a new branch. The bucket has its own ≤3 cap so follow-ups never
  crowd out the improvements the team should make next.
- **A `retro_action` reference renders yapm's own text, never the model's.** The action body and the
  converted issue's live status are baked into the reference server-side after validation, the same
  discipline the `widget` metric reference already uses: the model points at an action, yapm says
  what it was and whether it shipped.
- **A canceled converted issue is reported as canceled.** "Shipped" means `done` and nothing else;
  `canceled` is its own reported outcome, not a silent non-answer and not a shipped one.
- **The rejected-proposal log — the AI layer's only feedback signal about its own output quality.**
  An admin-gated, read-only, team-level view of what teams ratified and what they threw out, built
  from the verdict columns change 19 already writes. No reaction row is read, no user id appears in
  it, and it is **structurally out of the model's context**: `retro_ai_proposal` stays absent from
  the fact-assembly allowlist, asserted by the same equality test.
- **No migration.** No new table, no new column, no new Zero entity, no new mutator, no new
  permission predicate, no new container, no new env var.

## Non-goals

- **No per-person anything.** No "who owned the action", no completion rate by assignee, no
  follow-through score. `assignee_id` exists on both tables involved and is never read.
- **No reading of retro cards, drafts, votes, presence or comments.** The prior retro contributes its
  **agreed actions** and nothing else. An action is the team's public output; a card is an
  individual's testimony, and that boundary is unchanged.
- **No new stored category value and no schema change to `retro_ai_proposal`.** The follow-up bucket
  is derived from a reference kind, which is jsonb and needs no DDL. The alternative — a fourth value
  in the `category` CHECK constraint — is specified in `design.md` §D3 with its migration, and is
  deliberately not taken here.
- **No cross-cycle metric the model may type.** A follow-up proposal cites an action id or a metric
  key like every other proposal; it may not assert a rate, a percentage or a count of its own.
- **No automatic re-proposal or de-duplication against last cycle's text.** The model is told what
  happened; deciding that an improvement is worth repeating is the team's call, not a diff.
- **No operator control over generation from the rejected log.** It is a read. There is no
  "regenerate", no per-team quality knob and no prompt editor.
- **No retention or export of the rejected log.** It reads live rows; when a retro is deleted its
  proposals go with it.

## Capabilities

### Modified Capabilities

- `retro-ai-draft`: the fact assembly's table allowlist and identity-free guarantee are restated to
  admit the prior retro's actions and their converted issues under an explicit column allowlist that
  excludes both `assignee_id` columns and the card link; the typed-proposal requirement gains the
  `follow_up` bucket, its own cap, and the rule that a follow-up reference is rendered from yapm's
  text. Two new requirements: the prior-cycle follow-up group and its clean first-retro absence, and
  the operator-visible verdict log.

## Impact

- **`packages/schema`**: `db/retro-facts.ts` (the prior-retro read and the strip);
  `zero/retro/seed.ts` (`retro_action` reference kind); `zero/retro/ai-draft.ts` (the derived bucket,
  applied by the existing cap and rank functions); a new team-level verdict-tally read under
  `db/`. No migration, no `DB` interface change, no Zero schema change, no mutator change.
- **`apps/server`**: `ai/retro-draft.ts` (the follow-up section of the prompt, the fact block, and
  the server-side baking of a `retro_action` reference's label); `ai/admin-routes.ts` (one
  admin-gated `GET` under the existing `/api/v1/ai` base and its existing `requireAdmin`).
- **`apps/web`**: the retro AI panel renders a fourth group, absent when there is nothing to report;
  the AI settings view renders the rejected-proposal log.
- **Permission surface**: unchanged. No new synced query, no new predicate, no change to
  `teamScoped`. The one new REST route reuses the shipped admin gate.
- **API**: one additive `GET` under `/api/v1/ai`, within the additive-only major.
- **Docs**: `apps/docs/src/content/docs/features/retro-ai-draft.md` (the follow-up group, the
  two-retro payoff curve, the stripping guarantee, the rejected log),
  `apps/docs/src/content/docs/features/retrospectives.md` (action items are now reported back on),
  `ROADMAP.md` (row 22 status), `openspec/SCOPE-ai-features.md` (§3's "optionally" on the rejected
  log is resolved). No `.env.example` change — this change adds no environment variable.
