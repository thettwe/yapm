## Why

Change 18 shipped an AI that **proposes**. It draws Wins / Losses / Improvements beside the retro's
seeded data panel, each one citing a work-graph entity or a metric key yapm computed, and it labels
the whole section *"AI-drafted, not agreed — the team has not decided any of this."* That label is
honest and it is also the whole problem: the team has no way to decide. A member who disagrees with
a proposal has, by explicit spec (`retrospective` § "Nothing in the section records an opinion"),
no control to say so. The draft is a paragraph that arrives and then sits there.

This change is the **disposes** half. A member agrees or disagrees with a proposal privately; at
`vote → discuss` the server counts the reactions **once** and stamps a verdict; contested proposals
sort to the top of the discussion, where a team should spend its time; and an agreed Improvement is
one keystroke away from a real action item, which the shipped idempotent server-numbered
`convertActionToIssue` turns into a real issue in the next cycle.

It serves VISION **#3 Reality over ritual** (the argument the team should have is the one they
disagree about, and yapm can point at it), **#1 Speed is the feature** (a reaction is one optimistic
local write; nothing new waits on the network), **#4 Metrics for teams, never surveillance** (a
reaction is private by shape — self-scoped with no admin bypass — and the improvement→issue path
**never** pre-fills an assignee), and **#2 Opinionated defaults, real escape hatches** (the verdict
rule is fixed and knob-free; there is no threshold to configure).

## What Changes

- **A new synced entity `retro_ai_reaction`**, primary key `(proposal_id, user_id)`, value
  `agree | disagree`. Synced **self-scoped with no workspace-admin bypass** — the
  `retroDrafts.mine` / `retroVotes.mine` shape, carrying the same explicit deviation comment. A
  member's reaction reaches nobody else, teammate or admin.
- **One new `react` write op** in `RETRO_WRITE_OPS`, allowed in `group` and `vote`. `RETRO_PHASES`,
  the phase stepper, the phase CHECK constraint and the adjacency machine are **untouched**.
- **A verdict computed once, server-side, at `vote → discuss`**, inside the phase-advance override
  that already publishes drafts and stamps the AI draft. **No tally is ever incrementally
  maintained and no counter column exists anywhere.** Stepping back `discuss → vote` clears the
  verdict so a recount is authoritative rather than stale.
- **The verdict rule is fixed and knob-free**: any single disagree ⇒ `contested`; unanimous agree
  among responders ⇒ `agreed`; strictly more disagrees than agrees ⇒ `rejected`; nobody responded ⇒
  `unrated`. A minority veto protects the quiet dissenter. There is no threshold setting, no
  per-team config and no admin override.
- **Contested proposals sort to the top** of the AI section from `discuss` onward.
- **An agreed Improvement is one keystroke to an action item**, carrying a nullable
  `retro_action.ai_proposal_id` for provenance. `retro.convertActionToIssue` is used **unchanged**.
- **The improvement→action path never pre-fills an assignee.** The model has no identity data; a
  suggested owner would be the first per-person output in the entire AI layer. Pinned by a test on
  the converted issue.
- **Ratification applies to AI proposals only.** Human-written retro cards are not ratified — dot
  voting already ranks them. The reasoning is recorded in `design.md` because the argument cuts both
  ways.
- Migration `0020_retro_ratification`: the reaction table, four written-once columns on
  `retro_ai_proposal`, and `retro_action.ai_proposal_id`.
- **AI off ⇒ this surface is cleanly absent**, exactly as in change 18: a team that has not opted in
  issues no query, renders no control, and its retro stays byte-identical to the change-10 retro.

## Non-goals

- **No configurable verdict threshold, and no per-team ratification settings.** retro-board D7
  refused config knobs on principle and this change does not reopen it.
- **No live "n of m have responded" affordance.** It would need either a counter column (the
  concurrency class this design exists to avoid) or a read across other members' reaction rows (the
  privacy shape this design exists to preserve). If it is ever wanted it must be a direction-free
  per-user presence row, never an incremented integer.
- **No ratification of human cards.** See above and `design.md` §D2.
- **No change to the phase machine.** No new phase, no change to adjacency, no change to the CHECK
  constraint, no change to the stepper.
- **No AI involvement in the discussion.** The AI as scribe over a contested card's thread stays
  declined on principle (`SCOPE-ai-features.md` §5): it is the one read that would touch card
  bodies, and the pipeline reads no retro-authored content at all.
- **No assignee suggestion, ever**, and no per-person view of who reacted how.
- No new container, no new job, no new provider call, no new environment variable.

## Capabilities

### New Capabilities

- `retro-ratification`: the team's decision layer over AI proposals — private per-member agree /
  disagree reactions, a fixed knob-free verdict computed once at the phase advance, contested-first
  ordering in discussion, and the one-keystroke path from an agreed Improvement to a tracked issue
  with no pre-filled owner.

### Modified Capabilities

- `retrospective`: the AI draft section requirement currently forbids any means of endorsing or
  reacting to a proposal — that is exactly what this change adds, under a stated phase window. The
  action-items requirement gains AI provenance and the never-pre-filled-assignee guarantee.
- `retro-ai-draft`: the artifact requirement gains the written-once verdict fields on a proposal
  row; the section requirement gains the reaction controls and the verdict display.
- `local-first-sync`: a new self-scoped-with-no-admin-bypass synced entity, keyed by a compound
  natural key and written by a client mutator (unlike `notification`, which the server writes).

## Impact

- **Schema**: migration `0020_retro_ratification` — new table `retro_ai_reaction`; new columns
  `retro_ai_proposal.verdict`, `.agree_count`, `.disagree_count`, `.ratified_at`; new column
  `retro_action.ai_proposal_id` (`on delete set null`, so discarding a draft never deletes a human's
  action). Hand-written `DB` interface and Zero schema updated; the drift test covers all of it.
- **`packages/schema`**: the `react` write op; a pure verdict function and a contested-first
  comparator; the reaction mutators; the server-only ratify/clear helpers over the shared
  transaction; `queries.retroAiReactions.mine`; `retroAction.create` gains an optional
  `aiProposalId`.
- **`apps/web`**: the retro AI panel gains keyboard-operable reaction controls (group/vote), verdict
  badges and contested-first ordering (discuss onward), and the one-keystroke "add as action"
  control on an agreed Improvement; the retro command palette gains the equivalent entries.
- **Permission surface**: one new self-scoped query with an explicit no-admin-bypass deviation
  comment; one new phase-gated write op. `teamScoped` is not touched.
- **No new dependency, no new service, no new env var, no new job.** Three containers unchanged.
- **Docs**: `apps/docs/src/content/docs/features/retro-ai-draft.md` (ratification section, the
  verdict rule, the two stated residuals, the no-assignee guarantee),
  `apps/docs/src/content/docs/features/retrospectives.md` (the AI section no longer records no
  opinion), `apps/docs/src/content/docs/index.md` (the feature-list bullet that still claimed nothing
  the AI drafts is agreed by the team), `README.md` (feature list), `ROADMAP.md` (row 19 status),
  `openspec/SCOPE-ai-features.md` (§9 items 1/8/9/10 resolved). No `.env.example` change — this
  change adds no environment variable.
