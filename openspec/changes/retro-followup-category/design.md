# Design — retro-followup-category

## Context

See `proposal.md` — Why. This design exists to record the *reversal* precisely, because the decision
it reverses is itself written down and a reader will find both.

`openspec/changes/archive/2026-08-05-retro-ai-loop-close/design.md` §D3 is the authoritative spec for
this work. It chose the derived bucket, gave the reasons, gave the migration SQL for the alternative,
and closed with *"Recorded here so that if a maintainer prefers the explicit enum, the work is one
file and this paragraph is the spec for it."* Nothing here contradicts §D3's reasoning — §D3 already
said the stored enum was semantically cleaner and the smaller diff. What changed is the constraint:
change 22 was scoped with no migration and a sibling build held the next number. Neither is true now.

The state this design has to fit into:

- `RETRO_PROPOSAL_CATEGORIES = ['win','loss','improvement']` drives the Zod structured-output enum,
  the Zero schema's `enumeration<RetroProposalCategory>()`, the `DB` interface, the artifact adapter's
  one-group-per-category shape, and the verdict log's label map.
- `RETRO_PROPOSAL_BUCKETS = ['win','loss','improvement','follow_up']` is the same list plus one, and
  drives the cap, the rank, `contestedFirst`, the panel's group order and the chip.
- `retroProposalBucket(p)` is the single mapping between them: `refs` contains a `retro_action`
  reference ⇒ `follow_up`, else the stored `category`.
- `bakeRetroActionRefs` (§D4) overwrites `label`, `outcome` and `origin` on every surviving
  `retro_action` reference with yapm's own text, drops a reference naming an unknown action, and drops
  a proposal left with none. It runs inside `sanitizeRetroDraft`, after the name backstop and **before
  the cap**, because it can drop and re-bucket rows.

## Goals

- One vocabulary for a proposal's category, stored, CHECK-constrained, and read directly everywhere.
- The three properties §D3 says fell out for free from the derivation continue to hold — now by
  construction, each with a test.
- AI off ⇒ byte-identical behaviour. A team's first retro ⇒ byte-identical surface.

## Non-Goals

- No compatibility shim, no `bucketOf()` alias, no deprecated re-export. A second name for the same
  fact is what this change exists to remove.
- No widening of what a follow-up may cite, and no new reference kind.
- No change to the retro board, the reaction model or the verdict log's read.

## Decisions

### D1 — `RETRO_PROPOSAL_BUCKETS` and `RetroProposalBucket` are deleted, not aliased

The obvious low-risk move is `export const RETRO_PROPOSAL_BUCKETS = RETRO_PROPOSAL_CATEGORIES` and
`export type RetroProposalBucket = RetroProposalCategory`, leaving every import untouched. It is
rejected: §D3's whole argument was that there must be exactly one definition of what a follow-up is,
and two exported names for one list is precisely how a second definition later grows a second meaning
(someone adds a category that is not a bucket, or vice versa, and both compile). Every import moves to
`RETRO_PROPOSAL_CATEGORIES` / `RetroProposalCategory`.

`BucketableProposal` goes with it. Its only purpose was to describe "enough of a proposal to derive a
bucket from" — a stored category needs no structural interface, and `contestedFirst` now takes
`category?: RetroProposalCategory` directly.

`isRetroActionRef` **stays**. It is not a definition of follow-up-ness — it is the predicate the label
baker and the panel's origin lookup use to find the reference kind whose caption yapm owns (§D4), and
it is now also what the new validator (D3 below) checks a `follow_up` proposal against.

### D2 — The category CHECK becomes an exported frozen constant, and the drift test asserts it

Migration `0018_retro_ai.ts` spells its CHECK as an inline `sql` template. Migration 0022 instead uses
an exported constant in `zero/context.ts`, following the `AI_ARTIFACT_STATUS_CHECK` /
`AI_DISCLOSURE_EVENT_CHECK` precedent that `schema-drift.test.ts` already asserts against live
Postgres from both ends.

The constant is a **frozen literal string**, not a value derived from `RETRO_PROPOSAL_CATEGORIES` at
runtime. A migration's DDL is history: deriving it would mean a future fifth category silently changes
what migration 0022 emits on a fresh database while leaving every existing database on the old
constraint. The coupling that matters is instead asserted as a **unit test**: the CHECK literal names
exactly the members of `RETRO_PROPOSAL_CATEGORIES`, so adding a fifth category without a migration
fails at unit-test time rather than at insert time in production.

`0018`'s three-value literal is left exactly as it is. Forward-only migrations are not edited.

### D3 — A `follow_up` proposal with no `retro_action` reference is dropped, and this is the one real hazard of the change

Under the derived design, "no prior actions ⇒ no follow-up proposal" needed no code: on a team's first
retro the `retroAction` citation namespace is empty, so an invented action id is narrowed away, and
`dropUncitedAiItems` then drops the proposal that had nothing else. There was no way to *be* a
follow-up without citing one.

A stored category breaks that implication. The model can emit `category: 'follow_up'` with a perfectly
valid issue reference, and every shipped validator passes it: it is cited, it names no member, its
references are in their own namespaces, and it fits the cap. It would be stored and rendered as a
follow-up on a prior retro the team may never have had.

So the implication is restored explicitly. `dropUnbackedFollowUps` drops any proposal whose stored
category is `follow_up` and whose surviving references contain no `retro_action` reference. It is a
**validator**, phrased as the same kind of narrowing every other step is, and it runs at exactly one
place in the chain:

```
narrow namespaces → cite-or-omit → drop-if-names-member → bake yapm's captions
  → drop unbacked follow-ups → cap at three per category
```

**After the bake**, because the bake is what removes a reference naming an action the prior retro does
not have — a follow-up whose only prior-action reference the bake removed must be dropped, not stored
with an issue chip. **Before the cap**, for §D4's stated reason: the cap must be last, or a bucket can
end up holding four rows, or a legitimate follow-up can be discarded after three bogus ones consumed
the cap.

The converse is **not** enforced: a `win` or an `improvement` may cite a `retro_action` reference and
is stored as what it says it is. That is deliberate (see D4), and it is not a second definition of
follow-up-ness — it is the absence of one.

### D4 — A repeat of the same problem is an `improvement` that cites the prior action, not a `follow_up`

The shipped prompt tells the model: *"Give it the category that fits what it says: a delivered
improvement is a win, an abandoned one is a loss, a repeat of the same problem is an improvement."*
That sentence exists because `follow_up` was not a category the model could choose. It now is, and the
rule has to be restated rather than deleted, because one shipped behaviour depends on it.

Change 19's one-keystroke *Add this improvement as an action* affordance is offered on an **agreed
proposal whose stored category is `improvement`**. Under the derived design, a proposal that reported
"we agreed this last cycle and it never shipped — let us try again" was *stored* as `improvement` and
*rendered* as a follow-up, so it carried the affordance. If such a proposal now stores `follow_up`, the
affordance silently disappears from the one proposal most likely to deserve it.

Two ways out. Widening the affordance to `improvement | follow_up` introduces a second list of
"categories that can become an action" — a new enumeration, in the panel, of exactly the kind this
change is removing. Instead the **prompt draws the line at what the proposal is doing**:

- `follow_up` — *reporting the outcome* of a prior agreed action. Must cite it. Not itself a thing to
  do next, so it carries no add-as-an-action control, exactly as a win or a loss does not.
- `improvement` — *something to try next cycle*, which may additionally cite the prior action it is a
  repeat of. Keeps the affordance it has always had.

`actionable` in the panel is therefore left byte-identical, and the mutator (deliberately laxer) is
untouched.

### D5 — No backfill, and the reason stated rather than assumed

A proposal row drafted before this change stores `win | loss | improvement`; if it cites a
`retro_action` reference it rendered under the Follow-ups heading, and after this change it renders
under its stored category's heading. No row is invalid, nothing crashes, no reference is lost — the
baked `label`, `outcome` and `origin` on the reference are still rendered, so the row still says which
action it is about and what yapm computed about it. The only loss is the group heading and the row
chip naming the origin cycle.

Not backfilled, for three independent reasons, any one of which would be enough:

1. **A backfill would have to guess.** "Stored `win`, cites an action" could have been intended as a
   report on a shipped action (now `follow_up`) or as a win that happens to cite one (still `win`).
   The derivation threw that distinction away; nothing stored recovers it. A backfill would encode a
   guess as a stored fact — worse than the cosmetic difference it fixes.
2. **The rows are ephemeral by design.** A draft is generated lazily at the reveal and is **deleted**
   when a retro steps back to `brainstorm`; a proposal row's audience is one retro's discussion. This
   capability shipped days ago (change 22, PR #23), so the population is a handful of rows at most,
   and every future retro drafts fresh.
3. **A migration that rewrites model-derived content is not a migration.** DDL widens what may be
   stored; rewriting a team's stored artifact after the fact is a different and much larger promise.

Consequence, stated so a reviewer can disagree: on an instance that ran change 22, a pre-existing
follow-up-shaped proposal loses its Follow-ups grouping. That is a cosmetic regression on a
handful of rows, bounded to retros currently in flight, and it is the price of not guessing.

### D6 — The prompt gains a category, not a power

The system prompt changes in exactly three places: the bucket-cap line names four buckets; a new line
defines `follow_up` and states its citation obligation ("a follow_up proposal MUST reference the
action's id with kind `retro_action`; without one it is discarded"); and the existing "give it the
category that fits what it says" sentence is restated per D4. The "when no prior actions are given,
emit nothing about a previous retro" line stays — it is now backed by the validator of D3 as well as
by cite-or-omit.

Every rule remains enforced by code after the fact. A fully injected model that emits nothing but
`follow_up` proposals still produces at most three stored rows, each of which cites a real prior
action.

## Risks / Trade-offs

- **The one property that no longer holds for free is now one function deep.** D3's validator is the
  whole safety of the change: delete it and the model can invent a follow-up on a retro that never
  happened. It gets a direct test asserting the drop, and its position in the chain gets a test
  asserting a bake-orphaned follow-up is dropped too.
- **Pre-existing rows change grouping (D5).** Accepted, bounded, and stated above rather than
  discovered later.
- **The migration is a constraint swap on a live table.** `drop constraint` + `add constraint`
  validates existing rows; every existing row already satisfies the wider check, and the table is
  small (proposals for retros, ≤ a few per retro), so the validation scan is trivial.
- **One more thing the model may say.** A cycle whose draft is all follow-ups is capped at three of
  them and cannot displace the three improvements — same code path as before, now with a test that
  says so about `follow_up` specifically.

## Decisions made during implementation

### L1 — The CHECK constant is a frozen literal, breaking with its own file's precedent

`zero/context.ts` already holds three CHECK constants and all three are **derived** —
`` `value in (${RETRO_REACTION_VALUES.map(...)})` ``. `RETRO_PROPOSAL_CATEGORY_CHECK` is a plain
string literal instead, which makes it the odd one out in the file it lives in.

Kept as D2 specified, and the divergence is the point rather than an oversight: the derived constants
are a latent version of exactly the hazard D2 names, since adding a fifth reaction value would
silently change what migration 0012 emits on a fresh database while every existing database stayed on
the old constraint. Not fixed here — those are three unrelated migrations and this change is one
file — but the new constant does not join them, and the unit test in `schema-drift.test.ts` pins the
literal to the members of `RETRO_PROPOSAL_CATEGORIES` so the coupling that matters is still checked.

### L2 — The migration's constraint name was verified against live Postgres, not assumed

§D3's SQL names `retro_ai_proposal_category_check`. Migration `0018_retro_ai` never spells that name —
it attaches the CHECK inline via Kysely's `.check()` on `addColumn`, leaving Postgres to auto-name it.
`drop constraint <name>` would fail on a name Postgres did not pick. Confirmed against the live stack
rather than reasoned about:

```
retro_ai_proposal_category_check|CHECK ((category = ANY (ARRAY['win'::text, 'loss'::text,
  'improvement'::text, 'follow_up'::text])))
```

and `kysely_migration` shows `0022_retro_followup_category` applied on top of `0021_pm_digest` from a
`down -v`.

### L3 — The CHECK was probed by insert, using the FK as the discriminator

Task 1.4 asks for evidence that `follow_up` is accepted and a bogus value refused. A bare insert hits
the `draft_id` FK before anything useful is learned, so the probe supplies every NOT NULL column and
reads *which* constraint rejects it — CHECKs are evaluated before FK triggers, so the two cases are
cleanly distinguishable:

- `category = 'follow_up'` → `violates foreign key constraint "retro_ai_proposal_draft_id_fkey"`.
  It cleared the CHECK; only the fabricated draft id stopped it.
- `category = 'bogus_value'` → `violates check constraint "retro_ai_proposal_category_check"`.

The same fact is asserted at a higher altitude by the server test, which runs a real draft end to end
and reads back a stored row whose `category` is `follow_up`.

### L4 — No backfill, confirmed rather than re-argued, and the consequence has a test

§D5's reasoning is unchanged after implementation: nothing stored recovers whether a pre-change row
meant a report or a repeat, so a backfill would encode a guess as a stored fact. What the build adds
is the test §D5 implied but did not name — `retro-ai-panel.test.tsx` renders a row storing
`improvement` and carrying a baked `retro_action` reference and asserts it lands under **Improvements**
with its prior-action chip intact. The cosmetic regression is therefore pinned as intended behaviour
rather than left to be discovered as a bug.

### L5 — `data-bucket` and `data-category` are now identical, and both stay

Tasks 4.2 kept both attributes. They are now necessarily the same string, which reads as redundant.
Kept anyway: both are load-bearing selectors in the shipped e2e suite and in the panel's own tests,
and collapsing them is a rename with no behavioural content that would enlarge this diff into files
this change otherwise does not touch. Worth removing later as its own cleanup; not worth smuggling in
here.

### L6 — Two pre-existing tests are load-flaky under a fully parallel `turbo` run

`pnpm turbo lint typecheck test build` failed twice with **different** tests failing each time —
`apps/web/src/routes.test.tsx > the search route is registered…` (1111 ms, a timeout) and
`apps/server/src/jobs/search.pg.test.ts > misses a backdated row in the tail…`. Neither is touched by
this change, and neither reproduces in isolation: `@yapm/web` passed 413/413 four consecutive times
and `@yapm/server` 452/452 twice.

Checked rather than assumed: the same fully parallel gate run with this change **stashed** also
failed, on a third task. These are timing-sensitive tests contending for CPU and for the single dev
Postgres, not a regression. Reported here rather than smoothed over — CI runs each package's suite
with its own resources, and the honest statement is that the serial gate is green and the fully
parallel local one is flaky independently of this change.

Green as run: `lint`, `typecheck`, `build`, `@yapm/schema` 1009/1009 (including the pg-backed
migration and schema-drift suites against the `yapm-rfc` stack from `down -v`), `@yapm/web` 413/413,
`@yapm/server` 452/452, `@yapm/ui` 252/252, `@yapm/email` 27/27, `node scripts/check-boundaries.mjs`,
and `pnpm --filter @yapm/docs build`.

### L8 — The compose smoke test and the browser e2e suite could NOT be run here, and CI is the first place they execute

Task 7.3 asks for the compose smoke test, and it did not pass. **It does not pass on this branch and it
does not pass on the baseline either** — every browser-driven check in this environment fails at
sign-up, before any yapm surface is reached:

- The three-container production stack builds and boots cleanly on isolated ports (`yapm-rfc-smoke`,
  app 3007, zero-cache 4857). `/readyz` reports `status: ready` with all four checks green —
  database, logical replication with an active slot, search, storage — so **migration 0022 applies
  against the production image and the app boots on top of it.** That much is verified.
- `scripts/smoke.mjs` then fails, alternating between `sign-up failed: Invalid email` and `sign-up
  did not establish a session cookie`.
- The same failure was reproduced with this change **stashed** and the production image rebuilt from
  the baseline tree: identical, both signatures, across three runs. It is not caused by this change.
- The browser e2e suite fails the same way. `retro-ai.spec.ts` fails 6/6 waiting on
  `[data-testid="workspace-name"]`, which is what a session that never established looks like — and
  `auth.spec.ts`, which this change does not touch at any remove, fails too.
- `POST /api/auth/sign-up/email` returns **200 with a correct `Set-Cookie:
  better-auth.session_token=…; Path=/; HttpOnly; SameSite=Lax`** when driven by `curl`, so the server
  is behaving; the cookie is not surviving into the local Playwright Chromium's jar.

Stated plainly rather than dressed up: **task 5.9's "the shipped `retro-ai.spec.ts` must keep passing
unchanged" is unverified locally, and so is task 7.3.** They are unverified because the harness is
broken here for reasons predating this change, not because they were skipped. The e2e seed's category
union was widened (task 3.3) and no e2e assertion in `retro-ai.spec.ts` referenced `retroProposalBucket`
or the derived grouping, so the expectation is that both pass — but that is an expectation, not a
result, and CI's `e2e` and `smoke` jobs are the first place it is actually tested. If either fails
there, this note is where to start.

### L7 — Root docs checked for staleness, and the check's result is "none"

Task 6.3 asks for the check to be stated rather than skipped. `README.md`, `TECHSTACK.md`,
`.env.example` and `reference/` were searched for the deleted identifiers and for the follow-up
vocabulary: **no hits, and nothing stale.** This change adds no dependency, no environment variable,
no container and no library surface, so there is nothing in any of them to update. `ROADMAP.md` did
need two touches (row 22's derived-bucket prose gets a superseding pointer rather than a rewrite,
since it is history, plus the "where v1 actually stands" paragraph's "it cost no migration" clause)
and gets a row 24 of its own.
