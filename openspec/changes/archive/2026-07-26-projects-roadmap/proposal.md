## Why

issue-core, board-view, cycles, and triage landed the team-bound issue, the fixed six statuses, team-scoped synced queries + shared mutators + row-level permissions, the keyboard-first list/board/cycles/triage inbox, and the command palette. This change is roadmap #7: **projects + roadmap** — the lightweight, stakeholder-facing planning and reporting layer Linear is weak at, completing the v1 PM core.

A **project** is a lightweight grouping of issues toward a shared outcome: a name, an optional lead (a workspace user), an optional target date, a status (planned / active / completed / cancelled), and a **computed** progress (share of its issues that are Done). Issues gain a nullable project reference. A **roadmap** is a timeline of projects across time by target date — a clean, tokenized, keyboard-navigable view (not a heavy Gantt), giving a cross-team overview no other axis provides.

It reuses the prior changes wholesale — the tokenized issue visuals, the shared-mutator + row-level-permission pattern, the `isMember` workspace-level read gate and the `teamScoped` work-data gate, the command palette, and the keyboard-first view shell.

## What Changes

- **A workspace-level `project` entity** (`name`, optional `lead_id`, `status`, optional `target_date`) plus a nullable **`issue.project_id`** (`ON DELETE SET NULL`). Projects are **workspace-level, not team-scoped** (see design.md) so the roadmap is a genuine cross-team overview and an issue from any team may belong to a project.
- **Reads gated by `isMember`** — any workspace member (including viewers) reads every project via the existing workspace-level gate; a non-member gets an empty result (deny by empty query). The related issues surfaced through `projects.all` / `projects.get` are re-scoped with the existing `teamScoped` predicate, so a workspace-level project query can **never** widen issue reads past the caller's teams.
- **Writes gated by `canWrite`** — `project.create` / `project.update` / `project.delete` are shared mutators; viewers and non-members are rejected before existence is revealed. An optional lead is validated to be a workspace member.
- **`issue.setProject` respects the issue's team-scoped write permission** — it runs the same `loadIssueForWrite` (auth-before-existence, team-scoped) gate as every other issue write; the project need only exist in the workspace (a project spans teams, so no cross-team rejection).
- **Computed progress** — the share of a project's (readable) issues that are Done, computed client-side; never stored.
- **A Projects view** at `/teams/$teamId/projects`: a project rail, and a detail panel with the project's metadata, computed progress, and its issues; create / edit / delete.
- **A Roadmap view** at `/teams/$teamId/roadmap`: a tokenized, keyboard-navigable timeline positioning each dated project on a month axis by its target date, with undated projects held aside. No Gantt dependency.
- **Project grouping + filtering in the issue list** (a web-only axis, mirroring the cycle axis) and a **command-palette "Move to project"** action (plus a `p` hotkey), gated to writers.

## Capabilities

### New Capabilities

- `projects`: the workspace-level project entity and its lifecycle; `isMember` reads with `teamScoped` related issues; `canWrite` writes; `issue.setProject` under the issue's team-scoped gate; computed progress; the Projects view; the Roadmap timeline; project grouping + filtering; command-palette project action; correctness across all three presets in light and dark; viewers read-only.

### Modified Capabilities

- `issue-tracking`: adds the nullable `project_id` to `issue` and the `issue.setProject` shared mutator (team-scoped, `canWrite`-gated).
- `local-first-sync`: the `project` table replicates workspace-wide under `isMember`; `project_id` replicates under the existing team scope; project mutators sync under `canWrite`; the related-issue re-scoping prevents cross-team issue leakage; the drift test covers the new table and column.
- `command-palette`: adds a Move-to-project action on the targeted issue(s), gated to writers.

## Impact

- **Schema** (`packages/schema`): forward-only migration `0008_projects` (`project` table + `issue.project_id` + indexes); `project`/`issue.project_id` in the Kysely `DB` interface and the Zero schema; drift test extended; `projects.all` / `projects.get` queries; `project.*` and `issue.setProject` mutators; demo projects in the seed.
- **Web** (`apps/web`): the `/teams/$teamId/projects` + `/teams/$teamId/roadmap` routes and their views, the view-switch entries, the list project grouping/filtering, and the command-palette project action.
- **Dependencies**: none — the timeline is built from the design system, no Gantt library.

Docs (`apps/docs`): a user-facing **Projects & roadmap** page (`features/projects.md`) under Features, linked from the home page and sidebar; `pnpm --filter @yapm/docs build` passes. Root docs updated: README (status + feature list), ROADMAP (#7 status). No new env vars. The behavior is specified in `openspec/specs/projects`.

## Non-goals

- **Team-scoped projects.** Projects are deliberately workspace-level (design.md logs the tradeoff); a per-team project concept is not added.
- **Stored/denormalized progress.** Progress is computed from readable issues, not maintained as a column.
- **Project milestones, dependencies, or a true Gantt.** A single target date and a clean timeline ship now; richer scheduling is a possible future follow-up.
- **Cross-workspace projects.** One workspace per instance; projects belong to that workspace.
