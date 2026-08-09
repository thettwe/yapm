## 1. Own the harness before measuring anything

- [ ] 1.1 Confirm Node 24 (`.node-version`) is the interpreter for every command in this change, and
      record the exact version used beside every number produced.
- [ ] 1.2 Confirm nothing else on the machine holds ports 3210 or 5174 and that no other worktree is
      running against the dev Postgres — `reuseExistingServer: !process.env.CI` silently adopts a
      foreign server and produces `Invalid origin` failures that look like product bugs (design D8).
- [ ] 1.3 Bring the stack up in an order the sync layer survives: `YAPM_HOST_PORT=3210 docker compose
      -f docker/docker-compose.dev.yml up -d --wait postgres`, boot the server once so migrations
      run, then bring up `zero-cache`. Verify `zero-cache` reports the application tables replicated
      before running a test (design D3).

## 2. Measure the baseline on unmodified main

- [ ] 2.1 Run `projects.spec.ts`, `pm-digest.spec.ts` and `retro.spec.ts` **five times each** on the
      current branch point, capturing the full harness log each time.
- [ ] 2.2 Build the baseline table: per test, pass/fail, duration, and counts of `reloading in`,
      `Zero reloaded the page.`, `SchemaVersionNotSupported`, `ClientNotFound` in the forwarded
      browser console.
- [ ] 2.3 Count `Ignoring mutation … already processed` per spec file, split across a passing run and
      a failing run, and correlate with the reload counts from 2.2.
- [ ] 2.4 Run each of those three spec files **alone** against a freshly bootstrapped database and
      record which tests cannot stand up without a sibling's fixtures (design D6).
- [ ] 2.5 Open the Playwright trace of one failing two-client test and account for where the sixty
      seconds went, action by action.
- [ ] 2.6 Determine from the logs whether `Target.disposeBrowserContext` occurs at all and, if it
      does, whether it precedes or follows the timeout. Record "does not occur" if that is the
      answer.
- [ ] 2.7 Pull the last three CI e2e job logs and count `SchemaVersionNotSupported` in their opening
      minutes, to rule the fresh-volume ordering race (design D3) in or out.
- [ ] 2.8 Write the measured baseline and the ruling on each Open Question into design.md under
      `## Decisions made during implementation`, before changing any code.

## 3. The product's own sync-recovery policy

- [ ] 3.1 Read the real `UpdateNeededReason` union and both handler signatures from
      `@rocicorp/zero`'s `.d.ts` in `node_modules`; record the shapes in `reference/zero.md`.
- [ ] 3.2 Pass `onClientStateNotFound` from `ZeroRoot` so an unknown client recovers through
      `SyncRecovery` instead of the library's `location.reload()`.
- [ ] 3.3 Pass `onUpdateNeeded` from `ZeroRoot` so a version mismatch surfaces to the user rather
      than reloading the page under them, and never while a write is in flight.
- [ ] 3.4 Make sure the recovery status the indicator renders distinguishes these conditions from an
      ordinary outage, using only theme tokens, correct in all three presets light and dark, and
      keyboard-operable — the existing statusline indicator contract.

## 4. The multi-client lifecycle

- [ ] 4.1 Add `apps/web/e2e/fixtures.ts` with a `newContext` fixture whose teardown Playwright owns
      (carried from PR #41, with credit), and an unrequested-reload watcher that fails the test
      naming the reload and its reason.
- [ ] 4.2 Migrate all 17 `browser.newContext()` sites across the 11 spec files onto the fixture and
      delete their `finally` blocks.
- [ ] 4.3 Add a repository gate that fails when a spec body calls `browser.newContext()` directly.
- [ ] 4.4 Make each affected spec file self-contained per 2.4's findings: build the fixtures it needs
      rather than inheriting a sibling's.
- [ ] 4.5 Apply the budget decision from 2.2's distribution: raise a two-client test's budget only
      where successful runs measurably crowd it, and record the distribution beside the constant.
      Audit the inherited `test.slow()` in `pm-digest.spec.ts` against the same bar.
- [ ] 4.6 Carry `zz-isolation.spec.ts` over from PR #41, adapted to the isolation model this change
      ends with, so the last spec asserts what the browser sees and not only what Postgres holds.
- [ ] 4.7 If 2.7 shows the ordering race is real, fix the e2e job's stack startup in
      `.github/workflows/ci.yml` so the sync cache never snapshots a schema-less database.

## 5. Tests

- [ ] 5.1 Unit-test in `apps/web/src/zero/provider.test.tsx` that `ZeroRoot` supplies both handlers,
      so the library's reload path cannot be reached — the falsifiable check for section 3.
- [ ] 5.2 Unit-test that `onClientStateNotFound` routes into the recovery path and that
      `onUpdateNeeded` does not reload while a write is in flight.
- [ ] 5.3 Test the unrequested-reload watcher both ways: it fails a test whose page reloads itself,
      and it stays quiet when the test navigates or reloads deliberately.
- [ ] 5.4 Test the `newContext` gate both ways: red on a direct `browser.newContext()` in a spec
      body, green on the fixture.
- [ ] 5.5 Run each affected spec file alone, green, on a freshly bootstrapped database.

## 6. Prove it

- [ ] 6.1 Re-run the same five-times measurement from section 2 on this branch and publish the
      before/after table with real output quoted.
- [ ] 6.2 State the coverage delta explicitly: the assertion multiset before and after, and the
      reason for any difference.
- [ ] 6.3 Run the full Playwright suite **more than once** and report every run's result, not the
      best one.
- [ ] 6.4 Run `pnpm turbo lint typecheck test build` and the compose smoke test, quoting the output.

## 7. Documentation

- [ ] 7.1 Write `apps/web/e2e/README.md`: the multi-client lifecycle contract, the rule that a spec
      passes alone, how to raise a budget and what evidence it takes, and the local procedure for a
      trustworthy run (ports, one run per machine, stack startup order).
- [ ] 7.2 Update `PROCESS.md` §3 so the E2E tier states the lifecycle contract.
- [ ] 7.3 Update `reference/zero.md` with the reload-on-error default and the two options that
      override it — a post-cutoff API fact this repo does not record and that this change exists
      because nobody knew.
- [ ] 7.4 Update the operator-facing sync-recovery docs-site page if the client's reload policy
      changes what an operator sees during an upgrade; state plainly if it does not.
- [ ] 7.5 Sweep the root docs for anything this change makes stale (README, TECHSTACK, CLAUDE.md's
      verification note) and record `none` where nothing changed.
