# Design — retro-ratification

## Context

See `proposal.md` — Why. What follows is only the state this design has to fit into.

Change 18 (`retro-ai-draft`) shipped two client-read-only synced tables — `retro_ai_draft` (one per
retro) and `retro_ai_proposal` (rows, not a jsonb blob, *precisely so a later change could key on a
proposal id*) — written exclusively through server-only helpers over the shared Zero `Transaction`
(`packages/schema/src/zero/retro/ai-draft-writes.ts`), never registered in the client mutator map.
The draft is generated **lazily at the `brainstorm → group` advance**, inside the existing
`retro.setPhase` server override, which already publishes every private draft card in the same
transaction.

Change 10 (`retro-board`) shipped the ceremony this hangs off: six ordered phases with a strict
one-step adjacency machine, a `RETRO_WRITE_OPS` × phase matrix that every retro mutator consults
server-side, storage-layer anonymity (the card→author binding lives in a table absent from the Zero
schema), dot voting whose voter rows are self-scoped with **no admin bypass**, and
`retro.convertActionToIssue` — idempotent, server-numbered, routed through the shared
`issue.create` mutator.

Two concurrency scars this repo already paid for are load-bearing context:

- `bumpRetroVoteTally` had to become a **single-statement atomic increment** on the server, because
  read-then-write over a shared counter loses updates when a whole team votes at once.
- `castRetroVote` had to take a **`for no key update` row lock on the retro** (`lockRetroForVote`)
  before counting the caller's own dots, because the per-actor budget check is a read-then-write
  over rows another concurrent mutation is inserting.

Both are in the code, both were bugs first, and both are the reason this change stores no counter.

## Goals

- One private, phase-gated agree/disagree signal per member per proposal, and nothing else.
- A verdict that is **computed, never accumulated** — one read, one write, at one moment.
- A ratification surface that is fully keyboard-operable and adds no network wait to any existing
  retro interaction.
- The improvement→issue loop closed through the **shipped** conversion path, with no new authority
  and no per-person output.

## Non-Goals (design level; the proposal has the product-level list)

- No aggregate over other members' reactions is ever read by a client, in any phase, by any role.
  There is no query that could return another member's reaction row, which is why "n of m
  responded" is a non-goal rather than a missing feature.
- No SQL-side verdict logic. The rule is a pure TypeScript function in `packages/schema`, so the
  same function decides the stored verdict and (in tests) the hand-count it is compared against.
- No re-derivation of a verdict on read. The stored verdict is the record of what the team decided
  at the moment they decided it.

## Decisions

### D1 — `retro_ai_reaction`, PK `(proposal_id, user_id)`, self-scoped with no admin bypass

**Shape.** `proposal_id uuid → retro_ai_proposal(id) on delete cascade`, `user_id text` (no FK, the
`retro_presence` precedent — better-auth owns the `user` table), `retro_id uuid` and `team_id uuid`
denormalized for the ratify read and for membership cleanup, `value text check (value in ('agree',
'disagree'))`, `created_at`, `updated_at`. Primary key `(proposal_id, user_id)`.

**Why the compound natural key rather than a client-minted UUIDv7.** CLAUDE.md constraint 4 exists
because a mutator re-run during rebase re-mints an id and corrupts the optimistic result. With
`(proposal_id, user_id)` there is nothing to mint: both components are already known — one from the
argument, one from the **verified `ctx.userID`, never from an argument**. A rebase re-runs the same
upsert onto the same key. This is the `notification` / `issue_subscription` precedent, and the
constraint is simply not engaged. It also makes "one member, one reaction, one proposal" a
*storage* property rather than a validation rule.

**Why self-scoped with no admin bypass, and why that is a deviation worth a comment.** `teamScoped`
grants workspace admins a blanket read of every team's work data. That is right for issues and
wrong here for exactly the reason `retroVotes.mine` and `retroDrafts.mine` carry the same
deviation: a retro is the one surface where a member is invited to say something unwelcome, and a
signal an admin can read is not a signal a quiet dissenter will send. The query is
`zql.retro_ai_reaction.where('retroId', args.retroId).where('userId', ctx.userID)` behind an
`isMember` gate that denies by empty query, and it carries the deviation comment verbatim from
`queries.ts:244`/`:313`. The falsifiable check asserts an **admin** gets zero rows, not merely a
non-recipient member — because written as `teamScoped` this looks completely normal in review.

**Alternative rejected: reuse `retro_vote`.** A dot vote is a budgeted, positive-only ranking signal
over cards and groups; a reaction is an unbudgeted, bidirectional signal over an AI proposal. Fusing
them would have put a second `target_type` on the budget check and made a disagree cost a dot.

### D2 — Ratification applies to AI proposals only. Human cards are not ratified

`SCOPE-ai-features.md` §9 item 9 (from research §2.4) argues human cards should be ratifiable too,
"so the AI's cards get no special authority". **Answered: no.** Recorded here because the argument
genuinely cuts both ways and a future reader deserves to see why it went this way.

*For the symmetry:* a member reading "AI proposal: contested" beside an unmarked human card can
read the marking as the AI's content being taken more seriously — it is the one that got a
ceremony. And an asymmetric surface is a surface with two rules on it.

*Against, and decisive:* human cards **already have a ranking signal on that surface** — dot voting,
with a budget, a tally table and a whole phase named after it. A second, differently-shaped ranking
signal on the same board in the same session is not symmetry; it is two scoreboards, and a card
could be top-voted and rejected at once with no defined resolution. The asymmetry is also *the
correct shape of the underlying difference*: a human card is somebody's testimony and does not need
the team's endorsement to be true, whereas an AI proposal is a machine's inference over the work
graph and is worth precisely what the team says it is worth. Ratifying testimony is a different and
worse product.

Doubling the write surface would also have doubled the anonymity blast radius: a reaction row on a
`retro_card` in an anonymous retro pairs a reactor with a card whose author is deliberately
unknowable, and the moment both exist somebody will want to join them.

### D3 — The verdict rule: fixed, knob-free, minority-veto

A pure function in `packages/schema/src/zero/retro/ratify.ts`:

```
responders = agree + disagree
responders === 0            → 'unrated'
disagree === 0              → 'agreed'      (unanimous among responders)
disagree > agree            → 'rejected'    (strict majority against)
otherwise                   → 'contested'   (at least one disagree, not a majority)
```

**Any single disagree ⇒ not agreed.** A minority veto protects the quiet dissenter, which is the
entire reason the ceremony exists; a proposal one person thinks is wrong is a proposal worth
five minutes of discussion, and "contested" is a *routing* label, not a rejection. A configurable
threshold was declined outright: retro-board D7 refused config knobs on principle, and a threshold
knob is the specific knob whose settings encode how much dissent a team is willing to hear.

`unrated` is the honest fourth value. Nobody reacted, so the team decided nothing, and rendering
that as "agreed" would manufacture consent from silence.

### D4 — Tallies are never incrementally maintained; the verdict is computed once, server-side

At `vote → discuss`, inside the **existing** `retro.setPhase` server override, `ratifyRetroAiProposals`:

1. reads every reaction row for the retro in one query — `tx.run(zql.retro_ai_reaction.where('retroId', …))`,
   unfiltered because a server transaction is not permission-filtered (the same property
   `publishRetroDrafts` already relies on to read every author's drafts);
2. tallies in TypeScript, keyed by `proposal_id`;
3. calls the pure verdict function per proposal;
4. writes `verdict`, `agree_count`, `disagree_count`, `ratified_at` with one
   `tx.mutate.retro_ai_proposal.update` per proposal, through the same server-only-helper shape
   change 18 established for these tables.

**There is no counter column anywhere and no incremental write on the reaction path.** This
sidesteps both scars named in Context at once: there is no shared counter to lose an update on, and
no per-actor budget to hold a lock for, because a reaction has no budget — the primary key is the
whole constraint. Reacting is a plain upsert on a key nobody else can address.

Bound: `proposals × members` ≤ 9 × team size. For yapm's audience (2–20) that is at most 180 rows
read once per retro, at a moment that is already doing a multi-row publish pass.

*Why not compute on read?* Because the verdict is a record of a decision at a moment, not a live
poll. Stored counts also make the surface stable for a member who joins the team afterwards, and
they let the ratification be audited without replaying reactions.

**Alternative rejected: a `retro_ai_verdict` table.** Four nullable columns on the row that already
exists, written once and read by the same query that already syncs the proposal, versus a fifth
retro table, a fifth cascade and a fifth synced query. The columns win.

### D5 — Stepping back `discuss → vote` clears the verdict

The `group → brainstorm` step-back already **discards** the AI draft entirely (change 18), on the
principle that a phase rewind means the thing that phase produced did not happen. The same principle
applies one step later: on `discuss → vote` the four written-once columns are set back to null.

Two reasons beyond consistency. A stale verdict displayed while people are still reacting is an
**anchoring** signal, and anchoring mitigation is the property the lazy-generation design exists to
preserve. And a member who reacted after the first advance would otherwise see a verdict computed
without their reaction, which is worse than no verdict.

Reactions themselves are **not** deleted by the step back — they are what the member said, and the
next advance recounts them. Only the derived stamp is cleared.

### D6 — One new `react` op, phases `group` and `vote`

`RETRO_WRITE_OPS` gains `'react'`, `ALLOWED_PHASES.react = ['group', 'vote']`. Everything else in
`phase.ts` — `RETRO_PHASES`, `isAdjacentPhase`, the format column map — and the phase CHECK
constraint, the stepper and the adjacency machine are untouched. `retroCan` in the web model already
takes any `RetroWriteOp`, so the UI's affordance and the server's authority stay driven by the one
shared predicate.

**Why `group` and not just `vote`.** The AI section appears at the `group` advance and that is when
people read it; forcing a reader to hold an opinion until a later phase is friction with no
purpose. **Why not `discuss`.** The verdict is stamped on entry to `discuss`; a reaction accepted
after the count would be silently uncounted, which is worse than being told the window has closed.
The mutator's rejection carries the existing `invalidPhase` error the whole retro surface already
renders.

### D7 — Reaction mutators: `retroAiReaction.set` and `.clear`, authorized before any existence check

`set({ proposalId, value, createdAt, updatedAt })` — `user_id` from `ctx.userID`, never an argument.
Order, and the order is the falsifiable check:

1. `if (!canWrite(ctx)) throw notAuthorized(args.proposalId)` — **first**, before any read. A viewer
   or non-member cannot use the mutator as an oracle for whether a proposal id exists.
2. load the proposal; a missing one throws the same generic `notAuthorized`.
3. `loadRetroForWrite(tx, ctx, proposal.retroId, 'react', args.proposalId)` — team access, then the
   phase gate through the one shared predicate.
4. `tx.mutate.retro_ai_reaction.upsert(...)`, denormalizing `retro_id`/`team_id` from the loaded
   rows rather than from arguments.

`clear({ proposalId })` is the same prologue and a delete. Toggling off is not the same as
disagreeing and must be expressible; otherwise a mis-click is a permanent opinion.

Both are ordinary optimistic shared mutators — the same function on client and server — so a
reaction renders instantly from the local write. There is no server override: nothing about a
reaction needs server authority beyond what the shared function already enforces, and *that absence
is the design*, because a server override is where a counter would eventually be added.

### D8 — `retro_action.ai_proposal_id`, `on delete set null`, and never an assignee

An agreed Improvement is one keystroke to `retroAction.create`, whose args gain an optional
`aiProposalId` validated to name a proposal **in the same retro**. `convertActionToIssue` is used
**completely unchanged** — the provenance column is inert to it, which is the point: the AI path and
the human path converge on one conversion, one authorization, one server-assigned per-team number,
and the resulting issue is indistinguishable.

**`on delete set null`, not cascade.** If a facilitator steps back to `brainstorm` the draft and its
proposals are discarded — and cascading from there would delete a human's action item, which the
human wrote and owns. The provenance link is the expendable half.

**The assignee is never pre-filled, and this is a hard line, not a default.** `retro_action.assignee_id`
exists and the create path accepts one; the AI path passes nothing, so the action is created with a
null assignee and `convertActionToIssue` forwards that null into the issue. The model has no
identity dimension at any depth (change 18 proves it with an object-graph walk), so a suggested
owner could only be invented — and it would be the **first per-person output anywhere in the AI
layer**, contradicting VISION #4 and the team-level-metrics-only constraint. A test asserts the
converted issue's `assignee_id` is null. A human assigns it afterwards, through the ordinary
control, exactly as for any other action.

**Not gated on `verdict === 'agreed'` in the mutator.** The UI offers the control on agreed
Improvements — that is the affordance the spec names — but the mutator validates only that the
proposal belongs to the retro. A facilitator who decides during `discuss` that a *contested*
proposal is worth acting on should not be blocked by a machine-computed label, and gating in the
mutator would mean a step-back that cleared the verdict (D5) also revoked an action the team had
already agreed to create. Server authority stays at team access and the phase gate.

### D9 — Contested first, then a stable order

From `discuss` onward the section sorts `contested` proposals to the top, then the rest in the
existing `(category, rank)` order. It is a pure comparator in `ratify.ts`, sorted client-side over
already-synced rows — not an `orderBy` — because the ordering is phase-dependent and a phase-varying
synced query would be a second read shape for the same rows. Before `discuss` the order is
unchanged, since there is no verdict to sort by.

Contested is top because it is the routing signal: the point of the ceremony is to spend the team's
scarce discussion time where they disagree.

### D10 — The reaction control shows only your own reaction, in every phase

During `group`/`vote` a proposal renders two toggles (`aria-pressed`), reflecting **only the
caller's own** reaction, read from `queries.retroAiReactions.mine`. No count, no avatars, no "3
people agreed". This is not a UI simplification — it is the direct consequence of D1: no query
exists that could return another member's row, so there is nothing to render. It also removes the
last live-tally temptation at the source.

From `discuss` onward the proposal renders its stamped verdict and counts. The counts are a
team-level aggregate with no per-person dimension, which is the same line every other metric in
yapm holds.

**Keyboard**: the toggles are real `button`s in DOM order after the summary; the retro command
palette gains "Agree with this AI proposal" / "Disagree" / "Clear my reaction" / "Add this
improvement as an action" acting on the focused proposal, using the same `onFocusCapture`
last-focused-element pattern the board and the action list already use for cards and actions.

## Risks / Trade-offs

- **A tally in a two- or three-person team is partly self-identifying.** With two responders,
  "1 agree, 1 disagree" tells each of them what the other said. → *Documented, not solved.* It is
  inherent to any tally at that size and dot voting already has it (retro-board documented the same
  boundary for its vote tallies). The mitigations that exist are real but partial: no reaction is
  ever readable before the stamp, the stamp is one moment rather than a live feed, and no surface
  anywhere pairs a name with a direction. `SCOPE-ai-features.md` §9 item 10; **not blocking** by
  maintainer decision.
- **"The AI echoed my anonymous card."** A proposal whose substance resembles someone's anonymous
  card can make a participant *believe* the pipeline read it. It did not — the fact assembly reads
  work-graph tables only, under a table allowlist that excludes every retro content table, asserted
  by a merge-blocking test in change 18. → *Documented in the feature docs in those terms*, because
  the perception is real even though the mechanism is impossible, and a reader who understands why
  it is impossible stops worrying about it. **Not blocking** by maintainer decision.
- **A facilitator who advances early truncates the window.** Reactions after `vote → discuss` are
  rejected. → The control is the facilitator's, as every phase advance is; the rejection is explicit
  and the existing `invalidPhase` copy names the phase. Stepping back one phase reopens the window
  and clears the stale verdict (D5).
- **Verdict drift between the stamp and later reactions.** There are none: reacting is impossible
  after the stamp unless the facilitator steps back, which clears it.
- **A new synced table is a new anonymity surface.** → It carries no card, no body and no author
  binding; it is covered by the registry anonymity walk (`queries.anonymity.pg.test.ts` asserts
  covered == registry, so a new query cannot escape it) and by the schema-drift test.

## Migration Plan

`0020_retro_ratification`, forward-only, applied at boot like every other:

1. `create table retro_ai_reaction` + indexes on `retro_id` and `team_id`.
2. `alter table retro_ai_proposal` add `verdict text check (verdict in ('agreed','contested','rejected','unrated'))`,
   `agree_count integer`, `disagree_count integer`, `ratified_at timestamptz` — all nullable, all
   written once. A pre-existing proposal row keeps them null and renders exactly as it does today.
3. `alter table retro_action` add `ai_proposal_id uuid references retro_ai_proposal(id) on delete set null`.

Every column is additive and nullable, so the migration is safe against live data and the previous
app version keeps working against the new schema. The CHECK constraint text for both new enums is
exported once from `zero/context.ts` as a plain string (the `AI_ARTIFACT_STATUS_CHECK` precedent —
`context.ts` is in the client bundle and must not acquire a kysely import) and wrapped in
`sql.raw(...)` by the migration, so the migration and the TypeScript union cannot drift.

Rollback: the `down` drops the table and the columns. No data transformation, so a rollback loses
only ratification data.

## Decisions made during implementation

### G1 — The `SCOPE-ai-features.md` §9 item 1 gate was raised and consciously waived

`SCOPE-ai-features.md` §9 item 1 requires that, **before change 19 is built**, a human read three
real change-18 drafts generated from real cycle data — one connectors-rich, one cycles-only — and
say whether they are worth a team's attention or are "the sparkline with sentences". That gate is
the entire reason change 18 shipped alone.

**It was surfaced to the maintainer, who elected to proceed with change 19 anyway and answered
items 8 and 9 directly in the same pass. The three-draft read was NOT performed.**

Recorded plainly rather than omitted, because the omission changes what this change's green CI
means. Everything below is still true and testable: the reactions are private, the verdict matches a
hand-count, no counter exists, the converted issue has no assignee. What remains **unverified by any
test in this repo** is the premise underneath all of it — that the proposals being ratified are
worth ratifying. If the drafts turn out to be thin, this change is a well-built ceremony around
noise, and that will be visible to a human reading a real retro and to nothing else.

The maintainer's answers to the other three open items, taken as settled and not re-litigated:

- **§9 item 8 (the verdict rule)**: any single disagree ⇒ contested. Knob-free, no config, no
  threshold. → D3.
- **§9 item 9 (asymmetry)**: ratification applies to AI proposals only. → D2.
- **§9 item 10 (the two residuals)**: document both, neither is blocking. → Risks / Trade-offs, and
  the feature docs.

### G2 — Contested-first reorders the whole section, so the category headings give way to per-row chips

D9 says "contested first, then the rest in the existing `(category, rank)` order", and the spec
scenario says *every* contested proposal renders before *every* non-contested one. Those two
together are a **global** order, which the shipped rendering — three category `<section>`s with
headings — cannot express: sorting inside each section would bury a contested Improvement under a
column of agreed Wins, which is exactly the routing failure the ordering exists to prevent.

**Chosen:** before the stamp the section is byte-identical to what change 18 shipped — three
headed category groups. From the stamp onward it becomes one flat list in contested-first order,
and each row grows its own category chip so nothing is lost with the headings. The switch keys off
the presence of a verdict rather than the phase name, so a step back that clears the verdicts (D5)
puts the headings back in the same tick.

### G3 — The verdict badge distinguishes contested by accent and everything else by words alone

Four verdicts, three of them (`agreed`, `rejected`, `unrated`) with no shipped semantic token that
is AA in Warm, Focused and Editorial in both light and dark on `bg-bg-elevated`. Hand-rolling three
new colour pairs to make them distinguishable by hue would have been three new AA obligations for a
distinction the words already carry — and it would put meaning in hue, which the retro surface
refuses everywhere else (`RetroAccentBar`: "colour is reinforcement only").

**Chosen:** `contested` takes `Badge variant="accent"` because it is the routing signal; the other
three take `variant="outline"` and are told apart by their text. This is the same discipline
`ConfidenceNote` already states in a comment: "the distinction is carried by the words, not by
dimming one of them below AA". The reaction toggles follow suit — pressed is a border **and** a soft
fill **and** `aria-pressed`, never hue alone.

### G4 — `clearRetroAiReaction` reads its own row before deleting

The palette offers "Clear my reaction" from a focus snapshot, and a delete of a row that is not
there would be an error for a no-op. **Chosen:** the mutator reads the caller's own
`(proposalId, userID)` row and returns early when there is none, making the clear idempotent. The
read is self-addressed and runs *after* the authorization prologue, so it discloses nothing and does
not weaken the no-existence-oracle property: on a client the only reaction row that exists at all is
the caller's own.

### G5 — The command palette holds a focus SNAPSHOT, not a proposal id

The four palette entries need the focused proposal's body, category, verdict and the caller's own
reaction. Resolving an id inside the palette would mean querying the AI tables from
`RetroCommandProvider`, which is mounted for **every** retro — including a team that never opted in,
whose whole guarantee is that it issues no AI query at all.

**Chosen:** `setFocusedAiProposal` takes a snapshot object, built by the panel from its own already-
synced rows at the moment focus lands (the `onFocusCapture` pattern the board and action list use).
A team with no AI panel never calls it, so the palette's AI group is structurally absent rather than
conditionally hidden. The snapshot can go stale between a focus event and the palette opening; the
only field where that matters is `mine`, and acting on a stale `mine` is idempotent either way.

### G6 — The two reaction mutators are entered in the AI tool registry, as plain writes

`buildMutatorToolSpecs` is exhaustive over `defineMutators` by construction and throws on a mutator
it has no classification for, so registering the reaction mutators in the client map forces two
entries. **Chosen:** both are `write`, classified with the `notification.markRead` reasoning — the
user half of the key comes from the verified ctx, so an agent acting for a member can only ever
write that member's own row.

**The hazard this does not remove, recorded rather than buried:** an agent with write tools could
agree with a proposal an AI wrote. `needsApproval` is unconditionally true for every mutator tool,
so a human is in the loop — but that approval is the *only* thing standing between the model and
ratifying its own output, and the registry has no exclusion mechanism to express "never this one".
If a later change wants ratification to be un-delegable, it needs a real opt-out list in
`ai-tools.ts`, not a comment.

### G7 — The replica evidence for task 1.5 was NOT collected in this pass

Task 1.5 asks for `0020` to be applied against a running `zero-cache` from `down -v` on the
`yapm-rr` project, with the change-streamer log confirming that `retro_ai_reaction` and the altered
columns reach the replica. **The build instruction for this pass explicitly forbade running
`docker compose`**, on the grounds that the open PR already runs the full suite (including the
compose smoke test) in CI.

Recorded as an open gap rather than ticked: the migration is written and registered, the Kysely `DB`
interface and the Zero schema were updated together, and `db/schema-drift.test.ts` now pins the new
table, its compound primary key, both altered tables' columns and the no-counter property — but that
test needs a database, so **nothing in this pass observed the new table reaching a replica.** CI's
pg jobs and the compose smoke test are where that is actually established.

### G8 — Groups 5 and 6 are not in this pass

By the same instruction, this pass covers tasks groups 1–4; the pg integration tests (5.2–5.9), the
component tests (5.10–5.11) and the documentation (group 6) belong to the Close phase and are
unticked. What *was* done, because leaving it undone would have left the tree red: `ratify.test.ts`
(5.1, pure, no database), the `phase.test.ts` matrix row for `react`, the `schema-drift.test.ts`
shapes and assertions, the `queries.anonymity.pg.test.ts` registry entry that keeps
covered == registry true, and the existing `retro-ai-panel.test.tsx` mounts.

### G9 — The pressed toggle's ink is `text-1`, and the contested badge is SOLID: G3 shipped an AA failure

G3 chose `Badge variant="accent"` for `contested` and `text-accent-strong` for a pressed reaction
toggle, on the reasoning that `contested` is the routing signal and deserves the accent. Both put
**`--accent-strong` on a soft-accent wash**, and measured against the six preset blocks that pair
lands at:

| | ratio |
|---|---|
| Warm light / dark | 4.55 / 5.30 |
| Focused light / dark | **4.38** / **3.95** |
| Editorial light / dark | **3.94** / 4.89 |

Three of six are under AA for 11px text — and `packages/ui/src/styles/contrast.test.ts` had already
written that fact down at the mention typeahead ("`--accent-strong` over the soft-accent wash lands
at ~3.9 in three of the six presets"), which is exactly why the mention list carries `text-1`/`text-2`
ink on an accent-washed row. G3 reached for the pair anyway; nothing failed, because no test covered
the AI panel's toggles and `Badge variant="accent"` had never been used on a product surface before
this change — only in the showcase.

**Chosen:**

- The pressed toggle keeps the border and the soft fill and steps its ink up to **`text-1`**
  (11.08–16.10 across the six). Pressed is still carried by three signals plus `aria-pressed`; only
  the one that could not be read is gone.
- `contested` takes **`Badge variant="solid"`** (`bg-accent text-on-accent`), whose pair the contrast
  file already asserts at AA in all six. It is a stronger routing marker than the soft chip, not a
  weaker one.
- `contrast.test.ts` grows both toggle states as a pinned pair, plus a bounded note recording why the
  `accent` badge variant is not used on this surface — so the obvious future edit ("make the pressed
  state look more accented") fails in CI instead of shipping.

This is the AA half of task 4.5, done by measurement rather than by eye. The keyboard half is task
5.1's e2e walk; the "every colour is a token" half is visible in the file — every class in
`retro-ai-panel.tsx` resolves through a semantic token, with no literal colour anywhere.

### G10 — Keyboard proof is split: element nature in jsdom, real keystrokes in Playwright

jsdom does not synthesize a `click` from Enter on a focused `<button>`, and this repo has no
`@testing-library/user-event` — adding one for this would be a new dependency for a claim a browser
already settles.

**Chosen:** the component test asserts what jsdom can actually see — the toggles are real `BUTTON`s,
not disabled, no negative tabindex, focusable, carrying `aria-pressed` — which is the discipline
`follow-control.test.tsx` already states in a comment ("asserting the element's nature is the honest
jsdom proof; the real keystroke is an e2e concern"). The real Tab/Enter walk, including the
withdrawal, lives in `retro-ai.spec.ts`.

### G11 — "No counter is written" is asserted from RECORDED SQL, not from the absence of a call

The claim the whole design rests on is negative, and a negative is the easy thing to assert
vacuously. `createDatabase` already accepts a `log` callback, so the pg test builds its database with
one, snapshots the statement list around the two concurrent reactions, and asserts over that slice:
every write names `retro_ai_reaction` and nothing else, no statement matches `set …count…`, no
statement mentions `retro_vote_tally`, and no `update retro_ai_proposal` happens at all while a
reaction is being recorded. Bumping a counter anywhere on that path fails on the statement text
rather than on a downstream number that might still happen to be right.

The same recorder proves the opted-out case: a retro whose draft was deleted advances `vote → discuss`
issuing no statement that mentions a reaction or updates a proposal.

### G12 — The anonymity walk now carries a real reaction row, and the offence list grew by one

Task 5.9 asks that the registry walk grow by exactly the new query with no allowlist edit. The
registry entry alone satisfies "covered == registry", but it would have walked an **empty table** —
and a self-scoped query over no rows is indistinguishable from a leak-free one.

**Chosen:** the anonymous retro now seeds an AI draft, one proposal and A's own `disagree`, so the
walk really traverses `retro_ai_reaction`. The consequences, both deliberate:

- `IDENTITY_BY_DESIGN` is **unchanged** — a reaction is not identity-by-design, so any of them
  reaching B or C fails the two existing tests. That is the point of not editing the allowlist.
- The "finds the author's id when the author is the one asking" list grows from three entries to
  four. That test exists to prove the walk can find something; the fourth entry is the new thing it
  can find, and its absence would have meant the sweep never reached the table.
- The per-principal sweep gains a reaction leg beside drafts and votes, with an explicit non-vacuity
  assertion that A really holds a row.

### G13 — What this pass did NOT establish

Two boxes stay unticked, and neither is quietly ticked:

- **Task 1.5 (replica evidence)** — still open, for the reason §G7 gives: `docker compose` was
  forbidden in both build passes. CI's compose smoke test is where the migration is observed reaching
  a replica.
- **Task 7.1 / 7.3 (full build, compose smoke)** — not run locally by instruction, because the open
  PR runs the whole suite on every push. The fast gates (typecheck, lint, test, boundary check) and
  the docs build were run here.

The pg and e2e specs written in this pass were **not executed locally** — they need a live Postgres
and a live stack respectively. They typecheck and lint; CI is where they first run. Said plainly
because "the tests are written" and "the tests pass" are different claims.

<!-- Further entries appended during the build phase: what was ambiguous, what was chosen, and why. -->
