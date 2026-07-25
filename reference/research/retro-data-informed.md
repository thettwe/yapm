# Data-Informed / Metrics-Driven Retrospectives — Research for yapm (Phase-2 feature)

**Prepared:** 2026-07-25
**Audience:** yapm product/eng (VISION.md, ROADMAP.md, DESIGN.md context)
**Thesis under investigation:** *A retrospective should start from the cycle's REAL delivery data (from the work graph) rather than from memory.* This maps cleanly onto yapm's wedge — one work graph (issue ↔ PR ↔ CI ↔ deploy ↔ incident) — and its stated principle "Reality over ritual" (VISION #3) and "Metrics for teams, never surveillance" (VISION #4).

Retrospectives are explicitly a **Phase-2** feature per the brief. This document is the research substrate for designing that feature: the thought-leadership case, the specific delivery signals worth surfacing, the DORA/SPACE framing, the surveillance risk and how blameless/team-level framing defuses it, and a concrete "auto-populated cycle data panel" design plus differentiation vs. blank-whiteboard retro tools.

---

## 1. The core idea: retros are supposed to be data-informed by design

The canonical structure of an agile retrospective — the one every serious retro tool and facilitator uses — is the **five-stage framework** from Esther Derby & Diana Larsen's 2006 book *Agile Retrospectives: Making Good Teams Great*:

1. **Set the stage**
2. **Gather data**  ← *this is the stage yapm can automate*
3. **Generate insights** (ask "why?", find root causes)
4. **Decide what to do** (commit to improvements)
5. **Close**

The order is deliberate and not meant to be skipped: gathering data *before* generating insights "prevents the team from jumping to conclusions off a single loud opinion," and generating insights before deciding prevents action items that "treat symptoms instead of causes." Sources: [UCSB CS48 — Derby/Larsen Five Step Retro](https://ucsb-cs48.github.io/topics/retros_darby_larsen/), [Growing Scrum Masters](https://www.growingscrummasters.com/keywords/five-stage-retrospective-framework/), [Applied Frameworks](https://agile.appliedframeworks.com/applied-frameworks-agile-blog/agile-retrospective-framework-in-five-steps).

**Key insight for yapm:** "Gather data" is a first-class, *named* stage of the standard retro — but in practice most teams execute it from memory and feelings. The thesis is not novel invention; it is *doing the second stage properly*. yapm owns the data that stage is supposed to be about.

The Agile Manifesto's 12th principle already frames this: "At regular intervals, the team reflects on how to become more effective, then tunes and adjusts its behavior accordingly." Data-informed retros operationalize "reflect" against evidence rather than recollection. Source: [Umano — Data Driven Retrospectives](https://blog.umano.tech/2020/11/11/data-driven-sprint-retrospectives).

---

## 2. Thought-leadership / writing on data-driven retros

Consistent themes across the practitioner literature:

- **Shift from feelings to evidence.** "Using data shifts the conversation from 'feelings' to evidence." Conducted well, retros boost outcomes; conducted poorly they "breed toxicity" — data helps steer them. Source: [ActivityTimeline — Sprint Retrospective best practices](https://activitytimeline.com/blog/sprint-retrospective), [Umano](https://blog.umano.tech/2020/11/11/data-driven-sprint-retrospectives).

- **Visuals trigger better discussion.** Instead of asking "what slowed us down?", show the burndown / cycle-time chart; the visual triggers clearer, more specific discussion. Source: [Agile Seekers](https://agileseekers.com/blog/how-to-facilitata-powerful-retrospectives-with-data-actionable-outcomes).

- **Prepare the data in advance ("audit").** The facilitator should "build a strong foundation… by performing an audit to collect data in advance." This is exactly the manual labor an auto-populated panel eliminates. Source: [Code Climate — Adding value to retrospectives with data](https://codeclimate.com/blog/plan-retrospectives-with-data).

- **Be selective; avoid vanity metrics.** "Don't measure parameters just because they are easy to track" — a consequence of PM tools shipping out-of-the-box reports. Source: [Age-of-Product — Data-Informed Retrospectives](https://age-of-product.com/data-informed-retrospectives/).

- **Always record context.** "Data without context — the number of available team members, the intensity of incidents during a sprint — may turn out to be nothing more than noise." Source: [Age-of-Product](https://age-of-product.com/data-informed-retrospectives/).

- **Never weaponize for comparison.** "Never compare internal metrics with other teams" (or individuals — see §5). Source: [Age-of-Product](https://age-of-product.com/data-informed-retrospectives/).

- **Introduce data gradually.** Bringing data into retros changes team behavior; go gently, build a repeatable habit, reduce resistance. Source: [Umano](https://blog.umano.tech/2020/11/11/data-driven-sprint-retrospectives).

- **Close the loop.** The value comes from turning a retro action into a measurable hypothesis: qualitative retro output → measured against quantitative data (e.g., PR size) in the *next* cycle. "Why not retrospect in real-time?" — data should be available continuously, not assembled once a cycle. Sources: [ActivityTimeline](https://activitytimeline.com/blog/sprint-retrospective), [Code Climate](https://codeclimate.com/blog/plan-retrospectives-with-data).

- **Qualitative + quantitative reinforce each other.** Data tells you *what* changed; the human discussion tells you *why*. Neither replaces the other — a critical framing for yapm (the panel starts the conversation, it doesn't end it). Source: [Age-of-Product](https://age-of-product.com/data-informed-retrospectives/).

- **Tooling examples in this space:** SprintRetro (Atlassian Forge, pulls velocity/predictability/scope change/carryover/cycle time into the retro), Teaminal ("enriches each retro with data pulled in from GitHub and Jira, plus daily standups logged throughout the sprint"). Sources: [SprintRetro](https://sprintretro.co/), [Teaminal — Best free retrospective tools](https://www.teaminal.com/blog/free-retrospective-tools/).

---

## 3. Which delivery signals are most useful to review in a retro

Below are the signals worth surfacing, grouped, each with sourcing and the yapm work-graph provenance (i.e., *which native entity yapm already has or will have that produces it*).

### 3.1 Flow & predictability (yapm has this natively today — cycles, issues, projects)
- **What shipped vs. what carried over.** Classify cycle issues as *Planned* (in scope at cycle start), *Completed*, *Carryover* (rolled from previous cycle), *Carryover 2+* (rolled ≥2 cycles), and *Removed from scope*. This is the single most retro-relevant breakdown and yapm already computes it: cycles have **auto-rollover of unfinished work** on completion (ROADMAP change #5), which is precisely the carryover signal. Swarmia's purpose-built sprint categories are literally this list. Source: [Swarmia — Sprints docs](https://help.swarmia.com/metrics-and-definitions/sprints), [Swarmia — Sprint metrics product](https://www.swarmia.com/product/sprints/).
- **Velocity trend** — over-commitment vs. improving predictability. Show the *trend across cycles*, not one number (see Goodhart caveat §5). Source: [ActivityTimeline](https://activitytimeline.com/blog/sprint-retrospective).
- **Scope change / scope increase** — issues added mid-cycle vs. removed. Swarmia surfaces "scope increase and carryover." A high mid-cycle add rate is a planning/triage signal — and yapm has **triage** as a native surface (ROADMAP #6). Source: [Swarmia — Sprints](https://help.swarmia.com/metrics-and-definitions/sprints).
- **Issues in scope with no activity** — items that sat untouched all cycle (Swarmia surfaces this explicitly). yapm can detect this from issue state + linked git activity. Source: [Swarmia — Sprints](https://help.swarmia.com/metrics-and-definitions/sprints).
- **WIP (work in progress)** — reveals excessive multitasking / context-switching. Source: [ActivityTimeline](https://activitytimeline.com/blog/sprint-retrospective).
- **Carry-over / unrealistic planning** and **burndown shape** (how work actually progressed through the cycle). Source: [ActivityTimeline](https://activitytimeline.com/blog/sprint-retrospective).

### 3.2 Timing / cycle-time metrics (lights up with yapm connectors — PR data)
- **PR cycle time** — clock starts when a PR opens, stops at merge (some definitions extend to deploy). It measures *flow*, not code quality. Healthy median PR lifecycle is **under 24 hours**; elite teams merge 50% of PRs same-day and 90% within 48h. Sources: [GitKraken — PR cycle time benchmarks 2026](https://www.gitkraken.com/blog/healthy-pr-lifecycle-time-benchmarks-targets-2026), [getDX — cycle time](https://getdx.com/blog/cycle-time/).
- **Time to first review** — how long a PR waits before *any* feedback. Long here = review-assignment broken, reviewers overloaded, or no shared SLA. "First-review lag is usually cycle time's biggest component." Source: [Metabase — Code review health dashboard](https://www.metabase.com/dashboards/code-review-health/), [GitKraken](https://www.gitkraken.com/blog/healthy-pr-lifecycle-time-benchmarks-targets-2026).
- **Time to approval**, **number of review cycles** (back-and-forth iterations — high count signals unclear requirements or thin PR descriptions), and **merge time** (approval → landed on main). Source: [Metabase](https://www.metabase.com/dashboards/code-review-health/), [Abloomify](https://www.abloomify.com/blog/reduce-code-review-cycle-time).
- **Review wait is typically the largest slice of lead time** — "code sits in review far longer than it sits in CI." This is a high-value retro topic and directly actionable. Source: [Plandek — cycle time](https://plandek.com/blog/what-is-cycle-time-and-how-to-reduce-it), [Sourcegraph — cycle time guide](https://sourcegraph.com/blog/cycle-time-in-software-development-a-complete-guide).
- **PR size** — the single highest-leverage lever ("smaller PRs move faster, attract better feedback, introduce fewer defects"). A benchmark cited: keep PR size < ~98 code changes; some teams warn/block on threshold. A great recurring retro metric because it's actionable *tomorrow*. Source: [GitKraken](https://www.gitkraken.com/blog/healthy-pr-lifecycle-time-benchmarks-targets-2026), [AutonomyAI](https://autonomyai.io/technology/ci-cd-optimization-how-to-shorten-pr-cycle-time-and-ship-faster/).
- **Measurement caveats to bake in:** exclude/flag **dependency bot PRs** (Dependabot etc. open/merge in minutes, can be half a repo's volume, drag the median down) and **draft PRs** (not ready for review, distort the picture). Source: [Metabase](https://www.metabase.com/dashboards/code-review-health/).

### 3.3 DORA four keys (yapm Phase-2 goal — deploy + incident data)
- **Deployment Frequency**, **Lead Time for Changes**, **Change Failure Rate**, **Time to Restore Service (MTTR)**. DORA's own guidance puts retrospectives at the heart of the improvement cycle: "Use the DORA Quick Check, conversations, and **team retrospectives** to validate the progress you've made. Repeat the process." Sources: [DORA — software delivery performance metrics](https://dora.dev/guides/dora-metrics/), [getDX — DORA metrics complete guide](https://getdx.com/blog/dora-metrics/).
- These are **team/system-level by design** (see §4, §5), which is exactly aligned to yapm's stance. Source: [Multitudes — DORA & developer productivity](https://www.multitudes.com/blog/dora-developer-productivity).
- Caveat to state in the panel: **DORA tells you *what*, not *why*.** "DORA metrics provide valuable system data, but they don't explain why performance changes occur." Pairs with the human discussion. Source: [getDX — DORA](https://getdx.com/blog/dora-metrics/).

### 3.4 CI health / flaky tests (yapm connectors — CI runs)
- **Flaky tests and slow/brittle builds** "add delay at exactly the point where you need speed and confidence." Rerunning flaky tests is one of the between-step costs that dominate delivery time in high-change orgs. A per-cycle count of flaky/failed CI runs and build-time trend is a strong retro signal. Sources: [AutonomyAI — CI/CD optimization](https://autonomyai.io/technology/ci-cd-optimization-how-to-shorten-pr-cycle-time-and-ship-faster/), [mstone — PR cycle time](https://mstone.ai/glossary/pr-cycle-time/).
- Frame CI as a loop across **speed** (PR-open→merge, merge→deploy) and **reliability** (fewer flaky checks, fewer broken builds, fewer rollbacks). "Every flaky test removed… pays back on every future change." Source: [AutonomyAI](https://autonomyai.io/technology/ci-cd-optimization-how-to-shorten-pr-cycle-time-and-ship-faster/).

### 3.5 Incidents / MTTR (yapm Phase-3, closes the loop)
- **Incidents opened during the cycle, change failure rate, MTTR.** Blameless incident retros are directly tied to improving MTTR: "A blameless culture is one where engineers report incidents honestly… because the goal is systemic improvement rather than individual accountability. Run blameless retrospectives after every significant incident." Sources: [getDX — DORA](https://getdx.com/blog/dora-metrics/), [Multitudes](https://www.multitudes.com/blog/dora-developer-productivity).

### 3.6 Quality signals
- **Bug/defect counts, escaped defects, code-review time.** "If defects are rising, ask: what practices changed in this sprint?" Issues with many PRs may indicate work wasn't batched; PRs with high rework may signal an engineer struggling with a hard area or unclear technical direction — a *support* signal, not a blame signal. Source: [ActivityTimeline](https://activitytimeline.com/blog/sprint-retrospective).

**Selection principle (critical):** don't dump all of the above into one panel. Pick the few that (a) yapm can populate from real graph data this cycle, and (b) the team can *act on*. "Every metric should either be driving a decision or informing a trend — otherwise it's noise. After 4–6 weeks, audit your metrics: has this metric caused us to change anything? If not, remove it." Source: [getDX — DORA](https://getdx.com/blog/dora-metrics/).

---

## 4. How DORA / SPACE framing applies to retros

### DORA
- DORA is the **team/delivery-level** framework: Deployment Frequency, Lead Time, Change Failure Rate, Time to Restore. It measures the *delivery* half — speed and stability together. Source: [Multitudes](https://www.multitudes.com/blog/dora-developer-productivity), [DORA](https://dora.dev/guides/dora-metrics/).
- DORA's improvement model *is* retrospective-centric: measure → discuss in retro → agree on **one** improvement action → re-measure next cycle. "The natural home for metrics review is your sprint report and retrospective. Show the data, discuss what changed, agree on one improvement action." Source: [getDX — DORA](https://getdx.com/blog/dora-metrics/).
- DORA's research also emphasizes a **generative/learning culture** (Westrum) and blameless experimentation as the cultural substrate that makes metrics safe to look at — "builds the muscle of tackling new challenges… blameless experimentation." Source: [getDX — DORA](https://getdx.com/blog/dora-metrics/).
- **Speed + stability shown together** is a DORA discipline that matches yapm DESIGN/VISION ("speed always displayed alongside stability"). Optimizing one in isolation harms the other — "faster cycle time isn't valuable if your change failure rate spikes." Source: [GitKraken](https://www.gitkraken.com/blog/healthy-pr-lifecycle-time-benchmarks-targets-2026).

### SPACE
- SPACE (Forsgren, Storey, et al., 2021) = **S**atisfaction & well-being, **P**erformance, **A**ctivity, **C**ommunication & collaboration, **E**fficiency & flow — measurable at **individual, team, and system** levels. Source: [Swarmia — SPACE framework](https://www.swarmia.com/blog/space-framework/), [getDX — SPACE](https://getdx.com/blog/space-metrics/).
- SPACE is **complementary to DORA**: Forsgren frames DORA as "the signal" (how we're doing) and SPACE as "the action required" to improve. For a retro, SPACE is the reminder to look beyond delivery throughput to *flow* (interruptions, handoffs, review wait) and *satisfaction* (is this pace sustainable?). Source: [getDX — SPACE](https://getdx.com/blog/space-metrics/), [Red Gate — SPACE](https://www.red-gate.com/blog/database-devops/what-is-the-space-developer-productivity-framework/).
- **Anti-gaming guidance built into SPACE:** use "at least three metrics from three different dimensions." No single number can be optimized without the others revealing distortion — cross-validation makes gaming hard. This is the design rule for yapm's panel: never show one hero metric. Sources: [Swarmia](https://www.swarmia.com/blog/space-framework/), [Axify — Goodhart's Law](https://axify.io/blog/goodhart-law).
- **Caution for yapm:** SPACE *can* be measured at the individual level, but yapm's stance is team-level only. yapm should adopt SPACE's *dimensions* (esp. Efficiency & Flow) at the **team aggregate**, and get Satisfaction via optional team-level check-ins (a retro sentiment vote), never per-person productivity scoring. Source: [getDX — SPACE](https://getdx.com/blog/space-metrics/).

---

## 5. The surveillance / blame risk — and how team-level, blameless framing avoids it

This is the section most load-bearing for yapm's differentiation (VISION #4: "Metrics for teams, never surveillance… No individual leaderboards, no stack ranking").

### The risk is real and well-documented (Goodhart's Law)
- "When a measure becomes a target, it ceases to be a good measure" (Goodhart, popularized by Strathern). Applied to dev metrics: tie individual performance to raw numbers and "developers game the system, split PRs artificially, inflate story points, and focus on metrics over value." Source: [Keypup — Goodhart's Law in dev metrics](https://www.keypup.io/blog/goodharts-law-in-action-why-your-dev-metrics-are-being-gamed-and-how-to-fix-it/), [Practical DevSecOps](https://www.practical-devsecops.com/glossary/goodharts-law/).
- Concrete gaming patterns: **velocity** → estimate inflation ("what was a 3 becomes a 5"); **deployment frequency** → splitting one change into three deploys; **LOC** → padding; **test coverage** → tests that cover lines but assert nothing. Source: [Axify — Goodhart's Law](https://axify.io/blog/goodhart-law), [CodePulse — Goodhart's Law](https://codepulsehq.com/guides/goodharts-law-engineering-metrics).
- The dysfunction vignette: "a senior engineer submits 47 PRs in a sprint when last quarter's average was 8… an architect who used to mentor everyone now has zero PRs for two weeks." Individual-level counting punishes exactly the collaborative behavior teams want. Source: [Keypup](https://www.keypup.io/blog/goodharts-law-in-action-why-your-dev-metrics-are-being-gamed-and-how-to-fix-it/).

### The distinction that saves it: surveillance vs. insight
- "**Imposed metrics feel like surveillance; chosen metrics feel like tools.** Self-selected metrics are also harder to game because the team knows why they chose them." Metrics-as-surveillance → gaming, trust erosion, talent flight; metrics-as-insight → self-awareness, growth, optimization. Source: [Keypup](https://www.keypup.io/blog/goodharts-law-in-action-why-your-dev-metrics-are-being-gamed-and-how-to-fix-it/).
- "The problem isn't measurement — it's measuring the wrong things… Measure systems and processes, not individuals. Use metrics to find bottlenecks and improve flow, never to compare developers." Source: [gitmore — developer productivity metrics 2026](https://gitmore.io/blog/developer-productivity-metrics).
- **Why DORA specifically resists surveillance:** it measures *outcomes* (delivery speed & safety), not *activity* (commits, LOC) that invites individual comparison. Source: [getDX — DORA](https://getdx.com/blog/dora-metrics/).
- Long cycle times "often signal hidden problems — not bad developers, but **friction**. Used this way, the metric supports better conversations, not pressure." Source: [GitKraken](https://www.gitkraken.com/blog/healthy-pr-lifecycle-time-benchmarks-targets-2026).

### Design rules yapm should encode (turn philosophy into product constraints)
1. **Team-level aggregation only.** No per-developer breakdown, no leaderboard, no stack rank. (Matches VISION #4 and North Star: "Zero features gated by seat count… verifiable by anyone reading the source" — and here, verifiable that no individual scoreboard exists in the schema/UI.)
2. **Show trends, not absolutes.** "'Cycle time decreased 20%' is more useful than 'cycle time is 48 hours' — trends show improvement while absolutes invite comparison and competition." Source: [Keypup](https://www.keypup.io/blog/goodharts-law-in-action-why-your-dev-metrics-are-being-gamed-and-how-to-fix-it/).
3. **Always show speed *and* stability together.** Prevents optimizing one at the other's expense. Source: [GitKraken](https://www.gitkraken.com/blog/healthy-pr-lifecycle-time-benchmarks-targets-2026).
4. **Balanced set (≥3 signals, ≥3 dimensions).** No single hero metric to game. Source: [Swarmia — SPACE](https://www.swarmia.com/blog/space-framework/).
5. **Blameless framing in copy.** The panel narrates the *system* ("review wait grew this cycle"), never a person ("X was slow to review"). Blameless retros are the documented path to honest incident reporting and better MTTR. Source: [Multitudes](https://www.multitudes.com/blog/dora-developer-productivity).
6. **Metric hygiene / retirement.** Let teams pin/unpin panel widgets; nudge to audit ("has this driven a decision in 4–6 weeks?"). Source: [getDX — DORA](https://getdx.com/blog/dora-metrics/).
7. **Never tie to comp/reviews.** Explicit non-goal; "start by auditing whether any metric is tied to compensation." Source: [Keypup](https://www.keypup.io/blog/goodharts-law-in-action-why-your-dev-metrics-are-being-gamed-and-how-to-fix-it/).

> yapm's existing stance ("team-level metrics only, never individual surveillance") is not just ethically nicer — per the sources it is the *technically correct* way to keep metrics useful (un-gamed) and to preserve psychological safety in the retro. This is a marketable, principled position, and it's enforceable in an open-source schema.

---

## 6. How a yapm retro would auto-populate a "here's what actually happened this cycle" data panel

The design goal: when a cycle completes (yapm already has cycle completion + auto-rollover, ROADMAP #5), yapm opens a **Retro** for that cycle whose "Gather data" stage is *pre-filled from the work graph* — the facilitator does zero manual data-collection ("audit") because the data is native. This directly automates Derby/Larsen stage 2.

### 6.1 Data provenance — everything comes from entities yapm already models
yapm's wedge is that `issue ↔ PR ↔ CI run ↔ deploy ↔ incident` are first-class linked entities in one model (VISION §"one work graph"). That means the retro panel is a **query over the graph**, not an ETL/identity-mapping job (which is the entire product of LinearB/Swarmia). Concretely:

| Panel widget | Source entity in yapm graph | Available in phase |
|---|---|---|
| Completed / carryover / carryover-2+ / removed | issues ↔ cycle (auto-rollover already computes rollover) | **now (cycles, ROADMAP #5)** |
| Scope changes (added/removed mid-cycle) | issue↔cycle assignment events + triage | **now** |
| Velocity & predictability trend | cycle completion history | **now** (estimates deferred, so count-based first) |
| Issues with no activity | issue ↔ linked PR/commit (null link) | connectors (#8) |
| PR cycle time, time-to-first-review, review cycles, PR size | PR entity + review events | connectors (#8) |
| CI health / flaky/failed runs / build time | CI-run entity | connectors (#8) |
| DORA four keys | deploy + incident entities | Phase 2/3 |
| MTTR / change failure rate | incident entity | Phase 3 |

Because sync is via **Zero (local-first, real-time)**, the panel is *live and free* — it can update in real time during the retro and be "retrospected in real-time," which the literature explicitly wants ("Why not retrospect in real-time?"). Source: [Code Climate](https://codeclimate.com/blog/plan-retrospectives-with-data). (yapm sync engine: ROADMAP change #1/#2, Zero.)

### 6.2 Panel structure (mapped to the five-stage framework)
- **Set the stage:** cycle name/dates, team, a one-line sentiment prompt (optional team-level mood vote — the SPACE "Satisfaction" dimension at team aggregate, never per person).
- **Gather data (AUTO-POPULATED — the differentiator):** the widgets above, rendered as *trend visuals* (sparklines vs. prior cycles), grouped as **Delivered** (shipped vs. carried), **Flow** (PR cycle time, review wait), **Health** (CI/flaky, incidents), each with a plain-language, blameless caption ("Review wait was the largest slice of lead time this cycle" — the "visual triggers discussion" principle). Bots/drafts flagged-excluded by default. Sources: [Agile Seekers](https://agileseekers.com/blog/how-to-facilitata-powerful-retrospectives-with-data-actionable-outcomes), [Metabase](https://www.metabase.com/dashboards/code-review-health/).
- **Generate insights:** standard reflection board (What went well / What didn't / Ideas) — but each sticky can be **linked to a data widget or a specific issue/PR** in the graph (evidence-anchored reflection). This is the join blank-whiteboard tools cannot make.
- **Decide what to do:** action items become **real yapm issues** (native, not a synced-back copy), optionally tagged as a "process-improvement hypothesis" with the metric it targets (e.g., "reduce PR size" → watch PR-size trend next cycle). Closes the loop natively. Source: [Age-of-Product](https://age-of-product.com/data-informed-retrospectives/).
- **Close:** carry the chosen action(s) forward; next cycle's panel automatically shows whether the targeted metric moved — the "measure the impact of changes on subsequent sprints" loop, with zero manual re-collection. Source: [ActivityTimeline](https://activitytimeline.com/blog/sprint-retrospective).

### 6.3 Guardrails encoded in the panel (from §5)
- Team-level aggregates only; no per-person columns anywhere.
- Trends/deltas emphasized over raw absolutes.
- Speed and stability rendered as a pair.
- ≥3 signals across ≥3 dimensions by default; widgets are pin/unpin-able with a periodic "is this still driving decisions?" nudge.
- Blameless copy throughout.

### 6.4 Optional AI assist (fits ROADMAP #9, BYO-key AI over the graph)
yapm's BYO-key, work-graph-native AI could draft a **blameless narrative summary** of the panel ("This cycle you shipped 14 of 18 planned issues; 4 carried over — 2 of them for the 2nd time; median PR cycle time rose from 19h to 31h, driven by first-review wait") and *suggested discussion prompts* — analogous to LinearB's AI-generated retros, but running over yapm's own graph under the same permission model as humans, self-hosted, no data leaving the box. LinearB's own customer quote: "We started comparing the AI-generated retros to our actual sprint progress, and it made us look deeper." Source: [LinearB vs Swarmia](https://linearb.io/compare/swarmia-vs-linearb). *(yapm AI = ROADMAP #9; the differentiator is AI-over-the-work-graph, VISION.)*

---

## 7. Differentiation vs. blank-whiteboard retro tools

### The landscape splits in two
1. **Blank-whiteboard / sticky-note retro tools** — Metro Retro, EasyRetro, My Retro App, StickyRetro, and (partly) Miro/FigJam. Freeform canvas, voting, templates. Metro Retro "leaves the facilitation to you: **no guided stages, no built-in action tracking, and no health-check radars** to show how the team is trending over time." Sticky-note tools optimize for "create a board, get a link, no login." **None of them know anything about your delivery data.** Sources: [TeamRetro — Metro Retro alternative](https://www.teamretro.com/compare/metro-retro-alternative/), [Echometer — best retro tools](https://echometerapp.com/en/retrospective-tools-online/).
2. **Structured retro tools** — TeamRetro, Neatro, Parabol, Retrium. Guided stages, templates, action tracking, health checks. **Parabol** is open-source and integrates with Jira/GitHub/GitLab/Linear — *but the integration is for issue/task syncing and Sprint Poker estimation, not pulling delivery metrics into the retro.* "Parabol integrates with Jira and GitHub primarily for task/issue syncing and estimation; it doesn't pull detailed sprint metrics into the retro context." Sources: [Parabol GitHub integration](https://www.parabol.co/integrations/github/), [Parabol vs Retrium](https://www.parabol.co/comparison/retrium-alternative/), [Teaminal](https://www.teaminal.com/blog/free-retrospective-tools/).
3. **Metrics-into-retro tools** — SprintRetro (Atlassian Forge, pulls velocity/predictability/scope/carryover/cycle time), Teaminal (enriches retros with GitHub+Jira data + standups). These prove the demand — *but they are add-ons bolted onto a PM tool whose data they must re-import.* Sources: [SprintRetro](https://sprintretro.co/), [Teaminal](https://www.teaminal.com/blog/free-retrospective-tools/).
4. **Engineering-metrics platforms** — Swarmia, LinearB. Have the delivery data and sprint-carryover categories, but the **retro is not their surface** — they're dashboards a manager reads, and their entire engineering cost is *joining data across Jira ↔ GitHub ↔ CI* (the exact ETL yapm's native graph eliminates). Swarmia's sprints are *Jira-Cloud-only and in beta*; they don't support Linear Cycles yet. Sources: [Swarmia — Sprints](https://help.swarmia.com/metrics-and-definitions/sprints), [LinearB vs Swarmia](https://linearb.io/compare/swarmia-vs-linearb).

### yapm's unique position
No one else is **both** the PM tool (issues, cycles, board, roadmap) **and** the delivery-data owner **and** the retro surface, in one AGPL self-hosted product. That collapses three purchases (PM tool + metrics platform + retro tool) into one:

- **vs. blank-whiteboard tools (Metro Retro, EasyRetro, sticky-note apps):** yapm's retro arrives with the "Gather data" stage *already filled* from real graph data. They start from an empty canvas and human memory; yapm starts from what git/CI/deploy actually said. This is "Reality over ritual" applied to the retro itself.
- **vs. Parabol (the closest OSS peer):** Parabol is a great facilitation tool but has **no delivery metrics** in-retro and must sync actions *out* to a separate backlog. In yapm the actions *are* native issues and the metrics *are* native queries — no integration, no identity-mapping, no second vendor. yapm also both open-source *and* the underlying tracker (Parabol is only the meeting).
- **vs. SprintRetro / Teaminal (metrics-in-retro add-ons):** they re-import data yapm never externalized. yapm's panel is a **live Zero query over first-class entities**, so it's real-time, free, and works self-hosted with no ETL. Their metrics are only as good as the join; yapm's join is the data model.
- **vs. Swarmia / LinearB (metrics platforms):** those are read-only dashboards priced at $20–60/dev/month whose product is the ETL yapm makes disappear (VISION §"one work graph"). yapm puts the *same* signals *inside a blameless team retro*, team-level-only by principle, free and unlimited, on your own server. Swarmia's carryover categories are literally reproducible from yapm's cycle auto-rollover.

### One-line positioning
> **Every other retro tool asks the team what happened. yapm already knows — because the issues, PRs, CI runs, deploys, and incidents are one graph — and hands the retro a live, blameless, team-level "what actually shipped this cycle" panel, free, self-hosted, with the action items landing straight back in the tracker.**

---

## 8. Concrete recommendations for the yapm Phase-2 retro feature

1. **Attach a Retro to a completed cycle**, auto-opened on cycle completion (reuse the auto-rollover trigger). The retro's data panel is the cycle's real graph state.
2. **Ship the "Delivered" panel first** (completed/carryover/carryover-2+/removed/scope-change) — it's populatable *today* from cycles alone, no connectors needed, and it's the single most retro-relevant view (mirrors Swarmia's purpose-built categories). Source: [Swarmia — Sprints](https://help.swarmia.com/metrics-and-definitions/sprints).
3. **Light up Flow + Health panels as connectors land** (#8): PR cycle time, time-to-first-review, review cycles, PR size, CI/flaky counts — each blameless, trend-first, bot/draft-excluded.
4. **Enforce the guardrails in the schema/UI**, not just docs: no per-individual table exists; panels are team aggregates; trends over absolutes; speed+stability paired; ≥3 signals/≥3 dimensions default; pin/unpin + staleness nudge.
5. **Make action items native issues** with an optional "targets metric X" tag; next cycle's panel shows the delta automatically (closed loop, zero re-collection).
6. **Evidence-anchored reflection:** let stickies link to a widget/issue/PR — the join no whiteboard tool can make.
7. **Optional BYO-key AI** (#9) drafts the blameless narrative + discussion prompts over the graph, self-hosted, same permission model as humans.
8. **Copy discipline:** every caption narrates the system, never a person; ship the "why this is team-level only" explanation in the UI as a trust signal (verifiable in AGPL source).

---

## 9. Source list (all URLs cited above)

Data-driven / data-informed retros (thought leadership):
- https://activitytimeline.com/blog/sprint-retrospective
- https://blog.umano.tech/2020/11/11/data-driven-sprint-retrospectives
- https://age-of-product.com/data-informed-retrospectives/
- https://codeclimate.com/blog/plan-retrospectives-with-data
- https://agileseekers.com/blog/how-to-facilitata-powerful-retrospectives-with-data-actionable-outcomes

Derby/Larsen five-stage framework:
- https://ucsb-cs48.github.io/topics/retros_darby_larsen/
- https://www.growingscrummasters.com/keywords/five-stage-retrospective-framework/
- https://agile.appliedframeworks.com/applied-frameworks-agile-blog/agile-retrospective-framework-in-five-steps

DORA & SPACE:
- https://dora.dev/guides/dora-metrics/
- https://getdx.com/blog/dora-metrics/
- https://getdx.com/blog/space-metrics/
- https://www.multitudes.com/blog/dora-developer-productivity
- https://www.swarmia.com/blog/space-framework/
- https://www.red-gate.com/blog/database-devops/what-is-the-space-developer-productivity-framework/
- https://gitmore.io/blog/developer-productivity-metrics

PR cycle time / code-review health / CI / flaky:
- https://www.gitkraken.com/blog/healthy-pr-lifecycle-time-benchmarks-targets-2026
- https://getdx.com/blog/cycle-time/
- https://www.metabase.com/dashboards/code-review-health/
- https://plandek.com/blog/what-is-cycle-time-and-how-to-reduce-it
- https://sourcegraph.com/blog/cycle-time-in-software-development-a-complete-guide
- https://www.abloomify.com/blog/reduce-code-review-cycle-time
- https://autonomyai.io/technology/ci-cd-optimization-how-to-shorten-pr-cycle-time-and-ship-faster/
- https://mstone.ai/glossary/pr-cycle-time/

Surveillance / Goodhart's Law:
- https://www.keypup.io/blog/goodharts-law-in-action-why-your-dev-metrics-are-being-gamed-and-how-to-fix-it/
- https://axify.io/blog/goodhart-law
- https://codepulsehq.com/guides/goodharts-law-engineering-metrics
- https://www.practical-devsecops.com/glossary/goodharts-law/

Retro tools & metrics-in-retro / competitor landscape:
- https://www.parabol.co/integrations/github/
- https://www.parabol.co/integrations/jira/
- https://www.parabol.co/comparison/retrium-alternative/
- https://github.com/parabolinc/parabol
- https://www.teamretro.com/compare/metro-retro-alternative/
- https://echometerapp.com/en/retrospective-tools-online/
- https://www.teaminal.com/blog/free-retrospective-tools/
- https://sprintretro.co/
- https://help.swarmia.com/metrics-and-definitions/sprints
- https://www.swarmia.com/product/sprints/
- https://linearb.io/compare/swarmia-vs-linearb

---

## 10. UNVERIFIED / caveats
- **PR-size benchmark "< ~98 code changes"** and **"median PR lifecycle < 24h / 50% same-day / 90% within 48h"** come from vendor blogs (GitKraken/AutonomyAI), not peer-reviewed data — treat as directional, not authoritative. UNVERIFIED as universal benchmarks.
- **Vercel "43% cycle-time reduction (4.6h → 2h)"** is cited in a vendor blog (AutonomyAI); the underlying primary source was not independently verified here. UNVERIFIED.
- **Swarmia sprint feature being "Jira-Cloud-only and in beta, no Linear Cycles yet"** is from Swarmia's own docs as of the search date (2026-07); may have changed since. Verify before using competitively.
- **SprintRetro's exact metric set (velocity/predictability/scope/carryover/cycle time on Forge)** is per its marketing site and a third-party comparison; not independently confirmed.
- **Parabol "does not pull delivery metrics into the retro"** reflects sources as of search date; Parabol is actively developed (open-source) and could add this — re-check before publishing a competitive claim.
- The **LinearB customer quote** and LinearB-vs-Swarmia characterizations are LinearB's own marketing; treat as promotional.
- **yapm-side capabilities** (cycles auto-rollover, triage, Zero sync, connectors #8, AI #9) are taken from yapm's own VISION.md/ROADMAP.md/DESIGN.md; connectors, DORA views, incidents, and AI are **planned, not yet shipped** per the roadmap — the panel provenance table reflects intended phases, not current state.
- I did **not** independently verify the contents of the Derby/Larsen book beyond secondary summaries; the five-stage names and intent are well-corroborated across multiple sources but quotations are paraphrased by those sources.
