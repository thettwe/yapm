# Retrospectives for yapm — Synthesis & Recommendation

**Date:** 2026-07-25
**Inputs:** retro-formats.md · retro-competitive.md · retro-data-informed.md · retro-implementation.md
**Grounding:** yapm VISION.md, ROADMAP.md, DESIGN.md
**Status:** Recommendation for a **Phase-2** feature. Not on the locked roadmap. Everything below is a proposal.

---

## 1. Verdict — does a retro fit yapm? Yes, but only the *data-seeded* version. Ship it in Phase 2, paired with metrics.

**Build it.** A retrospective is one of the very few "ceremony" features that a delivery-truth PM tool can do *better than anyone else on earth*, and it converts yapm's existing assets — cycles with auto-rollover, the work graph, Zero sync, native issues — into a feature the whole category has failed to build. The strategic logic is unusually clean:

- **It rides infrastructure yapm already has.** Per retro-implementation.md, a retro is "largely a recomposition, not new infrastructure": rows synced by Zero, drag/reorder via the same fractional-index single-write the board already uses, keyboard nav from the issue list, tokens from the design system, cycles and issues as the anchor entities. The genuinely new work is narrow — a phase state machine, an anonymity boundary, and a lightweight presence/timer. That is a small, well-scoped surface for a differentiated feature.
- **It closes yapm's own loop.** yapm's wedge is "reality over ritual." A retro is the one ceremony where teams *decide what to change*, and today those decisions evaporate into a forgotten doc. yapm can make the decision a native issue in the next cycle, tracked like any other work, with auto-rollover already handling follow-through. The retro is the natural consumer of the DORA/delivery metrics arriving in Phase 2 — it gives those numbers a *place to be discussed*, not just a dashboard to be ignored.
- **The competitive whitespace is real and wide.** Per retro-competitive.md: essentially every retro tool (EasyRetro, Retrium, TeamRetro, Metro Retro, Neatro, Miro/Mural, and the retro UIs inside Jira/Azure DevOps) is a **blank whiteboard** — the team manually types "what went well." *Nothing* auto-seeds the retro from real delivery data. Even the vendors best positioned to do it have not: GitLab has native DORA and the full SDLC but no real retro surface; Atlassian bought DX for $1B rather than build delivery-data-seeded retros; Linear has cycles and no native retro at all.

**Why *not* a generic retro (the honest risk framing):** if yapm ships a plain sticky-note board, it loses. That market is saturated, the "fun/whiteboard" incumbents (Metro Retro, Miro) do canvas polish better than a PM tool should attempt, and Parabol already owns "the credible open-source retro" (AGPL, air-gap, mature, best-in-class backlog write-back). A me-too whiteboard would be undifferentiated feature-sprawl that violates yapm's "not an everything-app" principle. **The feature is only worth building as the data-seeded, work-graph-native version.** The differentiator is the seed, not the board.

### Risks to weigh honestly
1. **Scope creep / ceremony sprawl.** yapm's discipline is restraint ("not an everything-app," "not a config sandbox"). A retro invites feature bloat (whiteboards, GIFs, icebreakers, 40 templates). Mitigation: ship a *lightweight* board (Parabol-style reflect→group→vote→discuss), 3–4 formats, and let the **data panel** — not board chrome — be the wow. Explicitly defer infinite-canvas/drawing.
2. **The seed is thin until connectors land.** The full "what actually shipped, DORA delta, incidents" story depends on connectors (#8, Phase 2) and incidents (Phase 3). At Phase-2 start the auto-seed is limited to cycle data (shipped vs. carried-over, scope change). That is still novel and shippable, but the headline demo ("DORA moved Elite→High, 2 incidents fired") is gated on later work. Sequence the retro *after* or *with* connectors so it launches with a real seed, not an empty promise.
3. **Anonymity is a genuine engineering hazard, not a toggle.** Per retro-implementation.md §5: Zero has **no column-level read permission** — a synced row is fully readable in every client's local IndexedDB. "Strip the author on display" is a **privacy bug**, not an implementation detail. Getting anonymity right requires a server-only author table that never syncs. This is the one place the feature can quietly betray yapm's trust promise, so it must be designed correctly from day one.
4. **Surveillance drift.** A retro that surfaces delivery metrics is one careless schema decision away from an individual scoreboard — the exact thing VISION #4 forbids and the exact thing that makes this category "earn hatred." The guardrails (team-level aggregates only, no per-person table exists in the schema) must be *encoded*, not documented.
5. **It's genuinely optional for the 2–20-person core user.** Small self-hosting teams may run informal retros or none. This is a Phase-2 nice-to-have, not a wedge feature — it should never displace connectors/AI, which *are* the wedge. Correct priority: metrics first, retro as the surface that makes metrics matter.

**Bottom line:** the feature fits yapm's identity better than almost any other post-v1 addition *because* of the work graph — but its value is entirely in the data seed and the action→issue loop. Build the differentiated version, keep the board deliberately small, and land it alongside the metrics it's meant to discuss.

---

## 2. The differentiation thesis — data-informed retros over the work graph

**One line:** *Every other retro tool asks the team what happened. yapm already knows — the issues, PRs, CI runs, deploys, and incidents are one graph — so it hands the retro a live, blameless, team-level "what actually shipped this cycle" panel, free and self-hosted, with action items landing straight back in the tracker as issues.*

### What only yapm can do
A data-informed retro is not a novel invention — "Gather data" is the second of Derby & Larsen's five canonical phases (retro-formats.md §1), and the whole practitioner literature says to prepare the data in advance and "shift the conversation from feelings to evidence" (retro-data-informed.md §2). The problem is that **every serious retro tool executes that phase from memory** because it doesn't own the delivery data. The engineering-metrics vendors (Swarmia, LinearB) own the data but the retro isn't their surface — and their entire product cost is the ETL of joining Jira ↔ GitHub ↔ CI that yapm's native graph eliminates.

yapm is the only product that is **simultaneously the PM tool, the delivery-data owner, and the retro surface, in one AGPL self-hosted box.** That collapses three purchases (PM tool + metrics platform + retro tool) into one and makes the auto-seed a **live Zero query over first-class entities**, not an ETL job. Concretely, yapm's retro opens with its "Gather data" phase *already filled*:

- **Delivered** (available from **cycles alone, today** — no connectors): completed vs. carryover vs. carryover-2+ vs. removed-from-scope vs. scope-added-mid-cycle. yapm's auto-rollover already computes the carryover signal; this mirrors Swarmia's purpose-built sprint categories and is the single most retro-relevant view.
- **Flow** (lights up with connectors #8): PR cycle time, time-to-first-review (usually the biggest slice of lead time), review cycles, PR size (the highest-leverage, act-on-it-tomorrow lever), issues with no linked git activity.
- **Health** (connectors #8 → Phase 3): CI health / flaky-test count / build-time trend; then DORA four keys and MTTR / change failure rate once deploy + incident data land.

Each widget renders as a **trend** (sparkline vs. prior cycles) with a plain-language, blameless caption ("Review wait was the largest slice of lead time this cycle"), because the literature is clear that a *visual* triggers sharper discussion than a question. Reflection stickies can be **linked to a specific widget, issue, or PR** — evidence-anchored reflection, the join no blank-whiteboard tool can make.

### vs. the blank-whiteboard competitors
- **vs. Metro Retro / EasyRetro / Miro / Mural (blank canvas):** they start from an empty board and human memory; yapm starts from what git/CI/deploy actually said. "Reality over ritual" applied to the retro itself.
- **vs. Parabol (the closest OSS peer):** Parabol is an excellent facilitation tool and even writes action items *out* to Jira/GitHub/Linear — but it has **no delivery metrics in-retro** and it is only the *meeting*, not the tracker. In yapm the metrics *are* native queries and the actions *are* native issues — no integration, no identity-mapping, no second vendor.
- **vs. GoRetro / ScatterSpoke (the partial exceptions):** GoRetro parks a Jira-fed velocity/burndown monitor *beside* the board (Jira-sprint-metrics only, no DORA/CI/incidents). ScatterSpoke fuses retro with *AI-derived-from-feedback* sentiment/issue trends, not delivery truth from git. Both prove demand; neither seeds the board from the delivery graph.
- **vs. Swarmia / LinearB (metrics platforms):** read-only dashboards at $20–60/dev/month whose product is the ETL yapm makes disappear. yapm puts the *same* signals *inside a blameless team retro*, free and unlimited, on your own server.

### The guardrail — team-level, blameless, no individual surveillance
This is not just ethics; per retro-data-informed.md §5 it is the *technically correct* way to keep metrics un-gamed (Goodhart's Law) and to preserve psychological safety. yapm should encode these as **product constraints, verifiable in AGPL source**, not doc-ware:
1. **Team-level aggregation only** — no per-developer breakdown, no leaderboard, no stack rank; *no per-individual table exists in the schema.*
2. **Trends over absolutes** — "cycle time down 20%" beats "cycle time is 48h"; absolutes invite comparison.
3. **Speed and stability always shown together** (already a VISION/DESIGN commitment) — prevents optimizing one at the other's expense.
4. **Balanced set: ≥3 signals across ≥3 dimensions** — no single hero metric to game.
5. **Blameless copy throughout** — the panel narrates the *system* ("review wait grew"), never a person.
6. **Prime Directive surfaced at "set the stage"** (Kerth's blameless statement); anonymous input available; never tied to comp/reviews.

yapm's existing "metrics for teams, never surveillance" stance (VISION #4) is the enforceable, marketable position that lets it show delivery data *inside a retro* where every metrics vendor's individual-comparison framing would poison it.

---

## 3. Proposed yapm design (MVP)

### Where it slots
**Phase 2, sequenced with/after `connectors` (#8) and the DORA/delivery-metrics views.** The retro is the *consumer surface* for those metrics. Do not ship it before connectors land, or its headline (the data seed) is empty. Reuse the existing cycle-completion + auto-rollover trigger (pg-boss) to auto-open a retro when a cycle completes.

### Entity / phase model (from retro-implementation.md, condensed)
A **retro** is a cycle- and team-scoped meeting object owning a phase state machine. Everything editable is gated by the current phase, enforced in **server mutators** (not just the UI — optimistic local writes make client-only gating a lie).

- **Phases:** `brainstorm → group → vote → discuss → actions → closed` (Parabol-validated shape; facilitator/admin may step back one phase). Model the Derby/Larsen five phases as the flow; "set the stage" = the auto-seeded data panel + optional team-mood vote.
- **Core tables:** `retro` (team_id, cycle_id, next_cycle_id, format, phase, facilitator_id, is_anonymous, votes_per_participant, `timer_ends_at`) · `retro_column` (columns as **rows**, so custom formats and per-column accent tokens are free) · `retro_card` · `retro_group` · `retro_vote` · `retro_action` (carries `issue_id`, set on conversion) · `retro_presence` (ephemeral).
- **Real-time via Zero:** live cards/votes/grouping are "just rows" — optimistic writes + reactive `useQuery`, the same model already shipping in the issue list/board/cycles, sub-100ms for free. **Timer = durable `timer_ends_at`**, each client counts down locally; never broadcast per-second ticks. **Presence = coarse throttled heartbeat rows** pruned by pg-boss (preserves the 3-container constraint); defer pixel cursors.
- **Anonymity (the crux):** because Zero has no column-level read permission, the author of an anonymous card **must never be synced to clients.** Store author→card in a **server-only, non-synced table** (`retro_card_author`); `retro_card.author_display_id` is NULL for anonymous cards. Votes: keep `voter_id` server-only, sync only an aggregate **tally** to clients. This makes surveillance-safety a *storage-layer* guarantee, not a UI courtesy. Default: never reveal; reveal-on-close is an explicit, logged, opt-in facilitator action.
- **Action-items → issues loop (the differentiator):** a `convertActionToIssue` mutator creates a **real issue** through the same creation path humans use — team-scoped, assignee set, `cycle_id = next cycle`, backlink to the retro. The action then shows live issue status; next cycle's retro can query "actions from last retro and whether they shipped." Auto-rollover handles unfinished retro actions like any other issue.
- **Keyboard-first + tokenized:** `c` new card, `Enter` submit-and-stay, arrows to move focus, `v` vote, `]`/`[` advance/step-back phase (facilitator), `t` timer, `⌘/Ctrl+Enter` convert action→issue; everything also in the command palette. All cards/columns/pips/timer reference **semantic tokens only** (per-column `accent_token`, never hex); converted-action status uses existing status tokens so the retro matches the tracker; WCAG-safe in light/dark across Warm/Focused/Editorial.

### Which format(s) first
Support formats as **swappable column-sets over one board engine** (they are all just column configs). Ship a small, opinionated starter set, not 40 templates:
- **Went-well / Didn't / Action items** (the zero-learning-curve default),
- **Start / Stop / Continue** (concrete, low-emotion, action-focused),
- **Mad / Sad / Glad** (for post-incident / emotional cycles),
- **4Ls** (Liked/Learned/Lacked/Longed-for — for milestone/project retros).

Defer Sailboat/Starfish/KALM/DAKI and a custom-template *editor* (the `retro_column`-as-rows model already supports custom formats; the editor UI is the deferrable cost).

### MVP vs. later
**MVP (Phase 2, with connectors):**
- Retro object + `brainstorm→group→vote→discuss→actions→closed` phase machine, facilitator control, per-phase durable timer.
- The 4 starter formats; live cards, drag-group, dot voting with server-enforced budget — all via Zero.
- **Anonymity done correctly** (server-only author/voter tables) — non-negotiable for MVP; it is the trust promise.
- **Auto-seeded "Delivered" data panel** from cycle data (shipped/carryover/carryover-2+/removed/scope-change) — populatable from cycles *today*, no connectors needed — plus **Flow/Health widgets as connectors land**, all team-level, trend-first, blameless captions, bots/drafts excluded.
- **Action item → native issue** in the next cycle, with live status back-reference.
- Guardrails encoded in schema/UI (no per-individual table; ≥3 signals/≥3 dimensions; speed+stability paired; pin/unpin widgets).
- Evidence-anchored stickies (link a card to a widget/issue/PR).

**Later / fast-follow:**
- Full DORA panel + incidents/MTTR widgets (gated on Phase-2/3 deploy + incident data).
- **BYO-key AI (ROADMAP #9)** drafts the blameless narrative summary + discussion prompts + auto-grouping suggestions, over the graph, self-hosted, same permission model as humans.
- Async multi-day retros (the phase machine already allows it), reveal-on-close, more formats + a template editor, richer presence (pixel cursors), team-mood/SPACE-Satisfaction trend over time.

---

## 4. Competitive comparison table

| Tool | Open-source / self-host | Per-seat pricing? | Data-informed (auto-seeds delivery data)? | Action items → tracker issues | Integrated *with* the tracker |
|---|---|---|---|---|---|
| **yapm (proposed)** | **Yes — AGPL, self-host, 3-container** | **No — free, unlimited, no seat cap** | **Yes — native: shipped-vs-carried, DORA, CI, incidents from the work graph** | **Native — action item *is* an issue in the same graph** | **Is the tracker** (no integration; one graph) |
| **Parabol** | Yes — AGPL, on-prem, air-gap | Yes — $8/active user (Team tier) | No | Yes — writes out to Jira/GitHub/GitLab/Azure/Linear | No — separate meeting tool, syncs out |
| **TeamRetro** | No | No — flat per-team (~$21/team/mo) | No | Yes — publishes to Jira/Monday/GitHub | No — integrates out |
| **Retrium** | No | Per-room / per-user (~$39/room) | No | Yes — Jira Cloud | No |
| **EasyRetro** | No | No — per-team (~$21/team/mo) | No | Yes — Jira | No |
| **Neatro** | No | No — per-team (~$23/team/mo) | No | Yes — Jira Cloud | No |
| **GoRetro** | No | No — per-team (~$29/mo; no free tier) | **Partial** — Jira velocity/burndown monitor *beside* board | Yes — Jira | No |
| **ScatterSpoke** | No | Tiered ($50→$500/mo) | **Partial** — AI-derived sentiment/issue trends from feedback, not git | Yes (Enterprise) | No |
| **Metro Retro / Miro / Mural** | No | **Yes — per user ($8–10/user/mo)** | No (blank whiteboard) | Miro/Mural: create Jira cards | No |
| **Postfacto** | Yes — AGPL — **but abandoned (~2022)** | Free (self-host) | No | No | No |
| **Jira + Confluence** (native) | No (DC self-host) | Yes — per user | **Partial** — manually embed a live sprint report on the whiteboard | Yes — native Jira issues | Partial (same suite) |
| **Azure DevOps Retrospectives** | Yes (MIT) — only *inside* Azure DevOps | Free extension | No (auto), but actions → native work items | Yes — native work items | Yes — inside Azure DevOps only |
| **Linear** | No | Per user | — | — | **No native retro at all** |
| **GitLab** | Core OSS, self-host | Per user | No dedicated retro (uses issues; DORA is a separate dashboard) | Yes — issues | Has data, no retro surface |

**Reading of the table:** action-items→issues is *table stakes* (yapm must match it, and does so structurally better — no round-trip). Per-seat vs. per-team pricing is a live tailwind (GoRetro/Metro Retro killed free tiers in 2024–25; Miro/Mural/Parabol charge per head). The **two columns nobody else fills** are *open-source-and-self-host* **and** *auto-seeds real delivery data* — and yapm is the only row that fills **both** at once, which is precisely the wedge.

---

## Sources
All claims trace to the four input deliverables and yapm's own docs. Key external anchors (full lists in the source files): Derby & Larsen *Agile Retrospectives* (five phases); Kerth Prime Directive; Edmondson (psychological safety); DORA (dora.dev / getdx.com); Goodhart's Law (keypup.io, axify.io); Parabol (parabol.co, github.com/ParabolInc/parabol); competitive pricing/features (teamretro.com, goretro.ai, scatterspoke.com, neatro.io, easyretro.io, retrium.com, miro.com); Zero (zero.rocicorp.dev/docs/permissions — no column-level reads; /docs/mutators). Items marked UNVERIFIED in the source files (exact competitor pricing, PR-size benchmarks, format originators, Zero API drift, yapm's unshipped connectors/AI/incidents) remain UNVERIFIED here.
