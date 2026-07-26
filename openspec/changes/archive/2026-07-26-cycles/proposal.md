## Why

issue-core and board-view landed the team-bound issue, the fixed six statuses, team-scoped synced queries + shared mutators + row-level permissions, and the keyboard-first list/board. This change is roadmap #5: **cycles** — time-boxed iterations a team plans work into. A cycle belongs to a team, has a name, a per-team number, a start and end date, and a status (upcoming / active / completed). Issues gain a nullable reference to a cycle.

The signature behavior is **auto-rollover**: when a cycle completes, its unfinished issues (every status except Done and Canceled) move to the next open cycle, so nothing is silently dropped. This serves VISION **#9 Sub-100ms** (rollover runs optimistically in the shared mutator), **#10 Keyboard-first**, and the "nothing falls through the cracks" promise of a real planning tool. It reuses issue-core/board-view wholesale — the same team-scoped sync scope, the tokenized issue visuals, the shared-mutator + per-team server-number pattern.

## What Changes

- **A `cycle` entity**, team-bound, with a per-team `number` claimed server-authoritatively (the exact `issue_sequence` pattern, over a new `cycle_sequence` table), a `name`, a `status` enum (upcoming/active/completed), and `startDate`/`endDate`. Team-scoped synced (`cycles.byTeam`) under the existing `teamScoped` predicate; viewers read-only.
- **A nullable `cycleId` on `issue`** (FK `cycle.id` `ON DELETE SET NULL`), assignable via a new `issue.setCycle` shared mutator (team-scoped, cross-team cycle rejected).
- **Cycle mutators**: `cycle.create` (upcoming, end-after-start validated, server number override), `cycle.update`, `cycle.activate`, and `cycle.complete` — the rollover.
- **Auto-rollover, two triggers, one code path.** `cycle.complete` sets the cycle to completed and re-points its unfinished issues to the next open cycle (or unassigns them when none exists), deterministically and idempotently (a status guard makes a re-run a no-op). A **pg-boss scheduler** on the existing Postgres runs the same mutators to activate cycles whose start has passed and complete cycles whose end has passed — no new container.
- **A Cycles view** at `/teams/$teamId/cycles`: the active/upcoming/completed rail, the featured cycle with a simple progress bar, its issues, a create form, and a **Complete cycle** action. Peer to List and Board via the view switch.
- **Cycle grouping + filtering in the issue list** — a Cycle filter and a "group by cycle" option, layered over the existing list.

## Capabilities

### New Capabilities

- `cycles`: the cycle entity and its lifecycle; issue↔cycle assignment; the auto-rollover behavior (deliberate + scheduled, team-scoped, permission-gated, idempotent); the Cycles view with progress; cycle grouping/filtering in the list; correctness across all three presets in light and dark; viewers read-only.

### Modified Capabilities

- `issue-tracking`: adds the nullable `cycleId` field to `issue` and the `issue.setCycle` shared mutator (team-scoped, `canWrite`-gated, cross-team rejected).
- `local-first-sync`: `cycle` replicates under the same team scope; cycle mutators sync under that scope; viewers cannot write; the drift test covers the new tables/columns.

## Impact

- **Schema** (`packages/schema`): forward-only migration `0006_cycles` (`cycle` table, `cycle_sequence` counter, `issue.cycle_id` + index); `CycleTable`/`CycleSequenceTable` + `issue.cycle_id` in the Kysely `DB` interface; `cycle` + `cycleId` in the Zero schema; drift test extended (incl. the `cycle_sequence` Zero-exclusion assertion); `cycles.byTeam` query; cycle mutators + the `claimNextCycleNumber` server override; pure `nextCycleId`/`isUnfinished` rollover logic.
- **Server** (`apps/server`): a pg-boss scheduler (`jobs/scheduler.ts`) + the idempotent `runCycleMaintenance` pass (`jobs/cycles.ts`), wired into boot behind `CYCLE_MAINTENANCE`; `CYCLE_MAINTENANCE` + `CYCLE_MAINTENANCE_CRON` env.
- **Web** (`apps/web`): the `/teams/$teamId/cycles` route + `CyclesView`, the cycle model (progress/partition/current), the view switch entry, and cycle grouping/filtering in the list.
- **Dependencies**: `pg-boss` added to `apps/server` (already in the catalog).

Docs (`apps/docs`): a user-facing **Cycles** page (`features/cycles.md`) under Features, linked from the home page and sidebar; `pnpm --filter @yapm/docs build` passes. Root docs updated: README (status + feature list), ROADMAP (#5 status), TECHSTACK (pg-boss first-use), `.env.example` (the two new vars). The behavior is specified in `openspec/specs/cycles`.

## Non-goals

- **Cycle velocity/burndown analytics** — only a simple done/total progress bar ships now; graph-derived metrics arrive with the metrics work.
- **Persisting cycle grouping in saved views** — the saved-view grouping enum is unchanged; cycle grouping is a view-only convenience.
- **Auto-creating the next cycle during rollover** — rollover targets an existing open cycle, or unassigns; no cycle is minted inside a mutator (constraint #4).
- **Cross-team cycles or moving a cycle between teams.**
