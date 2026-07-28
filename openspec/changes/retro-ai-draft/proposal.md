## Why

`retro-board` (change 10) shipped the differentiator no whiteboard tool has: the retro's "gather
data" step already done, computed from the team's own work graph. `ai` (change 9) shipped a
BYO-key, injection-resistant, cite-evidence-or-omit AI substrate and proved it with one consumer,
the team-internal cycle digest. **Nothing joins them.** A team opens a retro, reads a panel of
metrics and sparklines, and then starts typing cards from a blank column — the same blank column
every other retro tool gives them, beside numbers nobody has been asked to interpret.

This change makes the AI a **participant that proposes and never decides**: it reads the
just-closed cycle's team-level work graph and drafts **≤3 Wins / ≤3 Losses / ≤3 Improvements**
into the retro change 10 already auto-opens, each one citing a work-graph entity id or a **seed
metric key**, so the UI renders yapm's own value, delta and sparkline beside the sentence. The
model can *point at* a number; it can never type one.

**It ships without ratification on purpose.** Agree/disagree, verdicts and the improvement→issue
loop are change 19, and they are worth building only once a human has read three real drafts and
said the drafts are worth a team's attention rather than the sparkline with sentences
(`SCOPE-ai-features.md` §9.1). That question cannot be answered from code, which is the entire
reason 18 ships alone.

It serves VISION **#3 Reality over ritual** (the cycle already happened; asking a team to
reconstruct it from memory is the ritual), **#1 Speed is the feature** (generation is off the hot
path entirely — no interaction waits on a model), **#4 Metrics for teams, never surveillance** (the
model receives no assignee, author, reviewer or user dimension at any depth, and a deterministic
validator drops any output naming a member), and **#2 Opinionated defaults, real escape hatches**
(three buckets, three items each, fixed — and the whole feature is **off until a team turns it on**).

## What Changes

- **Generation is lazy, at the `brainstorm → group` phase advance** — not at cycle close, not into
  a server-only staging table, not behind a phase-filtered synced query. The server-only branch of
  the shipped `retro.setPhase` override (the one that already calls `publishRetroDrafts`) writes a
  `retro_ai_draft` row with status `pending`, and a **self-re-arming pg-boss tail** — the exact
  `SEARCH_INDEX_QUEUE` shape (`scheduler.ts:326–353`: re-arm with `startAfter` in a `finally`, plus
  a one-minute watchdog cron so a lost job cannot stop drafting forever) — sweeps pending rows
  within seconds. This is strictly better than both alternatives the scoping pass offered: no third
  table, no unverified ZQL, **the anchoring mitigation becomes structural for free** (during
  `brainstorm` the row does not exist, so there is nothing to leak and no phase filter to get
  wrong), and spend is proportional to actual use — a retro nobody runs costs nothing. The cost is
  ~10s before the draft appears, rendered as a "drafting…" state the digest panel already models.

- **Off by default, opt in per team.** `team.ai_retro_draft_since` — a nullable timestamp, `NULL`
  meaning off, exactly the `team.auto_status_since` / `team.archived_at` convention. The phase-advance
  branch reads it *before* writing anything, so a team that has not opted in produces **no row, no
  job, no spend and no pixel**. This matches the posture the maintainer chose for auto-status: a
  team turns AI participation in its own retro on knowingly. Lazy generation already bounds the
  spend argument, so the default is about consent, not cost.

- **A genuine new server read: `retroFactsForCycle`.** `buildRetroSeed` has only ever been called
  from the client over synced rows; there is no server-side assembly. This change adds a sibling of
  `cycleFactsForTeam` that assembles the retro's cycle plus up to three prior completed cycles into
  `RetroSeedCycleInput`, calls the two existing **pure** builders (`buildRetroSeed` and
  `buildCycleFacts` — the metric math is reused, never duplicated), and returns both. Without the
  seed the retro draft's input would be byte-identical to the cycle digest's and the feature would
  be the digest with a different prompt.

- **An explicit column allowlist on that read, because `review` carries an `author` column**
  (`0009_connectors.ts:122` — the provider handle). `cycleFactsForTeam` never selects it;
  `retroFactsForCycle` *will* read `review.submitted_at` for the time-to-first-review metric. Every
  select is an explicit column list, and a test records the tables and columns the assembly touches
  and fails on `author` or on any table outside the allowlist.

- **Two new tables, both `teamScoped` and client-read-only.** `retro_ai_draft` (one per retro,
  unique on `retro_id`) and `retro_ai_proposal` (one row per proposal, carrying `category`,
  `summary`, `confidence`, `refs` and `rank`). Written **only** through the `upsertCycleDigest`
  trick — the shared Zero `Transaction`, never registered in the client `mutators` map. Proposal
  *rows* rather than a `content` jsonb because a stable proposal id is what change 19 keys
  reactions and provenance on.

- **The ≤3-per-bucket cap is enforced by the validator, not the prompt**, and applied *after* the
  cite-or-omit and name-validator drops, so a dropped item is replaced by the next real one rather
  than leaving a hole.

- **The three shared refactors every later AI change binds to** (`SCOPE-ai-features.md` §1, ~100
  lines total), owned here because a framework with zero live consumers would be merged and
  immediately reshaped, and because it would refactor the injection-critical validators *before*
  anything proves the new content shapes:
  1. `dropUncitedItems` / `dropItemsNamingMembers` / `contentNamesMember` are typed to
     `DigestContent` exactly. They become **shape-agnostic walkers** over a normalized
     `{headline, groups[{heading, items[{summary, refs[]}]}]}` view; the existing digest exports
     become thin adapters and `digest.test.ts` is untouched.
  2. `getWorkspaceAiSpendUsd` sums `cycle_digest` only, so a second artifact table makes the BYO-key
     spend cap **silently under-fire**. It becomes a union across every AI artifact table.
  3. `CYCLE_DIGEST_STATUSES` becomes the shared `AI_ARTIFACT_STATUSES`
     (`pending | ready | failed | ai_off`) with one exported CHECK-constraint text; `CycleDigestStatus`
     stays exported as an alias.
  With a standing review rule, stated here and grep-enforced in CI: **no second copy of a
  cite-or-omit / name-validator walker or spend accessor anywhere in `packages/schema`.**

- **A draft section adjacent to the seed panel — never interleaved into the format's columns.** Two
  of the four shipped formats (`mad_sad_glad`, `4ls`) do not map onto Wins/Losses/Improvements, so
  the AI's buckets are its own. Fully keyboard-operable: each proposal's evidence chips are in tab
  order, an issue/PR chip opens the entity, and a metric chip reveals the seed panel and focuses
  that tile through the shipped `seedWidgetSelector`. Tokenized, correct in all three presets light
  and dark.

- **AI off ⇒ the change-10 retro is byte-identical.** Team switch off ⇒ no row exists, no query
  returns anything, nothing renders. Workspace AI off / keyless / spend-capped ⇒ the row is written
  `ai_off` and the panel still renders nothing; the change-10 seed panel *is* the raw-evidence
  fallback the substrate requires, unchanged.

- **One new instance-level env var, `AI_RETRO_DRAFT` (default `true`)**, gating registration of the
  tail — every scheduler block in this repo is independently optional, and turning off the cycle
  digest must not silently turn off retro drafts (or the reverse). It is an instance kill switch;
  the per-team column is the consent gate.

## Capabilities

### New Capabilities

- `retro-ai-draft`: the per-team opt-in and its off-by-default semantics; lazy generation at the
  `brainstorm → group` advance and the self-re-arming tail that completes it; the identity-free
  fact assembly with its table/column allowlist; the typed proposal content schema and the three
  deterministic validators (cite-or-omit over work-graph ids **and** seed metric keys, name-validator,
  per-category cap); the two client-read-only synced tables and their permission story; the
  `pending`/`ready`/`failed`/`ai_off` state machine; and the keyboard-operable, tokenized draft
  surface with its AI-off absence.

### Modified Capabilities

- `ai-agent`: the cite-evidence-or-omit and name-validator substrate is restated as **shape-agnostic**
  — one walker serving every artifact content shape, with a stated no-second-copy rule — and the
  "cannot name an individual" requirement gains the retro consumer's stronger property: the pipeline
  reads **no retro-authored content at all**, so it cannot reconstruct authorship even in principle.
- `ai-gateway`: the per-workspace running spend total SHALL span **every** AI artifact table, not
  the cycle digest alone, so the optional cap cannot under-fire as consumers are added.
- `retrospective`: the retro surface gains an AI-draft section adjacent to the seed panel (its
  keyboard and theming contract, and its absence when AI is off); the storage-layer anonymity
  requirement is restated to cover the new AI read path — the fact assembly names no retro content
  table, and the registry anonymity walk covers the two new queries by construction.
- `teams`: `team` gains `ai_retro_draft_since`, written only by a new admin-gated
  `team.setAiRetroDraft` shared mutator and readable by every member under the existing team read
  scope.
- `local-first-sync`: two new team-scoped, client-read-only synced tables written exclusively by the
  server through the shared Zero transaction, joining `cycle_digest` in that class.
- `self-host-deploy`: the retro draft adds no container, no queue-runner process and no second
  `boss.start()` — one more block on the existing pg-boss — plus one optional env var.

## Impact

- **Schema** (`packages/schema`): forward-only migration **`0018_retro_ai`** — `team.ai_retro_draft_since
  timestamptz null`; `retro_ai_draft` (unique on `retro_id`, cascade from `retro`, column types
  mirroring `cycle_digest` exactly, plus a `claimed_at timestamptz` the tail claims on so two app
  replicas cannot double-spend a BYO key); `retro_ai_proposal` (cascade from `retro_ai_draft`,
  `refs jsonb`, CHECK on `category` and `confidence`). New `zero/ai-content.ts` (the shared
  walkers), `zero/retro/ai-draft.ts` (the content schema + validators + the server-only write
  helpers), `db/retro-facts.ts` (`retroFactsForCycle`). Modified: `zero/digest.ts` (adapters),
  `zero/context.ts` (`AI_ARTIFACT_STATUSES`), `zero/schema.ts` (+2 tables, +1 column, +2
  relationships), `zero/queries.ts` (+2 `teamScoped` queries), `zero/mutators.ts`
  (`team.setAiRetroDraft`, which therefore needs a `MUTATOR_TOOL_KINDS` classification and an
  `ai-tools.ts` args entry — that registry is exhaustive by construction and its test fails
  otherwise), `zero/server-mutators.ts` (the opt-in check + `pending` row at `brainstorm → group`),
  `db/cycle-digest.ts` (the spend union), `db/types.ts`, `db/schema-drift.test.ts`.
- **Server** (`apps/server`): `ai/retro-draft.ts` (the prompt, the input builder and
  `runRetroAiDraft` — the `runCycleDigest` state machine, reused shape for shape),
  `jobs/retro-draft.ts` (the tail pass), `jobs/scheduler.ts` (one more block: queue, worker,
  re-arm, watchdog cron), `config/env.ts` + `index.ts` (`AI_RETRO_DRAFT`).
- **Web** (`apps/web`): `retro/retro-ai-panel.tsx` (new) wired into `retro/retro-view.tsx` beside
  `RetroSeedPanel`; a "Retro AI draft" per-team toggle section on the admin AI settings surface.
- **UI** (`packages/ui`): **none** — the panel is built from the existing `Badge` and `Button` and
  the seed panel's own sparkline geometry.
- **Dependencies**: **none**. No catalog entry, no container.
- **Docs:** `apps/docs/src/content/docs/features/retro-ai-draft.md` (new — what it drafts, where the
  numbers come from, what the model never sees, how to turn it on, what happens when AI is off),
  `apps/docs/src/content/docs/features/retrospectives.md` (the new section and its off-by-default
  state), `apps/docs/src/content/docs/self-hosting/ai-setup.md` (`AI_RETRO_DRAFT`, the per-team
  switch, the lazy-generation spend model, and the spend total now spanning both artifact tables),
  `apps/docs/astro.config.mjs` (one sidebar entry), `README.md` ("What works today"), `ROADMAP.md`
  (row 18 status), `.env.example` (`AI_RETRO_DRAFT`). `TECHSTACK.md` is deliberately untouched — no
  version, dependency or technology decision moves — and that is asserted, not assumed.

## Non-goals

- **Ratification of any kind.** No agree/disagree, no reactions, no verdicts, no tallies, no
  contested/agreed/rejected sort. That is change 19, and it ships only after a human reads three
  real drafts. Nothing in this change stores an opinion about a proposal.
- **Any write path out of a proposal.** A proposal does not become a card, an action item, an issue
  or a comment. There is no HITL approval surface, because there is nothing to approve — the model
  proposes into a read-only section and a human retypes what they want. That is deliberate: the
  worst case here is a paragraph nobody agrees with.
- **`runAgent`, tools, or any agentic loop.** `generateStructured` only, no `ToolSet`, no
  `activeTools`. A CI grep asserts the retro-AI modules never import `buildAgentTools`.
- **Reading a single word of retro-authored content.** The pipeline never names `retro_draft`,
  `retro_card`, `retro_card_author`, `retro_vote`, `retro_presence` or `comment`. The anonymity
  boundary is not crossed for a stronger reason than aggregation: there is nothing to aggregate.
- **A suggested owner, assignee or "who should do this".** The model has no identity data and this
  change adds none. The first per-person output in the AI layer will not be here.
- **On by default.** Refused for the same reason auto-status refused it: a second automatic spend on
  someone's own API key, in a ceremony about how the team works, is a thing a team says yes to.
- **A "regenerate" button, a temperature knob, a prompt editor or a per-team format mapping.** One
  draft per retro, produced once at the advance. `retro-board` D7 refused config knobs on principle
  and that holds here.
- **Numbers in prose validation** — a validator rejecting any numeral absent from the computed
  facts. Declined and stated rather than silently omitted: it would reject dates, ordinals and "one
  of". The structural answer is that the model cites a metric *key* and yapm renders the value.
- **Reporting on the previous retro's improvements** ("did last cycle's actions ship?"). That is
  change 22 and needs two retros to have run.
- **Any surface outside the retro.** No digest change, no cycle-view change, no notification, no
  email, no command-palette entry.
