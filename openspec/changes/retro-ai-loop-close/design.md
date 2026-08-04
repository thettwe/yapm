# Design — retro-ai-loop-close

## Context

See `proposal.md` — Why. What follows is only the state this design has to fit into.

`retroFactsForCycle` (`packages/schema/src/db/retro-facts.ts`, change 18) is the server-side fact
assembly behind the retro AI draft. It reads seven tables — `cycle`, `team`, `issue`, `issue_link`,
`pull_request`, `ci_check`, `review` — with an **explicit column list on every select**, and calls
the two existing pure builders (`buildRetroSeed`, `buildCycleFacts`) rather than reimplementing a
metric. `retro-facts.pg.test.ts` wraps the Kysely instance in a recording proxy and asserts that the
set of tables read **equals** an allowlist and that the recorded column tokens contain no
identity-shaped name. That test is the enforcement mechanism this change extends; it is not
advisory.

Change 19 (`retro-ratification`, merged as `e467947`, not yet archived) added `retro_ai_reaction`,
the pure `retroProposalVerdict`, and four written-once columns on `retro_ai_proposal` — `verdict`,
`agree_count`, `disagree_count`, `ratified_at` — computed once at the `vote → discuss` advance and
cleared by the step back. It also added `retro_action.ai_proposal_id` (`on delete set null`) as the
provenance link from an agreed Improvement to the action a human created from it.

`retro_action` (migration `0012_retro.ts:173`) carries: `id`, `retro_id`, `team_id`, `group_id`,
`card_id`, `body`, **`assignee_id`**, `target_cycle_id`, `issue_id`, timestamps. `issue` carries
`assignee_id` too. Those two columns are the entire risk surface of this change.

`RETRO_SEED_REF_KINDS` (`zero/retro/seed.ts`) is `issue | pull_request | ci_check | deployment |
widget`, validated by Zod into a `refs jsonb` column with **no CHECK constraint** — so a new
reference kind costs no DDL. `retro_ai_proposal.category` is the opposite: a text column with
`check (category in ('win','loss','improvement'))`, so a new *stored* category value does cost DDL.
That asymmetry decides §D3.

## Goals

- The draft for cycle N can state whether cycle N−1's agreed improvements shipped, were canceled, or
  are still open, and can attach that to a metric the team already sees.
- Neither `assignee_id` is reachable from the assembled object, proven against the object rather
  than against the prompt.
- A team's first retro produces a well-formed bundle and a silent surface.
- An operator can see what teams threw away, at team level, without a per-person column existing
  anywhere in the read.

## Non-Goals (design level; the proposal has the product-level list)

- No new synced entity, no new query, no new mutator, no new permission predicate.
- No second copy of the cite-or-omit walker, the name-validator walker, or the spend accessor. The
  follow-up bucket is enforced **through** the shipped validators, not beside them.
- No de-duplication of this cycle's proposals against last cycle's text. A repeated improvement is a
  signal, and suppressing it would be the model editorializing about the team's judgement.

## Decisions

### D1 — The allowlist grows by exactly `retro` and `retro_action`, and the reason is what a retro action *is*

Change 18's spec says the assembly "SHALL NOT read any retro-authored content table (retro drafts,
cards, the card→author binding, votes, presence, **actions**) or any comment". This change moves
`retro` and `retro_action` — and only those — across that line. The argument, stated so a reviewer
can disagree with it rather than discover it:

A **card** is one person's testimony, written privately during `brainstorm`, published anonymously,
with its author binding deliberately held in a table that is absent from the Zero schema. A
**retro action** is the opposite artifact in every respect: it is created in `discuss`/`close`, in
front of everyone, as the team's agreed output; it carries no author column at all; and it is
already visible to every member and every workspace admin through an ordinary team-scoped query.
Reading it discloses nothing that reading the retro board does not.

What is *not* crossed, and is enforced by the same equality assertion:

- `retro_card`, `retro_card_author`, `retro_draft`, `retro_vote`, `retro_vote_tally`,
  `retro_presence`, `comment` stay out. So does `retro_ai_proposal` — see §D6.
- **`retro_action.card_id` and `.group_id` are never selected.** They are the join back to the
  anonymous card an action came from. Not reading them means the pipeline holds no edge into the
  anonymity-critical subtree even in principle, so a later change cannot follow one by accident.
- **`retro.facilitator_id` and `retro.created_by` are never selected.** The only columns read from
  `retro` are `id` and `cycle_id`.

An action **body** is human-written free text and can name a person ("ask Sam to own the release
check"). That is the same class of hazard as an issue title or a PR title, both of which have
reached the model since change 18 inside the delimited untrusted block, and it is mitigated the same
way: the untrusted-data fence on the input, and `dropAiItemsNamingMembers` on the output, with the
roster loaded only after the call. It is **not** a new hazard class and it is deliberately not
solved with a new redactor — a second name-walker is exactly what §1 of `SCOPE-ai-features.md`
forbids.

### D2 — The strip is a column allowlist, not a post-filter, and the test asserts the object

Every new select is an explicit column list:

```
retro         → id, cycle_id
retro_action  → id, retro_id, body, issue_id
issue (2nd)   → id, number, title, status          -- addressed by the action's issue_id
```

Note what is missing from each: `assignee_id` from both `retro_action` and `issue`, `card_id` and
`group_id` from `retro_action`, `facilitator_id` and `created_by` from `retro`.

The falsifiable check is asserted **twice, at two altitudes**, because the two failures are
different:

1. **On the recorded column tokens** — the recording proxy already collects every string passed to
   `select`/`selectAll`; the assertion is that `assignee_id` (and `card_id`, `group_id`,
   `facilitator_id`, `created_by`) appear in none of them, and that `selectAll` was never called.
   This catches the *read*.
2. **On the built object** — the existing `identityKeys` walker over the returned `RetroFacts`, with
   a prior retro whose action really has a non-null `assignee_id` and whose converted issue really
   has a different non-null `assignee_id`, so the seeded data is not vacuous. This catches a *shape*
   that reintroduces the value under an innocent key name.

Neither assertion mentions the prompt string. A downstream validator that happened to strip it would
not make either pass.

### D3 — `follow_up` is a derived bucket over a new reference kind, not a fourth stored category

`RETRO_SEED_REF_KINDS` gains `'retro_action'`. A pure exported function

```ts
retroProposalBucket(p): 'win' | 'loss' | 'improvement' | 'follow_up'
```

returns `'follow_up'` when the proposal cites at least one `retro_action` reference and its stored
`category` otherwise. **That one function is used everywhere a bucket is needed** — the cap, the
rank, change 19's ordering comparator, the panel's grouping, and the category chip — so there is one
definition of what a follow-up is and no place for a second to grow.

Three properties fall out for free rather than being coded:

- **"No prior actions ⇒ no follow-up proposal" is enforced by change 18's cite-or-omit validator.**
  With no prior retro, no action id enters `citableIds`; a model that invents one has the reference
  narrowed away and the proposal dropped as uncited. There is no new branch, no empty-string
  category, and no first-retro special case to get wrong.
- The `≤3 per bucket` cap applies to follow-ups on the same line of code as everything else, so a
  cycle full of follow-ups cannot crowd out the improvements the team should make next.
- A proposal drafted before this change renders identically: no `retro_action` reference, so its
  bucket is its stored category.

**The alternative, rejected here and specified so it can be chosen instead.** A fourth value in
`RETRO_PROPOSAL_CATEGORIES` is semantically cleaner — the bucket would be a stored fact rather than
a derivation — and everything downstream is already driven by that constant, so the diff would be
*smaller*, not larger. It costs exactly one migration:

```sql
alter table retro_ai_proposal drop constraint retro_ai_proposal_category_check;
alter table retro_ai_proposal add  constraint retro_ai_proposal_category_check
  check (category in ('win','loss','improvement','follow_up'));
```

plus the CHECK text in `schema-drift.test.ts`. It is not taken because this change was scoped with
**no migration** and a sibling build holds the next free number; the derived bucket honours that
boundary without inventing anything the codebase does not already do (a reference kind is data, and
`widget` already established that a reference kind can carry meaning). Recorded here so that if a
maintainer prefers the explicit enum, the work is one file and this paragraph is the spec for it.

### D4 — A `retro_action` reference's label is baked by yapm after validation, never taken from the model

`AiArtifactRef` already carries an optional `label`, and the model can put anything in it. For every
other reference kind the UI resolves the id against synced rows and ignores the label; for a
`retro_action` reference it **cannot**, because the prior retro's actions are not synced into this
retro's view and adding a cross-retro query for a caption would be a new permission surface for a
string.

So the server does what it already does for `widget`: after `sanitizeRetroDraft` runs, every
surviving `retro_action` reference has its `label` **overwritten** with yapm's own text — the action
body (truncated) and the yapm-computed outcome of its converted issue. The model points; yapm says
what it is pointing at. A label the model wrote never reaches storage, and the panel renders a
plain, non-navigating chip rather than a link into another retro.

### D5 — Outcome vocabulary: `shipped`, `canceled`, `in_flight`, `not_converted`

A yapm-computed enum, never a phrase the model chose:

| outcome | condition |
|---|---|
| `not_converted` | `retro_action.issue_id` is null — the team agreed it and never tracked it |
| `shipped` | the converted issue's status is `done` |
| `canceled` | the converted issue's status is `canceled` |
| `in_flight` | any other status (`backlog`, `todo`, `in_progress`, `in_review`) |

**`shipped` means `done` and nothing else.** `canceled` is reported as its own outcome, not folded
into "not shipped" and never counted as shipped — the third falsifiable check exists because
collapsing those two is the easy, plausible, wrong implementation. `not_converted` is kept distinct
from `in_flight` because "we never tracked it" and "we tracked it and it is still open" are
different failures and a retro should be able to tell them apart.

The bundle also carries yapm-computed totals per outcome, so a follow-up proposal can cite the
prior-retro widget key rather than typing a count.

### D6 — The rejected-proposal log is a team-level read, admin-gated, and structurally out of the model's context

**What it is.** One admin-gated `GET` under the existing `/api/v1/ai` base, behind the shipped
`requireAdmin` middleware, returning per-team totals by verdict (`agreed`, `contested`, `rejected`,
`unrated`) and the most recent rejected and contested proposals with their summary, bucket, counts
and the retro's cycle name. Rendered as a section in the AI settings view.

**Why it exists at all.** Every other quality signal in the AI layer is an assertion made at build
time. The verdicts are the only evidence the operator has that the drafts are worth reading —
`SCOPE-ai-features.md` §9 item 1 records that the "read three real drafts" gate was raised and
consciously waived, so this log is the closest thing to that gate that a running instance can
produce. It was marked optional in the scope only because it needed change 19's verdicts, which did
not exist when the scope was written.

**Three properties, each deliberate:**

- **Team-level, no per-person column.** The read touches `retro_ai_proposal`, `retro`, `cycle` and
  `team` and **never `retro_ai_reaction`**. `agree_count` and `disagree_count` are the aggregates
  change 19 already stamped; who voted which way is not readable by anyone, including an admin,
  including here. A per-proposal reactor list would have been the first per-person AI surface in the
  product.
- **Out of the model's context, structurally.** `retro_ai_proposal` is not in the fact-assembly
  allowlist and the equality assertion keeps it out. The model is never told what was rejected: a
  draft that steers away from previously-rejected phrasing is a model optimizing for approval, which
  is the opposite of the signal the team is being asked for.
- **A read, not a control.** No regenerate, no per-team quality knob, no prompt editor. The action
  an operator takes from it is to change the model or turn the feature off, both of which already
  exist.

### D7 — The prior retro is the one on the most recent completed cycle that has one

`retroFactsForCycle` already computes up to three prior completed cycles, newest first, for the
sparkline. The prior retro is the retro whose `cycle_id` is the newest of those that **has a retro
with at least one action**; if none does, `priorRetro` is `null`.

Walking back further than the immediately-preceding cycle is deliberate: a team that skipped a retro
should still be reminded of the last actions it actually agreed, and the window is already bounded
at three by `MAX_PRIOR_CYCLES`, so this adds no unbounded scan. The bundle names the cycle the
actions came from, so a proposal cannot imply the actions were from last cycle when they were from
three ago.

### D8 — The panel's fourth group is absent, not empty

`priorRetro === null`, or zero surviving follow-up proposals, renders **nothing** — no heading, no
"no prior actions yet" line, no reserved space. The change-10 retro and the change-18 panel stay
byte-identical for a team on its first retro, which is every team once. The first-retro state is a
clean absence by construction (§D3), so there is no code path that could render an apologetic empty
state even if someone later wanted one.

The group heading, when it exists, states the cycle the actions came from. Keyboard order is the
existing one: the group joins the panel's tab sequence in bucket order, with the same focus
treatment and the same token-only styling as the three shipped groups.

## Risks / Trade-offs

- **The derived bucket is a derivation, and derivations drift.** Mitigated by there being exactly one
  `retroProposalBucket` function and by a unit test that pins the derivation against the storage
  round trip. §D3 records the migration that would remove the derivation entirely.
- **An action body can name a person, and now reaches the model.** Same class as an issue title
  (§D1); mitigated by the fence and the output name-validator, not by a new redactor. Stated rather
  than hidden.
- **This change pays nothing back for a team's first retro, and the model's context grows for every
  retro after.** The prior-retro block is small (bounded by the prior retro's action count) but it
  is not free on a BYO key. Accepted: it is the difference between a retro that remembers and one
  that does not.
- **The rejected log can be read as a scoreboard for the AI, and a low-quality run looks like a
  productive team.** It is labelled as a signal about the model's output, not about the team, and it
  carries no target, threshold or trend line that would invite it to be managed.

## Decisions made during implementation

### L1 — §D8's heading needs the prior cycle's NAME on the client, and nothing synced carries it

§D8 says the follow-up group's heading "states the cycle the actions came from", and §D4 says a
`retro_action` reference's label is "the action body (truncated) and the yapm-computed outcome". Those
two are not satisfiable together by the shipped ref shape: `AiArtifactRef` is `{kind, id, label?}`, the
prior retro's rows are **not** synced into this retro's view, and adding a cross-retro query for a
caption is exactly the new permission surface §D4 refuses. Parsing a cycle name back out of a
composite label would make a user-typed cycle name load-bearing in a string split.

**Chosen:** `retroSeedRefSchema` gains **two optional, yapm-baked fields** — `outcome`
(`RetroActionOutcome`) and `origin` (the cycle name) — beside the existing `label`. `refs` is a jsonb
column with no CHECK, so this costs **no migration**, which is the same property §D3 relies on for the
reference kind itself. `bakeRetroActionRefs` writes all three for a `retro_action` reference and
**strips `outcome` and `origin` from every other kind**, so a model-authored value for either can
never reach storage, exactly as §D4 requires of `label`.

The panel then reads the heading from the first follow-up reference carrying an `origin` and the chip
from `label`, with the outcome carried as a non-colour icon beside yapm's word for it. A proposal
drafted before this change has neither field and falls back to the plain "Follow-ups" heading.

**The cost, stated:** the ref shape is shared with the retro board's card seed refs
(`mutators.ts`'s `seedRefArg`), so those rows can now legally carry two fields nothing writes. That is
one schema surface widened for one rendering, and the alternative — a fourth stored category with its
migration (§D3) — remains the cleaner answer if a maintainer would rather pay DDL than shape.

### L2 — `contestedFirst` breaks ties by bucket then rank, with every new field optional

Task 2.3 asks change 19's comparator to be pointed at `retroProposalBucket`, but `contestedFirst`
compared verdicts alone and relied on the caller's incoming `(category, rank)` order surviving a
stable sort. Requiring a category and a rank on `RatifiableProposal` would have broken change 19's own
test rows, which are `{id, verdict}` and nothing else.

**Chosen:** `RatifiableProposal extends Partial<BucketableProposal>` with an optional `rank`. The
comparator is contested → bucket → rank, and each leg is **skipped when either side lacks the field**,
so a `{id, verdict}` row ties on both and keeps precisely the pre-change behaviour. The flat ratified
list is now deterministic on its own rather than by inheritance from how the caller happened to build
its array. Verified by hand against a seven-row list: contested first, then `win`, `improvement`,
`follow_up` in canonical bucket order with dense ranks inside each.

### L3 — The verdict log distinguishes "never ratified" from "nobody responded"

`retro_ai_proposal.verdict` is null until the `vote → discuss` advance stamps it, and `unrated` is the
stamped verdict for "ratified, and nobody reacted". §D6 named four verdict totals and did not say
which bucket a null belongs in.

**Chosen:** a fifth count, `undecided`, for the null. Folding it into `unrated` would report a team
that never finished voting as a team that shrugged, which is the one misreading this log — a signal
about the model's output — must not invite.

### L4 — The settings section reads through a fallback rather than off the response

`VerdictLogSection` reads `log?.totals ?? []`. It sits below the two sections that matter on the AI
settings page, and a response whose shape surprises it must not take the provider card and the
retro-draft opt-in down with it. This also keeps the shipped `area-map.test.tsx` fetch stub — which
answers every URL with an `AiStatusResponse` — passing without being edited, which is the honest
signal that the section is genuinely independent of the card above it.

### L5 — What this pass did NOT run

- **The pg suite was not executed.** `packages/schema/src/db/retro-facts.pg.test.ts` grew the
  falsifiable check (the prior retro with two actions, two different non-null assignees, the
  outcome/total assertions, the object-and-columns strip) and the first-retro case, and both
  **typecheck and lint clean** — but no Postgres was reachable: port 5445 was closed and this pass was
  instructed not to run `docker compose`. **CI is where those two cases first execute.** "The test is
  written" and "the test passes" are different claims and this is the first one.
- **Groups 6.3–6.11 and group 7 (docs) are the Close phase's**, by the build instruction, and are
  unticked. 6.1 and 6.2 were done here because the allowlist EQUALITY assertion goes red the moment
  the two new tables are read — leaving it that way would have handed the next pass a broken tree
  rather than a finished stage.
- **CI did run the pg suite, and it is green.** The `quality` job sets `DATABASE_URL`, and
  `retro-facts.pg.test.ts` throws rather than skips when that is unset under CI — so the new
  falsifiable check and the first-retro case genuinely executed against Postgres on commit `8a3be25`
  and passed, along with the compose smoke test.
- **One e2e flake, identified and not mine.** The first Playwright run failed at
  `retro.spec.ts:236` ("take a dot back" left the budget at `2/3`), with the server log carrying
  fourteen `Ignoring mutation … as it was already processed` PushProcessor errors spread across the
  whole run, most in tests that passed. Nothing in this change touches a vote mutator, the vote query
  or the palette. **Re-running the identical commit passed all six checks**, which is the evidence
  rather than the assertion.
- What *was* run locally: `turbo typecheck`, `biome ci`, `turbo test` (699 schema / 294 server / 365 web / 246
  ui passing, pg and e2e suites skipped for want of a database), and `scripts/check-boundaries.mjs`.
  The pure bucket/cap/rank/bake/comparator behaviour was additionally exercised by hand through a
  throwaway vitest file that was deleted afterwards; it confirmed the follow-up bucket, the ≤3 cap per
  bucket beside three improvements, dense ranks within each bucket, the model's label being replaced
  by yapm's text, an invented action id being dropped by cite-or-omit, and the first-retro path baking
  nothing.

### L6 — The verdict log's pg tests live in `retro-facts.pg.test.ts`, beside the read they are the mirror of

The log is a `db/` read of its own and would naturally take its own `*.pg.test.ts`. It does not,
because the only reusable asset either read needs is the **recording Kysely proxy** — the thing that
makes "which tables did this statement name" assertable — and copying forty lines of proxy into a
second file to prove a second negative is the shape this change spent its whole design refusing.

The file now carries two sibling `describe`s, and the reason they belong together is stated in it:
**the fact assembly must never read a verdict, and the verdict log must never read a reaction.** Those
are the same claim pointed in opposite directions, they are both asserted by table-set equality
against the same proxy, and a reader who breaks one should find the other on the way past.

### L7 — What this pass ran, and the one thing it could not

- **Ran and green:** `pnpm lint` (biome ci, 542 files), `turbo typecheck --filter=...[origin/main]`,
  the four package suites (schema, server, web, ui), `node scripts/check-boundaries.mjs`, and
  `pnpm --filter @yapm/docs build` (23 pages).
- **NOT run: the pg suites and Playwright.** No Postgres was reachable — port 5445 was closed, the
  only listener on 5432 belongs to an unrelated project, and this pass was instructed not to run
  `docker compose`. So **CI is where every pg case in this pass first executes**, exactly as it was
  for 6.1/6.2 in the previous one. Both pg files throw rather than skip when `DATABASE_URL` is unset
  under CI, so a silent skip is not a failure mode available to them; but "the test is written" and
  "the test passes" are different claims and this pass can only make the first about:
  `retro-facts.pg.test.ts` (four new cases: all four outcomes distinctly, the two-cycles-back
  selection, the prior-retro-with-no-actions absence, and the four verdict-log cases),
  `retro-draft.test.ts`'s end-to-end bake case, and `admin-routes.test.ts`'s two verdict-log cases.
- **The full `build` task and the compose smoke test were also not run**, by the same instruction;
  task 8.1 and 8.2 are left unticked rather than reported as done.
