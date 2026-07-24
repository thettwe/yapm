# cycles — design

## Rollover: one shared code path, two triggers

A cycle completing must move its unfinished issues somewhere deterministic and must never drop them. The rollover is expressed **once**, in the shared `cycle.complete` mutator, and reached from two triggers:

1. **Deliberate** — the Cycles view's **Complete cycle** action calls `cycle.complete`.
2. **Scheduled** — a pg-boss job (`cycle-maintenance`) runs `runCycleMaintenance`, which calls the same `cycle.complete` (and `cycle.activate`) mutators through the ZQLDatabase transaction with a system admin context.

Because the logic lives in the shared mutator, the deliberate path is optimistic (the client re-points issues locally, sub-100ms) and the scheduled path is authoritative — identical behavior, no duplication.

## Determinism and idempotency

- **Destination** is chosen by the pure `nextCycleId(cycles, source)`: the earliest still-open cycle (upcoming or active) in the same team that sorts after the source, by `(number, startDate, id)` — the same total order the UI lists cycles in. When none exists, unfinished issues are **unassigned** (`cycleId → null`), staying visible in the list. This is computed from the synced cycles, so client and server agree. No new cycle is minted (constraint #4: no id minted inside a mutator).
- **Unfinished** = every status except `done`/`canceled` (`isUnfinished`). Finished issues stay on the completed cycle as its record.
- **Idempotent**: `cycle.complete` returns early when the cycle is already `completed`. So the scheduler racing the manual action, or a retried mutation, is a safe no-op — an issue is never double-moved.
- **Team-scoped + permission-gated**: `canWrite` before any existence read, then `loadCycleForWrite` (auth-before-existence, team-scoped) — the exact issue-mutator pattern. Viewers and non-members are rejected before the cycle's existence leaks.

## Per-team cycle number

Mirrors the issue number exactly: `number` is nullable, absent from the optimistic insert, and claimed in a server-authoritative `cycle.create` override (`claimNextCycleNumber` over a row-locked `cycle_sequence`). `cycle_sequence` is in the Kysely `DB` interface and migrations but **excluded from the Zero schema** (asserted by the drift test) so its churn never replicates.

## Scheduler on the existing Postgres (pg-boss)

The rollover scheduler uses pg-boss via `fromKysely(db)` — the same pool, the same three containers, no Redis. It installs its own `pgboss` schema at start (independent of the Kysely migrator). A cron-scheduled `cycle-maintenance` job (singleton across replicas) drives the idempotent pass. It is gated behind `CYCLE_MAINTENANCE` (default on; off in e2e for deterministic timing) and a failure to start is logged, not fatal — the deliberate **Complete cycle** action still works.

## Reuse

Cycles reuse: the `teamScoped` synced-query predicate (unchanged), the `assertTeamAccess`/`loadIssueForWrite` write gates, the `issue_sequence` server-number pattern, the tokenized `IssueRow`/status/priority visuals, `runMutation`/`newId`, the view-switch, and the theme tokens. No hardcoded colors/fonts.

## Decisions made during implementation

- **Rollover lives in the shared mutator, not a server-only override.** Unlike the issue-number claim (which genuinely needs the server), the rollover reads only synced data (cycles + the cycle's issues) and writes only `cycleId` updates on existing rows — no id minting, no server-only state. So it runs correctly on both client and server, giving optimistic rollover for the deliberate action. The scheduler reaches the same mutator via `dbProvider.transaction`.
- **No next cycle ⇒ unassign, not auto-create.** "Move to the next cycle" needs a target; minting a new cycle inside the mutator would violate constraint #4 (client-minted ids at the call site). Rather than a server-only cycle mint, unfinished issues are unassigned when no open successor exists — they remain fully visible in the list/board, so nothing is dropped, and the invariant stays simple and idempotent. Auto-creating the next cycle is a possible future follow-up (mint at the call site, pass the id in).
- **The scheduler both activates and completes.** To make `active` reachable without forcing a manual step, `runCycleMaintenance` promotes upcoming cycles whose `startDate` has passed and completes active cycles whose `endDate` has passed, in that order, each through the shared mutator. Manual `cycle.activate`/`cycle.complete` remain available. Both are idempotent via their status guards.
- **Cycle grouping/filtering is a web-only view concern.** Adding `cycle` to the persisted `ISSUE_GROUPINGS`/`saved_view.grouping` enum would require altering the check constraint and widening the schema filter. Since v1 does not need cycle grouping to persist in saved views, the list gains a web-only `ListGrouping = IssueGrouping | 'cycle'` and a web-only cycle filter; saving a view falls back to the default grouping. This keeps the schema surface (and the drift/enum) untouched. First-class persisted cycle grouping is a future follow-up.
- **`ZQLDatabase.transaction` yields a full mutator tx.** The pg-boss job runs mutators outside an HTTP request by calling `dbProvider.transaction((tx) => mutators.cycle.complete.fn({ tx, args, ctx }))`; the zeroKysely `ZQLDatabase` passes a `TransactionImpl` (with `.mutate`/`.run`/`location === 'server'`) directly, so no `makeServerTransaction` plumbing is needed.
- **Integration test verified against live Postgres.** `apps/server/src/jobs/cycles.test.ts` migrates a fresh DB, seeds a team + an active (ended) cycle + an upcoming cycle + issues, runs `runCycleMaintenance`, and asserts: the active cycle completes, the upcoming one activates, unfinished issues (todo, in_progress) move to the successor while done/canceled stay, and a second pass moves nothing (idempotent). The schema drift + migration tests were run against live Postgres and pass, including the `cycle`/`cycle_sequence`/`issue.cycle_id` additions.
