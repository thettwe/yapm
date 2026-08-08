# The end-to-end suite

Playwright, against the real stack: Postgres, zero-cache, the yapm server and a Vite dev server.
This is the only tier that can prove a keyboard flow, a two-client sync convergence or a
reconnection, so it is also the tier with the most ways to lie. The rules below exist so a red
result means the product broke, not that the harness drifted.

## The isolation contract

**Every test starts from the state the server leaves behind at boot: one `workspace` row and
nothing else.** No team, invite, project, issue, cycle, retro, notification or account created by
one test is visible to another, whichever tests ran before it and in whatever order.

That is enforced, not requested. `fixtures.ts` runs an automatic per-test fixture that calls
`resetToBaseline` and then `assertBaseline` from `reset.ts` before the test body runs, and
`zz-isolation.spec.ts` — which Playwright orders last, because spec files run lexicographically —
signs in and asserts the workspace it inherits from the entire preceding run is empty.

Four rules follow from it:

1. **Import `test` from `./fixtures`, never from `@playwright/test`.** `expect` and the types still
   come from `@playwright/test`. A spec that imports `test` from the package gets no reset, sees the
   previous test's rows, and quietly reintroduces the accumulation this contract exists to remove.
2. **Never call `browser.newContext()`.** Take the `newContext` fixture instead. It hands out fresh
   contexts and closes each exactly once in its own teardown, on the pass path and the fail path
   alike. A hand-rolled `finally { await context.close() }` races Playwright's teardown when a test
   times out and reports `Target.disposeBrowserContext: Failed to find context` over the real
   failure — which is what made two days of flake look like a browser bug.
3. **A test builds everything it needs.** There is no opt-out and no shared setup between tests in a
   file. If two tests need the same team, each makes its own; helpers in the spec file (or in
   `support.ts`) are how that stays short.
4. **Never encode fixture size or machine speed as a constant.** No tab-stop budget, no hard-coded
   index, no `.first()` / `.nth()` over a list another test could append to. Derive the bound from
   the page and say the derived bound in the failure message — `reconnect.spec.ts`'s
   `retryFromTheKeyboard` and `auto-status.spec.ts`'s `tabTo` are the pattern; `support.ts`'s
   `mintInvite` is the same idea for picking a row (it returns the invite link that was not on the
   page a moment ago, rather than trusting `invites.all`'s ordering).

Raising a timeout is a fix only where the evidence says the wait was genuinely under-provisioned,
and the evidence goes in a comment beside the number. Anywhere else it hides the defect.

## What the reset does and does not touch

`reset.ts` reads the table list out of `information_schema` rather than from a list a human
maintains, so a table added by a later migration joins both the reset and the assertion with no
human step. It deletes every row from every base table in `public`, in foreign-key order, in one
multi-statement statement that Postgres runs as a single implicit transaction — ordinary `DELETE`,
never `TRUNCATE`, because a row delete is unambiguously carried by logical replication.

Three exceptions, all commented in the file:

- `workspace` is preserved. `seedWorkspace` inserts `where not exists (select 1 from workspace)`, so
  a deleted workspace only comes back on a server restart.
- `kysely_migration` / `kysely_migration_lock` are never touched — migration bookkeeping.
- `jwks` is never touched. The server verifies Zero tokens against a remote JWKS set that `jose`
  caches behind a refetch cooldown; rotating the signing key per test would park verification behind
  that cooldown instead of failing fast.

The bootstrap admin is **not** preserved. It is deleted with everyone else and recreated by the next
sign-up: `ensureAccount` leads with sign-up, and `bootstrapFirstAdmin` promotes the caller only when
`workspace_member` is empty **and** their address matches `YAPM_BOOTSTRAP_ADMIN_EMAIL` — which the
Playwright server env pins to `admin@example.test`. So `ADMIN` is deterministically the workspace
admin in every test, without the harness curating better-auth's tables.

`workers: 1` and `fullyParallel: false` stay. The reset is global to one database, so two workers
would clear each other's fixtures mid-test. Isolation is the prerequisite for parallelism, not the
same thing as it; making the suite parallel needs a database per worker and is out of scope.

## Running it locally

CI brings the stack up like this, and so should you:

```sh
docker compose -f docker/docker-compose.dev.yml up -d postgres zero-cache
DATABASE_URL=postgres://yapm:yapm@localhost:5440/yapm pnpm --filter @yapm/web e2e
```

`DATABASE_URL` is required — `playwright.config.ts` refuses to start without it. Playwright starts
the server and the Vite dev server itself, on `E2E_SERVER_PORT` (default `3210`) and `E2E_WEB_PORT`
(default `5174`).

**The port trap.** If something else on your machine holds the port the server binds, the harness
comes up but the app never reaches the API, and the first symptom is `sync.spec.ts` timing out
waiting for `workspace-name`. That is an environment problem, not a product bug. Set
`E2E_SERVER_PORT` to something free and re-run.

To run one file, or one test:

```sh
DATABASE_URL=... pnpm --filter @yapm/web e2e e2e/projects.spec.ts
DATABASE_URL=... pnpm --filter @yapm/web e2e -g 'a viewer reads the workspace-level projects'
```

## Notes for whoever debugs the next flake

- A failure that says `Test timeout of 60000ms exceeded` with no failed expectation is the harness
  running out of wall clock, not an assertion disagreeing. Look at what the test was waiting for.
- `PushProcessor … Ignoring mutation from <clientID> with ID N as it was already processed` in the
  server log is `@rocicorp/zero/server`'s own idempotency bookkeeping, logged at error level. Zero
  keeps a `lastMutationID` per client and skips anything at or below it; a client that reconnects
  resends its queued mutations. `reconnect.spec.ts` provokes both resend paths deliberately.
- The `e2e/` directory is **not** in `apps/web/tsconfig.json`'s `include`, so `pnpm typecheck` does
  not cover it: `@yapm/schema/db`'s types name `kysely`, which `apps/web` does not depend on. Keep
  the harness free of imports `apps/web` cannot resolve — `reset.ts` goes through the pg `Pool` on
  the `Database` handle for exactly that reason.
