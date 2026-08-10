## 1. Own the harness before measuring anything

- [x] 1.1 Confirm Node 24 (`.node-version`) is the interpreter for every command, and record the
      exact version beside every number produced. *(Node 24.19.0, installed keg-only — the machine's
      default is v26.0.0 and no version manager is present. See design DI-1.)*
- [x] 1.2 Confirm nothing else holds the harness ports and that no other worktree is running against
      the dev Postgres. *(Solved structurally instead: a separate `-p yapm-e2e` compose project on
      ports 5445 / 4855 / 3210 / 5174, so the running `yapm-dev` stack can neither be adopted by
      `reuseExistingServer` nor be torn down. See design DI-2.)*
- [x] 1.3 Bring the stack up in an order the sync layer survives, and verify `zero-cache` reports the
      application tables replicated before running a test. *(postgres → server boot, 51 tables through
      `0023_deploy_history` → zero-cache → slot `zero_0_a` active, `issue`/`team`/`cycle`/`project`/
      `notification` replicated.)*

## 2. Measure the baseline on unmodified main

- [x] 2.1 Run `projects.spec.ts`, `pm-digest.spec.ts` and `retro.spec.ts` five times each.
      *(A first attempt was contaminated by two concurrent runners and discarded; see design.)*
- [x] 2.2 Build the baseline table: per test, pass/fail, duration, and the reload marker counts.
      *(design.md § "The measured baseline". projects 0/5, pm-digest 3/5, retro 5/5.)*
- [x] 2.3 Count `Ignoring mutation … already processed` per spec file across passing and failing runs.
      *(Zero, in both.)*
- [x] 2.4 Run each spec file alone against a freshly bootstrapped database and record which tests
      cannot stand up without a sibling's fixtures. *(All three were run file-alone throughout; no
      test required a sibling's fixtures. Re-asserted mechanically by task 5.5.)*
- [x] 2.5 Open the trace of one failing two-client test and account for the sixty seconds action by
      action. *(108 actions, 104 under 400ms, one unfinished `click` on the `Projects` menuitem.)*
- [x] 2.6 Determine whether `Target.disposeBrowserContext` occurs at all. *(It does not occur —
      neither locally nor in the last three CI e2e jobs.)*
- [x] 2.7 Pull the last three CI e2e job logs and count `SchemaVersionNotSupported`. *(0, 0, 0 —
      the ordering race is ruled out and the CI startup fix is not taken. The PROCESS.md §3 vs
      `ci.yml` contradiction is real but is a documentation defect; task 7.2 fixes it.)*
- [x] 2.8 Write the measured baseline and the ruling on each Open Question into design.md before
      changing any code.

## 3. Report the failure where it happens

- [x] 3.1 Set `actionTimeout` and `navigationTimeout` in `playwright.config.ts` with the reasoning
      recorded beside them (design D1).
- [x] 3.2 Make `goToMore` assert the transient opened before clicking into it, retrying the opener
      until an item is in the DOM (design D2).
- [ ] 3.3 Audit `support.ts` for the same shape elsewhere — any helper that clicks a transient and
      then clicks inside it without asserting it opened. `signOut` is the known second case.
- [x] 3.4 Prove 3.1 and 3.2 against the pre-fix commit: run the reproduction at the parent commit and
      record the failure output beside the fixed output. *(The three-run control on unmodified main:
      2/2/2 failures, all the 60s two-client class; the branch: those tests 0/9 across every
      subsequent full run. Design DI-5/DI-6.)*

## 4. The product's own sync-recovery policy

- [ ] 4.1 Read the real `UpdateNeededReason` union and both handler signatures from `@rocicorp/zero`'s
      `.d.ts` in `node_modules`; record the shapes in `reference/zero.md`.
- [ ] 4.2 Pass `onClientStateNotFound` from `ZeroRoot` so an unknown client recovers through
      `SyncRecovery` instead of the library's `location.reload()`.
- [ ] 4.3 Pass `onUpdateNeeded` from `ZeroRoot` so a version mismatch surfaces to the user rather than
      reloading the page under them, and never while a write is in flight.
- [ ] 4.4 Make sure the recovery status the indicator renders distinguishes these conditions from an
      ordinary outage, using only theme tokens, correct in all three presets light and dark, and
      keyboard-operable.
- [ ] 4.5 State in the same paragraph, wherever this is documented, that this closes a real gap and is
      **not** the cause of the failure this change fixes (design D4).

## 5. The multi-client lifecycle

- [ ] 5.1 Add `apps/web/e2e/fixtures.ts` with a `newContext` fixture whose teardown Playwright owns
      (carried from PR #41, with credit), and an unrequested-reload watcher that fails the test naming
      the reload and its reason (design D3).
- [ ] 5.2 Migrate all 17 `browser.newContext()` sites across the 11 spec files onto the fixture and
      delete their `finally` blocks.
- [ ] 5.3 Add a repository gate in `scripts/lib/boundaries.mjs` that fails when a spec body calls
      `browser.newContext()` directly.
- [ ] 5.4 Make each affected spec file self-contained: build the fixtures it needs rather than
      inheriting a sibling's.
- [ ] 5.5 Run each affected spec file alone, green, on a freshly bootstrapped database.
- [ ] 5.6 Carry `zz-isolation.spec.ts` over from PR #41, adapted to the isolation model this change
      ends with.
- [ ] 5.7 Audit the inherited `test.slow()` in `pm-digest.spec.ts`: with the hang gone, establish
      whether it is still earned and remove it if it is not. Record the distribution either way.

## 5b. Accumulation — the second defect (design DI-3)

- [x] 5b.1 Establish that a second defect exists and is not the transient: with each spec file green
      run alone, the full suite still fails and **degrades** run over run — 3 → 5 → 6 failures,
      spreading into `auth.spec.ts:37`, `auto-status.spec.ts:152` and `board.spec.ts:330`.
- [x] 5b.2 Measure the accumulated state behind it: one workspace holding **533 teams**, 687 issues,
      446 cycles, 112 users, 131 projects.
- [x] 5b.3 Separate the two: run the full suite on a **fresh database per run**, which is what
      `ci.yml` already does with fresh volumes, and publish the result beside the persistent-database
      numbers. *(Done — and the forensic audit (DI-6) then showed the cross-run degradation was this
      protocol's own reused-database artifact; the within-run "moving population" was RC3, real
      latent product defects, fixed in section 5c. Final: three fresh-DB runs, 95/95 each.)*
- [ ] 5b.4 Carry PR #41's per-test isolation over, with credit and with its diagnosis restored — it
      was right work credited to the wrong defect (design DI-3).
- [x] 5b.5 Establish what each still-failing test actually needs. *(Answered by the forensic
      classification (DI-6): the 533-team failures were reused-database artifacts of this measurement
      protocol, not CI-reachable states; every fresh-DB failure was RC3 (deferred server-ack
      side-effects) or a test bug, each fixed at its mechanism in section 5c. Nothing was loosened.)*
- [ ] 5b.6 Assert the invariant mechanically: a test that leaves the workspace materially larger than
      it found it should be visible, not discovered three changes later.

## 6. Freeze the dep optimizer for the e2e run — SUPERSEDED by the one-origin harness

- [x] 6.1 Reproduce the duplication deliberately. *(Done during the isolation runs: three
      `?v=` hashes in one run, `Invalid hook call` in `<MenuRoot>`.)*
- [x] 6.2 / 6.3 The optimizer is not frozen — it is **absent**: the suite now serves the built
      bundle from the app server itself (`mountSpa`, one origin, `reuseExistingServer: false`),
      which is the production shape. `?v=` hash count in a run: 0. The dev loop is untouched.

## 7. Tests

- [ ] 7.1 Unit-test in `apps/web/src/zero/provider.test.tsx` that `ZeroRoot` supplies both handlers,
      so the library's reload path cannot be reached.
- [ ] 7.2 Unit-test that `onClientStateNotFound` routes into the recovery path and that
      `onUpdateNeeded` does not reload while a write is in flight.
- [ ] 7.3 Test the unrequested-reload watcher both ways: it fails a test whose page reloads itself,
      and it stays quiet when the test navigates or reloads deliberately.
- [ ] 7.4 Test the `newContext` gate both ways: red on a direct `browser.newContext()` in a spec body,
      green on the fixture.
- [ ] 7.5 Test `goToMore` both ways: green when the transient opens, and failing at the menu — naming
      it — when it cannot, rather than at teardown.

## 8. Prove it

- [x] 8.1 First proof of the diagnosis: `projects.spec.ts` 0/5 → 3/3 passing, runtime 1.4–2.4 min →
      ~34s, from D1 and D2 alone.
- [x] 8.2 Re-run the measurement on this branch and publish the before/after table. *(Design
      DI-5/DI-6: control 2/2/2 vs final branch 0/0/0, with the intermediate states and the
      retracted comparisons recorded.)*
- [ ] 8.3 State the coverage delta explicitly: the assertion multiset before and after, and the reason
      for any difference.
- [x] 8.4 Run the full Playwright suite **more than once** and report every run's result, not the
      best one. *(Three consecutive fresh-database runs: **95 passed / 0 failed** at 7.1m each —
      against the unmodified-main control's 2 failures at 10.9–11.7m every run.)*
- [ ] 8.5 Run `pnpm turbo lint typecheck test build` and the compose smoke test, quoting the output.

## 9. Documentation

- [ ] 9.1 Write `apps/web/e2e/README.md`: the multi-client lifecycle contract, the rule that a spec
      passes alone, the rule that a transient is asserted open before it is clicked into, how to raise
      a budget and what evidence it takes, and the local procedure for a trustworthy run.
- [ ] 9.2 Update `PROCESS.md` §3 so the E2E tier states the lifecycle contract, and reconcile it with
      `ci.yml`'s actual startup order — one of the two is wrong and 2.7 says which.
- [ ] 9.3 Update `reference/zero.md` with the reload-on-error default and the two options that
      override it — a post-cutoff API fact this repo does not record and that two changes were scoped
      without.
- [ ] 9.4 Update the operator-facing sync-recovery docs-site page if the client's reload policy
      changes what an operator sees during an upgrade; state plainly if it does not.
- [ ] 9.5 Sweep the root docs for anything this change makes stale, and record `none` where nothing
      changed.
- [ ] 9.6 Add the ROADMAP row for this change and mark `e2e-multi-context` (row 43) superseded.

## 10. Close out the superseded change

- [ ] 10.1 Archive `e2e-multi-context` as superseded, keeping its proposal and design as the record of
      a falsified hypothesis, with a pointer to this change.
- [ ] 10.2 Close PR #41 with a note crediting the fixture and `zz-isolation.spec.ts` carried from it.
