# projects-roadmap — design

## Projects are workspace-level, not team-scoped

The load-bearing modeling decision. yapm's work data (issues, cycles, labels, saved views) is
team-scoped: every row carries a `team_id` and syncs under the two-hop `teamScoped` predicate. A
project could have followed that pattern, but the task's brief and VISION both point the other
way: a project is a **stakeholder-facing, cross-team overview**, and the roadmap's value is
precisely that it spans teams. So `project` is a **workspace-level** entity with a `workspace_id`
and **no** `team_id`, read through the same `isMember` gate as `workspace` / `teams` / `members`
(deny by empty query for a non-member). An issue from any team may point at any project.

This choice is weighed against the permission model in "Decisions made during implementation".

## Issues stay team-scoped; the project only adds a nullable pointer

`issue` gains a nullable `project_id` (`ON DELETE SET NULL`) and nothing else. Issues remain
team-bound and team-scoped for sync. Deleting a project unassigns its issues via the FK — no
issue is ever lost. `issue.setProject` runs the **issue's** existing write gate
(`loadIssueForWrite`: `canWrite` in the caller, then auth-before-existence + `assertTeamAccess`),
so assigning an issue to a project respects that issue's team-scoped write permission exactly. The
project only needs to exist in the workspace; because a project spans teams there is deliberately
no cross-team rejection (unlike `setCycle`).

## The related-issues leak, and how it is closed

A workspace-level `projects.all` that naively did `.related('issues')` would sync **every** issue
in every project to any workspace member — silently widening issue reads past the team scope and
breaking the permission model. The fix: the related issues are themselves wrapped in the existing
`teamScoped(...)` predicate, so `projects.all` / `projects.get` attach only the issues in teams the
caller belongs to. A project row is always visible (workspace-level); its issues are filtered to
the caller's teams. Progress is then computed over exactly those readable issues.

## Computed progress, never stored

Progress is the share of a project's issues at status Done, computed client-side (`projectProgress`)
like `cycleProgress`. Canceled issues count toward the total (cut scope) but not toward done. A
zero-issue project is 0%, never NaN. Nothing is denormalized: no counter to keep consistent, no
mutator bookkeeping on every status change.

## Writes gated by canWrite (workspace-wide)

Because projects are workspace-level, `project.create` / `update` / `delete` gate on `canWrite`
(member, non-viewer) with no team check — any writer may manage any project, matching the
cross-team overview intent. An optional lead is validated to be a workspace member. Viewers and
non-members are rejected before any existence check, so a project's existence never leaks.

## Roadmap timeline without a Gantt library

The timeline is a pure, deterministic layout (`roadmapTimeline`) built entirely from the design
system: a month axis from the start of the current month (or the earliest target) to the end of the
latest target with at least three months of runway, each dated project positioned by a left-percent,
a "now" gridline, and undated projects returned separately to list off-axis. It is unit-tested and
renders sub-100ms. The view is keyboard-navigable (j/k and arrows move a roving focus over project
rows, Enter opens the project); every row is a real `<button>` with an aria-label. No Gantt/chart
dependency is added.

## Web-only project grouping + filtering, mirroring cycle

Project grouping and filtering in the issue list layer over the persistable schema
filter/grouping exactly as the cycle axis does (a `projectIds` filter and a `'project'` grouping in
`GroupOptions`, not persisted in saved views). This keeps the saved-view mutator surface and the
persistable `IssueFilter`/`IssueGrouping` enums unchanged, at the cost of project filters not being
savable — the same tradeoff cycles already made, chosen for consistency and minimal schema churn.

## Reuse

Projects reuse: the `isMember` workspace-level read gate and the `teamScoped` work-data gate (both
unchanged), `loadIssueForWrite`/`assertTeamAccess`, `assertValidName`, the tokenized `IssueRow` and
status/priority visuals, the command palette, the view-switch, `runMutation`/`newId`, the
progress-bar pattern from cycles, and the theme tokens. The new schema surface is one table and one
nullable column.

## Decisions made during implementation

- **Workspace-level over team-scoped projects.** Chosen because the roadmap's whole purpose is a
  cross-team overview and the task brief prefers it. The cost is that a project's issues (and thus
  its computed progress) are team-scoped to the viewer: a member not in every team of a cross-team
  project sees only their teams' issues in that project and a correspondingly partial progress
  number. This is accepted because (a) it strictly preserves the team-scoped issue read model — no
  issue ever leaks across a team boundary, which is the non-negotiable permission constraint, and
  (b) the target user is a small team (2–20) where members are typically in all teams, so the
  common case is exact. A team-scoped project entity, or a workspace-wide issue-count aggregate,
  are the alternatives if cross-team progress accuracy for partial-membership users becomes
  important; both are additive.
- **Progress counts only Done, canceled excluded from done.** The task says "share of its issues
  that are Done", so only `done` counts toward progress; `canceled` remains in the denominator as
  scope that was cut rather than shipped, matching how a stakeholder reads "% complete".
- **`issue.setProject` does not reject cross-team.** Unlike `setCycle` (cycles are team-scoped),
  projects are workspace-level, so an issue from any team may join any project; the mutator only
  checks the project exists. It still runs the issue's full team-scoped write gate.
- **Projects/Roadmap live in the per-team view switch.** The app shell is team-centric; rather than
  build separate workspace-level chrome, the two views are added to the existing `ViewSwitch` and
  reached from any team, while their queries are workspace-level. Navigation from a project's issue
  uses that issue's own `team_id`.
- **Web-only project filter/grouping (not persisted in saved views).** Mirrors the cycle axis for
  consistency and to avoid changing the persistable filter schema and saved-view mutators.
