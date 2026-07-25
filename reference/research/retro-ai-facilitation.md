# AI-Facilitated Retrospective — Research + Design for yapm

Companion to `retro-formats.md` (which covers formats, the five-phase flow, and
facilitation mechanics). This document covers the **AI angle**: what retro tools do
with AI today, and a design for the user's idea — **the AI reads a whole cycle's
work-graph data and drafts a structured retrospective (Wins / Losses /
Improvements-required); the team then agrees or disagrees with each proposed card,
and the agreed items become the retro's findings + action items.** AI facilitates
and scribes; humans decide.

Verification policy (matches the other `reference-*.md`/`retro-*.md` files): every
external claim is cited inline; anything not confirmable against a primary/vendor
source is marked **UNVERIFIED**. yapm-side architecture claims are grounded in the
scratchpad references `reference-ai-providers.md` and `reference-connectors.md`
(themselves verified against installed SDKs + official docs). Design choices are
marked **PROPOSAL**. Model names/prices are **VOLATILE** — treat as runtime lookups.

---

## 1. Competitive landscape — AI in retrospective tools today

### 1.1 A taxonomy of "AI retro" capabilities

Sorting the market by *what the AI actually does* yields six classes, in ascending
order of ambition. The first five all operate on **human-authored sticky notes**;
only the sixth touches real delivery data — and no shipping product reaches the
top rung.

| # | Capability class | What the AI ingests | What it produces |
|---|---|---|---|
| A | **Post-hoc summarization** | the team's cards + discussion | a meeting summary / exec report |
| B | **Grouping / clustering** | the team's cards | affinity groups + suggested group titles |
| C | **Action-item generation** | grouped + voted cards (+ sentiment column) | suggested action items |
| D | **Sentiment / insight annotation** | the team's cards | themes, keywords, sentiment, trends over time |
| E | **Template / prompt generation** | a text description of the retro's focus | a board template / seeded sticky-note prompts |
| F | **Data-informed drafting** (the frontier) | *actual sprint/delivery data* | retro content (cards/findings) drafted from the data |

Classes A–E are now **table stakes** — most tools ship several. Class F is where
yapm's idea lives, and it is almost empty: exactly **one** shipping product
auto-generates retro cards from real sprint data (GoRetro's "Joker cards"), and it
draws only on **Jira PM data** (velocity/issues), presents the output as
**discussion sparks**, and does **not** structure it as a ratifiable
Wins/Losses/Improvements draft. See §1.4.

### 1.2 Tool-by-tool (precise, cited)

**TeamRetro** — the most explicit and best-documented AI retro suite. Its
"Responsible AI" page enumerates the exact capabilities and models:

- Automated **grouping** + group-title suggestions (class B)
- **AI Suggested Actions** — recommends actions from the retro + health-check
  insights; "Your team can vote on these proposed" actions (class C)
- **AI Insights** — topic, sentiment, keyword annotations + theme identification
  and sentiment tracking over time (class D)
- **Meeting summarization** + suggested meeting titles (class A)
- **Template / icebreaker / health-model generation** (class E)
- Models (VOLATILE): template/icebreaker gen via **OpenAI ChatGPT 5.x**;
  grouping, insights, summaries, actions via **Anthropic Claude Sonnet 4.x / Haiku
  4.x on AWS Bedrock**; embeddings via Titan v2 / Cohere.
- Stance: *"Our own use of AI is assistive… a person always reviews the output and
  decides what to keep."* Admins/facilitators can disable AI per account or per
  meeting.
- Sources: https://www.teamretro.com/responsible-ai/ ;
  https://help.teamretro.com/article/445-ai-features ;
  https://help.teamretro.com/article/425-whats-new-23-24
- **Class: A+B+C+D+E on human input. Not F.** Notably the closest existing model to
  yapm's *reaction* mechanic — the team **votes on AI-proposed actions** — but the
  proposals come from the team's own cards, not from delivery data.

**Parabol** (open-source core, self-hostable — the nearest philosophical cousin):

- **AI grouping** — auto-suggests a heading for each affinity group from the cards'
  content; headings are editable (class B). Confirmed by an independent walkthrough:
  *"The AI in Parabol automatically suggests headings for each of the groups based
  on the content of the cards, but you can edit those."*
- **AI Summaries / Automated Meeting Summary** — per-topic summary + a whole-meeting
  summary generated at meeting end (class A).
- **Insights** — analyses patterns across all of a team's past meetings (class D).
- Sources: https://www.parabol.co/ ;
  https://www.parabol.co/support-categories/meeting-features-summaries/ ;
  https://rebelsguidetopm.com/parabol-improve-your-retrospectives/ ;
  https://www.parabol.co/resources/retrospective-meetings/
- **Class: A+B+D on human input. Not F.**

**GoRetro ("data-driven" retros)** — the most important competitor for yapm's
thesis, and the only one that touches real sprint data (see §1.4 for the deep
read). Feature inventory:

- A single **Jira integration** "to fuel all your sprint activities with real-time
  data … get sprint facts to focus on what matters most and discuss in your
  retrospective" — i.e. a **sprint-monitoring dashboard + "sprint facts"** surfaced
  *as context beside* the retro board for humans to discuss.
- **"Joker cards" — "Personalized retro cards based on YOUR Sprint data … Spark a
  discussion automatically."** This is the single closest shipped feature to yapm's
  idea: the tool reads sprint data and **auto-generates cards**. (Whether an LLM or a
  templated rule engine drives it is **UNVERIFIED**; the marketing calls it
  data-driven, not "AI".)
- Standard board machinery: drag/merge, voting, action items synced back to the PM
  tool, happiness/morale tracking, analytics, sprint history.
- Sources: https://www.goretro.ai/ ; https://www.goretro.ai/retrospective-features ;
  https://www.goretro.ai/data-driven
- **Class: F — but a *narrow* F** (Jira PM/velocity data only, not git/CI/deploy/
  incidents/DORA; output is discussion sparks, not a structured, ratifiable
  Wins/Losses/Improvements draft). This is the prior art yapm most needs to
  out-distance and cite honestly.

**Power Retro** (Jira Marketplace add-on by Tappointment) — a rare technical
write-up of an AI retro implementation, useful as a design precedent:

- **AI grouping** of cards via OpenAI (GPT-4 → later GPT-4o); tuned temperature/
  top-p for determinism; pre-computes grouping in a background job so the "AI
  Grouping" click feels instant (class B).
- **AI action-item generation** from grouped + voted cards, using OpenAI
  **function calling** for reliable structured (JSON) output; crucially, they had to
  feed each card's **column sentiment** ("feeling" value from the Start/Stop/
  Continue or Went-well/Didn't columns) into the model because bare card titles were
  too ambiguous — the model defaulted to negative sentiment without it (class C).
- Claims retro duration cut "up to 60%". Integrates action items into Jira.
- Source: https://community.atlassian.com/forums/App-Central-articles/From-Concept-to-Reality-Integrating-AI-for-Seamless/ba-p/2804158
- **Class: B+C on human input. Not F.** Design lesson for yapm: **structured output
  (tool/function calling with a schema) + sentiment/context signals per item** are
  what make AI retro output usable — yapm's cards should be schema-typed and each
  should carry the delivery signal it was derived from (see §2.1, §5).

**EasyRetro** — added an **AI board summary** feature (~early 2024); strong action-
item tracking (due dates, assignees, analytics tab, carry-over view) but,
per third-party comparison, **no AI action-item generation**.
- Sources: https://easyretro.io/whats-new/ ;
  https://www.retrospectivetools.com/compare/easyretro-vs-sprintretro/
- **Class: A on human input. Not F.**

**Retrium** — deliberately **human-facilitated**: private brainstorming, collaborative
(human) grouping into themes, dot voting, guided five-phase flow, retrospective
history for tracking action items over time. Its own site markets *no* generative-AI
features. A competitor (TeamRetro) asserts "Retrium has no AI" — **note this is a
competitor-sourced claim**, but it is consistent with Retrium's own positioning.
- Sources: https://www.retrium.com/ ; https://www.retrium.com/features/retrospective-history ;
  (competitor claim) https://www.teamretro.com/compare/retrium-alternative/
- **Class: none / human-only. Not F.**

**Neatro** — retro experience (real-time/async), action-plan Kanban with reminders,
post-retro effectiveness survey, analytics. TeamRetro's comparison page is titled
"Neatro Alternative — Scheduled Retros & AI," implying Neatro ships *some* AI, but
Neatro's own feature pages emphasize its 4-step framework + analytics rather than
generative AI. Specific AI capabilities **UNVERIFIED**.
- Sources: https://www.neatro.io/features/retrospective-experience/ ;
  https://www.neatro.io/
- **Class: likely A/D (UNVERIFIED). Not F.**

**Miro AI (retrospective)** — generates sticky notes, discussion prompts, and
structured feedback **from a text description of the retro's focus** (class E).
Input is a prompt, not delivery data.
- Source: https://miro.com/ai/ai-retrospective/
- **Class: E. Not F.**

**Newer AI-summary entrants (Retrosive, Reetro, RetroTeam)** — "paste your notes /
run it live → executive-ready AI summary (themes, sentiment, risks, action items)."
Reetro/RetroTeam add AI grouping + AI action items + health-check insights.
- Sources: https://retrosive.com/ai-retrospective-summary ;
  https://www.retrospectivetools.com/tool/reetro/ ;
  https://www.retrospectivetools.com/tool/retroteam/
- **Class: A(+B+C+D) on human input. Not F.**

**Azure DevOps "Retrospectives" extension** (`microsoft/vsts-extension-retrospectives`,
open-source, MIT) — notable **not** for AI but as the clearest precedent for yapm's
**action-item → tracked-work-item** loop: it lets teams run a retro inside Azure
DevOps and "**create work items to track improvement actions**" directly, plus an
optional Team Assessment. **No AI drafting features documented** (UNVERIFIED whether
any were added since).
- Sources: https://github.com/microsoft/vsts-extension-retrospectives ;
  https://devblogs.microsoft.com/devops/retrospectives-the-hidden-gem-enabling-teams-to-thrive-part-1/
- **Class: none (AI). Precedent for action-items-as-work-items — which yapm does one
  better by making them native work-graph issues.**

### 1.3 The adjacent market that has the data but doesn't draft the retro

The engineering-metrics vendors (Swarmia, LinearB, Jellyfish, DX — the very tools
VISION.md positions against) **own exactly the delivery data yapm's AI would read**
(PR cycle time, review latency, CI health, DORA, deploys). But their retro story is
"bring our dashboard *to* your retro," not "draft the retro." Swarmia says outright:
*"Use Swarmia in team retrospectives to analyze flow efficiency and scope creep to
take the learnings from every finished project."* — humans read the charts and
draw the conclusions. None drafts a structured, ratifiable Wins/Losses/Improvements
artifact.
- Source: https://www.swarmia.com/jira-reporting/

So the market splits cleanly into two halves that **no one has joined**:
1. **Retro tools with AI** that draft/summarize/group — but only from *human sticky
   notes* (TeamRetro, Parabol, Power Retro, Retrosive, …).
2. **Delivery-data tools** that have the git/CI/DORA truth — but only *render it as
   dashboards* for humans to interpret (Swarmia, LinearB, …).
GoRetro sits in the seam (Jira PM data → auto "Joker cards") but reaches neither the
delivery-quality data nor a ratifiable structured draft.

### 1.4 Does ANY tool read actual delivery data (git/CI/issues) to draft wins/losses?

**Precise answer: No — with one partial exception that proves the gap.**

- **GoRetro** is the *only* shipped tool that reads real **sprint data** to
  **auto-generate retro cards** ("Joker cards"). But (a) the data is **Jira PM data**
  (issues, velocity, story points) — **not git/CI/deploy/incident/DORA delivery
  quality**; (b) the output is framed as **"spark a discussion"** prompts, not a
  structured Wins/Losses/Improvements draft the team ratifies; (c) it's a proprietary
  SaaS with a single Jira integration, the opposite of yapm's self-hosted BYO-key
  work-graph model. It is the nearest prior art and should be cited as such.
- Every **AI** retro feature in every other tool (grouping, summaries, suggested
  actions, insights, templates) ingests **human-authored cards**, never delivery
  data. Confirmed across TeamRetro, Parabol, Power Retro, EasyRetro, Retrosive,
  Reetro, RetroTeam, Miro.
- The tools that **do** have git/CI/DORA data (Swarmia/LinearB/DX/Jellyfish) render
  dashboards for the retro; they **do not draft** the retro at all, AI or otherwise.

### 1.5 Novelty verdict for yapm's approach

yapm's proposal is **novel on the combination, not on any single atom**. The atoms
exist separately in the market; no one has assembled them:

1. **Reads the delivery work-graph, not just PM velocity** — issue↔PR↔CI↔deploy↔
   incident (DORA, review latency, CI health, MTTR), the data GoRetro's Joker cards
   never touch and the retro-AIs never see. *(Novel among retro tools.)*
2. **Drafts a structured, typed Wins/Losses/Improvements artifact** — not a summary
   of human input (TeamRetro/Parabol), not discussion sparks (GoRetro), not a
   dashboard (Swarmia). *(Novel: the AI writes the first-draft *content* of the
   retro from data.)*
3. **An explicit agree/disagree ratification mechanic** where the AI *proposes* and
   humans *decide* card-by-card. TeamRetro's "vote on AI-suggested actions" is the
   only nearby precedent, and it votes on suggestions derived from human cards, not
   from data. *(Novel as applied to data-drafted findings.)*
4. **Self-hosted, BYO-key, provider-agnostic, under a permission ceiling**, running
   the agent loop on the user's own server against the same synced queries/mutators.
   *(Novel: every AI retro today is closed SaaS calling OpenAI/Bedrock.)*
5. **Team-level blameless by construction** — the data is aggregated so the AI
   *cannot* name individuals (§3), tied to a hard product principle
   (VISION #4). *(Novel as an enforced guardrail rather than a policy page.)*
6. **Action items become native work-graph issues in the next cycle**, closing the
   "action items evaporate" loop structurally (Azure DevOps proves the pattern; yapm
   makes them first-class linked issues, and next cycle's data can auto-report
   whether they shipped). *(Strong, not unique.)*

**Bottom line:** the honest one-liner is *"yapm is the first to let the AI draft the
retrospective's findings from real delivery data (git/CI/deploy/incidents), not from
human sticky notes — and then hand every card back to the team to ratify."* GoRetro
is the closest prior art (data→auto cards) and must be acknowledged; it stops at
Jira PM data + discussion sparks. The claim to defend is the **combination**, and it
is defensible.

---

## 2. The agree/disagree facilitation design (PROPOSAL)

Design goal: keep the AI firmly in the **propose-not-decide** role. The AI does the
tedious first pass a facilitator dreads (staring at the sprint's data and writing a
straw-man of what went well/badly); the humans do the part that must stay human
(judging whether it's true, why, and what to do). This maps onto Derby & Larsen's
five phases (`retro-formats.md` §1): the AI supercharges **Gather data** and seeds
**Generate insights**, but **Decide what to do** and **Close** stay human.

### 2.1 How the AI drafts cards from cycle data → three categories

The AI reads the cycle's work-graph slice (§4.1 lists the exact signals) and emits a
small, **schema-typed** set of proposed cards in three buckets. Three categories
(not the 5–8 formats in `retro-formats.md`) because the agree/disagree mechanic needs
a simple, stable shape; the classic formats remain available for a *manual* retro.

- **Wins** — things the data says went well ("14 of 16 issues shipped this cycle vs
  10/16 last"; "median PR review turnaround dropped from 19h to 7h"; "zero failed
  deploys, no incidents").
- **Losses** — things the data says went badly ("4 issues carried over for the
  second consecutive cycle"; "CI failure rate on `main` rose to 22%"; "two deploys
  rolled back"). Framed as team/system facts, never people (§3).
- **Improvements-required** — candidate changes the data motivates ("review latency
  spikes on Fridays — consider a review SLA or rotation"; "flaky test `X` failed in
  6 of 20 runs — quarantine or fix").

**Each card is a typed object, not free text:**

```
RetroCard {
  category: "win" | "loss" | "improvement",
  title: string,                       // blameless, team-level (§3)
  evidence: WorkGraphRef[],            // the exact signal(s): cycleStats, PRs (aggregate),
                                        //   checkRuns, deploys, incidents — LINKED, not asserted
  confidence: "high" | "medium" | "low",   // low when data is sparse/ambiguous
  source: "ai" | "human",
}
```

The **`evidence` link is load-bearing** for trust: every AI card must cite the
work-graph data it came from (a computed metric, a set of issues, a check-run
history) so a skeptical participant can click through and verify rather than argue
with a black box. A card the AI cannot ground in a linked signal should not be
emitted (anti-hallucination, §5). Cards carry a **confidence** flag so the AI can
hedge ("possible/low-confidence") instead of over-asserting — this both reduces
anchoring (§5) and models honesty.

Keep the draft **small** (e.g. ≤3–4 per bucket). A wall of AI cards maximizes
anchoring and review fatigue; a tight, high-confidence straw-man is the goal.

### 2.2 The reaction mechanic — per-person agree/disagree with a consensus reveal

Recommended shape (**PROPOSAL**), tuned for yapm's small teams (2–20, VISION):

1. **AI posts its draft** into the retro board's three columns, each card tagged
   `AI-proposed` and showing its evidence link + confidence. This *is* the seeded
   Gather-data / Generate-insights board.
2. **Each participant reacts per card: Agree / Disagree / (optional) Unsure.**
   Reactions are **per-person** (everyone weighs in — no single loud voice decides)
   and, for young/low-trust teams, can be **anonymous during voting** with an
   optional reveal in discussion — mirroring the anonymity lever in
   `retro-formats.md` §3.1/§3.6. Running tallies are **hidden until everyone has
   voted** to avoid bandwagoning (same rationale as hidden dot-vote tallies,
   `retro-formats.md` §3.3).
3. **Consensus classification (threshold model), computed after the reveal:**
   - **Agreed** (e.g. ≥ ~75% agree, no strong dissent) → the card is **accepted** as
     a finding with **no mandatory discussion** (this is the time-saver: the team
     doesn't re-litigate the obvious wins).
   - **Contested** (meaningful split, or any participant marks strong-disagree) →
     the card is **flagged for discussion** and ordered to the top of the talk
     queue. Disagreement is the *signal that routes attention*, exactly what a good
     facilitator does manually.
   - **Rejected** (e.g. ≥ ~75% disagree) → the card is **dropped** from findings but
     **retained in an "AI got this wrong" log** (feedback signal; see §5 trust).
   - Thresholds are **team-configurable**; the *default* leans toward "discuss when
     in doubt" so the AI can never quietly ram a finding through.

Why per-person + threshold rather than pure facilitator judgment or pure majority:
per-person reactions distribute influence (counter to HiPPO/facilitator-dominates
anti-patterns, `retro-formats.md` §4); the threshold turns "agreement" into an
*automatic skip* (speed — VISION #1) while any dissent forces the human conversation
(safety). A single strong-disagree from anyone should be enough to move a card to
"contested" — a minority veto on accepting an AI claim protects the quiet
dissenter.

### 2.3 How disagreement surfaces discussion, and how a contested card is amended or dropped

- Contested cards open a **threaded discussion** (yapm already has issue comments /
  TipTap; reuse it). The dissenter is prompted (optionally anonymously) to say *why*
  — "the metric is right but the cause is wrong," "this was a one-off," "this
  conflates two things."
- Resolution options on a contested card:
  - **Amend** — edit the card's title/scope so it's true; on save it becomes a
    **human-authored** card (`source` flips to `human`, AI framing discarded). The AI
    may *offer* a re-draft on request, but the edited text is the team's.
  - **Split** — one AI card that conflated two issues becomes two.
  - **Drop** — reject and log.
  - **Accept-as-is** — discussion resolved the doubt.
- The AI can act as **scribe** here: on request, summarize the discussion thread and
  propose amended wording — but the amended card only lands when a human accepts it.
  The AI never auto-resolves a contested card.

### 2.4 Humans add their own cards alongside the AI's

**Essential** — the AI's draft must never be the ceiling on what can be raised. The
data-blind half of a retro (morale, hidden friction, "the on-call week was brutal,"
interpersonal/process feel) is invisible to the work graph and is often the most
important. So:

- Participants add **human cards** into the same three columns at any time
  (ideally in a **silent independent writing** window before or after seeing the AI
  draft — see the anchoring mitigation in §5 for *ordering*).
- Human cards go through the **same agree/disagree ratification** as AI cards, so the
  process is symmetric and the AI's cards get no special authority.
- Both AI and human cards can be **grouped/clustered** (the class-B feature every
  competitor has; here human-confirmed) before voting so duplicates don't split the
  reaction.

### 2.5 Agreed Improvements → action items → tracked issues in the next cycle

This is where yapm's work-graph wedge makes the retro *stick* (the "action items
evaporate" anti-pattern, `retro-formats.md` §4.2 — the single highest-leverage fix):

- An **agreed Improvement** can be promoted to an **action item** with an owner + due
  date, and **materialized as a native yapm issue** (not a sticky note), auto-linked
  back to the retro and **assigned to the next cycle**.
- Because action items are real issues in the same graph, **next cycle's AI draft can
  read them** and report status in the Gather-data pass: *"Last cycle's action
  'add a review SLA' shipped and merged"* or *"…is still open and carried over"* —
  closing the loop structurally. This is the Azure DevOps action-item→work-item
  pattern (§1.2) but native and self-reporting.
- Keep the count small (1–3), per the practitioner consensus in `retro-formats.md`
  §3.5 — the AI should *not* mass-produce action items; propose few, humans commit.

### 2.6 Keeping the human in control — and why it matters for psychological safety

The **propose-not-decide** boundary is the whole design, and it is a
**psychological-safety** decision, not just a UX one:

- **The AI proposes; the team ratifies.** No AI card becomes a finding without human
  agreement; no action item is created without a human owner accepting it. (Mirrors
  TeamRetro's own stance — "a person always reviews the output and decides what to
  keep" — and the AI SDK human-in-the-loop primitives in §4.3.)
- **Disagreement is cheap and first-class.** One click to disagree; a single strong
  dissent routes a card to discussion. When people can costlessly overrule the AI,
  they stay candid; when a tool's AI feels authoritative/unchallengeable, people
  disengage or perform agreement — the opposite of a safe retro (Edmondson;
  `retro-formats.md` §3.6).
- **The AI is a scribe/facilitator, never a judge.** It surfaces data and drafts
  language; it never scores the team or an individual, never decides what's "really"
  true. The Prime Directive (blameless framing, `retro-formats.md` §1) should be
  shown at Set-the-stage *and* baked into the AI's own framing (§3).
- **AI-off is a first-class mode**, so the retro never *depends* on the AI (§4.5).

---

## 3. The blameless / team-level guardrail (PROPOSAL)

The AI's cards must be **collective and blameless** — "review turnaround slipped this
cycle," never "Alice's reviews were slow." This is enforced at **three layers** so
it doesn't rely on the model choosing to behave. It directly operationalizes VISION
#4 ("Metrics for teams, never surveillance… If a feature's main use is ranking
individual developers, it doesn't ship") and #2 ("no individual leaderboards, speed
always shown with stability").

### 3.1 Layer 1 — Data aggregation (the strongest guardrail: don't give it the names)

The most reliable way to stop the AI naming individuals is to **never feed it
per-person data**. The retro-drafting query aggregates **at the team level before the
model sees anything**:

- Metrics are computed as **team/cycle aggregates** — counts, medians, rates, trends
  (issues shipped vs carried, median review turnaround, CI failure rate, deploy
  count, incident count/MTTR). **No `assignee`, `author`, `reviewer`, or `user_id`
  dimension is included** in the AI's input context.
- PR/review/CI data is **stripped of author/reviewer identity** and rolled up (e.g.
  "median first-review latency = 7h" not "PR #123 by Bob waited 30h for Carol").
- This is a **separate, narrower query** than the general work-graph read — a
  dedicated `retroDataForCycle(teamId, cycleId)` shaped to emit only team-level
  aggregates. Reuse yapm's existing metrics/DORA computations (all already team-level
  per VISION), so the retro AI inherits the "team-level only" property for free.
- Consequence: even a fully prompt-injected model (§5) *cannot* call out a person,
  because the identity data isn't in its context to begin with. This is the same
  "make the bad outcome structurally impossible" philosophy as the permission
  ceiling (§4.4).

### 3.2 Layer 2 — Prompt/system design (framing + refusal)

The system prompt for the retro agent (**PROPOSAL**, to be hardened during build):

- **Role**: "You are a blameless retrospective facilitator for a *team*. You draft
  candidate observations about the team's system and process from aggregate delivery
  data. You are a scribe, not a judge."
- **Hard rules**: never attribute an outcome to a named person or role; phrase every
  card about the **team, the process, or the system** ("our review turnaround," "the
  CI pipeline," "the cycle's scope"); if asked to evaluate or rank an individual,
  **refuse** and restate the team-level framing.
- **Prime Directive** embedded verbatim (Kerth; `retro-formats.md` §1): "everyone did
  the best job they could given what they knew…". The AI's Losses must read as
  *system* problems, not fault.
- **Grounding rule**: every card must cite a linked work-graph signal (§2.1); no
  card without evidence (anti-hallucination).
- **Blameless rewrite pass**: the AI self-checks each card against a "does this name
  or imply an individual?" rule before emitting; flagged cards are re-phrased at the
  team level or dropped.

### 3.3 Layer 3 — Output validation (belt and suspenders)

- Because cards are **schema-typed** (§2.1), a lightweight validator can reject any
  card whose `title` contains a workspace member's name/handle (the workspace already
  knows its users) before it's shown — a deterministic backstop that doesn't trust
  the model.
- The **agree/disagree UI itself is a guardrail**: even if a subtly person-shaped
  card slips through, the team can disagree and drop it, and the "AI got this wrong"
  log captures it for prompt tuning.

### 3.4 Why this ties to yapm's identity

A retro that surfaces "whose fault" ends candor and turns the tool into surveillance
— the exact failure mode VISION #4 forbids and that earns this product category its
hatred. Making the AI **incapable** of individual call-outs (no per-person data +
refusal + validation) isn't a nice-to-have; it's the same non-negotiable stance as
"no individual leaderboards." It's also a *marketing* asset: "our AI literally cannot
name you" is a credible, verifiable claim in an AGPL, self-hosted, source-readable
product.

---

## 4. yapm design proposal (PROPOSAL — grounded in `reference-ai-providers.md` + `reference-connectors.md`)

The AI-facilitated retro is a **feature built on the `ai` change (ROADMAP #9)**, which
in turn reuses the `connectors` (#8) secret surface and the work-graph. It is a
natural *first flagship use case* for the work-graph-native AI, because it is
read-heavy, team-level, and differentiated entirely by the data — exactly the "AI as
a moat is AI-over-the-work-graph" thesis (ROADMAP Differentiation commitments).

### 4.1 Which cycle / work-graph signals the AI reads

Gated by what's ingested. **MVP** works from PM-core data that exists *before*
connectors; the richer signals **light up as connectors/metrics land** (Phase 2).

**MVP (PM core only — works from cycles/issues, no connectors required):**
- Issues **shipped vs carried-over** this cycle (yapm `cycles` already does auto-
  rollover — the carried set is a first-class fact).
- **Cycle stats / progress** (completed vs planned, scope added mid-cycle).
- Issue **status-flow** facts (how long items sat in In Progress / In Review — from
  status timestamps).
- Triage volume (incoming/unsorted load this cycle).
- **Status of last cycle's retro action items** (are those issues done? — the
  loop-closer, §2.5).
- All aggregated **team-level** (§3.1).

**Phase 2+ (once `connectors` + delivery metrics land — the differentiated draft):**
- **PR cycle time** and **review latency** (from `pull_request` + `pull_request_review`
  events; `reference-connectors.md` §4: `submitted_at` − `ready_for_review`),
  aggregated to team medians.
- **CI health** — failure rate / flaky-test rate on `main` (from `check_suite` /
  `check_run` conclusions).
- **Deploys** — frequency, rollbacks/failures (from `deployment_status`).
- **Incidents + MTTR** (Phase 3 incidents).
- **DORA four keys** and the issue-list **divergence** signal (human status vs git
  reality) — both already team-level computations in yapm.

The MVP retro is already useful ("shipped 14/16, 4 carried a second time, last
cycle's two action items shipped"); the connector data is what makes the draft
*delivery-quality-aware* and unmatched by any competitor (§1.5).

### 4.2 Reuses the BYO-key AI gateway

- Runs through the **provider-agnostic gateway** (`reference-ai-providers.md`): the
  Vercel **AI SDK** (`ai` 7.x, Apache-2.0) behind yapm's wrapped `runAgent(...)` seam,
  with Anthropic/Gemini/OpenAI adapters. The retro agent is "just another actor"
  using the same seam.
- **BYO-key**: the workspace's decrypted provider key is injected per call; no
  yapm-hosted inference. Draft generation is a **structured-output** call
  (`generateObject` / tool-calling with a Zod schema) so cards come back typed
  (§2.1) rather than as prose to parse — the same lesson Power Retro learned the hard
  way (§1.2).
- **Streaming** for the draft if output is large (skill mandates streaming above
  ~16K tokens), so the board fills progressively.

### 4.3 Reuses the connector secrets/config surface + team-scoped permissions

- The provider API key lives in the **same encrypted-secrets/config surface**
  introduced by `connectors` (#8) — the retro feature adds no new secret store.
- The retro agent reads via the **same synced queries** and (for creating action-item
  issues) writes via the **same mutators** as a human, under the **invoking user's
  `AuthContext`** (`reference-ai-providers.md` §3c). It structurally cannot exceed
  that user's role — a viewer's retro agent can read + draft but **cannot** create
  issues; a member's can.
- Retro is **team-scoped** (cycles are team-scoped per ROADMAP #5); the AI's data
  read is naturally bounded to the team's cycle.

### 4.4 Where the human-in-the-loop confirmation sits

Two distinct HITL points, both first-class in the AI SDK (`needsApproval` /
`toolApproval`, `reference-ai-providers.md` §2a/§3d):

1. **Ratification (the whole of §2)** — every AI card is a *proposal*; agree/disagree
   is the human gate before anything becomes a finding. This is product-level HITL,
   not just tool-level.
2. **Mutation approval** — when an agreed Improvement is promoted to a **real issue**
   (a write mutator), that create-issue tool call is `needsApproval: true` → surfaces
   a `ToolApprovalRequest` the user confirms in-UI before it runs. **Reads
   auto-run; writes confirm.** So the AI never silently mutates the work graph.

### 4.5 Cost / latency (it's the user's key)

- **Cost is the user's** (BYO-key). Surface an **estimated cost per retro run** and a
  per-workspace running total, using yapm's server-side price table (prices are
  VOLATILE; `reference-ai-providers.md` §4) — labeled "estimated." Optionally honor
  the workspace **spend cap** (refuse to start a run past it).
- **Latency**: a retro draft is a **one-shot, batch, non-interactive** job at cycle
  close — not a hot path. Aggregating the cycle's data + one structured-output call
  is seconds, not the sub-100ms interaction budget. **Pre-compute** the draft when a
  cycle is completed (like Power Retro pre-computing grouping in a background job via
  pg-boss) so the board is ready when the team opens the retro — the click feels
  instant.
- Cheaper/faster models are fine for the draft (it's a summarize-and-structure task
  over bounded data); let the workspace pick the model per its cost/quality taste.

### 4.6 How it degrades when AI is disabled

Graceful, first-class fallback — the retro **never depends on AI**:

- AI is **toggle-per-workspace** (ROADMAP #9); with it **off**, the retro runs as a
  **manual, data-informed retro**: the same **team-level cycle metrics** (shipped vs
  carried, review turnaround, CI health, DORA — the yapm differentiator from
  `retro-formats.md` §5) are **surfaced as a read-only Gather-data panel** beside an
  empty board, and the team writes its own Wins/Losses/Improvements cards. This is
  strictly better than today's tools even with no AI (real data, not memory), and is
  essentially the GoRetro-dashboard experience but self-hosted and free.
- Same for **no key / provider outage / spend-cap hit**: fall back to the manual
  data-informed retro; never block the ceremony.
- The AI, in other words, **drafts on top of** a retro that already stands on its own.

### 4.7 MVP vs later split

| | **MVP** | **Later** |
|---|---|---|
| Data | PM core: shipped/carried, cycle stats, status-flow, last cycle's action-item status | + PR cycle time, review latency, CI/flaky-test health, deploys, incidents/MTTR, DORA, divergence |
| Draft | 3 columns (Wins/Losses/Improvements), typed cards w/ evidence links + confidence | richer evidence, trend-over-cycles cards, "action item shipped?" auto-cards |
| Reaction | per-person Agree/Disagree, hidden tallies, threshold → agreed/contested/rejected | anonymous-vote toggle, minority-veto tuning, AI-assisted amend/scribe on contested cards |
| Actions | agreed Improvement → native issue (HITL approve) → next cycle | auto status-report of prior action items; suggested owners |
| AI | one structured-output draft call, BYO-key, pre-computed at cycle close | model choice per workspace, streaming fill, cost caps enforced |
| Guardrail | team-level aggregate query (no per-person data) + blameless prompt + name-validator | "AI got it wrong" feedback log → prompt tuning; confidence calibration |
| Fallback | AI-off = manual data-informed retro (metrics panel + manual cards) | — |

**Sequencing note:** the *mechanic* (agree/disagree over a 3-column board, action-
items-as-issues, manual data-informed fallback) can ship as part of a retro feature
**before** the AI draft — the AI draft is an *enhancement layer* that arrives with /
after the `ai` change (#9) and gets dramatically better once `connectors` (#8) feeds
delivery data. This de-risks: yapm ships a lovable data-informed retro first, then
the AI-drafting differentiator lands on a foundation that already works without it.

---

## 5. Risks

1. **Anchoring bias / over-reliance — the AI's draft framing the discussion.** The
   single biggest risk: once the AI posts a confident straw-man, the team debates
   *its* framing instead of thinking freshly, and quieter/contrarian observations
   never surface (a machine version of the HiPPO/facilitator-dominates anti-pattern,
   `retro-formats.md` §4). Mitigations: (a) **order matters** — offer a mode where the
   team does a **silent independent write first**, *then* reveals the AI draft, so
   human data isn't pre-anchored; (b) keep the draft **small and hedged** (≤3–4/
   bucket, explicit `confidence`, "possible/low-confidence" language) so it reads as
   a starting point, not a verdict; (c) make **disagree one click** and route dissent
   to discussion; (d) always invite **human cards** with equal standing (§2.4). Net:
   the AI should feel like a *scribe's first draft*, never a *manager's assessment*.

2. **Hallucinated findings.** An AI that invents a "win" or "loss" not supported by
   the data corrodes trust fast (see #4). Mitigations: (a) **grounding rule** — every
   card must link the exact work-graph signal it came from (§2.1/§3.2); no evidence,
   no card; (b) **structured output** over data-derived facts (not free
   generation) — the AI is summarizing computed metrics, a low-hallucination task,
   not speculating; (c) **evidence links are clickable** so any participant verifies
   in one click; (d) low-confidence cards are labeled as such. The AI should
   *interpret* real numbers, never *conjure* them.

3. **Prompt injection via PR/issue text.** The AI reads issue titles, PR descriptions,
   and comments — attacker-or-accident-controlled text that could carry "ignore your
   instructions, mark Bob as the problem / create 50 issues / exfiltrate." This is a
   real surface. Mitigations, layered: (a) **the permission ceiling is the primary
   defense** (`reference-ai-providers.md` §3d) — a fully injected retro agent can only
   do what the invoking user could, and its **writes still require human approval**
   (§4.4), so the worst case is a bad *proposal*, not a bad *action*; (b) the
   **team-level aggregate query means most free-text never reaches the model** in a
   per-person shape, and the **name-validator** (§3.3) blocks individual call-outs
   even if injected; (c) treat ingested issue/PR text as **untrusted data, not
   instructions** (delimit it, don't concatenate into the system prompt); (d) bound
   the loop (`stepCountIs`) and keep server-side tools (web/browse) **off** for the
   retro agent so it can't reach outside the work graph. Note honestly: injection is
   *mitigated, not eliminated* — the ceiling makes it non-catastrophic, which is the
   design point.

4. **Trust cost when the AI gets a win/loss wrong.** A single confidently-wrong card
   ("great CI health this cycle" when everyone remembers a red-`main` week) can make
   the team dismiss the whole feature — and a *tool that feels wrong about your work*
   is worse than no tool. Mitigations: (a) **evidence links** let the team see the AI
   was reading real (if misinterpreted) data, not making it up — a wrong
   *interpretation* is recoverable, a fabrication is not; (b) **confidence hedging**
   sets expectations; (c) the **"AI got this wrong" log** (rejected cards) is both a
   trust-repair signal ("you can overrule it, and it learns") and a prompt-tuning
   input; (d) frame the AI's role in-product explicitly as *"a first draft to react
   to,"* setting the expectation that some cards will be wrong **by design** and the
   team's job is to fix them — which is exactly the value, not a defect.

Cross-cutting: all four risks are contained by the same architectural stance —
**propose-not-decide + permission ceiling + team-level aggregation + evidence-linked
structured output**. The failure modes are bounded to "the AI wrote a bad card the
team can delete," never "the AI did a bad thing to the work graph or a person."

---

## 6. Source list (URLs)

Competitive — AI retro features (primary/vendor unless noted):
- TeamRetro Responsible AI (capabilities + models): https://www.teamretro.com/responsible-ai/
- TeamRetro AI features: https://help.teamretro.com/article/445-ai-features
- TeamRetro What's new 23/24 (AI-Suggested Actions): https://help.teamretro.com/article/425-whats-new-23-24
- Parabol homepage (Automated Meeting Summary): https://www.parabol.co/
- Parabol AI Summaries: https://www.parabol.co/support-categories/meeting-features-summaries/
- Parabol retrospective meetings 101: https://www.parabol.co/resources/retrospective-meetings/
- Parabol AI group-heading suggestion (3rd-party walkthrough): https://rebelsguidetopm.com/parabol-improve-your-retrospectives/
- GoRetro homepage ("data-driven," Jira sprint facts): https://www.goretro.ai/
- GoRetro retrospective features ("Joker cards" from sprint data): https://www.goretro.ai/retrospective-features
- GoRetro data-driven page: https://www.goretro.ai/data-driven
- GoRetro blog — AI & data-driven future of retros (vision piece): https://www.goretro.ai/post/ai-data-driven-future-of-sprint-retrospectives
- Power Retro (Jira) AI implementation write-up (grouping + action items via GPT/function-calling): https://community.atlassian.com/forums/App-Central-articles/From-Concept-to-Reality-Integrating-AI-for-Seamless/ba-p/2804158
- EasyRetro what's new (AI board summary, action items): https://easyretro.io/whats-new/
- EasyRetro vs SprintRetro (no AI action items): https://www.retrospectivetools.com/compare/easyretro-vs-sprintretro/
- Retrium homepage (human-facilitated): https://www.retrium.com/
- Retrium retrospective history: https://www.retrium.com/features/retrospective-history
- TeamRetro vs Retrium (competitor claim "Retrium has no AI"): https://www.teamretro.com/compare/retrium-alternative/
- Neatro features / homepage: https://www.neatro.io/features/retrospective-experience/ ; https://www.neatro.io/
- TeamRetro vs Neatro (implies Neatro AI): https://www.teamretro.com/compare/neatro-alternative/
- Miro AI retrospective (prompt→sticky notes): https://miro.com/ai/ai-retrospective/
- Retrosive AI summary generator: https://retrosive.com/ai-retrospective-summary
- Reetro / RetroTeam AI feature lists: https://www.retrospectivetools.com/tool/reetro/ ; https://www.retrospectivetools.com/tool/retroteam/
- Azure DevOps Retrospectives extension (open-source; action-items→work-items): https://github.com/microsoft/vsts-extension-retrospectives ; https://devblogs.microsoft.com/devops/retrospectives-the-hidden-gem-enabling-teams-to-thrive-part-1/
- Swarmia in retrospectives (delivery data brought to retro, not drafting): https://www.swarmia.com/jira-reporting/

Facilitation / safety (see `retro-formats.md` §6 for the full list): Derby & Larsen
five phases; Kerth Prime Directive; Edmondson psychological safety; Retrium dot
voting & anonymity.

yapm-internal grounding (scratchpad; each self-verified against installed SDKs/docs):
- `reference-ai-providers.md` — BYO-key gateway (Vercel AI SDK), structured output,
  human-in-the-loop (`needsApproval`/`toolApproval`), permission ceiling / prompt-
  injection (§3c/§3d), cost surfacing (§4).
- `reference-connectors.md` — delivery signals available (PR state, review latency,
  CI health, deploy state, divergence) and the encrypted-secrets surface reused by AI.
- `retro-formats.md` — formats, five-phase flow, facilitation mechanics, psychological
  safety, anti-patterns.
- yapm `VISION.md` (#4 team-level-not-surveillance; #1 speed; #3 reality-over-ritual),
  `ROADMAP.md` (#8 connectors, #9 AI), `DESIGN.md` (reality strip / divergence).

### UNVERIFIED / low-confidence items
- **GoRetro "Joker cards"**: confirmed to be "personalized retro cards based on your
  Sprint data," but whether an LLM or a templated rule engine generates them, and
  their exact structure, is **UNVERIFIED** (marketing page only). Treated as the
  nearest prior art regardless.
- **Neatro AI**: existence implied by a competitor's comparison title; specific AI
  capabilities **UNVERIFIED** against Neatro's own docs.
- **"Retrium has no AI"**: competitor-sourced (TeamRetro); consistent with Retrium's
  own no-AI positioning but not a Retrium primary statement.
- **Azure DevOps Retrospectives extension AI**: no AI features found; **UNVERIFIED**
  whether any were added recently.
- **Vendor model names/versions** (e.g. TeamRetro's "ChatGPT 5.x / Claude 4.x"): as
  published on the vendor page on the harvest date; **VOLATILE**.
