## Why

issue-core, board-view, and cycles landed the team-bound issue, the fixed six statuses, team-scoped synced queries + shared mutators + row-level permissions, the keyboard-first list/board/cycles, and the command palette. This change is roadmap #6: **triage** — an inbox for incoming, unsorted issues that a team has not yet decided what to do with.

The modeling constraint is load-bearing: **the six statuses are fixed and not configurable** (VISION), so triage is NOT a seventh status. Triage is an **orthogonal boolean state** on an issue — `needs_triage` — separate from its status. An issue awaiting triage still has one of the six statuses; it is simply held out of the normal list/board until a human accepts, declines, or routes it. This serves the "nothing falls through the cracks" promise while reserving the entry path for the later connectors work, which will route externally-created issues straight into the inbox.

It reuses issue-core/board-view/cycles wholesale — the same team-scoped sync scope, the tokenized issue visuals, the shared-mutator + row-level-permission pattern, the command palette, and the keyboard-first view shell.

## What Changes

- **A `needs_triage` boolean on `issue`** (`NOT NULL DEFAULT false`), the orthogonal triage state. Existing issues are unaffected (false). An issue **enters triage** two ways: created with the flag set (`issue.create` gains an optional `needsTriage`; reserved for connectors that create externally-sourced issues), or an existing issue is **flagged** into the inbox (`issue.flagTriage`).
- **Triage issues are held out of the normal views.** `issues.byTeam` and `issues.mine` exclude `needs_triage = true`; a new team-scoped `triage.inbox` query lists exactly the awaiting-triage issues, oldest first.
- **Three keyboard-first inbox actions**, each a shared mutator, each clearing the triage flag:
  - `issue.acceptTriage` — clear triage; the issue becomes a normal backlog/todo issue with its status untouched.
  - `issue.declineTriage` — clear triage and set status `canceled`.
  - `issue.routeIssue` — accept-with-routing: clear triage and, in one atomic optimistic write, apply an assignee, a cycle, labels, and/or a status (all same-team-validated).
- **A Triage inbox view** at `/teams/$teamId/triage`: the awaiting-triage issues with keyboard-first Accept (A), Decline (D), and Route (R). Peer to List, Board, and Cycles via the view switch.
- **Command-palette triage actions** — Accept, Decline, Route, and Send to triage on the focused/selected issue(s), gated to writers.

## Capabilities

### New Capabilities

- `triage`: the orthogonal triage state on an issue; how an issue enters triage (created-into or flagged); the team-scoped `triage.inbox`; the three inbox actions (accept / decline / route), each team-scoped, permission-gated, and sub-100ms optimistic; the Triage view; command-palette triage actions; correctness across all three presets in light and dark; viewers read-only.

### Modified Capabilities

- `issue-tracking`: adds the `needs_triage` field to `issue`, the optional `needsTriage` on `issue.create`, and the `issue.flagTriage` / `issue.acceptTriage` / `issue.declineTriage` / `issue.routeIssue` shared mutators (team-scoped, `canWrite`-gated, cross-team rejected). Triage issues are excluded from `issues.byTeam` and `issues.mine`.
- `local-first-sync`: the `needs_triage` column replicates under the same team scope; triage mutators sync under that scope; viewers cannot write; the drift test covers the new column.
- `command-palette`: adds Accept / Decline / Route / Send-to-triage actions on the targeted issue(s), gated to writers.

## Impact

- **Schema** (`packages/schema`): forward-only migration `0007_triage` (`issue.needs_triage` + a partial index); `issue.needs_triage` in the Kysely `DB` interface and the Zero schema; drift test extended; `triage.inbox` query; the triage mutators; `needsTriage` excluded from the normal issue queries; demo triage issues in the seed.
- **Web** (`apps/web`): the `/teams/$teamId/triage` route + `TriageView` (keyboard-first accept/decline/route), the view-switch entry, and the command-palette triage actions.
- **Dependencies**: none.

Docs (`apps/docs`): a user-facing **Triage** page (`features/triage.md`) under Features, linked from the home page and sidebar; `pnpm --filter @yapm/docs build` passes. Root docs updated: README (status + feature list), ROADMAP (#6 status). No new env vars. The behavior is specified in `openspec/specs/triage`.

## Non-goals

- **A seventh status.** Triage is orthogonal to the fixed six; no status is added or made configurable.
- **Team reassignment during routing.** Routing assigns assignee/cycle/labels/status within the issue's team; moving an issue between teams collides with the per-team number and cross-team scope and is reserved for the connectors work.
- **External connectors that populate the inbox.** The `needsTriage` entry path is reserved for them; this change only models the state and the human triage actions.
- **Triage sub-states / SLA / auto-triage rules.** A single boolean ships now; richer triage workflow is a possible future follow-up.
