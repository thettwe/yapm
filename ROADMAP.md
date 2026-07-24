# yapm — Roadmap

Scope decisions from the v1 scoping session (2026-07-23). Each item becomes an OpenSpec change (`openspec/changes/`) when its turn comes — proposals are written just-in-time, not upfront.

## V1 scope (locked)

**Shape**: one workspace per instance → teams → issues. Roles: admin / member / viewer (viewer free and unlimited).
**Tracking**: issues (status, priority, labels, assignee, TipTap description, comments) · cycles with auto-rollover · triage inbox · lightweight projects (name, lead, target date, membership, computed progress).
**Surfaces**: keyboard-first list · board · roadmap (timeline of projects) · command palette · search/filtering.
**Wedge proof**: GitHub App — branch/PR ↔ issue linking, PR state drives issue status, PR + checks visible on the issue.

**Opinionated defaults (not asked, decided per philosophy):** fixed status categories (Backlog / Todo / In Progress / In Review / Done / Canceled); estimates deferred; sub-issues deferred; notifications = in-app inbox + email for mentions/assignments.

## Change sequence

| # | Change | Contents | Status |
|---|--------|----------|--------|
| 1 | `foundation` | Monorepo, 3-container compose, CI, dev loop, Zero walking skeleton | ✅ built & archived |
| 2 | `workspace-auth` | Workspace, users, teams, roles, better-auth (email/password, GitHub OAuth, OIDC — free), invites, row-level sync permissions | ✅ built & archived |
| — | `design-system` | Tokenized theme system: Warm/Focused/Editorial presets + accent customization + per-user synced preference; strictly-tokenized component library; issue-row primitive with reserved reality-strip + divergence slots | ✅ built & archived |
| 3 | `issue-core` | Issues + statuses/priorities/labels/comments, keyboard-first list, command palette, filtering. **Reality strip + divergence flag** in the row (layout now, git data via connectors); filter architecture designed for derived delivery state | next |
| 4 | `board-view` | Kanban board grouped by status | |
| 5 | `cycles` | Time-boxed iterations, auto-rollover | |
| 6 | `triage` | Triage inbox: accept/decline/route incoming issues | |
| 7 | `projects-roadmap` | Projects entity + roadmap timeline | |
| 8 | `connectors` | **First-party connector framework** + GitHub as its first connector: webhook ingestion (pg-boss, serialized per install), PR/CI/deploy → work-graph edges, PR linking + auto-status. Shared encrypted-secrets/config surface. Gated on the user registering a GitHub App. GitLab etc. = later connectors | |
| 9 | `ai` | **BYO-key, work-graph-native AI**: provider-agnostic gateway (Anthropic/Gemini/OpenAI), toggle + configure per workspace, agents that read via the same synced queries and act via the same mutators + permissions. Reuses the connector secrets/config surface. Built after the graph exists so the AI is differentiated by the data, not the model | |

Order rationale: schema-risk first (2–3 define the work graph's core tables), daily-use surfaces before periphery, connectors before AI, and both last because they bind to stable issue semantics and a rich work graph. `design-system` was inserted after workspace-auth (design pass before the first product screens).

## Differentiation commitments

- **Issue list shows reality, not just intention** — rows carry a delivery signal (PR/CI/review) and a divergence flag derived from the work graph; see [DESIGN.md](DESIGN.md). Layout built in `issue-core`; git data populates via `connectors`.
- **Connectors, not special-cases** — GitHub is the first implementation of a reusable first-party framework; GitLab and others follow as connectors.
- **AI as a moat is AI-over-the-work-graph** — BYO-key, self-hosted, provider-agnostic, operating under the same permission model as humans (which is also the safety story). Architected from the start, shipped once the graph is rich.

## Post-v1 (from VISION.md phasing)

- **Phase 2 — Delivery truth**: CI/deploy ingestion, automatic status transitions, DORA + review-health + CI-health views (team-level only). Lights up the issue-list reality strip's full signal.
- **Phase 3 — Incidents + cloud**: incident tracking (change failure rate, MTTR), managed cloud offering.
- Backlog of deliberate deferrals: full multi-color theme editor, "blocked-on" issue axis, estimates, sub-issues, additional connectors (GitLab, Jira/Linear import), true third-party plugin runtime, mobile/desktop apps, i18n, public API expansion, Yjs collaborative descriptions.
