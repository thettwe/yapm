## Why

yapm ingests deployments and then destroys them. `deployment` has `state` and `updated_at` and no
immutable event timestamp (`0009_connectors.ts:131-144`); `applyWorkGraphMutation` UPDATES `state` in
place on every status event (`work-graph.ts:355-366`); and the reconcile sweep re-derives state from
`statuses.data[0]`, the **newest status only** (`reconcile.ts:302-326`). GitHub's `auto_inactive`
marks a superseded deployment `inactive` the moment the next one succeeds — so a past `success`, and
the moment it happened, are overwritten. What the table holds is "the current deploy per
environment", not a history. Counting `state = 'success'` today counts roughly one row per
environment, forever, no matter how many times the team shipped.

The second half is the missing edge. `map.ts:204-205` maps `ref` and `environment` off the
deployment payload and **drops `sha`**, which GitHub sends in the same object — contrast `:95`, where
the PR mapper correctly keeps `head_sha`. With no commit on the deployment row there is nothing to
join a PR to, which is why `merged-not-deployed` returns `false` unconditionally
(`filter.ts:107-116`). That is not a bug: it is a **reserved slot**, sanctioned by the issue-list
spec ("where a delivery predicate has no data it simply matches nothing"), asserted by
`filter.test.ts:125-126`, and rendered as a selectable option at `issue-list.tsx:697`. It matches
nothing rather than aliasing to merged, which would wrongly include merged-and-deployed. This change
fills it in.

Vision principles served: **reality over ritual** — the row's fourth signal becomes "this actually
reached production", derived from git, not from a status a human set; and **metrics are free views
over native data, never a bolt-on** — deployment frequency is unanswerable today not because no view
exists but because the fact is not stored, and no chart can be built over a row that was overwritten.

## What Changes

- **Migration `0023_deploy_history`** (highest on main is `0022`) adds three columns:
  - `deployment.deployed_at timestamptz` — stamped the first time a deployment reaches a terminal
    `success`, and thereafter **immutable**.
  - `deployment.sha text` — the commit the deployment carried, which `map.ts` stops discarding.
  - `pull_request.merge_commit_sha text` — the commit a merge produced, which GitHub already sends on
    every `pull_request` payload and which the exact PR→deployment join needs.
- **A non-regression guard in `applyWorkGraphMutation`.** Once `deployed_at` is set, no later status
  event, no redelivered webhook and no reconcile sweep may clear it or move it. `state` stays
  last-writer-wins (the current deploy per environment is still a useful fact); `deployed_at` becomes
  write-once. A stale event carrying a `success` that the row has not yet recorded still stamps the
  fact even though it is too old to move `state` — see design §D2.
- **The PR→deployment association is an exact sha match**, `pull_request.merge_commit_sha =
  deployment.sha` within the same repo, computed client-side over already-synced team-scoped rows.
  Chosen over the repo+environment+first-success-after-`merged_at` heuristic. What it costs and where
  it is wrong is stated plainly in design §D3 — a batched or rebased deploy whose sha is not the
  PR's merge commit reads as not-deployed, so the predicate **over-reports** "merged, not deployed"
  and never fabricates a deployment that did not happen. That asymmetry is deliberate.
- **`DeliverySignal` gains a fourth axis, `deployedAt: number | null`.** The seam's two function
  signatures — `computeDeliverySignal(issue, linked)` and `computeDivergence(status, signal)` — are
  unchanged, as the work-graph spec requires; the value they pass between them grows one field, and
  `LinkedEntities` grows one optional input. `connectors` design decision 4 deferred exactly this
  ("a per-issue/per-team deployment query is deferred to the UI phase"); this change takes it up.
- **`merged-not-deployed` consults real data**: a linked PR is merged and no deployment carries its
  merge commit. `filter.test.ts:125-126`'s assertion is **deliberately replaced**, not corrected — it
  pinned the reserved slot's honest emptiness, and the slot is now filled.
- **The reality strip gains a deploy glyph.** A row whose merged change reached production says so,
  with its own icon (not hue alone) and an accessible label. The placeholder grows with it, so
  populating the signal still shifts nothing.
- `map.ts`, `reconcile.ts` and the GitHub payload types carry `sha` and `merge_commit_sha`; the
  existing reconcile cron is the backfill for rows ingested before this change.
- Zero schema entries for the three columns, `schema-drift.test.ts` rows, `db/types.ts` fields. The
  `deployments.byTeam` synced query is **unchanged** and stays team-scoped exactly as it is.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `work-graph`: `deployment` gains an immutable first-success timestamp and the deployed commit, and
  `pull_request` gains its merge commit — so deployment becomes an append-only *history* rather than
  a per-environment current state. A new requirement states the write-once invariant. The
  delivery-signal seam gains a deployment axis while keeping both exported function signatures.
- `connectors`: the deployment mapping SHALL preserve the payload's commit sha, and the ETag
  reconciliation — which reads only the newest status — SHALL NOT be able to regress a stamped
  deployment fact.
- `issue-list`: `merged-not-deployed` stops being the reserved slot and evaluates over real
  deployment data; the reality strip renders a deployment signal.

## Impact

- `packages/schema/src/migrations/0023_deploy_history.ts`, `migrations/index.ts`.
- `packages/schema/src/zero/schema.ts` — `deployment.sha`, `deployment.deployedAt`,
  `pullRequest.mergeCommitSha`.
- `packages/schema/src/zero/work-graph.ts` — `upsertDeployment` gains `sha`/`deployedAt` derivation
  and the write-once guard; `upsertPullRequest` carries `mergeCommitSha`.
- `packages/schema/src/zero/delivery.ts` — `DeliverySignal.deployedAt`, `LinkedEntities.deployments`,
  the sha-join in `assembleLinkedEntities`.
- `packages/schema/src/zero/filter.ts` — `merged-not-deployed`.
- `packages/schema/src/db/types.ts`, `packages/schema/src/db/schema-drift.test.ts`.
- `apps/server/src/connectors/github/map.ts`, `reconcile.ts`, `payloads.ts`.
- `apps/web/src/issues/delivery.ts`, `issue-list.tsx`, `model.ts` — the team's deployments reach the
  row assembler through the query issue-detail already uses.
- `packages/ui/src/components/issue-row.tsx` — the deploy glyph and the widened placeholder.
- No new dependency, no new container, no new GitHub App permission, no new synced query, no new
  client mutator, no new permission predicate.

Docs: `apps/docs/src/content/docs/self-hosting/github-connector.md` (what the Deployments permission
now yields and that the sweep backfills), `apps/docs/src/content/docs/features/delivery-signals.md`
(the strip's fourth signal, and "Merged, not deployed" stops being reserved — including the exact-sha
caveat), `ROADMAP.md` (a row for this change, and Phase 2's "an issue↔deployment edge that is not
modelled" is now half-true and must say which half), `DESIGN.md` §Reality strip (the slot's contents).

## Non-goals

- **No delivery or insights view, and no metric tile.** Deployment frequency becomes a tile in a
  later change that consumes what this one stores. The sibling `team-delivery-view` build owns
  `apps/web/src/routes/`, `apps/web/src/retro/seed-model.ts`, `retro-seed-panel.tsx` and
  `packages/schema/src/zero/retro/seed.ts`; this change touches none of them.
- **No incident entity.** Change failure rate and MTTR both need one, and inventing a half-built
  `incident` here to gesture at DORA would ship a table nothing writes. Honestly Phase 3.
- **No deploy-driven status automation.** Change 14's opt-in automation fires on PR open/merge; a
  deploy-driven transition is a separate product decision and is not taken here.
- **No `issue_deployment` edge table.** The association is a computed join over two synced columns,
  not a third stored edge — see design §D3 for why a stored edge would have to be recomputed on
  every late-arriving deployment anyway.
- **No change to `deployments.byTeam`,** to who may read a deployment, or to the `deployment` state
  vocabulary.
- **No backfill migration.** `deployed_at` and `sha` are null for rows already stored; the existing
  reconcile cron fills them on its next sweep for deployments GitHub still lists, and older ones stay
  null. A migration cannot invent a timestamp it never recorded — see design §D5.
