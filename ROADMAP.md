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
| 1 | `foundation` | Monorepo, 3-container compose, CI, dev loop, Zero walking skeleton | **Proposed — ready to apply** |
| 2 | `workspace-auth` | Workspace, users, teams, roles, better-auth (email/password, GitHub OAuth, OIDC — free), invites, row-level sync permissions | |
| 3 | `issue-core` | Issues + statuses/priorities/labels/comments, keyboard-first list, command palette, filtering | |
| 4 | `board-view` | Kanban board grouped by status | |
| 5 | `cycles` | Time-boxed iterations, auto-rollover | |
| 6 | `triage` | Triage inbox: accept/decline/route incoming issues | |
| 7 | `projects-roadmap` | Projects entity + roadmap timeline | |
| 8 | `github-sync` | GitHub App, webhook ingestion (pg-boss, serialized per install), PR linking + auto-status | |

Order rationale: schema-risk first (2–3 define the work graph's core tables), daily-use surfaces before periphery, GitHub last because it needs stable issue semantics to bind to.

## Post-v1 (from VISION.md phasing)

- **Phase 2 — Delivery truth**: CI/deploy ingestion, automatic status transitions, DORA + review-health + CI-health views (team-level only).
- **Phase 3 — Incidents + cloud**: incident tracking (change failure rate, MTTR), managed cloud offering.
- Backlog of deliberate deferrals: estimates, sub-issues, GitLab support, Jira/Linear importers, mobile/desktop apps, i18n, public API expansion, Yjs collaborative descriptions.
