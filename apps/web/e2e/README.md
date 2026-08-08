# The end-to-end suite

Playwright, against the real stack: Postgres, zero-cache, the yapm server and a Vite dev server.
This is the only tier that can prove a keyboard flow, a two-client sync convergence or a
reconnection, so it is also the tier with the most ways to lie. The rules below exist so a red
result means the product broke, not that the harness drifted.

## The isolation contract

**Every test starts from the state the server leaves behind at boot: one `workspace` row and
nothing else, named what the server named it.** No team, invite, project, issue, cycle, retro,
notification or account created by one test is visible to another, and no workspace name written by
one test survives into another — whichever tests ran before it and in whatever order.

That is enforced, not requested. `fixtures.ts` runs an automatic per-test fixture that calls
`resetToBaseline` and then `assertBaseline` from `reset.ts` before the test body runs — roughly a
hundred times a suite — and `zz-isolation.spec.ts`, which Playwright orders last because spec files
run lexicographically, signs in at the point where the reset had the whole preceding run to clear
and asserts the baseline arrived **in the browser**: the empty states, one member, and a short list
of literally-named tables at zero. It is not a nicer restatement of `assertBaseline`; it covers the
two things `assertBaseline` structurally cannot (the synced replica, and its own table set going
wrong), and the file says so at the top.

Four rules follow from it:

1. **Import `test` from `./fixtures`, never from `@playwright/test`.** `expect` and the types still
   come from `@playwright/test`. A spec that imports `test` from the package gets no reset, sees the
   previous test's rows, and quietly reintroduces the accumulation this contract exists to remove.
2. **Never call `browser.newContext()`.** Take the `newContext` fixture instead. It hands out fresh
   contexts and closes each exactly once in its own teardown, on the pass path and the fail path
   alike. A hand-rolled `finally { await context.close() }` races Playwright's teardown when a test
   times out and reports `Target.disposeBrowserContext: Failed to find context` over the real
   failure — which is what made two days of flake look like a browser bug.

   Rules 1 and 2 are not on the honour system: `scripts/lib/boundaries.mjs` rule 7 fails on either
   one in any `apps/web/e2e/*.spec.ts`, and `node scripts/check-boundaries.mjs` runs in CI's
   `Package boundaries` job. A spec that opts out of the reset cannot report its own leak, so the
   check has to live outside the suite.

3. **A test builds everything it needs.** There is no opt-out, and no test inherits fixture data or
   product state from a sibling. Setup that owns no database rows is fine — `attachments.spec.ts`
   and `search.spec.ts` open one Kysely handle per file in `test.beforeAll` and close it in
   `test.afterAll`, which the reset does not interact with. If two tests need the same team, each
   makes its own; helpers in the spec file (or in `support.ts`) are how that stays short.
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
  a deleted workspace only comes back on a server restart. The **row** is preserved; its **contents**
  are restored — the same statement writes `name` back to `DEFAULT_WORKSPACE_NAME`, because a
  workspace a spec renamed is otherwise the one piece of mutable state a delete-everything sweep
  cannot reach. `assertBaseline` reads the name back, so the restore cannot silently stop covering
  it. That restore is only a restore while the server actually seeded that name, so
  `playwright.config.ts` pins `SEED_WORKSPACE_NAME` to the same constant in the server's env — an
  ambient `SEED_WORKSPACE_NAME` would otherwise reach the server through Playwright's env merge and
  the reset would rename the workspace away from its boot state on the very first test.
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
YAPM_HOST_PORT=3210 docker compose -f docker/docker-compose.dev.yml up -d --wait --wait-timeout 180 postgres zero-cache
DATABASE_URL=postgres://yapm:yapm@localhost:5440/yapm pnpm --filter @yapm/web e2e
```

`DATABASE_URL` is required — `playwright.config.ts` refuses to start without it. Playwright starts
the server and the Vite dev server itself, on `E2E_SERVER_PORT` (default `3210`) and `E2E_WEB_PORT`
(default `5174`).

**`YAPM_HOST_PORT` must equal `E2E_SERVER_PORT`.** zero-cache calls *back* to the yapm server for
every query and every mutation, over `host.docker.internal`, and it resolves `ZERO_QUERY_URL` /
`ZERO_MUTATE_URL` from `YAPM_HOST_PORT` at container-**create** time
(`docker/docker-compose.dev.yml:39-40`, defaulting to `3000`). Bring the stack up without it and
zero-cache points at port 3000 while Playwright serves on 3210: the app loads, the sync socket
opens, and nothing ever answers.

**The port trap.** If you change `E2E_SERVER_PORT` — because something else on your machine holds
3210 — you must recreate zero-cache with a matching `YAPM_HOST_PORT`:

```sh
YAPM_HOST_PORT=<port> docker compose -f docker/docker-compose.dev.yml up -d --force-recreate zero-cache
```

Changing the environment without `--force-recreate` does nothing: the running container keeps the
URLs it was created with. The symptom of forgetting either half is every spec timing out on
`workspace-name` even though the app itself loads. That is an environment problem, not a product
bug.

To run one file, or one test:

```sh
DATABASE_URL=... pnpm --filter @yapm/web e2e e2e/projects.spec.ts
DATABASE_URL=... pnpm --filter @yapm/web e2e -g 'a viewer reads the workspace-level projects'
```

## Notes for whoever debugs the next flake

- A failure that says `Test timeout of 60000ms exceeded` with no failed expectation is the harness
  running out of wall clock, not an assertion disagreeing. Look at what the test was waiting for.
- `PushProcessor … Ignoring mutation from <clientID> with ID N as it was already processed` in the
  server log is `@rocicorp/zero/server`'s own log context, at error level. The working hypothesis is
  that it is idempotency bookkeeping — Zero keeps a `lastMutationID` per client and skips anything at
  or below it, and a client that reconnects resends its queued mutations (`reconnect.spec.ts`
  provokes both resend paths deliberately). **This has not been confirmed with counts** — see
  `openspec/changes/e2e-isolation/design.md` D13 and task 2.5 — so do not cross it off the list
  without comparing per-file counts across a passing and a failing run.
- The `e2e/` directory is **not** in `apps/web/tsconfig.json`'s `include`, so `pnpm typecheck` does
  not cover it: `@yapm/schema/db`'s types name `kysely`, which `apps/web` does not depend on. Keep
  the harness free of imports `apps/web` cannot resolve — `reset.ts` goes through the pg `Pool` on
  the `Database` handle for exactly that reason.
- The one part of the harness a gate *does* check is `order.ts`: the reset's topological sort and its
  empty-table-set guard are pure, so they live apart from the queries and `order.test.ts` covers them
  in the web unit suite (`pnpm --filter @yapm/web test`). Playwright is pinned to `**/*.spec.ts` so
  it does not mistake that file for a spec.
