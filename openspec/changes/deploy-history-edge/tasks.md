## 1. The three columns, and the migration that adds them

- [x] 1.1 Write `packages/schema/src/migrations/0023_deploy_history.ts` (highest on main is `0022`):
      `deployment.deployed_at timestamptz` nullable, `deployment.sha text` nullable,
      `pull_request.merge_commit_sha text` nullable, and index
      `deployment_team_deployed_at_idx on deployment (team_id, deployed_at)`. `down` drops all four.
      No CHECK and no default — design §D7 says why null is the honest value and why the write-once
      rule lives in the write path rather than a trigger. Register it in `migrations/index.ts`.
- [x] 1.2 `packages/schema/src/db/types.ts` — `DeploymentTable` gains `sha: Nullable<string>` and
      `deployed_at: Nullable<Timestamp>`; `PullRequestTable` gains `merge_commit_sha:
      Nullable<string>`. Rewrite `DeploymentTable`'s comment: it is no longer "a deployment's latest
      state" — it is one deployment's whole life, with `state` current and `deployed_at` immutable.
- [x] 1.3 `packages/schema/src/zero/schema.ts` — `deployment` gains `sha: string().optional()` and
      `deployedAt: number().from('deployed_at').optional()`; `pullRequest` gains
      `mergeCommitSha: string().from('merge_commit_sha').optional()`. No new relationship: the
      PR→deployment association is a computed join, not an edge (design §D3).
- [x] 1.4 `packages/schema/src/db/schema-drift.test.ts` — add the three rows to the expected column
      map (`nullable: true, hasDefault: false` for each).
- [ ] 1.5 Apply the migration against the live dev stack from `down -v`
      (`POSTGRES_HOST_PORT=5452 ZERO_CACHE_HOST_PORT=4860 YAPM_HOST_PORT=3012`, project `yapm-dhe`)
      with zero-cache running, and confirm the columns and the index exist. Record the evidence in
      `design.md` under `## Decisions made during implementation`.

## 2. The durable fact: a write-once `deployed_at` in the shared write path

- [x] 2.1 `packages/schema/src/zero/work-graph.ts` — `upsertDeployment` gains `readonly sha: string
      | null`; `upsertPullRequest` gains `readonly mergeCommitSha: string | null`. Comment the
      deployment field with what it is FOR (the exact join in design §D3), not what it is.
- [x] 2.2 `applyWorkGraphMutation`'s `upsertDeployment` branch implements design §D2's three rules:
      derive `incomingDeployedAt = mutation.state === 'success' ? mutation.sourceUpdatedAt : null`
      (`inactive` never stamps — its timestamp is the moment of supersession); on the update path
      write `deployedAt: existing.deployedAt ?? incomingDeployedAt` and `sha: mutation.sha ??
      existing.sha`; on insert write both straight through. The existing `sourceUpdatedAt` ordering
      guard is untouched for `state`/`updatedAt`/`ref`/`environment`.
- [x] 2.3 The stale-event path stops returning blind: when `mutation.sourceUpdatedAt <
      existing.updatedAt` AND the event carries a success AND `existing.deployedAt` is null, write
      `deployedAt` (and `sha` when absent) and **nothing else**, then return. Carry a comment
      stating the constraint the code cannot express: the fact is monotone, current state is
      last-writer-wins, and this is the one branch where they disagree. The `existing` read in this
      branch now needs `deployedAt` and `sha` on its narrowed type.
- [x] 2.4 `upsertPullRequest` persists `mergeCommitSha` on both insert and update, alongside
      `headSha`, with no new ordering rule (it is current state like the rest of the PR row).

## 3. Stop dropping the sha at the provider boundary

- [x] 3.1 `apps/server/src/connectors/github/payloads.ts` — `GithubPullRequest` gains
      `merge_commit_sha?: string | null`. `DeploymentStatusEvent.deployment.sha` already exists;
      confirm it against the installed `@octokit/webhooks-types` `.d.ts` rather than from memory,
      and note the verification in design.md if it differs.
- [x] 3.2 `apps/server/src/connectors/github/map.ts` — the `deployment_status` case maps
      `sha: event.deployment.sha ?? null` (the line that has been dropping it since change 8), and
      `pullRequestMutation` maps `mergeCommitSha: pr.merge_commit_sha ?? null` next to `headSha`.
- [x] 3.3 `apps/server/src/connectors/github/reconcile.ts` — `reconcileDeployments` emits
      `sha: deployment.sha ?? null` on every mutation, which makes the existing cron the backfill
      (design §D5). `reconcilePulls` emits `mergeCommitSha` from the listed PR. Verify both fields
      exist on the octokit response types in `node_modules` before writing the access.
- [x] 3.4 Confirm no other producer of `upsertDeployment` / `upsertPullRequest` exists (grep both
      mutation kinds across `apps/` and `packages/`); every construction site must supply the new
      fields or the union will not type-check.

## 4. The edge: an exact sha join, and the fourth axis on the signal

- [x] 4.1 `packages/schema/src/zero/delivery.ts` — `DeliverySignal` gains `deployedAt: number |
      null`; `LinkedEntities` gains `deployments?: readonly { readonly deployedAt: number }[]`.
      Rewrite the comment that calls the exported shape "fixed and UNCHANGED from issue-core" to say
      what actually held (both function signatures) and what widened, citing design §D4 and the
      `connectors` decision 4 it supersedes.
- [x] 4.2 `computeDeliverySignal` returns `deployedAt` = the **earliest** `deployedAt` among
      `linked.deployments`, or null when there are none. It must not change when a signal is null:
      the `prs.length === 0 && ciRuns.length === 0` early return is unchanged, so a deployment
      alone never manufactures a signal for an issue with no linked PR.
- [x] 4.3 `assembleLinkedEntities` gains an optional second parameter — the team's deployment rows
      (`{ repo, sha, deployedAt }`-shaped, structurally satisfied by the synced row). For each
      linked PR whose `state === 'merged'` and whose `mergeCommitSha` is non-null, collect
      deployments in the same `repo` whose `sha` equals it and whose `deployedAt` is non-null.
      `LinkedPullRequestRow` gains `mergeCommitSha?: string | null`. Omitting the parameter yields
      today's behaviour exactly — every existing call site keeps compiling and keeps its result.
      NO `headSha` fallback (design §D3, last paragraph).
- [x] 4.4 `packages/schema/src/zero/filter.ts` — `merged-not-deployed` becomes
      `signal.pr === 'merged' && signal.deployedAt === null`. Replace the comment above it: it
      documented a reserved slot, and the slot is filled; the new comment states the over-report
      direction design §D3 chose. `DELIVERY_PREDICATES` and the filter schema are unchanged.

## 5. The row says a change reached production

- [x] 5.1 `packages/ui/src/components/issue-row.tsx` — `RealityStripProps` gains `deployedAt: number
      | null`. Render a deploy glyph (a lucide icon already in the bundle's icon set) in a fourth
      slot when non-null, with its own label folded into the strip's `aria-label` summary. Glyph +
      token, never hue alone (the file's own CI-health comment states the rule). Widen both the
      strip and `RealityStripPlaceholder` to the same new fixed width so alignment still cannot
      shift, and keep the placeholder's dot count consistent with the slots.
- [x] 5.2 `apps/web/src/issues/delivery.ts` — `linkedEntitiesFor` takes the team's deployment rows
      and forwards them to `assembleLinkedEntities`; `deliveryView` passes `signal.deployedAt` into
      the strip props. `LinkedIssueRow` still aliases the schema seam type.
- [x] 5.3 `apps/web/src/issues/issue-list.tsx` + `model.ts` — subscribe to
      `queries.deployments.byTeam({ teamId })` (the query issue-detail already uses; it is NOT
      modified) and thread the rows into the memoized `linkedEntitiesFor` per row, so the strip and
      the filter's `linkedFor` read one assembled value. Confirm the per-render cost stays a single
      pass over the team's deployments, not one per row (design §Risks).
- [x] 5.4 Do not touch `apps/web/src/routes/`, `apps/web/src/retro/seed-model.ts`,
      `retro-seed-panel.tsx`, or `packages/schema/src/zero/retro/seed.ts` — a sibling build owns
      them. If a type change forces a diff in one, stop and record it in design.md instead.
- [x] 5.5 `apps/web/src/issues/issue-detail.tsx` — its `DeploymentRow` and repo-filtered deploy list
      keep working unchanged; add nothing to it. Confirm by compile, and say so.

## 6. Tests

- [x] 6.1 **The falsifiable check.** `packages/schema/src/zero/work-graph.test.ts`: apply
      `upsertDeployment` with `state: 'success'` at T1, then the same `(installationId, externalId)`
      with `state: 'inactive'` at T2 > T1. Assert the row's `state` is `inactive`, its `updatedAt`
      is T2, and its `deployedAt` is still **T1**. This fails on today's main by construction — the
      column does not exist.
- [x] 6.2 `work-graph.test.ts` — three successive deployments to one environment (three external
      ids), each reaching success and superseding the last: exactly three rows carry a non-null
      `deployedAt`, and their timestamps are the three distinct success moments. Assert 3, not 1.
- [x] 6.3 `work-graph.test.ts` — redelivery: apply the identical success mutation twice;
      `deployedAt` is unmoved. Then a reconcile-shaped mutation (newest status `inactive`, later
      `sourceUpdatedAt`): `deployedAt` still unmoved.
- [x] 6.4 `work-graph.test.ts` — the stale-success path (§D2): a success at T1 arriving AFTER an
      `inactive` at T2 > T1 stamps `deployedAt = T1` while leaving `state = 'inactive'` and
      `updatedAt = T2`. And the converse: an `inactive`-only deployment never acquires a
      `deployedAt`.
- [x] 6.5 `work-graph.test.ts` — `sha` is written on insert, preserved when a later mutation omits
      it, and `mergeCommitSha` round-trips on `upsertPullRequest`.
- [x] 6.6 `apps/server/src/connectors/github/map.test.ts` — a `deployment_status` fixture that
      **includes a sha** maps to a mutation carrying it, and a `pull_request` merged fixture carries
      `mergeCommitSha`. Add the fields to the existing fixtures rather than adding new ones where
      the fixture already exists.
- [x] 6.7 `apps/server/src/connectors/github/reconcile.test.ts` — the mocked `listDeployments`
      response carries a sha and the emitted mutation carries it (the backfill leg of §D5), and a
      deployment whose newest status is `inactive` emits a mutation that the write path leaves
      `deployedAt`-preserving (assert at the mutation level here; the invariant itself is 6.1).
- [x] 6.8 **Both directions in one test.** `packages/schema/src/zero/delivery.test.ts` (or the
      existing delivery suite): `assembleLinkedEntities` over a merged PR whose `mergeCommitSha` a
      deployment carries yields a non-null `deployedAt`; the same PR against a deployment carrying a
      different sha yields null. Plus: a deployment with a matching sha but a null `deployedAt`
      yields null, and a same-sha deployment in a **different repo** does not match.
- [x] 6.9 `packages/schema/src/zero/filter.test.ts` — **deliberately replace**
      `filter.test.ts:125-126`'s "matches nothing even when a merged PR is linked" assertion. The
      new test filters `merged-not-deployed` over two merged issues, one deployed and one not, and
      asserts exactly the undeployed one. Keep the no-connector case as its own test (empty
      `LinkedEntities` still matches nothing) so the spec's "no data ⇒ matches nothing" scenario
      keeps a test. Say in the test name that the slot is now filled, not that the old assertion
      was wrong.
- [x] 6.10 `packages/ui` / `apps/web` component test — a row with a `deployedAt` renders the deploy
      glyph and names it in the strip's accessible label; a row without one renders neither, and the
      two rows report the same strip width.
- [x] 6.11 PROCESS §3's big-feature rule, judged honestly: this touches the synced schema, the
      connector write path, and the signature reality-strip UI — three of the four triggers, so the
      rule asks for all three tiers. State plainly in design.md that **the deployment signal is not
      reachable from e2e**: no work-graph row can be created without a configured GitHub App, and
      the suite has no work-graph seed (change 14's `auto-status.spec.ts` covers only its toggle for
      the same reason). The e2e leg is therefore what the browser can actually reach — the Delivery
      filter menu still lists `merged-not-deployed` and is still keyboard-operable — asserted by the
      shipped `issues.spec.ts` passing unchanged, plus a new keyboard assertion only if the existing
      spec does not already cover the Delivery menu.

## 7. Documentation

- [x] 7.1 `apps/docs/src/content/docs/features/delivery-signals.md` — the strip's fourth signal, and
      **Merged, not deployed** stops being reserved: what it now matches, the exact-commit rule, and
      the batched-deploy over-report stated in the filter's own description (spec: "the product
      SHALL state that limitation"). Correct lines 73-74, which say the edge is not modeled.
- [x] 7.2 `apps/docs/src/content/docs/self-hosting/github-connector.md` — the Deployments read
      permission now yields deploy history, not just current state; no new permission is requested;
      the reconcile sweep backfills the commit for deployments GitHub still lists and older rows
      stay unknown (§D5), so a sparse first week is expected rather than broken.
- [x] 7.3 `ROADMAP.md` — a row for this change, and correct Phase 2's "an issue↔deployment edge that
      is not modelled" (line 74): the edge exists now; what remains unmodelled is the incident
      entity that change failure rate and MTTR need, and deploy-driven status transitions remain
      out of scope for the reason change 14 gave.
- [x] 7.4 `DESIGN.md` §Reality strip (line 45) — the slot's contents, now four signals not three.
- [x] 7.5 Check `README.md`, `TECHSTACK.md`, `.env.example` and `reference/` for staleness —
      expected to be none (no dependency, no env var, no container, no new permission). Say so
      explicitly rather than skipping the check.
- [x] 7.6 `pnpm --filter @yapm/docs build` passes.

## 8. Verification

- [ ] 8.1 `pnpm turbo lint typecheck test build` and `node scripts/check-boundaries.mjs`.
- [ ] 8.2 The pg suites against the `yapm-dhe` stack from `down -v`: migrations and schema-drift, so
      `0023` is proven to apply on a fresh database and the hand-written Zero schema matches it.
- [ ] 8.3 The compose smoke test on the `yapm-dhe` project name and ports. Report the actual output.
- [x] 8.4 Record in `design.md` under `## Decisions made during implementation` what ran, what did
      not, what CI is the first place to execute, and every decision taken that these tasks did not
      anticipate.
