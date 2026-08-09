## Why

The triangle's most expensive failure is not a missed deadline. It is re-litigating a settled
debate six weeks later because the settlement lived in comment 47.

Every tracker on the market records that a *status* changed. None of them remembers *why*. yapm's
whole wedge is that the work graph holds the facts an issue tracker throws away — the PR, the
check, the deploy, the incident — and the one fact it still throws away is the team's own reasoning.
`design-explorations/overhaul-2026-08/plays/PLAY-decisions.md` is the approved argument and
`plays/decisions-thread.html` + `plays/decisions-record.html` are the approved drawings: a thread
can end in one sentence, that sentence is pinned above the thread it distilled, and the sentences
accumulate into a team page that answers *"why did we do it this way?"* six weeks from now.

It is also the change that pays off two folds already standing in the shipped product:
`northstar/home-digest-2.html` draws a **DECIDED THIS CYCLE** band that Home does not render, and
PR #33 folded the **Decisions** item out of `more▾` with the comment *"no entity backs it, and a
disabled row is chrome promising what the product cannot keep"* — reassigning `g d` to Delivery in
the meantime. This change builds the entity, so both folds open.

Vision principles served: **the work graph is the product** (a decision is a first-class node, not
a comment convention); **team-level only, structurally** — the decision table has **no author
column at all**, the same structural guarantee `retro_card_author` gives the retro, made impossible
in the schema rather than merely discouraged in the UI; **keyboard-first**; **sub-100ms and
offline** (the record renders from already-synced rows); **free means free**.

## What Changes

**A `decision` entity — the first new table in this design series.**

- Team-scoped, one plain sentence (capped, so it stays a sentence), a `decided_at`, a link to the
  issue whose thread it distilled, the comment range it came out of, the count of comments in that
  thread stamped at decide time, and an optional `revisit_cycle_id`.
- **No author column, no owner column, no `decided_by`.** Not nullable, not server-only —
  *absent*. The chip's provenance line reads `from a thread of 5 · the team's call, no owner`, and
  it is true because there is nothing in the row that could say otherwise. A drift test asserts
  the absence in Postgres *and* in the Zero schema, so a later change cannot add one quietly.
- Forward-only Kysely migration applied at boot, hand-written Zero schema entry, team-scoped read
  predicate identical in shape to its siblings, and the CI drift test between the Zero schema and
  the live Postgres schema covers every column.

**A Decide affordance in the comment composer.** Any thread can end in one sentence: a `Decide`
control beside `Comment`, reachable from the composer without a pointer, opening a single-line
field with the sentence budget stated. Writing a decision is a normal team-member write; there is
no admin bypass for *reading* another team's decisions.

**The decision chip, pinned above the thread it distilled.** The sentence in plain type, provenance
as a mono line, the revisit pill where one is set — and the thread beneath it truly collapses
(the play's "quiet by opacity" is explicitly filed as a sketch; a real 40-comment thread needs a
real collapse with a control that says how many are behind it).

**The Decisions record page**, at `/teams/{teamId}/decisions`, reached from `more▾` as `g d`:
`Decisions` + a mono count, the standfirst, a search field, chip-rows grouped by cycle, the revisit
pill where one is set, one row unfoldable in place to read the *why* without leaving. **No owner
column exists on the page because none exists in the row.**

**Two folds open.**

- Home renders **DECIDED THIS CYCLE** — decision chips, no owner, folding entirely when the cycle
  holds none.
- `more▾` regains its **Decisions** item and **`g d`**; Delivery's menu hint moves to **`g s`**
  (its own vocabulary is shipping), and the swap is recorded in the spec, the docs keyboard table
  and here.

**Honesty constraints, carried into the requirements.** A decision **never expires** — it gets
revisited. No glyph fades, no row dims with age, nothing sorts by staleness. A revisit marker names
a cycle and says, in words, that it will resurface at that cycle's planning; **there is no planning
surface in yapm yet**, so the marker stores, displays, and lists under a "revisits due" filter on
the record page — and the docs say plainly that resurfacing at planning arrives when a planning
surface does, rather than implying it already happens.

Non-goals — deliberately folded:

- **The triangle rail's DESIGN section** (`decisions-thread.html`'s right rail). It assumes design
  frames attached to comments as first-class artifacts; those do not exist. Filed as SKETCH by the
  play and not built.
- **A `D` bare-key shortcut on the thread.** The composer's control and the palette are the two
  routes; a bare letter over a page full of prose is a keystroke waiting to fire by accident.
- **Area labels from the AI change-area map.** `areas.ts` maps repository file paths, not issues.
  The record page's area column is the issue's own labels or nothing.
- **AI-suggested decision sentences.** The play's own self-critique says the tool can suggest an
  editing discipline but not enforce one; a model writing the team's settlement is the opposite of
  what this entity is for.
- **A planning surface.** Named above; out of scope, and said so on the surface.
- **No new container, service, job, dependency or env var.**

## Capabilities

### New Capabilities

- `decisions`: the decision entity and its record — what a decision is, the ownerless guarantee,
  how one is made from a thread, how the record page reads, searches and groups, what a revisit
  marker means and where it will resurface, and the rule that the record never fades.

### Modified Capabilities

- `issue-detail`: the comment thread gains the Decide affordance, the pinned decision chip above
  the thread, and the true collapse of a thread a decision has settled.
- `app-frame`: `more▾` lists Decisions with `g d`; the go-to grammar gains `g s` for Delivery; the
  "a destination with no entity behind it does not render" scenario is re-pointed at a destination
  that still has no entity, because decisions now do.
- `team-home`: the DECIDED THIS CYCLE band, and the band-order and no-new-query clauses that
  currently forbid it.
- `local-first-sync`: team-scoped `decision` sync, deny-by-empty, auth-before-existence, no admin
  read bypass across teams — and the structural absence of an author column asserted by the drift
  test.

## Impact

- `packages/schema/src/migrations/0024_decision.ts` (new) + `migrations/index.ts`; `db/types.ts`
  gains the `decision` table; `db/schema-drift.test.ts` gains its shape *and* the absent-author
  assertion.
- `packages/schema/src/zero/schema.ts`: the `decision` table entry and its relationships.
- `packages/schema/src/zero/queries.ts`: `decisions.byTeam` (one named query, serving the record
  page and Home), and `.related('decisions')` inside the existing issue-detail query's existing
  `teamScoped(...)` predicate.
- `packages/schema/src/zero/mutators.ts` + `server-mutators.ts`: `decision.record`,
  `decision.revise`, `decision.retract`.
- `packages/schema/src/zero/decisions.ts` (new): the pure derivations — cycle grouping, search
  match, provenance phrasing — computed client-side over synced rows.
- `packages/schema/src/zero/team-home.ts`: the DECIDED THIS CYCLE band model.
- `apps/web/src/decisions/` (new): the record page; `apps/web/src/routes/teams.$teamId.decisions.tsx`.
- `apps/web/src/issues/issue-detail.tsx`: the Decide control, the pinned chip, the settled-thread
  collapse.
- `apps/web/src/frame/{deck,go-to}.tsx|ts`: the Decisions item, `g d`, Delivery → `g s`.
- `apps/web/src/home/team-home.tsx`: the DECIDED band.
- `packages/ui/src/components/drawn.tsx`: the decision mark (a fact held inside a promise) on the
  shared 20-unit grid — additive only.
- `packages/ui/src/styles/contrast.test.ts`: this surface's pairs, **appended as a clearly
  delimited block at the END of the file** (three cross-branch merge conflicts in this series say
  why).
- `apps/web/e2e/decisions.spec.ts` (new): deciding a thread, and reading the record.
- No dependency, env var, container, service or job is added or changed. `ROADMAP.md` is not
  edited — parallel builds; the maintainer adds the row at archive time.

Docs: `apps/docs/src/content/docs/features/decisions.md` (new — the entity, the ownerless
guarantee and why it is structural, deciding a thread, the record page, revisit markers and the
plain statement about where they will resurface); `features/issue-detail.md` (the Decide
affordance and the settled thread); `features/app-frame.md` (the `more▾` list and the keyboard
table: `g d` → Decisions, `g s` → Delivery); `features/team-home.md` (the DECIDED band);
`README.md`'s feature list.
