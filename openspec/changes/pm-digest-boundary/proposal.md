# pm-digest-boundary

## Why

Every AI artifact yapm has shipped so far is read by the team that produced the work. This is the
first one that is not: a product manager who is not on the team reads a summary of that team's
cycle. That is a permission boundary, and it is the irreversible part of the feature — a migration,
a second authorization axis, and an audit table are all costly to reverse, while the prose is not.
So the boundary ships here, deliberately, while the content is unremarkable.

Being honest about the content: on the data migration `0009` stores, the model sees issue titles,
PR titles, yapm-computed counts, and — only because change 21 shipped first — yapm-computed product
area labels. There is no PR body, no labels, no commit table, no file paths and no diffs anywhere in
the schema, and putting patch content in front of the model is **declined, not deferred**
(SCOPE §5): there is no in-stack secret scanner, and it is the only proposal in either AI family
that inverts a shipped spec guarantee — with output crossing a permission boundary, `ai-agent`'s
"the worst case is a bad paragraph, never a leak" stops being true. Change 21 is what gives this
change substance; without it a PM would get a re-voiced list of ticket titles.

Vision principles served: **#4 (trust — the producing team sees what was said about their work
before anyone outside it does)**, **#7 (free means free — the PM audience is unlimited and
role-free)**, **#8 (team-level metrics only — nothing here is per-person)**, and the
three-container promise (this adds no service; the run is in-process on the existing pg-boss).

## What Changes

- **A separate synced `pm_digest` row**, one per cycle, holding PM-altitude content — **not** a
  widened read on `cycle_digest`. ZQL has no `select()` (`reference/zero.md:1884`), so a
  PM-audience query over `cycle_digest` would hand the PM the team-internal `content` column. There
  is no column projection to hide behind.
- **A second authorization axis: `pmAudienceScoped`, a new read predicate written beside
  `teamScoped` and never a change to it.** ~15 queries depend on `teamScoped`; a one-line widening
  there silently re-scopes issues, cycles, labels, deployments, saved views and attachments. The
  entitlement is membership of a team's explicit audience list — nothing else. **No PM role is
  added and the admin/member/viewer model is untouched.** The new predicate has **no workspace-admin
  bypass** (the `notifications.mine` shape), because the audience list *is* the entitlement.
- **Four switches, all in the existing admin-gated, server-only `connector_config.config` jsonb** —
  no new table, no new crypto: a workspace-level PM-disclosure switch (default off), a per-team
  `pmVisible` switch (default off), a per-team audience list of user ids, and an admin kill switch.
  Not in `connector_installation.repo_mapping`, which is typed `Record<string, string>` and read
  with `repo_mapping ->> ${repoFullName}` (`db/connector.ts:386`).
- **A default-on human review-and-publish gate.** A generated PM digest reaches nobody until a
  member of the producing team releases it. The failure mode is an unrecallable disclosure; a review
  step is also what makes the audit log meaningful rather than decorative. This runs the feature at
  human speed, and that is the intended trade.
- **A server-only `ai_disclosure_audit` table, excluded from the Zero schema**, written on every
  policy change and every generation, publish and retraction. It ships here rather than with the
  governance change because "there is a record" is the strongest line in the security story and
  there is no audit table anywhere in migrations `0001`–`0019`.
- **What the producing team sees**: the PM-facing text in full before publish, and after publish a
  yapm-computed "Shared with N readers outside this team" marker on their own cycle view. Never a
  reader list — that would be a surveillance surface.
- **Content**: a second `generateStructured` run over the **existing** `cycleFactsForTeam`, in the
  same job, under a PM-altitude system prompt, reusing change 18's generalized validators and change
  21's `dropItemsDisclosingPaths` unchanged. **Evidence is baked as server-rendered plain-text
  labels** (`ENG-142 · PR #331`), never links: a PM outside the team can open none of the targets,
  so links would dead-end, and making them work means widening reads on issues and PRs — a far
  larger disclosure than the prose it was meant to make verifiable.
- **`getWorkspaceAiSpendUsd` gains `pm_digest`**, so the BYO-key spend cap cannot silently
  under-fire on the second run per cycle.
- **A new instance toggle `AI_PM_DIGEST` (default off)**, separate from `AI_DIGEST_ON_CYCLE_CLOSE`.

## Capabilities

### New Capabilities

- `pm-digest` — the disclosure boundary: the artifact, the audience axis, the four switches, the
  review-and-publish gate, the disclosure audit, the PM reader surface, and the producing team's
  transparency marker.

### Modified Capabilities

- `ai-agent` — one requirement changes, and it is the spec delta this change owns. "Every consumer
  SHALL provide a graceful AI-off fallback that renders the raw linked evidence" is **unsatisfiable
  for a reader who has no raw evidence to fall back to**: every fallback yapm ships is built from
  `teamScoped` queries a PM cannot run. For a disclosure consumer, degrading gracefully means **the
  surface is cleanly absent**. Stated deliberately rather than inherited and quietly broken.

## Impact

- **Migration**: `0021_pm_digest` — `pm_digest` (synced, with four columns deliberately excluded
  from the Zero schema) and `ai_disclosure_audit` (server-only, entirely excluded).
- **`packages/schema`**: `zero/queries.ts` (`pmAudienceScoped` + two query groups), `zero/schema.ts`,
  `zero/context.ts` (`AuthContext.pmAudienceTeamIds`, the audit-event CHECK text), `zero/mutators.ts`
  + `zero/server-mutators.ts` (`pmDigest.publish` / `pmDigest.unpublish` and their server
  overrides), a new `zero/pm-digest.ts`, `db/pm-disclosure.ts`, `db/ai-config.ts`,
  `db/cycle-digest.ts` (spend union), `db/types.ts`.
- **`apps/server`**: `ai/pm-digest.ts` (prompt, input builder, evidence labels, `runPmDigest`),
  `ai/admin-routes.ts` (the policy surface), `jobs/scheduler.ts`, `zero/context.ts` and
  `auth-routes.ts` (the resolved audience travels on the sync credential exactly as `role` does),
  `config/env.ts`, `index.ts`.
- **`apps/web`**: a `/digests` reader route that does not exist when the caller's audience is empty,
  a review-and-publish card on the cycle view, a PM-disclosure block in admin AI settings, and the
  sync-session plumbing that carries the audience to the client.
- **No new dependency, no new container, no new crypto, no new REST resource outside `/api/v1`.**
- **Docs**: a new `apps/docs/src/content/docs/features/pm-digest.md`; updates to
  `features/cycle-digest.md`, `self-hosting/ai-setup.md`, `README.md`, `ROADMAP.md` (row 20),
  `.env.example`. The words **"auditable"** and **"retention-bounded"** are reserved for change 23
  and MUST NOT appear in user-facing copy here.

## Non-goals

- **Patch content in front of the model.** Declined, not deferred (SCOPE §5).
- **A PM role.** The audience list is the entitlement; `admin | member | viewer` is untouched.
- **A project-scoped or role-based audience.** Projects are workspace-level and lightweight while
  cycles are team-scoped, so a project audience needs a join that may span teams.
- **Evidence links for the PM.** Baked plain-text labels; widening issue/PR reads is a bigger
  disclosure than the prose.
- **Retention, an admin audit *view*, and a "digest is ready" email.** All change 23. This change
  writes the audit rows; it does not sweep or display them.
- **A per-reader read log.** Who *read* a digest is not recorded. Counting readers is a disclosure
  fact; watching them is surveillance.
- **Exporting the PM digest as a customer changelog.** Internal, cycle-scoped, risk-bearing.
