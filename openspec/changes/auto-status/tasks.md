Sequenced so the app runs after every task, and so nothing in a later group is depended on by an
earlier one: the pure decision ladder (1) is written before anything calls it; the schema surface (2)
before the mutators that stamp it (3); the mutators before the ingest wiring that invokes them (4);
the shared mutator and column before the client surface that reads and writes them (6); and the
falsifiable check (5) before the UI, so the behaviour is proven before it is exposed.

## 1. The pure decision ladder, consumer-free

- [x] 1.1 Add `SYSTEM_ACTOR_ID` and `SYSTEM_AUTH_CONTEXT` to `packages/schema/src/zero/context.ts`
      (`{ userID: 'system', role: 'admin' }`), with a comment stating the two rules that bound it: it
      is reachable only from server-side call sites driven by instance-produced data, and it is never
      derived from a request. Export both from `@yapm/schema`.
- [x] 1.2 Point `apps/server/src/jobs/cycles.ts` at the shared constant and delete its local
      `SYSTEM_CTX` (`cycles.ts:19`). The value is identical; the point is one definition. Confirm the
      cycle job's existing tests still pass unchanged.
- [x] 1.3 Create `packages/schema/src/zero/auto-status.ts` with `AUTO_STATUS_RANK`
      (`backlog 0, todo 1, in_progress 2, in_review 3, done 4`; `canceled` absent by construction, not
      by a branch) and `AUTO_STATUS_MAX_LINKED_ISSUES = 25`.
- [x] 1.4 Implement `decideAutoStatus(input): IssueStatus | null` in that file, exactly the eight
      ordered guards in design.md §D6. Pure, synchronous, no ZQL, no imports beyond `context.js`
      types. The target map is `merged → done`, `open → in_review`, everything else `null`.
- [x] 1.5 Export the module from `packages/schema/src/index.ts`. Run
      `node scripts/check-boundaries.mjs` — nothing new may cross a package boundary.
- [x] 1.6 **Test (unit, no DB)** `packages/schema/src/zero/auto-status.test.ts`: a table driving every
      guard to `null` one at a time (off; event before `autoStatusSince`; no state edge; needs_triage;
      canceled; human newer than the event) and every transition that must fire (`todo → in_review` on
      open, `in_progress → done` on merge, `backlog → done` on merge). Plus: `draft` and `closed`
      produce `null`; a target at or below the current rung produces `null` (`done` + open PR stays
      `done`, `in_review` + open PR is a no-op); a human stamp **older** than the event does not
      block; a `null` human stamp does not block.

## 2. Migration `0016_auto_status` and the schema surface

- [x] 2.1 Write `packages/schema/src/migrations/0016_auto_status.ts`: add
      `team.auto_status_since timestamptz null` and `issue.last_human_status_at timestamptz null`,
      then one `UPDATE issue SET last_human_status_at = updated_at`. No index, no constraint, no
      extension. `down()` drops both columns. Register it in `migrations/index.ts`.
- [x] 2.2 Add both columns to the hand-written Kysely `DB` interface in
      `packages/schema/src/db/types.ts` (nullable `Timestamp`, not `Generated`).
- [x] 2.3 Add both to the Zero schema in `packages/schema/src/zero/schema.ts` as
      `number().from('auto_status_since').optional()` and
      `number().from('last_human_status_at').optional()`.
- [x] 2.4 **Test (integration)** extend `packages/schema/src/db/schema-drift.test.ts` so both columns
      are asserted present in Postgres **and** in the Zero schema.
- [x] 2.5 **Verify on the live stack before building on it** (the `search` I1 precedent): bring up
      `POSTGRES_HOST_PORT=5446 ZERO_CACHE_HOST_PORT=4854 YAPM_HOST_PORT=3006 docker compose -p yapm-as
      -f docker/docker-compose.dev.yml` from `down -v`, apply the migration against a **live**
      zero-cache, then delete the replica volume and restart to exercise the fresh-install path.
      Record in design.md §Decisions what the write-worker actually applied. Two nullable
      `timestamptz` columns on existing replicated tables should be a non-event — confirm it rather
      than assume it.

## 3. Human-intent stamping in the shared mutators

- [x] 3.1 In `packages/schema/src/zero/mutators.ts`, add a small shared helper that returns the
      `lastHumanStatusAt` patch for a given `ctx` and `updatedAt` — the stamp when
      `ctx.userID !== SYSTEM_ACTOR_ID`, nothing otherwise. Pure function of args and ctx, so the
      optimistic and authoritative passes agree and rebase is safe.
- [x] 3.2 Apply it in the four mutators that write `issue.status`: `createIssue`, `setIssueStatus`,
      `moveIssue`, and `routeIssue` (only when `routeIssue` is actually given a status).
- [x] 3.3 Add `team.setAutoStatus` to `mutators.ts`: args `{ id, since: timestamp | null, updatedAt }`,
      gated by `canManage` before the team is loaded, writing `auto_status_since`. The instant comes
      from args (the call site), never from inside the mutator body. Register it in the `team` group
      of the `mutators` map.
- [x] 3.4 Classify `team.setAutoStatus` in `packages/schema/src/zero/ai-tools.ts` —
      `MUTATOR_TOOL_KINDS` (`write`) and the args map. The registry is exhaustive by construction and
      its test fails until this is done.
- [x] 3.5 **Test (unit)** in `packages/schema/src/zero/mutators.issue.test.ts`: a status write under a
      member ctx stamps `lastHumanStatusAt`, and the same write under `SYSTEM_AUTH_CONTEXT` leaves it
      untouched. In `packages/schema/src/zero/mutators.test.ts` (where the team mutators are already
      tested): `team.setAutoStatus` is rejected for a member and for a viewer before any existence
      check, accepted for an admin, and disabling writes `null`.
- [x] 3.6 **Test (unit)** a guard test that enumerates the shared mutator set, selects every mutator
      whose body writes `issue.status`, and asserts each stamps the column for a human ctx and not for
      the system principal — so a fifth status-writing mutator added later fails here rather than
      silently opening the hole.

## 4. The transition, behind the `WorkGraphMutation` union

- [x] 4.1 Implement `applyAutoStatusForPullRequest(tx, ctx, input)` in `auto-status.ts`: read the
      team's `auto_status_since`, read up to `AUTO_STATUS_MAX_LINKED_ISSUES` `issue_link` rows for the
      pull request, load each linked issue's `status`, `needsTriage` and `lastHumanStatusAt`, call
      `decideAutoStatus`, and for each non-null target invoke
      `mutators.issue.setStatus.fn({ tx, args: { id, status, updatedAt: now }, ctx: SYSTEM_AUTH_CONTEXT })`.
      No raw `tx.mutate.issue.update`, no Kysely.
- [x] 4.2 Call it from both non-stale branches of `applyWorkGraphMutation`'s `upsertPullRequest` case
      in `work-graph.ts` — after `linkIssues`, passing the **effective** state actually written
      (`merged` when pinned terminal) and the previous state (`null` on insert). The stale branch
      (`mutation.updatedAt < existing.updatedAt`) keeps linking and keeps returning without
      considering status.
- [x] 4.3 Confirm `apps/server/src/connectors/github/` is untouched by this change — a `git diff
      --stat` over that directory must be empty. That absence is the firewall property, not a
      convention.
- [x] 4.4 **Test (unit)** `packages/schema/src/zero/work-graph.test.ts` additions using the existing
      fake transaction: the open edge and the merge edge each write once; a redelivery of the same
      mutation writes nothing; an activity bump on an already-merged PR writes nothing; a stale
      out-of-order mutation links but writes no status.

## 5. The falsifiable check, against live Postgres

- [x] 5.1 **Test (integration)** `packages/schema/src/zero/auto-status.pg.test.ts`, the scenario named
      in design.md §"How we will know this worked": two teams (T1 opted in an hour ago, T2 `NULL`),
      one `todo` issue each, the same two `upsertPullRequest` mutations driven through the real
      `applyWorkGraphMutations` path. Assert T1 goes `in_review` then `done`; T2 stays `todo` **and**
      `computeDivergence` returns `status_behind_merge`; a verbatim replay of the merged mutation is
      inert; and a member's post-merge move to `in_progress` survives a later merged-PR delivery, with
      divergence firing. Self-gated by `describe.skipIf(DATABASE_URL === undefined)`.
- [x] 5.2 **Test (integration)** the epoch guard on its own: a merged pull request whose `updatedAt`
      precedes `auto_status_since` drives nothing, which is the first-install-backfill safety property.
- [x] 5.3 **Test (integration)** an untriaged issue and a canceled issue are each left alone by a
      merged pull request, and the untriaged one stays in the triage inbox query.
- [x] 5.4 Run 5.1–5.3 against the `yapm-as` stack and record the actual output. If any assertion
      passes against `main`, the check is not falsifiable and must be strengthened before proceeding.

## 6. The admin surface

- [x] 6.1 Add a **Status automation** section to `apps/web/src/settings/connectors-view.tsx`: one row
      per non-archived team, each showing the team name, its current state, and an Enable/Disable
      control built from the existing tokenized `Button` in the same shape as the connector's own
      toggle. Teams come from the already-synced Zero query; the write is
      `team.setAutoStatus` with the instant minted at this call site.
- [x] 6.2 Write the section's copy: the two transitions; never backward, never Canceled, never
      untriaged; and enabling does not change existing issues. Three sentences at the point of
      decision, not only in the docs.
- [x] 6.3 Confirm the section is invisible and unreachable for a non-admin, riding the page's existing
      admin gate rather than adding a second one.
- [x] 6.4 **Test (unit)** a component test for the section: renders each team's state, invokes the
      mutator with `null` when disabling and a timestamp when enabling, and renders nothing for a
      non-admin.
- [x] 6.5 **Test (E2E)** `apps/web/e2e/auto-status.spec.ts` against the 3-container stack: as an
      admin, reach the control with Tab only, activate with Enter, reload, and assert it still reads
      enabled (the value round-tripped through Postgres and back down the sync socket). Assert a
      member session cannot reach the control.
- [x] 6.6 Verify the section in all three presets in light and dark: every color and font from a
      token, AA contrast, visible focus ring, and the state change announced.

## 7. Documentation

- [x] 7.1 New `apps/docs/src/content/docs/features/auto-status.md`: what fires and what never fires,
      the guard ladder in plain language, how to turn it on, the since-epoch guarantee, the honest
      caveat that a stale magic word in a branch name can move the wrong issue, and how it relates to
      the divergence flag.
- [x] 7.2 Add the sidebar entry to `apps/docs/astro.config.mjs` under Features.
- [x] 7.3 Update `apps/docs/src/content/docs/features/delivery-signals.md`: divergence is now
      explicitly what happens when automation is off or blocked, and goes quiet by construction when
      a transition fires.
- [x] 7.4 Update `apps/docs/src/content/docs/self-hosting/github-connector.md`: a pointer to the
      per-team toggle, the statement that no App scope changes, and that nothing is written back to
      GitHub.
- [x] 7.5 **`ROADMAP.md`, all four contradictions**: amend the wedge line (10) to describe what yapm
      actually does — PR state drives issue status **for teams that opt in**; correct row 8's false
      "PR linking + auto-status" claim to linking only; remove "automatic status transitions" from the
      Post-v1 Phase 2 entry (60), leaving CI/deploy ingestion and the DORA views; and add row 14 for
      this change plus a sentence in the "Where v1 actually stands" paragraph.
- [x] 7.6 **`VISION.md`** Phase 2 (87): reconcile it with ROADMAP — the opt-in half of "automatic
      status transitions" ships in Phase 1, so Phase 2 keeps CI/deploy ingestion and the metric views.
- [x] 7.7 `README.md` "What works today": the opt-in automation, in one clause, beside the divergence
      flag it now completes.
- [x] 7.8 `TECHSTACK.md` connector-framework row (34): name status automation as the second thing a
      new connector inherits from the union, so the firewall claim stays concrete.
- [x] 7.9 Assert `.env.example` and the Zod config schema are unchanged by this change. A feature that
      grew a config knob has broken the "one nullable column" promise; the check is mechanical.
- [x] 7.10 `pnpm --filter @yapm/docs build` passes.

## 8. Verification

- [x] 8.1 `pnpm turbo lint typecheck test build` clean, with the actual output recorded.
- [x] 8.2 Integration and E2E suites run against the `yapm-as` compose stack
      (`POSTGRES_HOST_PORT=5446 ZERO_CACHE_HOST_PORT=4854 YAPM_HOST_PORT=3006`,
      `docker compose -p yapm-as`), including the compose smoke test.
- [x] 8.3 Walk every scenario in `openspec/changes/auto-status/specs/**` and confirm each is true of
      the built system, naming the test or the observation that establishes it.
- [x] 8.4 Confirm no prior change regressed: divergence behaviour for an automation-off team is
      byte-identical, the cycle-rollover job still passes with the shared principal, and the
      `ai-tools` exhaustiveness test is green.
