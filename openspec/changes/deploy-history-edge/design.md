## Context

Three facts about the code as it stands shape every decision below.

1. **`upsertDeployment` is an in-place upsert keyed on `(installation_id, external_id)`.** One GitHub
   deployment is one row for its whole life. Successive deploys to `production` are already separate
   rows (separate GitHub deployment ids) — so the row *multiplicity* for a history is present today.
   What is missing is the fact and its time: the row that succeeded at 14:02 is flipped to `inactive`
   at 15:10 by `auto_inactive`, `updated_at` moves to 15:10, and nothing anywhere records 14:02.
2. **`reconcile.ts` reads `statuses.data[0]`, per_page 1.** The sweep is structurally incapable of
   seeing an earlier `success` once a later status exists. Any design that recomputes `deployed_at`
   from current state re-destroys the fact on the next cron tick. The guard therefore has to live in
   the write path, not in the reader.
3. **The ordering safety net already returns early.** `if (mutation.sourceUpdatedAt <
   existing.updatedAt) return` — a stale event currently writes nothing at all. A write-once
   `deployed_at` that only runs after that check would be silently skipped for the one event class
   most likely to carry a success the row has not seen: a redelivery of an older status after a newer
   one landed.

Constraints: all ZQL and mutators stay in `packages/schema`; the connector write path is server-only
and not a client mutator; ids are client-minted at the call site (`map.ts` / `reconcile.ts` already
do this via `newId()`); the Zero schema is hand-written and drift-tested against live Postgres.

## Goals / Non-Goals

**Goals:**

- `deployment` becomes an append-only record of what actually shipped and when — a fact that survives
  `auto_inactive`, webhook redelivery, out-of-order events and the reconcile sweep.
- Counting successful deploys over a window returns the true count. Three successive deploys to one
  environment count as three.
- An exact, defensible PR→deployment edge, with its failure direction chosen rather than inherited.
- `merged-not-deployed` — a shipped, selectable, permanently-empty filter option — starts returning
  the issues it names.
- The row's reality strip says whether a change reached production, in the slot DESIGN.md reserved.

**Non-Goals:**

- Any view, chart or tile over the new data. A sibling build owns the delivery view.
- An `incident` entity, change failure rate, or MTTR.
- Multi-environment semantics beyond what is stored: "deployed" here means *some* deployment carrying
  the commit reached success. Per-environment promotion state is stored (the `environment` column)
  but the predicate does not distinguish staging from production — see §D6.

## Decisions

### D1 — `deployed_at` is a write-once column on the existing row, not a new `deployment_event` table

The alternative that reads best on paper is an append-only `deployment_event` table (one row per
status transition) with `deployment` kept as the current-state projection. It is strictly more
faithful: it records the `pending → in_progress → success → inactive` walk, and a later analysis
could ask questions this design cannot.

Rejected, for three reasons that are specific to this repo rather than general:

- **It is a second synced table for a fact one column carries.** The only question asked of the
  history in v1 and in the change that consumes it is *when did this deployment first succeed* — one
  timestamp per deployment. An event log makes every reader do a `min(created_at) where state =
  'success' group by deployment_id` to answer it, and makes the Zero client sync every intermediate
  `pending` row to a browser that renders none of them.
- **The sync boundary would need a new team-scoped query, a new permission predicate and a new drift
  row** — all of which the non-goals rule out, and none of which the falsifiable checks need.
- **The event log does not, by itself, solve the problem.** Its rows would still be written by the
  same `upsertDeployment` under the same stale-event early return; an append-only table with a
  reader that only ever sees the newest status appends nothing either. The invariant, not the shape,
  is the fix.

Recorded as reversible: adding `deployment_event` later is additive, and `deployed_at` remains
derivable from it, so nothing here forecloses it.

### D2 — The invariant: `deployed_at` is stamped once and never moves; `state` stays last-writer-wins

Two facts on one row with two different update rules, stated explicitly because a single "upsert"
verb hides the difference:

| Column | Rule | Why |
|---|---|---|
| `state`, `updated_at`, `ref`, `environment` | last-writer-wins, guarded by the existing `sourceUpdatedAt` ordering check | "What is deployed right now" is genuinely current state; a stale event must not regress it |
| `deployed_at` | **write-once**: `existing.deployedAt ?? incoming` | A past success is not current state. It happened. Nothing later is entitled to an opinion about it |
| `sha` | fill-if-absent: `incoming ?? existing` | An event that omits the sha (an older fixture, a provider that stops sending it) must not blank a commit already recorded |

Concretely, `applyWorkGraphMutation`'s `upsertDeployment` branch becomes:

- Derive `incomingDeployedAt = mutation.state === 'success' ? mutation.sourceUpdatedAt : null`.
  `success` is the only terminal state that means "it shipped"; `inactive` is a *superseded* success
  and must not stamp, because its timestamp is the moment it was superseded, not the moment it
  succeeded.
- **On the stale path** (`mutation.sourceUpdatedAt < existing.updatedAt`), do not return blind. If the
  stale event carries a success and `existing.deployedAt` is null, write **`deployedAt` (and `sha` if
  absent) only** — leaving `state`, `updatedAt`, `ref` and `environment` untouched. This is the case
  §Context.3 names, and skipping it would mean a redelivered older `success` after a newer `inactive`
  loses the fact forever. Otherwise return as today.
- **On the update path**, `deployedAt: existing.deployedAt ?? incomingDeployedAt`.

Why write-once rather than `min(existing, incoming)`: the two differ only when two distinct `success`
statuses exist for the same deployment id with the later one arriving first, which GitHub does not
produce (a deployment succeeds once). Write-once is one comparison, is trivially idempotent under
redelivery, and cannot be made to walk backwards by a fabricated timestamp. `min` would let a
malformed or clock-skewed payload drag a real timestamp into the past.

Idempotency falls straight out: replaying the same `deployment_status` webhook hits
`existing.deployedAt ?? incoming` with `existing.deployedAt` already set, which is a no-op write of
the same value. The reconcile sweep, which can only ever see the newest status, hits the same branch
and likewise cannot clear it.

### D3 — Exact sha join over `pull_request.merge_commit_sha = deployment.sha`, chosen over the time heuristic

The two candidates, and what each gets wrong:

**Exact (chosen).** A merged PR is deployed when some deployment in the same repo carries its
`merge_commit_sha` and has a non-null `deployed_at`. Both columns are free — GitHub sends
`merge_commit_sha` on every `pull_request` payload and `sha` on every `deployment` object; yapm is
already receiving both and throwing one away.

- *Where it is wrong:* a deploy that ships several merges at once carries **one** sha — the tip. The
  other PRs in that batch are genuinely in production and read as not-deployed. Same for a release
  branch, a squash-and-retag, or any pipeline that deploys a tag rather than the merge commit.
- *Direction of the error:* it **over-reports** `merged-not-deployed` and never under-reports. The
  filter can show a change that actually shipped; it can never hide one that did not, and the strip
  can never claim a deployment that did not carry the commit. For a filter whose purpose is "what
  have we merged and not yet got out", a false positive costs a glance and a false negative costs a
  missed release — so the asymmetry is chosen, not tolerated.

**Heuristic (rejected).** Repo + environment + first `success` after the PR's `merged_at`. It catches
the batched case, and it is wrong in the opposite direction: any deploy that happens to succeed after
a merge marks that merge deployed, including a deploy from a different branch, a revert, a rollback,
or a hotfix that never contained the PR. It would let the strip assert "this reached production"
about a change that did not — which is the one thing a signal called *reality* may not do.

**Not stored as an edge.** No `issue_deployment` / `pr_deployment` table. Deployments arrive after
merges, often minutes later and sometimes after a reconcile sweep, so a stored edge would need
re-computation on every deployment write anyway — an edge that is recomputed on write is a join with
extra bookkeeping. The join runs client-side over rows the client already holds: `queries.issues.*`
already carries `issueLinks → pullRequest`, and `queries.deployments.byTeam` is already synced by
issue-detail. Neither query changes.

**Fallback to `head_sha` is deliberately NOT implemented.** A merge commit and the PR's head commit
are different objects, and a deploy carrying the head sha means the branch was deployed, not the
merge. Matching on it would reintroduce the heuristic's false-positive class through the back door.

### D4 — `DeliverySignal` gains `deployedAt`; both seam signatures stay as issue-core defined

`connectors` design decision 4 wrote: *"deployment … is NOT fed into `computeDeliverySignal` — the
exported signal shape is fixed and adding a deploy axis would change it … a per-issue/per-team
deployment query is deferred to the UI phase."* That deferral is the thing being taken up, so the
shape changes now, deliberately and in the spec:

```ts
interface DeliverySignal {
  pr: PrState | null
  ciHealth: CiHealth | null
  reviewAgeMs: number | null
  deployedAt: number | null   // new
}

interface LinkedEntities {
  // …
  deployments?: readonly { readonly deployedAt: number }[]   // new, optional
}
```

What the work-graph spec actually pins is *"`computeDeliverySignal` and `computeDivergence` keep the
signatures issue-core defined"* — the **function** signatures, both of which are untouched.
`LinkedEntities` gains an optional field, so every existing caller still type-checks, and the
spec delta says which promise widened rather than letting a reader discover it.

`assembleLinkedEntities` gains a second, optional parameter (the team's deployment rows) and performs
the §D3 join: for each linked merged PR, a deployment in the same repo whose `sha` equals the PR's
`mergeCommitSha` and whose `deployedAt` is non-null contributes `{ deployedAt }`. `deployedAt` on the
signal is the **earliest** such timestamp — the moment the change first reached production. Passing
no deployments (every existing call site, and any instance with no connector) yields the same signal
as today with `deployedAt: null`.

`computeDivergence` is **not** extended. "Merged and not deployed for N days" is a plausible fourth
divergence kind and it is a product decision with a threshold in it; this change adds no threshold
and no new glyph beyond the strip's own.

### D5 — No backfill migration; the reconcile cron is the backfill

`deployed_at` and `sha` are null on every row that predates the migration. A backfill cannot recover
them from the database — the timestamp of a past success is exactly the thing that was overwritten,
and `updated_at` is the moment of supersession, not of success. Writing `updated_at` into
`deployed_at` for rows where `state = 'success'` would manufacture a plausible-looking wrong number
and make it indistinguishable from a real one.

What does heal: `reconcileDeployments` lists the repo's deployments (100 most recent per repo) and
now emits `sha` on every mutation, so the sha fills in on the next sweep for anything GitHub still
returns. `deployed_at` fills in for those whose newest status is still `success`. Everything older
stays null and reads as "not deployed / unknown", which is honest. Stated in the docs so an operator
reading a sparse first week knows why.

### D6 — "Deployed" ignores the environment, and says so

The predicate and the strip ask *did a deployment carrying this commit succeed*, with no filter on
`environment`. A team whose staging deploys succeed and whose production deploys do not would see
"deployed" on a change that is not in production.

Not solved here, deliberately: yapm has no way to know which of a team's environment strings means
production. `production` is a GitHub convention, not a rule, and hard-coding the string would be
wrong for every team that names it `prod`, `live`, or `eu-west-1`. The honest fix is an admin-set
"production environment" per repo or team — configuration this change is not scoped to add, and which
belongs with the delivery view that will care about the distinction. Recorded here so the later
change inherits the question rather than rediscovering it.

### D7 — Migration `0023` is three nullable column adds and one index

```sql
alter table deployment add column deployed_at timestamptz;
alter table deployment add column sha text;
alter table pull_request add column merge_commit_sha text;
create index deployment_team_deployed_at_idx on deployment (team_id, deployed_at);
```

All three nullable with no default: null means "not known", which is true for every existing row and
for any deployment that has not succeeded. No CHECK — `deployed_at` has no enumerable domain, and the
write-once property is a property of the write path, not of a constraint Postgres can express without
a trigger (and a trigger is a second place the rule lives, which is how two rules drift apart).

The index is on `(team_id, deployed_at)` because every question asked of this column is asked within
one team over a time window. It is added now rather than with the view that needs it, so the view is
a read-only change.

## Risks / Trade-offs

- **[The exact-sha join over-reports `merged-not-deployed` for batched deploys]** → §D3 chooses this
  direction on purpose; the docs state it in the filter's own description so a team seeing a shipped
  change in the list knows why. Mitigation if it bites: an admin-set deploy-matching mode, which the
  stored `sha` makes possible and the heuristic-only design would not.
- **[The stale-path stamp writes to a row a newer event already updated]** → it writes exactly one
  column that the newer event could not have set (it is null by the branch's own condition), and one
  more (`sha`) only when absent. No column both paths can write is written on the stale path.
- **[`deployed_at` depends on `sourceUpdatedAt`, which is provider-supplied]** → same trust boundary
  the existing ordering guard already sits on; a GitHub payload with a wrong `updated_at` already
  mis-orders `state` today. Write-once (not `min`) means a bad timestamp cannot drag a good one
  backwards, only sit there as the first value.
- **[A wider `DeliverySignal` touches every consumer of the seam]** → the field is additive and
  nullable, and the two exported function signatures do not move; `apps/web/src/cycles/digest.ts`
  and the retro seed read `LinkedEntities`-shaped data structurally and gain an optional field they
  ignore. The sibling build's files are not touched.
- **[The list now needs the team's deployments synced to evaluate the predicate]** → it is the same
  `deployments.byTeam` query issue-detail already subscribes to, over rows already inside the team
  boundary; no new query, no widened scope. The extra client work is one pass over the team's
  deployment rows per render, memoized alongside the existing `linkedEntitiesFor`.

## Decisions made during implementation

**`LinkedPullRequestRow` also gained `repo`, not just `mergeCommitSha`.** Task 4.3 names only
`mergeCommitSha`, but §D3's join is *same-repo* and exact — a merge commit alone cannot express
"in the same repo", and matching on the sha across repos would be a different (looser) predicate
than the one the design chose. Both fields are optional, so every existing caller still compiles,
and `queries.issues.*` already syncs the whole PR row through `withLinkedDelivery`, so neither is a
new sync cost. The delivery test asserts the repo leg directly.

**A named `TeamDeploymentRow` type, exported from the seam.** `assembleLinkedEntities`' second
parameter needs a shape both `apps/web` call sites can name. It is structural (`repo`, optional
`sha`, optional `deployedAt`), so the `deployments.byTeam` result satisfies it without a mapping
step, and issue-detail's local `DeploymentRow` satisfies it once its two new columns are declared.

**`issue-detail.tsx` was touched after all — one argument, not a restructure.** Task 5.5 asked for
nothing to be added to it, but its strip is the same `RealityStrip` the list renders, computed from
the same seam. Leaving `linkedEntitiesFor(issueLinks)` without the deployments there would mean the
list row shows the deploy glyph and the detail panel for the SAME issue does not — a contradiction
the reality strip specifically may not have. `deployments` was already a prop of `IssueDetailBody`
(it feeds the existing deploy list), so the fix is passing it as the second argument plus declaring
`sha`/`deployedAt`/`mergeCommitSha` on the two local row interfaces. No new query, no new prop, no
change to `DeploymentRow`'s rendering.

**The deploy glyph is `RocketIcon` on `text-signal-sync`.** Verified present in the installed
`lucide-react@1.26.0` `.d.ts` rather than assumed. `--signal-sync` is the token CI-passing and
PR-approved already use, so its contrast is already carried by the shipped presets; the glyph, not
the hue, is what distinguishes the fourth slot. The strip and `RealityStripPlaceholder` share one
`REALITY_STRIP_WIDTH` constant (`w-[86px]`, up from `w-16`) so the two can no longer drift apart,
and the placeholder grew to four dots to match the four slots.

**`merge_commit_sha` and `deployment.sha` confirmed against `@octokit/openapi-types@27.0.0`, not
memory.** `components.schemas.deployment.sha` is `string` (non-null) and `pull-request.merge_commit_sha`
is `string | null`. `DeploymentStatusEvent.deployment.sha` was already declared in `payloads.ts:95`
and had simply never been read. Both are mapped through `?? null`, so a payload that omits either
yields null rather than `undefined`.

**Fixtures tell the join's story rather than just satisfying the type.** The merged-PR fixture's
`merge_commit_sha` (`9f1c2d3e4b5a`) is deliberately DIFFERENT from its `head.sha` (`abc123def456`),
so a future head-sha fallback would visibly change a test result rather than pass silently.

### What ran, and what CI is the first place to execute

Ran locally, green: `pnpm turbo run typecheck '--filter=...[origin/main]'`, `pnpm lint`,
`pnpm turbo run test '--filter=...[origin/main]'` (schema 784, ui 256, server 370, web 446 passing),
and `node scripts/check-boundaries.mjs`.

**Not run here, by instruction** (the build phase was told to skip Docker, the full build, Playwright
and the smoke test because the open PR already runs the whole suite): task 1.5's live-stack migration
apply, task 8.2's Postgres suites, and task 8.3's compose smoke test. That means **CI is the first
place migration `0023` executes against a real database and the first place `schema-drift.test.ts`
compares the three new columns to live Postgres** — 393 pg-gated tests are skipped in a DB-less run.
The migration is three `alter table ... add column` statements and one `create index`, matching the
shape of `0011` and `0019`, and the drift expectations were written to match (`nullable: true,
hasDefault: false` for all three). If CI disagrees, that is the honest place to find out.
