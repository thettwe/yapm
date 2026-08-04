## Why

Change 22 (`retro-ai-loop-close`) shipped `follow_up` as a **bucket derived at read time** — a
proposal is a follow-up exactly when it cites a `retro_action` reference — and its own design
document, §D3, records why: the change was scoped with **no migration**, a sibling build held the
next free number, and `retro_ai_proposal.category` carries `check (category in ('win','loss',
'improvement'))` from migration `0018_retro_ai`. §D3 then states plainly that the stored fourth
category is *semantically cleaner and the diff is smaller, not larger*, gives the migration SQL, and
closes with: *"Recorded here so that if a maintainer prefers the explicit enum, the work is one file
and this paragraph is the spec for it."*

**The maintainer has chosen the explicit enum.** This change is a deliberate reversal of a logged
decision, not a new idea: the no-migration constraint that forced the derivation was the wrong call,
it no longer binds (`0021_pm_digest` is the highest migration on main and no sibling build is
running), and §D3 is the spec this change implements.

Vision principles served: *one obvious way to do a thing* — a proposal's bucket becomes a stored
fact with exactly one definition, instead of a fact recomputed by a pure function every surface has
to remember to call; and *the schema is the contract* — the four values a proposal can carry become
enforceable by Postgres rather than by convention.

## What Changes

- `RETRO_PROPOSAL_CATEGORIES` gains a fourth value, `follow_up`. `RETRO_PROPOSAL_BUCKETS` and the
  `RetroProposalBucket` type are **deleted**: they were the same four values under a second name, and
  keeping both would leave two vocabularies for one fact.
- Migration **`0022_retro_followup_category`** widens the `retro_ai_proposal` category CHECK to the
  four values, exactly as §D3's SQL specifies. The CHECK text is asserted against live Postgres by
  `schema-drift.test.ts`.
- **`retroProposalBucket` is deleted along with every call site.** The cap, the rank, change 19's
  `contestedFirst` comparator, the panel's grouping and the category chip each collapse to reading
  `proposal.category`, because all five already key off `RETRO_PROPOSAL_CATEGORIES`.
- The model may now emit `category: "follow_up"`. The structured-output schema follows the constant
  automatically; the system prompt is updated to describe the fourth category and its citation
  obligation.
- **NEW validator: a `follow_up` proposal that cites no `retro_action` reference is dropped.** This
  is the one property the derived design got for free and a stored category does not: with a derived
  bucket, "no prior actions ⇒ no follow-up" fell out of change 18's cite-or-omit walker (an invented
  action id is narrowed away and the proposal dropped); with a stored category the model could emit
  `follow_up` with no prior-action reference at all and cite-or-omit would not catch it. The new
  validator runs **inside** `sanitizeRetroDraft`, after the label bake and before the cap, so that a
  proposal whose only prior-action reference the bake removed is dropped too.
- The ≤3-per-bucket cap applies to `follow_up` on the same line of code as every other category,
  unchanged.
- **BREAKING (storage semantics, not API):** a proposal row drafted before this change that stored
  `improvement` and cited a `retro_action` reference rendered as a follow-up and now renders as an
  Improvement. **No backfill** — see `design.md` §D5 for why that is the right answer rather than an
  omission.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `retro-ai-draft`: the follow-up bucket becomes a **stored fourth category** rather than a
  derivation over a reference kind; a new deterministic validator makes "no prior actions ⇒ no
  follow-up proposal" a property of the validator chain rather than of the cite-or-omit walker; the
  stored category set the proposal row may carry grows to four and is CHECK-constrained in Postgres.

## Impact

- `packages/schema/src/zero/retro/ai-draft.ts` — the constant, the deleted bucket function and type,
  the new follow-up citation validator, the chain order.
- `packages/schema/src/zero/retro/ratify.ts` — `contestedFirst` sorts on `category` directly.
- `packages/schema/src/zero/context.ts` — the exported `RETRO_PROPOSAL_CATEGORY_CHECK` text.
- `packages/schema/src/migrations/0022_retro_followup_category.ts` and `migrations/index.ts`.
- `packages/schema/src/db/schema-drift.test.ts` — the CHECK assertion §D3 names.
- `apps/server/src/ai/retro-draft.ts` — the system prompt's category rules.
- `apps/web/src/retro/retro-ai-panel.tsx`, `apps/web/src/retro/ai-labels.ts`,
  `apps/web/e2e/db.ts` — grouping, chip, spoken unit, and the e2e seed's category union.
- No new dependency, no new container, no new query, no new mutator, no new permission predicate.

Docs: `apps/docs/src/content/docs/features/retro-ai-draft.md` (the follow-up section — a stored
category, and what a follow-up must cite), `ROADMAP.md` (a row for this change, plus a superseding
note on row 22's "derived bucket … no migration" prose), and
`openspec/changes/archive/2026-08-05-retro-ai-loop-close/design.md` is left untouched as the
historical record it is.

## Non-goals

- **No data backfill and no dual-read compatibility path.** Old rows render as their stored category
  (§D5).
- **No change to `RETRO_SEED_REF_KINDS`.** `retro_action` stays: the reference kind is what §D4's
  baked label, outcome and origin depend on, and what the citation namespace is keyed by. This
  change removes the *derivation*, not the reference.
- **No second definition of follow-up-ness anywhere.** Not a helper, not an alias type, not a
  `isFollowUp()` convenience. The stored `category` is the answer.
- No change to who may read a proposal, to the reaction model, or to the verdict log's shape beyond
  the fourth label.
- No new AI capability: the model gains a category, not a power.
