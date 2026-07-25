# Retrospective Tools — Competitive Analysis (2026)

**For:** yapm (open-source PM + delivery-truth work graph)
**Scope:** Dedicated retro tools + how PM incumbents handle retros. Focus on the three yapm-relevant questions: (a) does anything pull real delivery/sprint DATA into the retro, (b) is anything genuinely open-source + self-hostable, (c) who writes action items back into the tracker as issues.
**Date compiled:** 2026-07-25. Prices are list prices at time of writing; verify before quoting externally.

---

## TL;DR for yapm

1. **They are almost all blank whiteboards.** The overwhelming majority (EasyRetro, Retrium, TeamRetro, Metro Retro, Neatro, Reetro, Postfacto, Miro/Mural, and the retro UIs inside Jira/Azure DevOps) start from an empty board of sticky notes. The team *manually types* "what went well / what didn't." None of them auto-populate the retro with "here's what actually shipped this cycle, here's your velocity/DORA delta, here are the incidents that fired." **This is the exact gap yapm's work-graph thesis attacks.**
2. **Partial exceptions exist but are shallow.** GoRetro bolts a Jira-fed "sprint monitor" (velocity/burndown) next to the retro; ScatterSpoke fuses retro feedback with its own AI-derived issue/sentiment trend metrics; Jira/Confluence can *embed* a live sprint report via Smart Links. But none of these is "the retro board is pre-seeded from the delivery graph (PRs merged, deploys, CI health, incidents)." They are dashboards parked next to a whiteboard, not data driving the retro.
3. **Genuinely open-source + self-hostable = essentially only Parabol** (AGPL-3.0, actively maintained, air-gap capable). Postfacto (AGPL, ex-Pivotal) is open-source and self-hostable but **effectively abandoned** (last commit ~2022). Azure DevOps' Retrospectives extension is open-source (MIT) but only runs *inside* Azure DevOps.
4. **Writing action items back into the tracker as issues is a solved, common feature** among the paid tools (Parabol, TeamRetro, Retrium, Neatro, EasyRetro, GoRetro all push to Jira; Parabol/TeamRetro also to GitHub/Azure/Linear/GitLab). yapm cannot differentiate here — it must simply match it, natively and better (action item = first-class issue in the same graph, no round-trip integration).
5. **Pricing has bifurcated into per-seat vs. per-team.** The pain yapm names in VISION.md (seat tax on occasional participants) is real: Parabol ($8/active user), Miro ($8/user), Mural ($9.99/user), Retrium (per-user options) charge per head; the "friendlier" camp (TeamRetro, Neatro, EasyRetro, GoRetro, Kollabe, Reetro) has moved to **flat per-team pricing with unlimited members** precisely because per-seat retro pricing is resented. Several tools (GoRetro, Metro Retro) **killed their free plans** in 2024–2025, creating churn/opportunity.

---

## Dedicated retro tools

### Parabol — the one real open-source competitor
- **Core:** Structured reflect → group → vote → discuss → action retro; 40+ templates (Start/Stop/Continue, 4Ls, Mad/Sad/Glad, custom). Also Sprint Poker (with backlog import + write-back), async standups, check-ins, lightweight team-health emoji poll. AI grouping, AI summaries, AI discussion prompts, cross-meeting "Insights" theme extraction. Anonymous reflections.
- **Pricing:** Starter **Free forever** — 2 teams, 10 meetings/month, 30-day history, 3 retro summaries. Team **$8/active user/month** (unlimited meetings/history/summaries). Enterprise = contact sales (SAML SSO, SCIM, SLA, on-prem). Source: https://www.parabol.co/pricing/
- **Open-source / self-hostable:** **YES — AGPL-3.0, fully auditable, self-host + on-prem, works air-gapped with no external deps.** Repo: https://github.com/ParabolInc/parabol . Actively maintained (multiple releases/week; v13.27.0 landed 30 June 2026 per https://www.retrospectivetools.com/tool/parabol/ ). This is the single most credible OSS/self-host retro option in the market.
- **Integrations:** Jira, Linear, Azure DevOps, GitHub, GitLab, Slack, Microsoft Teams. Backlog **write-back** — action items sync as issues into Jira/GitHub/GitLab/Azure/Linear. Google Calendar for scheduling. (No Confluence/Trello.)
- **Data into retro?** No. It writes *out* to trackers well, but does not pull delivery metrics *into* the retro board. Team-health is a single emoji poll, not delivery data.
- **Strengths:** Only mature AGPL/self-host option; best-in-class backlog write-back; engineer-flavored (public roadmap, AGPL, no sales theater); credible logos (Netflix, GitHub, Stanford).
- **Weaknesses:** Free tier capped (10 meetings/mo, 30-day history); no native whiteboard/presentation/screen-share mode; SSO/SCIM/SLA/on-prem support gated to Enterprise (the code is open, but the *supported* enterprise controls are paid). Per-active-user pricing on the Team tier.

### EasyRetro (formerly FunRetro)
- **Core:** Simple, "fun" sticky-note retro boards; templates; voting; action items; export. One of the older, most widely-known brands.
- **Pricing (per team, unlimited members):** Free $0; **Team ~$21/mo (billed annually)**; Business $50/mo; Large Business $75/mo. Source: https://easyretro.io/pricing (older refs cite $25/team monthly). Free plan is usable but limited.
- **Open-source / self-hostable:** **No.** Proprietary SaaS. (UNVERIFIED any self-host offering — none advertised.)
- **Integrations:** Slack, Jira, Trello, Confluence. Publishes/exports action items to Jira. Sources: https://easyretro.io/integrations/jira/ , https://easyretro.io/integrations/slack/
- **Data into retro?** No — blank whiteboard.
- **Strengths:** Cheap, simple, well-known, per-team pricing. **Weaknesses:** Feature-light vs. newer AI tools; no health checks/analytics depth; closed-source.

### Retrium
- **Core:** Facilitation-heavy retro tool (Radar/health checks, team agreements, "Techniques" library, structured phases). Aimed at coaches/agile-mature orgs.
- **Pricing:** Sold **per "Team Room"** (a room = one team). Listed ~**$39 per Team Room/month** on retrium.com/pricing; Capterra lists per-user options starting ~$12/user/mo (annual ~$7.91/user); third-party refs cite ~$29/mo up to 5 users, ~$129/mo larger teams. Pricing model has both per-room and per-user framings — **verify current before quoting.** Sources: https://www.retrium.com/pricing , https://www.capterra.com/p/149376/Retrium/
- **Open-source / self-hostable:** **No.** Proprietary SaaS.
- **Integrations:** Jira Cloud (action-item execution). Slack. Source: https://www.retrium.com/integrations/jira
- **Data into retro?** No — blank whiteboard + health radars.
- **Strengths:** Strong facilitation/coaching pedigree, team health/radar over time. **Weaknesses:** Pricier, enterprise-leaning; closed-source; confusing per-room vs per-user pricing.

### TeamRetro
- **Core:** Retrospectives + team health checks + agile estimation (poker). Guided facilitation, 40+ templates, AI grouping/summaries, action tracking with due dates/assignees.
- **Pricing (per team, unlimited members):** Single Team **~$20.83/mo billed annually** (~$25 monthly); drops to **~$15/team/mo at 6+ teams**. Source: https://www.teamretro.com/plans/
- **Open-source / self-hostable:** **No.** Proprietary SaaS. SOC 2 Type 2 + GDPR on every plan.
- **Integrations:** Jira, GitHub, Slack, Microsoft Teams, Monday, Azure DevOps, Confluence. **Publishes action items as Jira issues** (and to Monday/GitHub) with due date/priority/assignment. Sources: https://www.teamretro.com/integrations/ , https://help.teamretro.com/article/213-integration-jira
- **Data into retro?** No — blank board; can push estimates/actions out but doesn't pull delivery data in.
- **Strengths:** Broadest tracker write-back among closed tools; predictable per-team price; enterprise compliance. **Weaknesses:** Closed-source; no self-host.

### GoRetro
- **Core:** Sprint-centric retro + planning poker + capacity calculator + "data-driven sprint"/sprint-monitor. Fun boards, sentiment, AI. Positions itself as data-driven.
- **Pricing:** **Removed its free plan** (2024–2025). Premium **~$29/team/month (billed annually)**; Sprint Pro **~$49/mo** (planning poker gated here); 30-day trial. Sources: https://www.scrumjam.app/blog/goretro-alternatives , https://sprintpulse.io/compare/goretro-alternative , https://www.retrotools.io/tools/goretro
- **Open-source / self-hostable:** **No.** Proprietary SaaS.
- **Integrations:** Jira (imports sprint data). Slack/MS Teams (UNVERIFIED full list).
- **Data into retro? PARTIAL — this is the closest of the dedicated fun-retro tools.** GoRetro's "sprint monitor"/data-driven sprint pulls **Jira sprint data (velocity, burndown, story points)** and shows it alongside the retro so the team reflects against real numbers. Sources: homepage https://www.goretro.ai/ ("data-driven and engaging retrospective meetings, sprint planning events, and sprint monitoring tools"), nav includes a "Data driven sprint" section. It is Jira-sprint-metrics-only, not DORA/git/CI/incidents, and the metrics sit *beside* the board rather than seeding it.
- **Strengths:** Only mainstream fun-retro tool that surfaces sprint velocity data in-context; poker + capacity in one. **Weaknesses:** Killed free tier (churn risk for users, opportunity for yapm); poker paywalled to $49 tier; closed-source; Jira-only data.

### Metro Retro
- **Core:** Playful infinite-canvas whiteboard retro (drawing, stamps, animations, timers). Whiteboard-first, "fun" positioning.
- **Pricing:** **Removed its free plan in September 2024.** Now 30-day free trial, then paid only. Sources: https://retrotools.io/tools/metro-retro , https://www.teamretro.com/compare/metro-retro-alternative/
- **Open-source / self-hostable:** **No.** Proprietary SaaS.
- **Integrations:** UNVERIFIED — limited; primarily a standalone whiteboard (no strong tracker write-back advertised).
- **Data into retro?** No — pure blank whiteboard.
- **Strengths:** Best "fun/engagement" feel. **Weaknesses:** No free tier anymore; thin integrations; closed-source.

### Neatro
- **Core:** Guided/scheduled retros, curated templates, "Ice-Breaker," anonymity, action-item follow-up, AI. Clean UX, per-team model.
- **Pricing (per team, unlimited members):** **Free** forever (small teams, limited); **Premium ~$23.20/team/month** (annual; ~$29 monthly); Pro adds SSO/advanced security. Source: https://www.neatro.io/pricing/
- **Open-source / self-hostable:** **No.** Proprietary SaaS.
- **Integrations:** **Jira Cloud** — direct sync of action items as Jira issues. Source: https://www.neatro.io/ . (Reports of limited integrations/exports on lower tiers per https://www.teamretro.com/compare/neatro-alternative/ )
- **Data into retro?** No — blank board.
- **Strengths:** Polished, flat per-team price, Jira action sync. **Weaknesses:** Narrow integration set; closed-source.

### Reetro (reetro.io)
- **Core:** Simple, "100% free" retro boards, voting, action items. Lightweight.
- **Pricing:** Advertises free; a single paid plan **~€27/month** adds security/export/support (pricing not fully public — shown in-product). Sources: https://reetro.io/ , https://www.neatro.io/blog/free-retrospective-tools/
- **Open-source / self-hostable:** **No.** Proprietary SaaS.
- **Integrations:** Minimal (UNVERIFIED specifics; not a strong integration story).
- **Data into retro?** No — blank board.
- **Strengths:** Genuinely usable free tier, dead simple. **Weaknesses:** Thin features/integrations; opaque pricing; closed-source.

### Postfacto (Pivotal Labs → Shopify) — open-source but abandoned
- **Core:** Self-hosted remote retro (happy/meh/sad columns, live updates across devices, voting, action-item tracking, public/private boards, Google OAuth). Originally built by Pivotal Labs.
- **Pricing:** **Free** (self-host your own instance; you pay for hosting).
- **Open-source / self-hostable:** **YES — AGPL-3.0, self-hosted.** Repo: https://github.com/Shopify/postfacto (a fork; originally pivotal/postfacto). Deploys to Tanzu Kubernetes Grid, Tanzu Application Service, Cloud Foundry, Heroku.
- **Maintenance status: EFFECTIVELY UNMAINTAINED.** The Shopify repo's latest commit is dated **~March 2022 (~4 years ago)**; only 6 stars / 6 forks; no recent releases. Deployment targets (Cloud Foundry, Tanzu, Heroku's old free tier) are dated. Verified via https://github.com/Shopify/postfacto (commit history shows "4 years ago"). Treat as a dead project — a cautionary precedent, not a live competitor.
- **Integrations:** None with trackers. **Data into retro?** No.
- **Relevance to yapm:** Proves the appetite for a free self-hosted retro existed, and that a neglected AGPL tool decays. yapm's advantage is bundling retro into a *maintained* product with the delivery graph already present.

### ScatterSpoke — the "retro + metrics" outlier (closest philosophically to yapm)
- **Core:** Retrospectives (20+ formats, AI facilitator, guided facilitation) **explicitly fused with metrics**: issue extraction, wins extraction, sentiment analysis over time, issue trends over time, team impact dashboard, feedback metrics & insights, cross-team summaries, standups, team goals. Pitch: "turn feedback into actionable data," combine retro feedback *with* metrics.
- **Pricing:** Free $0 (10 users, 1 team, 90-day view); **Starter $50/mo** (100 users, 5 teams); **Business $500/mo** (unlimited); Enterprise custom (bi-directional integrations, SAML/OIDC/SCIM). Steep $0→$50→$500 jumps. Source: https://www.scatterspoke.com/pricing/
- **Open-source / self-hostable:** **No.** Proprietary SaaS.
- **Integrations:** Slack/Teams on lower tiers; **bi-directional integrations reserved for Enterprise.** (UNVERIFIED exact connector list.)
- **Data into retro? PARTIAL/CLOSEST.** ScatterSpoke's whole thesis is retro + metrics together — but the "metrics" are largely **AI-derived from the feedback itself** (sentiment/issue/theme trends) plus optional metric inputs, not automatically-ingested git/CI/deploy/DORA/incident data. It is the dedicated tool whose *positioning* is nearest to yapm's, which makes it the most direct conceptual competitor to watch — but it does not natively own the delivery graph the way yapm intends to.
- **Strengths:** Only dedicated retro tool built around "feedback → data"; longitudinal trend dashboards. **Weaknesses:** Harsh pricing cliffs; SSO/SCIM enterprise-only; closed-source; metrics are feedback-derived, not delivery-truth.

> Other small players seen in the market (not requested but noted for completeness): Kollabe (~$29/mo flat, unlimited users — aggressive anti-per-seat pricing), Team O'clock (Jira/Asana/Linear/Slack, ~$3/user or $27/team), TeleRetro, RetroTeam, SprintPulse (free 1 team / $20/team), Echometer (health-check heavy), IdeaBoardz (free, bare-bones). None are open-source/self-hostable; none pull delivery data in.

---

## How the PM incumbents handle retros

### Linear
- **Native retro? NO.** Linear has **no dedicated retrospective feature** as of 2026 (verified against product/marketing — no retro surface; teams run retros in external tools like Parabol, Miro, or a Linear doc/project). UNVERIFIED that any first-party retro exists. This is a notable gap given Linear's cycle-based workflow — a retro that reads a cycle's completed issues would be natural, and its absence supports yapm's "reporting/ceremonies Linear doesn't have" positioning (VISION.md).
- Workaround: teams use Linear Docs/Projects or pipe cycle data into an external retro tool manually.

### Jira / Atlassian
- **Native (new): YES, recently.** Atlassian added **Sprint Retrospectives natively** — on finishing a sprint in **Company-Managed** software projects, users can create a Sprint Retrospective as a **Confluence whiteboard or page**. Source: https://community.atlassian.com/forums/Jira-articles/Sprint-Retrospectives-now-available-in-Company-Managed-Projects/ba-p/2752635
- **Confluence Whiteboards for retros:** collaborative sticky-note retros with **live, embedded Jira reports via Smart Links** (you can embed a sprint burndown/report onto the retro page/whiteboard). Sources: https://www.atlassian.com/software/confluence/resources/guides/how-to/whiteboard-retros , https://www.atlassian.com/blog/confluence/effective-sprint-retros-with-confluence-and-jira
- **Marketplace plugins:** Easy Agile TeamRhythm (adds a Retrospective page per Jira board, in-context), "Sprint Retrospectives for Jira," plus TeamRetro/Parabol as marketplace apps. Sources: https://help.easyagile.com/easy-agile-teamrhythm/retrospectives-for-your-jira-board , https://marketplace.atlassian.com/apps/1235003/sprint-retrospectives-for-jira
- **Data into retro? PARTIAL** — the Confluence embed of a live sprint report is the closest any incumbent gets to "delivery data next to the retro," but it's a manually-embedded chart, not an auto-seeded board, and it's Jira sprint data (not DORA/CI/incidents; Atlassian's DORA story requires separate integration work per https://getdx.com/blog/dora-metrics-jira/ — Atlassian bought DX for $1B rather than build it, per yapm VISION.md).
- **Action items back to issues? Yes** — being in Jira/Confluence, retro action items convert to Jira issues trivially.

### Azure DevOps — Retrospectives extension (notable: free + open-source)
- **Native-ish: YES via a free first-party extension.** The **Retrospectives** extension (publisher ms-devlabs) runs inside Azure DevOps: collect feedback, group/prioritize/vote, and **create Azure DevOps work items directly from feedback**, emailable summaries. **Free.** Sources: https://marketplace.visualstudio.com/items?itemName=ms-devlabs.team-retrospectives , https://devblogs.microsoft.com/devops/retrospectives-the-hidden-gem-enabling-teams-to-thrive-part-1/
- **Open-source: YES.** Source on GitHub: https://github.com/microsoft/vsts-extension-retrospectives (open-source, MIT-style). But it only runs *inside* Azure DevOps — not a standalone self-hostable retro app.
- **Data into retro?** No auto-seeding of delivery data, but action items become native work items (same graph). This is the incumbent whose model is **closest to yapm's "action item = issue in the same system"** ideal — worth studying its UX.

### GitLab
- **Native retro? NO dedicated feature.** GitLab runs retros using **plain issues + issue templates** (its handbook documents team retrospective *issues*; a tutorial covers "stand-ups, retrospectives, and velocity" using issues/boards). Sources: https://about.gitlab.com/blog/how-gitlab-handles-retrospectives/ , https://docs.gitlab.com/tutorials/scrum_events/standups_retrospectives_velocity/ , https://handbook.gitlab.com/.../retrospectives/
- **Data into retro?** No dedicated retro surface. GitLab *does* have Value Streams Dashboard / DORA metrics natively (per https://codepulsehq.com/guides/dora-metrics-tools-comparison ), but these are separate dashboards, not wired into a retro ceremony.
- **Relevance:** GitLab is the only incumbent with native DORA + the full SDLC, but you must move everything into GitLab (yapm's VISION.md positioning). It notably has **not** built a real retro UI on top of that data — leaving the exact "data-seeded retro" idea unbuilt even by the one vendor best positioned to do it.

### Generic whiteboards — Miro / Mural
- **Core:** Infinite-canvas whiteboards with large libraries of **retro templates** (sticky notes, voting, timers). The default "blank whiteboard" retro for many teams.
- **Pricing (PER SEAT):** Miro — Free (3 boards), paid from **$8/user/mo** (annual; ~$10 monthly). Mural — Free (3 boards), paid from **$9.99/user/mo**. Sources: https://miro.com/templates/retrospective/ , https://www.retrospectivetools.com/compare/miro-vs-mural/ , https://mockflow.com/blog/miro-vs-mural
- **Open-source / self-hostable:** **No.**
- **Integrations:** Miro 250+ (Slack, Jira, Zoom, Teams, Notion); Mural core (Slack, Jira, Zoom, Trello, Teams). Jira integration allows creating/linking Jira cards from sticky notes.
- **Data into retro?** No — the definitional blank whiteboard. **Weaknesses for our purposes:** per-seat pricing (the exact tax yapm opposes), fully manual, no delivery data.

---

## Feature / pricing comparison table

| Tool | Open-source? | Self-host? | Pricing model | Entry price (paid) | Free tier | Tracker integrations | Action items → tracker issues | Pulls delivery/sprint DATA into retro? |
|---|---|---|---|---|---|---|---|---|
| **Parabol** | **Yes (AGPL-3.0)** | **Yes** (on-prem, air-gap) | Per active user | $8/active user/mo | Yes (2 teams, 10 mtgs/mo) | Jira, GitHub, GitLab, Azure, Linear, Slack, Teams | **Yes** (Jira/GH/GL/Azure/Linear) | No |
| **EasyRetro** | No | No | Per team | ~$21/team/mo (annual) | Yes | Jira, Trello, Confluence, Slack | Yes (Jira) | No |
| **Retrium** | No | No | Per team-room / per-user | ~$39/room/mo (or ~$12/user) | Trial | Jira Cloud, Slack | Yes (Jira) | No |
| **TeamRetro** | No | No | Per team | ~$20.83/team/mo (annual) | Trial | Jira, GitHub, Azure, Monday, Confluence, Slack, Teams | **Yes** (Jira/Monday/GitHub) | No |
| **GoRetro** | No | No | Per team | ~$29/team/mo; poker $49 | **No (removed 2024–25)** | Jira | Yes (Jira) | **Partial** — Jira sprint velocity/burndown monitor beside board |
| **Metro Retro** | No | No | Per user (est.) | Paid-only after trial | **No (removed Sep 2024)** | Limited/UNVERIFIED | UNVERIFIED | No (pure whiteboard) |
| **Neatro** | No | No | Per team | ~$23.20/team/mo (annual) | Yes | Jira Cloud | Yes (Jira) | No |
| **Reetro** | No | No | Single flat plan | ~€27/mo | Yes | Minimal/UNVERIFIED | UNVERIFIED | No |
| **Postfacto** | **Yes (AGPL-3.0)** | **Yes** | Free (self-host) | $0 | n/a | None | No (local only) | No — **UNMAINTAINED (~2022)** |
| **ScatterSpoke** | No | No | Per plan (tiered) | $50/mo (Starter) | Yes (10 users) | Slack/Teams; bi-dir @ Enterprise | Yes (Enterprise) | **Partial** — retro + AI-derived issue/sentiment trend metrics |
| **Linear** (incumbent) | No | No | — | — | — | native tracker | n/a | **No native retro at all** |
| **Jira/Confluence** (incumbent) | No | Server EOL / DC self-host | Per user | Jira Std ~$8+/user | Yes (10 users) | native | **Yes** (native) | **Partial** — embed live Jira sprint report on retro whiteboard |
| **Azure DevOps Retrospectives** | **Yes (MIT, in-platform)** | Only inside Azure DevOps | Free extension | $0 | Yes | native (work items) | **Yes** (native work items) | No (auto), but native work items |
| **GitLab** (incumbent) | Yes (core is OSS) | Yes | Per user | Free/Premium | Yes | native | Yes (issues) | **No dedicated retro** (uses issues; DORA is a separate dashboard) |
| **Miro** (whiteboard) | No | No | **Per user** | $8/user/mo | Yes (3 boards) | Jira, Slack, Teams, Notion (250+) | Yes (Jira cards) | No (blank whiteboard) |
| **Mural** (whiteboard) | No | No | **Per user** | $9.99/user/mo | Yes (3 boards) | Jira, Slack, Zoom, Trello, Teams | Yes (Jira) | No (blank whiteboard) |

---

## The three sharp answers

### (a) Does ANY tool pull real delivery/sprint DATA into the retro (auto-populate what shipped, velocity, DORA, incidents)?
**Essentially no — they are blank whiteboards.** Nothing in the market auto-seeds a retro from the delivery graph (PRs merged, deploys, CI health, DORA deltas, incidents fired this cycle). The three partial exceptions are shallow:
- **GoRetro** — parks a **Jira-fed sprint monitor (velocity/burndown/story points)** next to the retro. Jira-sprint-metrics only; no DORA/CI/deploy/incident; sits beside the board, doesn't seed it.
- **ScatterSpoke** — fuses retro with **AI-derived issue/sentiment/theme trend metrics** (mostly computed from the feedback itself, plus optional metric inputs). Closest *philosophy* to yapm, but not delivery-truth from git/CI.
- **Jira + Confluence** — you can **manually embed a live sprint report** via Smart Links onto a retro whiteboard. A chart on a page, not a data-driven board; Jira sprint data only.
**→ yapm's opening is wide open.** A retro that opens pre-populated with "this cycle you merged N PRs, shipped X deploys, DORA moved from Elite→High, 2 incidents fired, review turnaround +30%" — sourced automatically from the native work graph — is something **no dedicated retro tool and no PM incumbent (including GitLab, which has the data) currently does.** This is the single strongest wedge for a yapm retro feature.

### (b) Are any genuinely open-source + self-hostable?
**Three, with heavy caveats:**
- **Parabol** — **the only credible one.** AGPL-3.0, actively maintained, on-prem, air-gap capable. But its *supported* enterprise controls (SSO/SCIM/SLA) are commercially gated, and free-tier caps push teams to paid.
- **Postfacto** — AGPL-3.0, self-hostable, but **effectively abandoned (~2022)** with dated deploy targets (Cloud Foundry/Tanzu/Heroku). Do not treat as live.
- **Azure DevOps Retrospectives extension** — open-source (MIT) but only runs **inside Azure DevOps**; not a standalone self-hostable app.
GitLab's core is OSS/self-hostable but has **no real retro feature** (it uses issues). 
**→ For a self-hosting eng team that wants a maintained, free, self-hosted retro tightly coupled to their own tracker + delivery data, the market offering is essentially just Parabol (generic) — and nobody couples it to a native work graph.** yapm can be the first "retro included, free, self-hosted, seeded by your own delivery truth."

### (c) Which integrate action items back into the tracker as issues?
**Common and well-solved — table stakes, not a differentiator:**
- **Parabol** → Jira, GitHub, GitLab, Azure DevOps, Linear (best coverage).
- **TeamRetro** → Jira, Monday, GitHub (with due date/priority/assignee).
- **Retrium** → Jira Cloud. **Neatro** → Jira Cloud. **EasyRetro** → Jira. **GoRetro** → Jira.
- **Azure DevOps extension** & **Jira/Confluence native** → create native work items/issues directly (no round-trip).
- **Miro/Mural** → create Jira cards from sticky notes.
**→ yapm must match this, but its structural advantage is that a retro action item is simply **a new issue in the same graph** — no cross-tool sync, no identity mapping, instantly linked to the cycle/PR/incident it came from.** Where competitors *integrate out* to a tracker, yapm's retro *is already in* the tracker.

---

## Strategic notes for yapm (VISION.md alignment)

- **The wedge is validated.** yapm's "reality over ritual" and "one work graph" principles map perfectly onto the biggest unmet need here: retros are blank whiteboards divorced from delivery truth. Even GitLab (native DORA) and Atlassian (bought DX for $1B) have **not** built a delivery-data-seeded retro. Being first is realistic.
- **Don't rebuild a whiteboard; seed a board.** The market is saturated with sticky-note UX (Miro/Mural/Metro Retro do "fun" better than a PM tool should try to). yapm's retro should be *lightweight* (reflect/group/vote/action, à la Parabol/Postfacto) but **auto-populated** from the cycle's graph — that's the whole point.
- **Pricing tailwind.** GoRetro and Metro Retro killed free tiers (2024–2025); Miro/Mural/Parabol charge per seat. yapm's "free, unlimited, self-hosted, no seat tax" stance is a live differentiator for exactly the r/selfhosted/HN audience it targets — and bundling retro at $0 undercuts $20–50/team/mo point tools.
- **Closest competitor to watch: ScatterSpoke** (retro + metrics thesis) and **Parabol** (OSS + write-back). Neither self-hosts a *delivery-truth-seeded* retro; that's the whitespace.
- **Action-item write-back is table stakes** — ship it, but frame it as "action items are native issues in the same graph," not "we integrate with your tracker."

---

## Source URLs (primary)
- Parabol: https://www.parabol.co/pricing/ , https://github.com/ParabolInc/parabol , https://www.retrospectivetools.com/tool/parabol/
- EasyRetro: https://easyretro.io/pricing , https://easyretro.io/integrations/jira/
- Retrium: https://www.retrium.com/pricing , https://www.retrium.com/integrations/jira , https://www.capterra.com/p/149376/Retrium/
- TeamRetro: https://www.teamretro.com/plans/ , https://www.teamretro.com/integrations/ , https://help.teamretro.com/article/213-integration-jira
- GoRetro: https://www.goretro.ai/ , https://www.scrumjam.app/blog/goretro-alternatives , https://www.retrotools.io/tools/goretro , https://sprintpulse.io/compare/goretro-alternative
- Metro Retro: https://retrotools.io/tools/metro-retro , https://www.teamretro.com/compare/metro-retro-alternative/
- Neatro: https://www.neatro.io/pricing/ , https://www.neatro.io/
- Reetro: https://reetro.io/ , https://www.neatro.io/blog/free-retrospective-tools/
- Postfacto: https://github.com/Shopify/postfacto (commit history ~2022)
- ScatterSpoke: https://www.scatterspoke.com/pricing/ , https://www.scatterspoke.com/
- Jira/Confluence: https://community.atlassian.com/forums/Jira-articles/Sprint-Retrospectives-now-available-in-Company-Managed-Projects/ba-p/2752635 , https://www.atlassian.com/blog/confluence/effective-sprint-retros-with-confluence-and-jira , https://help.easyagile.com/easy-agile-teamrhythm/retrospectives-for-your-jira-board
- Azure DevOps: https://marketplace.visualstudio.com/items?itemName=ms-devlabs.team-retrospectives , https://github.com/microsoft/vsts-extension-retrospectives , https://devblogs.microsoft.com/devops/retrospectives-the-hidden-gem-enabling-teams-to-thrive-part-1/
- GitLab: https://about.gitlab.com/blog/how-gitlab-handles-retrospectives/ , https://docs.gitlab.com/tutorials/scrum_events/standups_retrospectives_velocity/
- Miro/Mural: https://miro.com/templates/retrospective/ , https://www.retrospectivetools.com/compare/miro-vs-mural/ , https://mockflow.com/blog/miro-vs-mural
- Jira DORA context: https://getdx.com/blog/dora-metrics-jira/ , DORA tools: https://codepulsehq.com/guides/dora-metrics-tools-comparison

## UNVERIFIED / verify-before-quoting
- Retrium's exact current pricing model (per-team-room vs per-user; the $39/room vs $12/user figures come from different sources/dates).
- Metro Retro integration list and current price point (paid-only post-Sep-2024; exact $ not confirmed).
- Reetro's exact paid price/integration list (pricing shown in-product, not fully public).
- GoRetro's full non-Jira integration list and whether "sprint monitor" ingests anything beyond Jira sprint metrics.
- ScatterSpoke's exact connector list per tier and whether any metric ingestion is git/CI/deploy (vs. feedback-derived).
- Linear: confirmed **no native retro**, but a future/beta first-party retro is UNVERIFIED (none found as of compile date).
- Whether Parabol's self-hosted build enforces any feature gating vs. cloud (docs imply full features are in the AGPL source; enterprise *support*/controls are the paid part).
