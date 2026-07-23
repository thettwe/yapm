# yapm — Product Vision

**Yet Another Project Management.** The name is tongue-in-cheek. The frustration behind it is not.

## Vision statement

yapm is the open-source tool where project management and engineering quality live in one work graph — issues, PRs, CI runs, deploys, and incidents connected natively — so a team can see both *what* they're building and *how well* they're delivering it, free and unlimited on their own server, forever.

## The problem

Three failures define the current market:

1. **PM tools track intentions, not reality.** Issue status is hand-updated theater, disconnected from what git, CI, and production actually say. Teams that want the truth pay a second vendor ($20–60/dev/month — LinearB, Swarmia, Jellyfish) whose entire product is re-joining data the PM tool threw away. Atlassian just paid $1B for DX to buy this capability rather than build it.

2. **"Open source" PM tools betray the label.** The category leader caps self-hosted workspaces at 12 seats and paywalls SSO, dashboards, and time tracking on your own hardware. The genuinely-free alternatives are either ops-heavy multi-container stacks or dated and clunky. Nobody offers Linear-grade speed and polish in open source.

3. **Seat-based pricing punishes collaboration.** The canonical complaint: 40 of 60 registered users spend twenty minutes a month in the tool at full price. Stakeholders, viewers, and occasional contributors are a tax, so teams keep work out of the tool — which defeats the tool.

## The wedge: one work graph

Every engineering-metrics vendor spends most of its effort on one problem: mapping identities and entities across Jira ↔ GitHub ↔ CI ↔ incident tools. yapm makes that problem disappear by making the graph native:

```
issue ↔ PR ↔ CI run ↔ deploy ↔ incident
```

These are first-class, linked entities in one data model. Consequences:

- **Status derives from reality.** A PR merging, a deploy landing, an incident opening — these move work items without a human remembering to.
- **Metrics are views, not a product.** DORA four keys, review turnaround, PR size, CI health, flaky-test rate, MTTR — computed over native data, included, free. Not an ETL pipeline bolted on for $30/dev/month.
- **No other open-source tool has this**, and only GitLab has it commercially — and only if you move everything into GitLab. yapm connects to where teams already are (GitHub first).

## Who it's for

**Primary: small self-hosting engineering teams (2–20 people).** The face of the user is a tech lead at a small company or indie team who wants Linear's experience without per-seat rent, owns their own data, and is tired of choosing between "free but crippled" and "good but greedy." They live on r/selfhosted and Hacker News, and they evangelize what they love.

Everyone else — cloud-first startups, Jira escapees, OSS maintainers — comes later, on the same foundation.

## Product principles

1. **Speed is the feature.** Sub-100ms interactions, keyboard-first, command palette everywhere. Linear proved this is why people stay; no open-source tool has matched it. If yapm is slow, nothing else matters.

2. **Opinionated defaults, real escape hatches.** Built-in rails for the healthy workflow — cycles, triage, progressive depth (starts as a plain tracker, grows into projects/roadmaps). But fix Linear's documented dead-ends: stakeholder-grade reporting, automations, and a complete API are core, not afterthoughts.

3. **Reality over ritual.** Wherever a fact can come from git, CI, or deploys, it is never asked of a human.

4. **Metrics for teams, never surveillance.** Team-level only. No individual leaderboards, no stack ranking, speed always displayed alongside stability. Misused metrics are how this category earns hatred; yapm's opinion is built in.

5. **Free means free.** No seat caps. No SSO tax. No feature flags waiting for a license key. No upgrade nags inside the self-hosted UI. One-command export of everything. The self-hosted product *is* the product.

6. **Deployable in minutes.** One `docker compose up` on a small VPS. Operational simplicity is a moat — the leading free alternative's own README calls itself resource-heavy.

## What yapm is not

- **Not a config sandbox.** No custom issue-type hierarchies, no workflow-scheme labyrinth. Jira's flexibility is the disease, not the cure.
- **Not a surveillance tool.** If a feature's main use is ranking individual developers, it doesn't ship.
- **Not an everything-app.** No chat, no docs-suite sprawl, no CRM. The scope is work tracking + delivery truth.
- **Not open-core.** There is no `ee/` directory. 100% of the code is AGPL.

## License and sustainability

- **AGPLv3 from day one, all code open.** The Plausible model: the community edition *is* the entire product. AGPL keeps clouds from reselling it; starting there (rather than relicensing later) is the lesson of Redis, Elastic, and HashiCorp. Register the trademark.
- **Revenue: managed cloud only.** Charge for convenience — hosting, backups, upgrades — never for capability. Pricing shape TBD, but the principle is fixed: no per-seat tax for viewers/stakeholders; prefer flat or usage-based tiers (the Basecamp `$299 flat` model is repeatedly praised as the sane one).
- **Sober expectations.** Plausible-style calm profitability is the realistic ceiling for a small team. Adoption precedes monetization; expect 1–2 years of distribution-building. The commitment is to keep the free product whole the entire way.

## Positioning in one line each

| Against | yapm's answer |
|---|---|
| **Linear** | Open source, self-hostable, with the reporting and delivery metrics Linear doesn't have |
| **Jira** | Fast, opinionated, and honest about pricing |
| **Plane** | Actually free: no seat caps, no SSO tax, no paywalled dashboards on your own server |
| **Huly** | Focused scope, light ops, delivery metrics instead of everything-app sprawl |
| **GitLab** | Works with the tools you already use; PM+metrics without migrating your whole SDLC |
| **LinearB / Swarmia** | The metrics are free because the data was never in two places |

## North stars

- A new team is self-hosted and tracking work in **under 5 minutes**.
- p95 interaction latency **under 100ms**.
- A team can answer *"did we ship faster and safer this cycle, and what's blocking review?"* **without buying or integrating anything**.
- Zero features gated by seat count or license key — verifiable by anyone reading the source.

## Phasing sketch (to be refined into a roadmap)

1. **Phase 1 — PM core, graph-ready.** Issues, projects, cycles, triage, keyboard-first UI, GitHub sync (branch/PR ↔ issue). The schema models the full work graph from day one even before all edges are ingested.
2. **Phase 2 — Delivery truth.** PR/CI/deploy ingestion, automatic status transitions, DORA + review-health + CI-health views.
3. **Phase 3 — Incidents + cloud.** Incident tracking closing the loop (change failure rate, MTTR), then the managed cloud offering.

## Honest risks

- **Crowded space.** Plane, Huly, OpenProject, Leantime, Tenzu. The work-graph wedge and the "actually free" stance must stay sharp in every piece of messaging.
- **Scope gravity.** A great PM core alone is enormous. Phase 1 must ship something lovable before the metrics story is fully real.
- **Cloud-only revenue is a long game.** With no enterprise edition, the managed cloud has to be genuinely better-run than a $5 VPS to convert self-hosters' employers.
