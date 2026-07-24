# cycles — tasks

## 1. Schema: cycle entity + issue reference

- [x] 1.1 Migration `0006_cycles`: `cycle` table, `cycle_sequence` counter, `issue.cycle_id` (`ON DELETE SET NULL`) + indexes
- [x] 1.2 `CYCLE_STATUSES`/`CycleStatus` in context; `CycleTable`/`CycleSequenceTable` + `issue.cycle_id` in the Kysely `DB` interface
- [x] 1.3 Zero schema: `cycle` table, `issue.cycleId`, team↔cycles and cycle↔issues relationships
- [x] 1.4 Extend the schema-drift test (cycle, issue.cycle_id, cycle_sequence exclusion); verify against live Postgres

## 2. Mutators + queries

- [x] 2.1 Pure rollover logic (`nextCycleId`, `isUnfinished`, `compareCycles`) + unit tests
- [x] 2.2 `cycle.create` (upcoming, end-after-start, server number override `claimNextCycleNumber`), `cycle.update`, `cycle.activate`
- [x] 2.3 `cycle.complete` — team-scoped, permission-gated, deterministic, idempotent rollover + unit tests
- [x] 2.4 `issue.setCycle` (same-team, cross-team rejected) + unit tests
- [x] 2.5 `cycles.byTeam` team-scoped synced query; export the new surface

## 3. Scheduled rollover (pg-boss)

- [x] 3.1 `runCycleMaintenance` — activate due upcoming cycles, complete ended active cycles, via the shared mutators
- [x] 3.2 pg-boss scheduler on the existing Postgres (`fromKysely`), gated behind `CYCLE_MAINTENANCE`; env + `.env.example`
- [x] 3.3 Wire into boot + shutdown; live-Postgres integration test for the rollover + idempotency

## 4. Cycles view (web)

- [x] 4.1 Cycle model (progress, partition, current cycle) + unit tests
- [x] 4.2 `CyclesView` + `/teams/$teamId/cycles` route: rail, featured cycle + progress, issues, create, complete
- [x] 4.3 View-switch entry (List ↔ Board ↔ Cycles)

## 5. List integration

- [x] 5.1 Cycle filter + group-by-cycle in the issue list (web-only view layer)

## 6. Documentation

- [x] 6.1 `apps/docs` Cycles feature page + sidebar + home link; `pnpm --filter @yapm/docs build` passes
- [x] 6.2 Root docs: README (status + features), ROADMAP (#5 status), TECHSTACK (pg-boss first-use), `.env.example`

## 7. Gates

- [x] 7.1 `pnpm turbo lint typecheck test build` green (with live Postgres)
