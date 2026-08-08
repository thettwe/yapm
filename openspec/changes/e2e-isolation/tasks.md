## 1. Read before writing anything

- [x] 1.1 Read `apps/web/e2e/support.ts` (ADMIN, `ensureAccount`, `stop`, `goToMore`, `signOut`), `apps/web/e2e/db.ts` (the direct-to-Postgres seeder), `apps/web/playwright.config.ts` (webServer env, `DATABASE_URL` requirement, `workers: 1`, `timeout: 60_000`, `retries` in CI)
- [x] 1.2 Read the two worst offenders in full — `apps/web/e2e/projects.spec.ts` (`:188`, `:246`) and `apps/web/e2e/connectors.spec.ts` (`:236`) — and `apps/web/e2e/reconnect.spec.ts:162` (`retryFromTheKeyboard`, the derived-bound pattern to copy) plus `auto-status.spec.ts`'s `tabTo`
- [x] 1.3 Read `packages/schema/src/zero/queries.ts` lines 89–121 and 212–240 (the five unbounded workspace-wide queries) and `packages/schema/src/db/seed.ts` (`seedWorkspace`, `bootstrapFirstAdmin` — the promote-only-when-`workspace_member`-is-empty rule and the required-email gate)
- [x] 1.4 Read `reference/zero.md` §"Failure modes" and §"Postgres objects zero-cache creates" **before** judging the `PushProcessor` replay messages or touching the database between tests. Zero 1.x is `defineQuery`/`defineMutator`/`handleMutateRequest`; the `PushProcessor` in the log is a log context inside `@rocicorp/zero/server`, not an API this repo calls
- [x] 1.5 Read `.github/workflows/ci.yml`'s `e2e` job (fresh volumes, `YAPM_HOST_PORT=3210`, `DATABASE_URL=…:5440/yapm`, `pnpm --filter @yapm/web e2e`) and the `## Decisions made during implementation` sections of the three most recent archived changes — `2026-08-08-app-frame` (the 166-vs-150 tab-stop failure), `2026-08-08-issue-list-daylight`, `2026-08-08-one-reality-vocabulary`

## 2. Diagnose before fixing — real numbers, written down

- [ ] 2.1 Bring the stack up the way CI does: `YAPM_HOST_PORT=3210 docker compose -f docker/docker-compose.dev.yml up -d --wait --wait-timeout 180 postgres zero-cache` with `DATABASE_URL=postgres://yapm:yapm@localhost:5440/yapm`. `YAPM_HOST_PORT` must match `E2E_SERVER_PORT`: zero-cache bakes `ZERO_QUERY_URL`/`ZERO_MUTATE_URL` from it at container-create time and calls back over `host.docker.internal`. Locally, port 3000 is held by an unrelated container; the harness's own default is `E2E_SERVER_PORT=3210`, so use that or 3200 — a local failure in `sync.spec.ts` waiting for `workspace-name` on port 3000 is an environment problem, not a product bug
- [ ] 2.2 Establish the baseline failure rate: run `projects.spec.ts` + `connectors.spec.ts` **at least 5 times** from an already-populated database (i.e. after a full suite run, not from empty) and record pass/fail per attempt with the actual output
- [ ] 2.3 Instrument fixture growth: record row counts for `workspace`, `team`, `workspace_member`, `user`, `invite`, `project`, `issue` at the start of every spec file of one full run, and per-spec-file duration alongside. Publish the table
- [ ] 2.4 Correlate: state whether duration tracks accumulated row count, with the numbers. **If the evidence contradicts the accumulation hypothesis, stop and follow the evidence** — the hypothesis is a starting point, not a conclusion
- [ ] 2.5 Rule on the `PushProcessor … already processed … Expected: N` messages: count them per run, split by spec file, comparing at least one passing and one failing run. Say benign or symptomatic, with the counts. `reconnect.spec.ts` deliberately provokes the resend paths, so separate its contribution
- [ ] 2.6 Falsify or confirm the context-error mechanism: in a timed-out trace, establish whether `Target.disposeBrowserContext: Failed to find context` fires *after* the test timeout (a consequence) or before it (a cause). Record which
- [ ] 2.7 Write everything from 2.2–2.6 into `openspec/changes/e2e-isolation/design.md` under `## Decisions made during implementation`

## 3. The reset (`apps/web/e2e/reset.ts`)

- [x] 3.1 `resetToBaseline(db)`: derive the table set from `information_schema.tables` for the application schema, subtract an explicit commented ignore set (Kysely migration bookkeeping, pg-boss's job tables, anything outside `public`), and delete the rest in FK-dependency order using ordinary `DELETE` — never `TRUNCATE` (design D3)
- [x] 3.2 Preserve exactly: the single `workspace` row, and the bootstrap admin's rows in `user`, `account` and `workspace_member` (targeted deletes, not table-level skips), so `admin@example.test` stays deterministically the workspace admin (design D1)
- [x] 3.3 `assertBaseline(db)`: assert every non-preserved table is empty and fail naming the offending table and its row count
- [x] 3.4 If preserving the admin's auth rows proves troublesome, fall back to deleting everything but `workspace` and letting `bootstrapFirstAdmin` re-promote on the next `/api/zero/token` — the required-email gate makes that deterministic. Record whichever was chosen, and why, in `design.md`

## 4. The fixture (`apps/web/e2e/fixtures.ts`)

- [x] 4.1 Export a `test` extending `@playwright/test` with an auto fixture that runs `resetToBaseline` then `assertBaseline` before each test (design D2), reusing one Kysely handle per worker rather than opening one per test
- [x] 4.2 Export a browser-context fixture that hands out fresh contexts and closes every one in its own teardown, once, on both the pass and the fail path (design D5)
- [x] 4.3 Audit all ~100 tests for cross-test dependence within a file. Name every case found. Where one is real, give the test its own fixture — never re-share state. If a file genuinely needs shared state, the opt-out is explicit and named in the file
- [ ] 4.4 Measure whether zero-cache needs a barrier after the bulk delete (design risk 1). If a client is observed rendering deleted rows, add a polled post-reset invariant — never a fixed sleep. Record the answer

## 5. Migrate the 21 spec files

- [x] 5.1 Every spec imports `test` from `./fixtures` instead of `@playwright/test` (`expect` may still come from `@playwright/test`)
- [x] 5.2 Replace all 17 `browser.newContext()` sites with the fixture: `board:380`, `attachments:127`, `notifications:83`, `issues:340`, `triage:215`, `sync:64,65`, `projects:212,249,250`, `retro:473`, `search:340`, `sso:180`, `auto-status:129`, `mentions:81`, `retro-ai:571,572`, `theme:35,59`, `auth:66,90,109`, `pm-digest:345,632`, `connectors:310`. No `finally { await context.close() }` survives
- [x] 5.3 Delete the comments that documented the accumulation as a fact of life once it is no longer one — `projects.spec.ts:116–119` ("the roadmap also holds rows from earlier runs"), `reconnect.spec.ts:153–161`, `support.ts:43–45` — replacing each with what is now true. Keep `reconnect.spec.ts`'s derived walk; only its rationale changes
- [x] 5.4 Verify the specs that were written *around* accumulation still assert the same thing on a clean workspace: `projects.spec.ts:111` (roadmap roving index needs ≥2 rows — it creates both itself), `auth.spec.ts` (the non-member cases), `sso.spec.ts` (the deliberately-unverified provider)

## 6. No hidden caps on determinism

- [x] 6.1 Sweep for constants encoding fixture size or machine speed: literal loop bounds, tab budgets, index-based row assertions. Derive each from the page and make the failure message state the derived bound (the `reconnect.spec.ts:162` pattern)
- [x] 6.2 Replace `getByTestId('invite-link').first()` at all six sites (`auth:58`, `attachments:116`, `connectors:303`, `notifications:68`, `auto-status:122`, `mentions:65`, `projects:205`) with a selection the test itself knows. It is currently correct only because `invites.all` orders `createdAt desc` — a selector that is right by accident is still wrong
- [x] 6.3 Audit every `.nth(i)` over a list other specs can append to (`notifications:311,312`, `retro-ai:443,447,448,449`) and confirm the list is test-local after isolation, or make the selection explicit
- [ ] 6.4 Do **not** raise timeouts as a class. After the reset lands, re-measure; raise only where the evidence shows the wait was genuinely under-provisioned and write that evidence beside the number
- [x] 6.5 Confirm no assertion was weakened, skipped, `fixme`-d, newly `slow`-ed or deleted: `git diff main -- apps/web/e2e | grep -E '^\-.*(expect|test\()'` reviewed line by line, and the coverage delta reported explicitly (expected: none)

## 7. Tests

- [ ] 7.1 `apps/web/e2e/zz-isolation.spec.ts` — the falsifiable check. Runs last (Playwright orders files lexicographically) and asserts the workspace it inherits from the whole preceding run holds zero teams, invites, projects and issues. **It must fail against today's `main`** (where it sees ~45 teams) and pass with this change. Verify both directions, not just the passing one — **half done:** it passes here (both CI runs, D16/D17). The failing direction has **no artefact**, and the cherry-pick the task describes cannot produce one: the spec imports `test` from `./fixtures`, which exists only on this branch. The runnable falsification is named in D19
- [ ] 7.2 Prove the fix by measurement, not by one green run: run the affected specs **at least 5 times** and the full suite **at least twice** after the change, and report the pass rate before and after with real output — **partially done (D17):** the full suite ran twice in CI (2 failed/90 passed, then 1 failed/92 passed) against two `main` runs the same day (both failed). First-attempt pass rate is **0/2 before, 0/2 after**. The ≥5 repeats of the affected specs are still owed, and the verdict so far is that isolation did not deliver determinism
- [x] 7.3 Report the runtime delta against the ~21-minute baseline. The prediction is that it gets faster; if it is materially slower, say by how much and why the trade is worth it — **22.4m on `main` → 18.2m here, 19% faster** (D17)
- [x] 7.4 Confirm the `Target.disposeBrowserContext` error no longer appears in any run, and state whether that is because the timeouts stopped or because the lifecycle changed (2.6 decides which) — **neither: it appears 0 times on `main` too** (D18). The change cannot claim credit for removing it

## 8. Documentation

- [x] 8.1 `apps/web/e2e/README.md` (new): the isolation contract in the terms the next person writing a spec needs — every test starts from the bootstrapped baseline; import `test` from `./fixtures`; never create a context by hand; never encode fixture size or machine speed as a constant; `workers: 1` is still required and why; how to run locally (the port-3000 trap, `E2E_SERVER_PORT`, the compose commands CI uses)
- [x] 8.2 `PROCESS.md` §3: the E2E tier bullet gains the isolation contract and points at the new README
- [x] 8.3 Sweep every root doc this makes stale per PROCESS.md §2 — `README.md`, `ROADMAP.md`, `TECHSTACK.md`, `CLAUDE.md` (its Verification section), `CONTRIBUTING.md` (its Development section, where a contributor looks before writing a spec), `.env.example` (expected: unchanged; confirm rather than assume). No docs-site page: `apps/docs` serves evaluators, self-hosters and users and has no contributor section
- [x] 8.4 Record every judgement call taken during the build in `design.md` under `## Decisions made during implementation`, including the answers to the three Open Questions

## 9. Gates

- [x] 9.1 `pnpm turbo lint typecheck test build` — green in CI's `Lint, typecheck, test, build` job on both pushes; locally `typecheck`, `lint` (670 files) and affected `test` (589) are green and the full `build` was left to CI
- [x] 9.2 The compose smoke test — green in CI on `73bc8a0`
- [ ] 9.3 The full Playwright suite, run more than once (7.2), with the output quoted honestly — including any failure. **Run twice; both runs red.** Quoted in D16 and D17. Left unticked because the suite is not green, not because it was not run
- [x] 9.4 `node scripts/check-boundaries.mjs` (the harness must not make `packages/schema` import an app)
- [ ] 9.5 `npx -y @fission-ai/openspec@latest validate e2e-isolation` clean (**done — "Change 'e2e-isolation' is valid"**), and every scenario in `specs/ci-pipeline/spec.md` verified true (**not yet: the scenarios about a red gate on a broken restore have not been provoked**)
