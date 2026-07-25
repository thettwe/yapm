## Context

yapm has cycles with auto-rollover (change 5), a triage inbox (6), projects (7), a GitHub connector feeding a real work graph (8), and a BYO-key AI substrate whose first flagship is the team-internal cycle digest (9). What it does not have is the surface where a team *decides what to change* — and the whole retro category executes its own "Gather data" phase from human memory because no retro tool owns the delivery data.

This change builds the retro that only yapm can build. The board is deliberately small and unremarkable; the differentiator is the **seed** and the **action → issue loop**. If we ship a generic sticky-note whiteboard we lose: Parabol owns credible OSS retro and Metro Retro/Miro own canvas polish. Research verdict and shape: `reference/research/retro-synthesis.md`; build plan: `retro-implementation.md`; panel contents: `retro-data-informed.md`; formats/landscape: `retro-formats.md`, `retro-competitive.md`; the seams to leave (and build nothing of): `retro-ai-facilitation.md`.

Binding constraints, in force before any code: three containers (no new service — the existing Postgres and pg-boss only); all ZQL and all mutators in `packages/schema`, imported by both client and server; client-minted UUIDv7 at the **call site**, never inside a mutator body; row-level permissions deny by empty query and check auth **before** existence; tokenized styling correct in Warm/Focused/Editorial, light and dark, at AA; keyboard-first; sub-100ms; kysely 0.28.17, no kysely-codegen, no TS-Compiler-API tooling.

The load-bearing verified fact from `reference/zero.md`: **Zero read permissions are filter-based and row-level. There is no column-level read permission and no `select()` — queries always return whole rows.** Zero also has **no aggregates** (`count`/`group by`). Both facts shape the entity model below far more than any product preference.

## Goals / Non-Goals

**Goals:**

- A retro whose "Gather data" phase is pre-filled from the work graph, degrading gracefully from *connectors present* to *cycles only* — and useful in the cycles-only case, which is every team on day one.
- Anonymity that is true at the storage layer: a client must be **structurally unable** to learn who wrote an anonymous card, not merely not shown it.
- A phase machine a crafted mutation cannot cheat.
- Action items that are real issues in the next cycle, created through the same path and permissions as any other issue.
- Auto-open at cycle close on the existing pg-boss pass; no new container, job type, or env var.
- Team-level and blameless as a *schema* property, not a copy choice.

**Non-Goals:** AI drafting/facilitation of any kind (later change); DORA/MTTR health metrics (Phase 3, seam only); collaborative rich-text or pixel cursors; per-individual anything; reveal-on-close; a template editor; formats beyond the four starters.

## Decisions

### D1 — Entity set and relationships

Ten tables; nine synced, one server-only. All are team-scoped (`team_id` on every row) and permission-anchored on team membership, exactly as `cycle` is. Every ordering field is a fractional-index string (`rank`), reusing `packages/schema/src/zero/rank.ts` and the board's single-write move.

| Table | Shape (beyond `team_id`, timestamps) | Sync |
|---|---|---|
| `retro` | `cycle_id` (nullable, **unique when set**), `next_cycle_id`, `title`, `format`, `phase`, `facilitator_id` (nullable), `is_anonymous`, `votes_per_participant`, `timer_ends_at`, `timer_duration_s`, `created_by`, `closed_at` | team-scoped |
| `retro_column` | `retro_id`, `key`, `title`, `accent_token`, `rank` | team-scoped |
| `retro_draft` | `retro_id`, `column_id`, `author_id`, `body`, `seed_ref` (json), `published_at` | **own rows only** (`author_id = ctx.userID`) |
| `retro_card` | `retro_id`, `column_id`, `group_id`, `body`, `rank`, `is_anonymous`, `author_display_id` (nullable), `seed_ref` | team-scoped |
| `retro_group` | `retro_id`, `column_id`, `label`, `rank` | team-scoped |
| `retro_vote` | `retro_id`, `target_type`, `target_id`, `voter_id` | **own rows only** (`voter_id = ctx.userID`) |
| `retro_vote_tally` | PK = `target_id`, `retro_id`, `target_type`, `count` | team-scoped |
| `retro_action` | `retro_id`, `group_id`, `card_id`, `body`, `assignee_id`, `target_cycle_id`, `issue_id` | team-scoped |
| `retro_presence` | PK (`retro_id`,`user_id`), `focus_target`, `last_seen_at` | team-scoped |
| **`retro_card_author`** | PK `card_id`, `retro_id`, `author_id` | **NONE — absent from the Zero schema** |

```
team 1─* retro *─1 cycle (reflected)   retro *─1 cycle (next → action target)
retro 1─* retro_column 1─* retro_card *─0..1 retro_group
retro 1─* retro_draft   (private; publishes into retro_card, same id)
retro 1─* retro_vote → (card | group)   retro_vote_tally keyed by that target
retro 1─* retro_action ─0..1 issue ─1 cycle(next)
retro 1─* retro_presence
retro_card 1─1 retro_card_author  (server-only, never synced)
```

*Why a tally table:* Zero has no aggregates and a client cannot count rows it cannot see, so the per-target count must be a real row. Its primary key is the **target id** (a card or group id, already client-minted and unique), which means the vote mutators can `upsert` it without minting anything inside a mutator body.

*Alternatives rejected:* a single `retro_item` table with a discriminator (loses FK integrity and makes the vote-target rule unexpressible); grouping by a `parent_card_id` self-reference (makes "a group with a label and its own rank" awkward and breaks the single-write move); columns as an enum in code (kills custom formats and per-column accent tokens for no gain, since rows cost nothing).

### D2 — The anonymity boundary (the crux)

**Constraint, restated precisely:** Zero syncs whole rows. If `author_id` is a column on a synced `retro_card`, every participant's browser has it in IndexedDB and anonymity is cosmetic. This is a privacy bug, not an implementation detail.

**The model, in three parts:**

1. **`retro_card_author(card_id → author_id)` is a server-only table, absent from the Zero schema entirely.** It is the authorization and moderation source of truth (may this caller delete this card?) and the audit record. The schema-drift test asserts its absence from the Zero schema, exactly as it already does for `issue_sequence` and `cycle_sequence`. Because no synced query can even *name* a table outside the Zero schema, the leak is structurally impossible rather than merely unwritten. It reaches zero-cache's trusted internal replica (Zero's default `FOR TABLES IN SCHEMA public` publication) and stops there — the same accepted boundary the connectors change documented for its secret tables.
2. **An anonymous `retro_card` carries no author value.** `author_display_id` is written **only** for a non-anonymous retro; for an anonymous retro it is null on the synced row, so there is nothing to strip.
3. **Private brainstorming lives in a separate table, not in a filtered view of the card.** `retro_draft` rows carry `author_id`, and their **only** synced query is `zql.retro_draft.where('authorId', ctx.userID)` — driven by the verified context, never by args, and with **no workspace-admin bypass** (an explicit deviation from the shared `teamScoped` helper, which grants admins workspace-wide read). You cannot receive another person's draft, so you cannot learn its author.

**Why the draft table exists at all.** "Hide other people's cards during brainstorm" cannot be expressed as a read filter over `retro_card` without an author dimension **in the Zero schema** — ZQL filters can only reference schema tables, and putting the author back on the card is precisely the bug we are avoiding. A per-user opaque "slot" on the card row was considered and rejected: it clusters an author's cards under one pseudonym, which is a real deanonymization vector in a 2–20 person team. Splitting the private phase into its own table dissolves the conflict: during `brainstorm` nothing is in `retro_card` yet, so there is nothing to hide; after publish there is no author to leak.

**Publish.** Advancing forward out of `brainstorm` publishes every unpublished draft: insert `retro_card` **with the draft's own id** (client-minted at the original call site — nothing is minted inside a mutator, and re-running is an idempotent upsert), set `author_display_id = is_anonymous ? null : author_id`, write `retro_card_author`, stamp `published_at`. Publish runs **only in the server override** (`tx.location === 'server'`), because a client's `tx.run` sees only its own drafts and would otherwise publish a partial board optimistically; the phase flip itself stays in the shared mutator so it is still instant.

**Consequence, accepted deliberately:** a published anonymous card has no client-visible owner, so **body edits after publish are not offered to anyone**; deletion during `group`/`vote`/`discuss`/`actions` is facilitator/admin moderation, authorized server-side against `retro_card_author`. The author's own retained draft row is their personal record of what they wrote (and follows them across devices, since it syncs to them alone). This is simpler than a per-card ownership dance and it is what makes the guarantee auditable.

**Votes.** `retro_vote` keeps `voter_id` because the budget needs it, and syncs **only to the voter** by the same self-filter. Everyone else sees the `retro_vote_tally` count. A client therefore gets an instant optimistic dot (its own row plus the tally increment — sub-100ms) while who voted for what never leaves the server for anyone but the voter. The alternative — a fully server-only vote table — was rejected because it makes voting wait on the network for both the dot and the remaining-budget readout.

**Reveal-on-close is a non-goal.** Default is never reveal, and no code path copies `retro_card_author.author_id` onto a synced row.

### D3 — Phase state machine, enforced in the server mutators

`PHASES = ['brainstorm','group','vote','discuss','actions','closed']`, ordered.

- `retro.setPhase({id, to})` accepts **only** an adjacent phase: exactly one step forward, or exactly one step back. Non-adjacent targets (including "skip to closed" and "rewind to brainstorm") are rejected with `MutationErrorCode.invalidPhase`. Entering `closed` stamps `closed_at`; the one legal step back out of it clears it.
- Only the **facilitator or a workspace admin** may change phase. `facilitator_id` is nullable (an auto-opened retro has none until someone runs it): while null, any non-viewer team member may claim it via `retro.claimFacilitator`; `retro.setFacilitator` hands off.
- **Every retro write mutator re-reads the retro's current phase and consults one pure predicate**, `isRetroWriteAllowed(phase, op)`, before applying. The predicate is exported from `packages/schema`, unit-tested exhaustively over the phase × operation matrix, and the same function drives the UI's affordances — so the UI and the authority can never disagree, and the UI is a convenience rather than the enforcement.

| Phase | Allowed | Blocked |
|---|---|---|
| `brainstorm` | create/edit/delete own draft; configure format, anonymity, budget; timer; presence | cards, groups, votes, actions |
| `group` | move a card, create/label/dissolve a group, reorder; facilitator card deletion | new drafts, votes, actions |
| `vote` | cast/retract own vote within budget; facilitator card deletion | card/group edits, drafts, actions |
| `discuss` | create/edit/delete actions; convert action → issue | drafts, cards, groups, votes |
| `actions` | finalize actions (assignee, target cycle); convert action → issue | drafts, cards, groups, votes |
| `closed` | read only; convert an already-created action → issue | everything else |

Rationale for enforcing in the mutator rather than the UI: with optimistic local writes, a client-only gate is a suggestion. The server checks the retro's phase **at apply time**, so a write racing a phase advance is rejected and Zero rolls the optimistic write back. Anonymity is also settable only while `phase = 'brainstorm'` — before any card exists — which makes the guarantee crisp: a retro's anonymity is fixed before there is anything to attribute.

### D4 — The voting budget rule

One knob: `votes_per_participant`, default **3**, range 1–10, settable only during `brainstorm`. One `retro_vote` row is one dot; stacking multiple dots on the same target is allowed (classic dot voting), bounded only by the total. The budget is enforced by counting the caller's own rows in this retro — a count the client has in full, so the UI self-limits and the server is authoritative on a race (Zero rolls back the over-budget optimistic dot).

**Target rule:** a vote targets a `group` if the card has been grouped, otherwise the `card` itself; the mutator rejects a vote on a grouped card. This avoids the alternative of auto-creating a singleton group per ungrouped card at the `group → vote` transition, which would mint ids inside a mutator — forbidden.

### D5 — The data-seed panel, and what each section shows with no connectors

One pure function in `packages/schema`, `buildRetroSeed(input): RetroSeed`, over synced rows (the cycle's issues, their linked PRs/reviews/CI checks, and up to three prior completed cycles of the same team). Pure and deterministic, so it is unit-testable and identical on client and server. It mirrors — and deliberately does not merge with — `cycle-facts.ts`, which is the *AI digest's* server-side narrowed read; the panel is a live client-side computation because it must be sub-100ms and correct offline.

| Section | With connectors | **With no connectors (day one)** |
|---|---|---|
| **Delivered** (cycles only) | identical | **Fully populated**: shipped, carried out, carried in, carried **twice or more**, added mid-cycle, canceled, total — each with a sparkline against the prior cycles and a blameless caption |
| **Flow** | median PR cycle time, median time-to-first-review, review rounds, issues with no linked PR, CI failing rate | Section renders a single quiet empty state naming exactly what would light it up ("Connect GitHub to see PR cycle time and review wait"). No zeros, no fake charts, no chart chrome. |
| **Health** (DORA/MTTR) | — | **Not produced at all.** Phase 3. The `RetroSeed` type carries no health field; the seam is the section list being open for extension. |

Two `issue` columns make Delivered honest rather than inferred: `carryover_count` (incremented by the existing `cycle.complete` rollover — deterministic, args-derived, idempotent under the existing status guard) gives "carried twice or more", and `cycle_assigned_at` (stamped by `issue.create`, `issue.setCycle`, and the rollover) gives "added mid-cycle" precisely, instead of the `created_at > start_date` approximation. "Removed from scope" needs an assignment event log and is a stated non-goal.

**Guardrails encoded, not documented:** `RetroSeed` is a type with **no user field anywhere** — no assignee, author, reviewer, creator, or user id — so the panel physically cannot render a per-person number; a unit test walks the produced object graph and fails on any identity-shaped key. Speed and stability ship as a pair in Flow (cycle time next to CI failing rate). Captions are pure templates that narrate the system ("review wait was the largest slice of lead time this cycle"), never a person. Trends lead; absolutes are secondary.

**Evidence-anchored cards:** a widget offers "add a card from this" which seeds a draft with `seed_ref` (`{kind:'issue'|'pull_request'|'ci_check'|'widget', id, label?}`, reusing `DigestEvidenceRef` from the AI change), and the card renders a chip linking back. That is the join no whiteboard tool can make, it costs one nullable json column, and it is the same grounding contract the later AI change needs.

### D6 — The action → issue loop

`retro.convertActionToIssue({ actionId, issueId, createdAt, updatedAt })` — **the new issue's id is minted at the call site** and passed in, like every other create.

Server checks, in order: `canWrite`, team access, phase ∈ {`discuss`,`actions`,`closed`}, `issue_id IS NULL` (idempotent — a second call is a no-op, not a duplicate issue). It then calls the **shared `issue.create` mutator function** (`mutators.issue.create.fn({tx, args, ctx})`, the same composition `createServerMutators` already uses) with `teamId = retro.team_id`, `title` = the action body's first line, `cycleId = action.target_cycle_id ?? retro.next_cycle_id`, `assigneeId = action.assignee_id`, and a description linking back to the retro — then sets `retro_action.issue_id`. Its **server override claims the per-team issue number** in the same authoritative pass, so a converted action is indistinguishable from a hand-created issue: same triage defaults, same permissions, same reality strip, same auto-rollover.

Rejected: a bespoke insert into `issue` (would silently skip numbering, triage defaults, and future create-path behavior) and returning the new id from the mutator (Zero mutators cannot return data).

### D7 — Auto-open at cycle close, on the existing trigger

A retro row needs an id, and ids are never minted inside a mutator — so `cycle.complete` cannot create one. Instead `retro.openForCycle({ id, cycleId, format, columns:[{id,key,title,accentToken,rank}] })` is called **by the same two call sites that already complete a cycle**: the Cycles view's Complete-cycle action (client mints the ids) and `runCycleMaintenance` (the job mints them — a job is a call site like any other). The mutator no-ops if the cycle already has a retro; a unique index on `retro.cycle_id` is the backstop, so the button racing the scheduler produces exactly one retro. Columns are validated against the named format template (a pure `RETRO_FORMATS` map), so a client cannot inject arbitrary columns under a known format name.

The auto-opened retro has `facilitator_id = null` (the scheduler is not a person) and `next_cycle_id` resolved with the same deterministic `nextCycleId` the rollover already uses. The maintenance pass also prunes `retro_presence` rows older than five minutes — one extra delete in an existing job, no new job type and **no new env var** (`CYCLE_MAINTENANCE` still gates the pass).

No opt-out toggle ships: a retro nobody opens is one empty row, and a knob would be a config-sandbox wart. An admin can delete it.

### D8 — Timer and presence

The timer is **durable state, never ticks**: `retro.startTimer({id, durationS})` sets `timer_ends_at`; each client renders `endsAt − now` locally with a local interval. The shared mutator computes the end from the call-site clock so the optimistic render is instant; the **server override recomputes it from the server clock**, which is authoritative and kills client skew. Facilitator/admin only. Presence is a coarse, throttled heartbeat row (every ~10s and on focus change, column-level granularity — no pixel cursors), self-write only (`user_id` from `ctx`), pruned by the maintenance pass. Both choices exist to keep the 3-container promise: no sidecar WebSocket service, no Redis.

### D9 — Formats, keyboard, tokens

Four starter formats as column-sets over one board engine: `wentwell_didnt_action` (default), `start_stop_continue`, `mad_sad_glad`, `4ls`. Sailboat/Starfish/KALM/DAKI and a template editor are deferred; the `retro_column`-as-rows model already supports custom formats, so only the editor UI is the deferred cost.

Keyboard (mirroring the issue list's model, every entry also in the command palette): `c` new card in the focused column, `Enter` submit-and-stay, arrows move focus, `v` vote / `Shift+V` retract, `g` group with…, `a` new action, `⌘/Ctrl+Enter` convert action → issue, `]` / `[` advance / step back (facilitator), `t` timer, `Esc` leave the editor. Every surface fully operable without a pointer.

Every color comes from a semantic token — `retro_column.accent_token` stores a **token key, never a hex** — and a converted action renders its issue's status with the existing status tokens so the retro looks like the tracker. Correct in Warm/Focused/Editorial, light and dark, at AA.

### D10 — Seams the later `retro-ai-facilitation` change attaches to (build none of them)

1. **`buildRetroSeed` / `RetroSeed`** is the agent's input contract: already team-level, already identity-free, already the thing the AI must not be given names in.
2. **`retro_draft`** is the propose-not-decide write path — an AI actor drafts under the invoking user's `AuthContext` and its cards enter through the same publish step as a human's, with no new write surface.
3. **`seed_ref`** on drafts/cards is the grounding/evidence link the AI change's cite-or-omit validator requires, reusing `DigestEvidenceRef`.
4. **The phase machine and `isRetroWriteAllowed`** are the extension point for an agree/disagree ratification step: a future phase or per-card reaction slots into the ordered list and the matrix without touching any existing mutator's authority.
5. **The AI-off fallback is already the product**: this change *is* the manual data-informed retro that the AI later drafts on top of, so "AI disabled" never degrades the ceremony.

Nothing in this change calls a model, stores a model output, or adds an AI column.

## Risks / Trade-offs

- **Anonymity is one careless synced query away from being a lie** → the author lives in a table the Zero schema cannot name; an integration test enumerates **every** query in the registry, runs each with a non-author member's context, and asserts no result reveals an anonymous card's author; the drift test asserts `retro_card_author` stays out of the Zero schema. Both are merge-blocking.
- **The self-filtered `retro_draft` / `retro_vote` queries must not use the shared `teamScoped` helper**, which grants workspace admins a bypass → they are written as bare `where('authorId'|'voterId', ctx.userID)` with a comment stating the deviation, and a test asserts an admin who is not the author receives nothing.
- **Optimistic/authoritative divergence at publish** (a client sees only its own drafts) → publish is server-only; the phase flip stays optimistic, so the interaction is still instant and the rest of the cards arrive a sync tick later.
- **Vote double-spend under optimism** → budget enforced server-side; the UI self-limits from the live count; Zero rolls the rejected dot back.
- **Presence write churn** → coarse granularity, ~10s throttle, column-level focus only, pruned in the existing pass.
- **A thin seed on day one** (no connectors ⇒ no Flow) → the Delivered section is fully populated from cycles alone and is the single most retro-relevant view; Flow's empty state names exactly what to connect rather than rendering hollow zeros.
- **Ceremony sprawl** → the board is deliberately small (four formats, no canvas, no GIFs, no icebreakers); the wow is the panel, and every deferral is written down as a non-goal.
- **Two new `issue` columns touch the hottest table in the schema** → both are additive and nullable-or-defaulted, written only by mutators that already write that row in the same transaction, and covered by the drift test.

## Migration Plan

Forward-only Kysely migration `0012_retro`, applied automatically at boot like every other: create the nine synced tables plus the server-only `retro_card_author`; add `issue.carryover_count` (not null, default 0) and `issue.cycle_assigned_at` (nullable); add the unique index on `retro.cycle_id` and the FK/lookup indexes the synced queries need (Zero derives its indexes from upstream, so they belong in Postgres). No backfill: existing completed cycles get no retrospective, and `carryover_count` starts at 0 for every issue, so early Delivered trends simply have fewer prior points. Rollback is a fresh-volume redeploy or a manual drop of the new tables/columns; nothing else reads them.

## Open Questions

None blocking. Deliberately deferred and recorded above: reveal-on-close, a template editor, additional formats, async/multi-day facilitation affordances, richer presence, and pin/unpin of panel widgets.

## Decisions made during implementation

### Schema phase (groups 1–2)

**D-1 — `retro_draft` carries a call-site `rank`, copied onto the published card.** The design specified publish as "insert the card with the draft's id" but never said where the card's `rank` comes from, and publish runs inside a mutator where nothing may be minted. Adding `rank` to `retro_draft` (minted at the draft's own call site, like every other rank) resolves it: publish copies it. Ranks are minted per author over rows only that author can see, so two authors can mint the same first key; cards therefore sort by `(rank, id)`, which is deterministic and identical on every client. The alternative — a nullable card rank filled in by the first move — would leave the freshly revealed board in an undefined order.

**D-2 — `retro_column.accent_token` stores a retro-SEMANTIC key, not a CSS token name.** `RETRO_COLUMN_ACCENTS = positive | negative | caution | neutral | action`; `packages/ui` maps each to a theme token. Storing `status-done` would bake a stylesheet variable name into Postgres and break the moment the token set is renamed; storing a hex was already forbidden. The DB has a CHECK constraint on the five keys, so a column accent is closed-set at the storage layer.

**D-3 — the format is changeable in `configure`, but only while the retro has no drafts and no cards.** Task 2.2 asks `configure` to cover format; a format change replaces the columns, and columns cascade to drafts/cards. Rather than drop the capability or silently destroy other people's drafts, the mutator requires the new format's columns in the same call and refuses when any draft or card exists. A client cannot see other members' drafts, so its optimistic swap may be rejected by the server — the same optimistic/authoritative divergence the vote budget already has, and the reason the check lives server-side.

**D-4 — `configure` is facilitator/admin, and a facilitator is never auto-assigned.** Anonymity and the vote budget are trust-relevant settings, so they follow the same gate as the phase machine rather than being open to any member. `openForCycle` therefore always writes `facilitator_id = null` (for the deliberate action as well as the scheduler, since they are the same mutator), and whoever runs the retro claims the seat with `retro.claimFacilitator` — one keystroke, and it keeps the auto-opened and hand-opened retro identical.

**D-5 — presence and facilitation are allowed in every phase, including `closed`.** The design's matrix says a closed retro is read-only. A heartbeat is liveness, not retro content, and "who's here" has to stay accurate while a closed retro is being read; facilitation is control, and locking it in `closed` would strand a retro whose facilitator left. Both are their own operations in the matrix (`presence`, `facilitate`) and the exhaustive unit test pins exactly which operations survive `closed`: `convert`, `facilitate`, `presence`.

**D-6 — the vote tally is incremented atomically in SQL on the server; the shared mutator writes it only on the client.** A read-then-write count loses updates precisely when a whole team votes at once, which is the normal case. The shared mutator computes the optimistic tally (so the dot and the readout are instant) and returns before the tally write when `tx.location === 'server'`; the override then does one row-locked `insert … on conflict do update set count = count + 1`, the same pattern as the per-team sequence counters. Without the split the server would double-count.

**D-7 — a vote's target has no FK, so the mutators clear dots when a target stops being votable.** `retro_vote.target_id` is polymorphic (card or group), so Postgres cannot cascade it: deleting a card or dissolving a group would otherwise leave dots charged against voters' budgets forever. `retroCard.delete`, `retroGroup.dissolve` and the auto-dissolve inside `retroCard.move` all clear the target's votes and its tally row in the same write pass.

The invariant is wider than "the target row was deleted", and the first cut of the implementation got both edges of it wrong:

- **Emptying a group by deleting its last card left the group alive.** `retroCard.move` and `retroGroup.create` both dissolved a group their write had emptied; `retroCard.delete` cleared the card's own dots and stopped there. In the `vote` phase (where `moderate` is allowed) a facilitator deleting the only card in a group left an empty group still rendered, still votable, and still holding its voters' dots. `retroCard.delete` now runs the same `dissolveEmptyGroup` pass the other two do, after the card row is gone so the emptiness check sees it.
- **A card absorbed into a group kept its own dots.** A grouped card is voted on through its group, so joining one retires the card as a vote target — but its existing `retro_vote` rows and tally row survived, unreachable and still charged. Reachable whenever a facilitator steps back from `vote` to `group` to regroup. `retroCard.move` and `retroGroup.create` now clear a card's own dots as it joins a group.

Both cases refund the dots rather than migrating them to the group, matching what dissolving a group already does: a target that stops being votable returns its dots to their voters' budgets.

**D-8 — a card's author may delete their own card, proven without any client learning an author.** The design left post-publish deletion as facilitator/admin moderation "authorized against `retro_card_author`", but that table cannot be named by a client, so the shared mutator could never offer an author path. The shared mutator accepts facilitator/admin **or** a caller who holds the retained `retro_draft` row with the same id (self-synced, `author_id` written from `ctx`, unforgeable for someone else's card); the server override re-verifies the non-facilitator path against `retro_card_author`, which stays the final authority. Nothing about an author reaches any client, and an author can retract their own card — which a retro needs.

**D-9 — `issue.create` stamps no `cycle_assigned_at`.** Task 2.9 lists it, but the shared create takes no `cycleId`: a new issue has no cycle, so there is no assignment moment. The stamp is written by `issue.setCycle`, by `issue.routeIssue` (which can set a cycle during triage) and by the rollover inside `cycle.complete`. `carryover_count` starts at 0 there.

**D-10 — "added mid-cycle" counts only issues still in the cycle.** `cycle_assigned_at` records the LAST assignment, so for an issue the rollover carried out it already describes the successor cycle. Counting carried-out issues would report every rollover as scope creep. The panel therefore computes it over in-cycle issues only; an issue that was added late and then carried is counted as carried, not as scope creep.

**D-11 — the retro mutators live in `mutators.ts` rather than their own module.** `defineMutators` must be called exactly once, and the retro mutators need `assertTeamAccess`, `createIssue` and `setIssueCycle`, which live in `mutators.ts`. A separate module would need to import from `mutators.ts` while `mutators.ts` imported it back for the registry — a real ESM cycle for no gain. The pure logic (`retro/phase.ts`, `retro/seed.ts`) and the server-only Kysely writes (`retro/server-writes.ts`) are separate modules; `mutators.ts` must never import kysely, or it would reach the client bundle.

**D-12 — `RetroSeedRef` is a superset of `DigestEvidenceRef`, not the same type.** The panel needs a `widget` kind ("add a card from this number") that the AI digest's evidence kinds do not have. Widening `DIGEST_EVIDENCE_KINDS` would change what the digest model is allowed to emit; a superset in `retro/seed.ts` keeps one grounding contract (a digest ref is assignable to a seed ref) without touching the AI change's validators.

**D-13 — the demo seed gains a completed cycle.** Task 1.5 seeds a demo retro "on the seeded completed cycle", and the seeder had none. It now seeds Cycle 1 (completed, just ended) / Cycle 2 (active) / Cycle 3 (upcoming), with two issues carried out of Cycle 1 (one of them for the second time), one added mid-cycle and three shipped — so the Delivered panel has real, non-zero content on first run, and the demo retro sits in `discuss` with cards, a group, tallies and one unconverted action.

**D-14 — the retro mutators are tested against real Postgres, not only a stubbed transaction.** The unit suite drives the mutators through a hand-rolled transaction whose `run()` shifts a pre-seeded queue of results. That harness cannot see a mutator's effect on rows the test did not stub, which is exactly the shape of both defects in D-7: three tables — card, group, tally — that must agree after every write, where the mutator's own reads decide what it writes next. Both were invisible to all 46 stubbed tests, green the whole time.

`zero/testing/pg-transaction.ts` closes that gap with a real authoritative `Transaction` over a Kysely transaction: `tx.run` compiles the ZQL AST to SQL and `tx.mutate` writes through, so a mutator reads its own writes exactly as it does under zero-cache, and `dbTransaction.wrappedTransaction` is the same executor the server-only writes (`retro_card_author`, the atomic tally bump) already take. It is deliberately strict — an unknown table, an unknown column or an untranslatable query shape throws — so a mutator that grows a construct the harness does not model fails loudly instead of going quietly untested. It lives under `src/**/testing/**`, excluded from `tsconfig.build.json`, so nothing test-only ships in `dist`.

`mutators.retro.pg.test.ts` runs on it: group/card/vote consistency after every write, the phase machine (skip, long rewind, non-facilitator, write-in-a-closed-phase), publish idempotency and attribution, the vote budget and target rules, card-delete authority, and the action→issue loop. Both D-7 defects fail it. The stubbed harness keeps the work it is good at — argument validation, authorization, exact write payloads — and now throws when a mutator reads past the end of its queue rather than handing back `undefined`, so under-stubbing is a loud failure that points at the Postgres suite.

### Board phase (group 4, minus the data panel)

**D-15 — the retro card is a `packages/ui` primitive with its own accent kinds, not a reuse of `BoardCard`.** `BoardCard` is issue-shaped (issue key, status glyph, priority mark, reality strip); a retro card is one body of text plus an optional author, evidence chip and vote pips. Sharing it would have meant five optional-prop branches through a component the tracker depends on. `RetroCard`/`RetroVotePips`/`RetroAccentBar` live beside it instead, and `RetroAccentKind` is declared in `packages/ui` exactly as `StatusKind` is — `packages/ui` never imports `@yapm/schema`, so the app maps `RetroColumnAccent → RetroAccentKind` (`ACCENT_TO_KIND`) the same way it already maps `IssueStatus → StatusKind`. D-2's "packages/ui maps each key to a theme token" is satisfied by `ACCENT_RAIL` inside that component, the single place a token stands behind an accent.

**D-16 — a column accent is reinforcement, never the carrier.** The status tokens are not all 3:1 against every surface in every preset (the existing `StatusGlyph` has the same property), so the accent is used only as a 4px rail and never for text or as the sole signal: every column and card also states its meaning in `text-1`/`text-2`, which the contrast suite already pins at AA. Extending `contrast.test.ts` to demand 3:1 of the status ramp would have failed on pre-existing tokens without making anything more legible.

**D-17 — dropping a card onto another FORMS a group; the column background is the ungroup/reorder target.** The spec's scenario is "drag a card onto another card → a group is created", which leaves no gesture free for intra-column reordering onto a card. So: drop on an ungrouped card in the same column → `retroGroup.create` (one group row + both references); drop on a grouped card or on a group → `retroCard.move` into it; drop on a card in another column → `retroCard.move` with a rank minted at that card's slot; drop on the column background → `retroCard.move` to the end of the column with `groupId = null`, which is also how a card leaves a cluster. Every case except group formation is the board's single-write move with the rank computed at the call site.

**D-18 — `v` on a grouped card retargets to its group instead of being rejected.** `retroVote.cast` refuses a grouped card (design D4), and a grouped card is still focusable (it is readable, deletable and can be regrouped). Rather than let a keystroke produce a guaranteed rejection, `castOrRetract` resolves the target the same way the mutator does. The UI and the authority agree by construction, which is the same principle `retroCan` applies to the phase matrix.

**D-19 — `c`, `a`, `]`, `[` and `t` are read at the window; `v`, `Shift+V`, `g` and the arrows are read on the board.** Capture has to work the moment the retro loads, before anything has been tabbed to, so the retro-wide keys are a window listener (ignored while a field or dialog owns the keyboard) exactly like the board view's `o`/`m`. The item-scoped keys live on the board's container handler, which reads the focused element from `document.activeElement` so a shortcut can never fire against a stale reference. dnd-kit's `KeyboardSensor` keeps Space/Enter for pick-up and drop, so neither list claims them.

**D-20 — the shell owns the composer and focus state; the board is controlled.** "New card" from the palette and `c` from the window both have to land in one column's composer, and the board is not the component that hears either. `composerColumnId` and the last-focused column therefore live in the shell and are passed down, which also means the presence heartbeat (`focus_target`, narrowed to a column id — never a card or draft id, since presence syncs to the whole team) has a single source.

**D-21 — the Cycles view's Complete-cycle action opens the retro, and a completed cycle links to it.** D7 names both completion triggers; this is the deliberate one. `openRetroArgs` in `retro/model.ts` mints the retro and column ids and copies the format template, `retro.openForCycle` re-validates that template server-side, and the mutator no-ops when the cycle already has a retro — so the button racing the (not-yet-built) maintenance pass still yields exactly one retro. Completing does not navigate; the cycle grows a "Retrospective" link instead.

**D-22 — the data-seed panel (4.3) is deliberately not in this pass.** It is the change's differentiator and a self-contained surface over `buildRetroSeed`, which already exists and is already tested. The board slots it above the columns with no structural change. Everything the panel needs from this pass — `seed_ref` on `retroDraft.create`, the column-scoped composer, the evidence chip on `RetroCard` — is present and unused.

### Seed phase (the data panel, the closed loop, auto-open)

**D-23 — the panel reads `issues.byTeam`, not a new query.** `buildRetroSeed` needs the cycle's issues with their linked PR/review/CI subtree and the same for up to three prior cycles. That is exactly `issues.byTeam` (already `withLinkedDelivery`), which the List and Board views in the same team have open anyway, so the panel adds no sync surface and no server round trip — it is a `useMemo` over rows the client already holds, which is what makes it sub-100ms and correct offline. Two consequences are accepted deliberately: issues still awaiting triage are excluded (`issues.byTeam` filters `needsTriage`, and an untriaged issue has no cycle to be counted in), and a cycle outside the caller's synced slice yields **no panel at all** rather than a board of zeros — `buildRetroSeedFor` returns null and `RetroSeedPanel` renders nothing.

A prior cycle is one that is `completed` and sorts before this one by `compareCycles` — the same total order the Cycles view lists in and the rollover picks a successor with — so the sparkline's history never disagrees with the cycle list.

**D-24 — "add a card from this widget" seeds the composer, it does not write a card.** The widget's action opens the column composer carrying the ref, rather than immediately creating a draft titled after the number. A widget is a prompt, not a finding: the value is the sentence a person writes next to it. The shell already owned `composerColumnId` (D-20), so it now owns `composerSeed` alongside it, cleared whenever the composer closes; the ref rides every card captured from that composer, which is right because they are all about that figure.

**D-25 — the evidence chip is a two-way link, and it stops its own keystroke.** A seeded card renders a chip naming the figure; activating it reveals the panel (the shell owns the collapse state for exactly this reason) and focuses the tile, which carries `tabIndex={-1}` so it is a programmatic focus target without joining the tab order. The chip must `stopPropagation` on `keydown`: it sits inside a card whose own handler reads Enter as "edit" and Backspace as "delete", so without it, following the link opened the editor over the top of the panel. The e2e test asserts the tile ends up focused, which is what caught it.

**D-26 — the trend's direction is words first, colour never.** `formatSeedDelta` renders "+2 vs. last cycle" / "−1.5h vs. last cycle" / "no change" in `text-2`, with an arrow glyph as `aria-hidden` reinforcement; nothing in the panel encodes better/worse in hue. This follows D-16 (the status ramp is not AA against every surface in every preset) and the research's own rule that a retro metric is a system signal, not a verdict. A metric with no `betterWhen` — carried in, canceled, in scope — reports movement with no judgement at all. A flat series draws on the sparkline's mid-line rather than collapsing to the floor, so "unchanged" reads as steady instead of as zero, and a series with fewer than two points says "no history" instead of drawing a dot.

**D-27 — the web-side adapter gets its own no-identity assertion.** `buildRetroSeed`'s unit test already walks the produced object graph for identity-shaped keys, but the guarantee can only be broken in the layer that maps synced rows into it. `seed-model.test.ts` therefore feeds the adapter an issue row carrying a real `assigneeId`/`creatorId` and a review carrying an `author`, and walks the result for `assignee|author|reviewer|creator|user|member|owner|actor|login|email` at any depth. The mapping layer is the only place a name could get in, so that is where the second assertion belongs.

**D-28 — the maintenance pass resolves the retro's successor cycle from Postgres, after completing.** `retro.openForCycle` takes `nextCycleId`, and the job must supply it or every scheduler-opened retro's actions would land nowhere. The job re-reads the team's cycles and calls the same `nextCycleId` helper `cycle.complete` uses, with the completing cycle as the source — the helper ignores the source's own status and excludes it by id, so reading after completion gives the same answer the rollover reached, and reading after (rather than caching before) also picks up any cycle this same pass just activated. This is what makes the action → issue loop close on an auto-opened retro, not only on a hand-opened one.

**D-29 — the pass reports what it opened by re-reading, not by assuming.** `retro.openForCycle` is a silent no-op when the cycle already has a retro, so the job cannot know from the call whether its ids were the ones that landed. It reads the retro back and reports the id only when it matches the one it minted; a retro opened a moment earlier by the deliberate Complete-cycle action is therefore reported as "not opened by this pass", which is what the race test asserts.

**D-30 — presence is pruned with a raw predicate.** `retro_presence.last_seen_at` is a DB-defaulted (`Generated<Timestamp>`) column whose operand typing rejects a plain `Date` under this project's TS config — the same wrinkle `cyclesNeedingDigest` already documents — so the sweep compares it with `sql\`… < ${cutoff}\``. It is one `delete` in the pass that already runs: no new job type, no new env var, and `CYCLE_MAINTENANCE` still gates the whole thing.

### Anonymity proof phase (5.2 and the two-client 5.5 pass)

**D-31 — the Postgres harness was extended to evaluate the query registry, rather than driving the queries through `zero-cache analyze`.** Task 5.2 has to run *every* synced query, and every team query is wrapped in `teamScoped`, which is a correlated `whereExists`; `retros.detail`, `issues.byTeam`, `members.all` and others also carry `related` subqueries. The harness (D-14) supported neither: `runQuery` threw on `related`, and `buildCondition` threw on anything that was not simple/and/or. So the registry could not be evaluated at all.

Two routes were open. `runAnalyzeCLI` against a running zero-cache (`reference/zero.md` §Debugging tools) would be a truer end-to-end evaluation, but it makes the crux test depend on a live container, a fixed CLI output shape and a sync token per persona, and it takes the assertion out of Vitest's reach — the proof would be slower, flakier, and harder to extend when a query is added. Extending the harness instead keeps the proof a plain unit-speed test against real Postgres, evaluates the very same `Query` objects the client builds, and keeps its deliberate strictness: `related` is fetched per parent row and shaped by the query's `format` (including flattening a junction's `hidden` hop), a correlated subquery condition compiles to a correlated `exists (…)` with per-statement aliases, and anything still unmodelled — `flip`, `scalar`, a bounded subquery, a cursor, an unknown table or column — throws exactly as before. Nothing is skipped: `queries.anonymity.pg.test.ts` asserts the covered set equals the registry set, so a query a later change adds fails this test rather than escaping it.

**D-32 — the harness compiled `denyAll` to `true`.** `denyAll` is `q.where(({or}) => or())`, which Zero treats as constant FALSE (`isAlwaysFalse`); the harness returned `sql\`true\`` for an empty junction of either kind, so every deny-by-empty-query in the registry evaluated as "return everything". No existing test noticed, because the mutator suite never evaluated a denied query. Empty `and` is now `true` and empty `or` is `false`, matching Zero. This was a harness defect, not a product one — but it is exactly the kind of defect that would have made the anonymity proof pass for the wrong reason.

**D-33 — the proof is provenance-aware, not a substring hunt, and it has a stated negative control.** "The author's id appears nowhere in any result" is not the invariant: A's id legitimately reaches every member through the workspace roster (`user`, `workspace_member`, `team_membership`) and through `retro_presence`, which is deliberately team-visible (D-8) and whose focus target is asserted to be a column id, never a card or draft id. So `walkQueryResult` walks the result *against its AST*, tagging every scalar with the table and field it came from, and the assertion is: A's id may appear only at those named places, plus `retro_card.authorDisplayId` when and only when that card's `isAnonymous` is false. Everything else fails, by name.

To keep that from being a proof that passes because nothing anywhere carries an author, the seed has A author only inside the retros — every issue, comment, action, saved view and invite belongs to B — and the same walk is run a third time with A's own context, where it must find A at exactly `retro_draft.authorId`, `retro_vote.voterId` and `user_preference.userId`. None of the three is on the allowlist, deliberately: each is self-scoped, so any of them reaching another member fails the two tests above. The proof was mutation-checked both ways — publishing an anonymous card with `authorDisplayId = draft.authorId`, and rewriting `retroDrafts.mine` to use `teamScoped` — and each fails it for B and for the admin.

**D-34 — anonymity had no way to be turned on, so the retro shell grew a facilitator toggle.** The spec requires anonymity to be settable while the retro is in `brainstorm` and immutable thereafter, and `retro.configure` implements exactly that — but nothing in the UI called it, so `is_anonymous` was permanently the `openForCycle` default of false and the change's crux was unreachable from the product. The header now renders an `Anonymous` / `Attributed` toggle for the facilitator while `isRetroWriteAllowed(phase, 'configure')` holds, with a matching command-palette entry; once the retro leaves `brainstorm` the control collapses back to the read-only badge that was already there. This is the smallest surface that makes the guarantee real, and it is what the two-client e2e drives.

**D-35 — the two-client e2e reads the replica by decomposing Zero's chunks into rows.** Zero persists its whole client replica as a handful of Replicache B-tree chunks in IndexedDB, so a naive per-record search finds every value co-occurring with every other and proves nothing. The walk therefore descends into each stored chunk and lifts out every `e/<table>/<id>` entry as its own row, tagged with its table — the same granularity the registry proof uses. What it asserts: during `brainstorm`, client 1's draft body is absent from the persisted bytes entirely and client 2 holds exactly one `retro_draft` row, its own; after the facilitator advances, client 2 holds both cards, every `retro_card` row has `"authorDisplayId":null`, and no row of any content table (`retro_card`, `retro_draft`, `retro_vote`, `retro_vote_tally`, `retro_group`) names the author. What it deliberately does not assert is that client 1's id is absent outright — it is present in the roster and in `retro.facilitatorId`, both by design, and neither binds a person to anything written.

Two mechanical points. The positive control is polled (`expect.poll`) because Zero flushes its in-memory head to IndexedDB on its own schedule, and an absence read before the first flush would mean nothing. And the pre-existing "correct across every preset" retro test fails on a *reused* database — the theme it writes syncs into the admin's `user_preference` and outlives the run — so the e2e suite is only meaningful against a fresh volume, which is what CI already does.

### Integration residue (5.3, 5.4)

**D-36 — the vote budget could be exceeded under concurrency, and the fix is a per-voter advisory lock on the authoritative path.** `retroVote.cast` counts the caller's own `retro_vote` rows and then inserts, with nothing serialising the two statements. Under READ COMMITTED two casts opened at the same moment both take the same pre-insert count and both land. Driven through `createServerMutators()` in six genuinely parallel Kysely transactions against a budget of three, **all six landed** — a voter could spend double their dots by clicking fast enough in two tabs, and no amount of client-side self-limiting closes it because the client is not the authority.

The fix is one statement in the server override, before the shared mutator runs its count:
`select pg_advisory_xact_lock(hashtext(retroId), hashtext(voterId))`. It is held to commit, and READ COMMITTED takes a fresh snapshot per statement, so the count that follows sees the dot the previous holder committed. The optimistic client path is untouched — `tx.location === 'server'` gates it, exactly like the atomic tally bump (D-6) — so the dot and the remaining-budget readout stay instant and VISION #9 holds. Six concurrent casts now land exactly three, and the suite asserts the upper bound *and* that the budget is still fully spendable, so a fix that simply dropped the losing casts would fail it.

The lock is keyed on (retro, voter) rather than taken as `select … for update` on the retro row, which was the obvious alternative. Two reasons. A row lock would queue a whole team's dots behind one another for no invariant — the budget is per-voter — and it would also queue them behind any concurrent `retro.setPhase`, which writes that row. More importantly it would have *hidden* D-6: with every cast serialised, a read-then-write tally would be correct too, and the "whole team votes on one target at once" regression guard would stop guarding anything. With the narrow lock that test still has teeth — mutation-checked by de-atomising `bumpRetroVoteTally`, which drops the tally to 1 of 5. A hash collision between two unrelated voters costs a few microseconds of ordering and nothing else.

D-7's two edges are re-asserted after a burst rather than after a single tidy dot: deleting the target card and dissolving the target group each return every voter's dots and take the tally row with them.

**D-37 — the carryover facts are proven across two consecutive rollovers, and the "added mid-cycle" assertion runs through `buildRetroSeed` rather than over the raw column.** `mutators.carryover.pg.test.ts` (a sibling of the retro pg suite, so the stubbed `mutators.cycle.test.ts` stays as it is) drives cycles A → B → C through the server mutators against live Postgres: completing A moves the unfinished issue to B with `carryover_count = 1` and `cycle_assigned_at` stamped to that completion, completing B moves it to C with `carryover_count = 2` and the stamp **rewritten** to the second completion. A re-run of the same completion is a no-op on both — the status guard, not an accumulator.

The two decisions a naive expectation gets wrong are pinned by name. D-9: `issue.create` stamps no `cycle_assigned_at` at all (task 2.9 reads as though it should), and the stamp appears only once `setCycle` runs. D-10: after the rollover a carried issue's stamp is later than the origin cycle's start, so reading the column alone would report it as scope creep in the cycle it left — but the stamp by then describes the successor. The test therefore asserts through `buildRetroSeed`, where the rule lives: an issue added mid-cycle and then carried counts as carried out, not as added mid-cycle, and it is counted as carried *in* on the far side of the same rollover. A control issue added mid-cycle that ships stays counted, so the assertion is not vacuously zero.

Mutation-checked: collapsing the rollover write to `carryoverCount: 1` with no stamp fails four of the six tests.
