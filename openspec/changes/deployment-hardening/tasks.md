## 1. Shipped defaults become a named, detected fact

- [x] 1.1 Add `apps/server/src/config/shipped-defaults.ts`. It exports `SHIPPED_DEFAULTS` — a frozen
      record of variable name → the literal value this repo ships — covering `BETTER_AUTH_SECRET`
      (`yapm-dev-secret-change-me-in-production`), `ZERO_QUERY_API_KEY`
      (`yapm-zero-query-key-change-me`), `ZERO_MUTATE_API_KEY` (`yapm-zero-mutate-key-change-me`) and
      the database password (`yapm`, read out of `DATABASE_URL`, not out of a variable the server
      declares). It exports `findShippedDefaults(env): string[]` returning the offending **names**,
      sorted, never a value. Design §D2 records why `ZERO_ADMIN_PASSWORD` is deliberately absent —
      put that reason in the file as a constraint comment, since a reviewer will otherwise read its
      absence as an oversight.
- [x] 1.2 `apps/server/src/config/env.ts`: add `YAPM_ALLOW_INSECURE_DEFAULTS` as the
      `z.preprocess(...).enum(['true','false']).default('false')` pattern the file already uses for
      `SEED_DEMO_CONTENT`. `BETTER_AUTH_SECRET`'s default stays exactly as it is — the value is the
      thing 1.1 recognises, so changing it here would break the detector rather than fix anything.
- [x] 1.3 Wire the gate into `apps/server/src/index.ts`, **before the server listens and before
      migrations run** — a refusal must not leave a half-migrated database behind. Production plus no
      escape hatch ⇒ log the named list at `fatal` and `process.exit(1)`. Otherwise ⇒ one `warn` with
      the names and the remedy (`node scripts/init-env.mjs`). No branch of this prints a value.
- [x] 1.4 Add the non-gating readiness entry: `nonGatingCheck('configuration', …)` in the
      `readinessChecks` array in `index.ts`, reporting either that nothing is defaulted or **how
      many** variables are. Non-gating deliberately — see the spec requirement's own reasoning; do
      not make it gating "for safety", that converts a warning into an outage. It reports a count
      and never the names: `/readyz` has no auth and the hardening page puts it behind a catch-all
      public proxy.
- [x] 1.5 Add `scripts/init-env.mjs`: copy `.env.example` to a repo-root `.env`, replacing every
      value in `SHIPPED_DEFAULTS` **plus `ZERO_ADMIN_PASSWORD`** with
      `randomBytes(32).toString('base64url')` from `node:crypto`. Refuse to overwrite an existing
      `.env` (exit non-zero, say so). Print the variables it filled, by name. No dependency: this
      runs before `pnpm install` in a clean checkout, so it must be dependency-free Node.
- [x] 1.6 Add the operator-only half: `apps/server/src/config/admin-routes.ts` serving
      `GET /api/v1/configuration` with the offending **names** and their remedies, admin-gated
      (session, then role, before anything is read) and `no-store`. Never a value, on either
      surface. `/readyz` points at it by path, from one shared constant.

## 2. The sync origin becomes runtime configuration

- [x] 2.1 `apps/server/src/config/env.ts`: add `ZERO_CACHE_PUBLIC_URL`, `z.string().url()`,
      defaulting to `http://localhost:4848`. Its comment states what it is — the origin the *browser*
      opens its sync socket to — and why it is not an in-network hostname.
- [x] 2.2 `apps/server/src/app.ts`: serve `GET /api/config` returning
      `{ zeroCacheUrl }` with `Cache-Control: no-store`, taking the value through `AppOptions` rather
      than reading env inside the route. Under `/api` on purpose: Vite's dev proxy already covers it
      and no proxy rule is added (design §D3). Unauthenticated on purpose: the value is public to
      every browser that connects.
- [x] 2.3 Add `apps/web/src/zero/runtime-config.ts`: `fetchRuntimeConfig()` (parses the response,
      rejects a missing or non-URL `zeroCacheUrl` rather than defaulting past it) and a
      `RuntimeConfigGate` component. The gate renders a **neutral boot shell** — page background,
      no spinner, no visible copy, and a polite live region that says "Loading…" a beat later so the
      wait is not silent to a screen reader — while in flight; retries on the existing `backoffDelay`
      from `@/zero/backoff` rather than inventing a second backoff; and only after the ceiling
      renders a failure that names `/api/config`. Both phases are `<main>`; the failure carries a
      polite live region and a **Retry now** button, matching `SyncUnavailable`. Every colour via
      tokens, correct in all three themes light and dark.
- [x] 2.4 `apps/web/src/zero/provider.tsx`: delete
      `const CACHE_URL = import.meta.env.VITE_ZERO_CACHE_URL ?? …`. `ZeroRoot` takes `cacheUrl` as a
      prop. It must remain a stable string across renders — the options memo's identity is what
      `ZeroProvider` keys the whole client on, and a value that changes identity per render reopens
      IndexedDB and rehydrates every query.
- [x] 2.5 `apps/web/src/main.tsx`: mount `RuntimeConfigGate` **above** `ZeroRoot`, so no Zero client
      is constructed before the origin is known (design §D3 — this ordering is the whole point, not a
      stylistic preference).
- [x] 2.6 Remove `VITE_ZERO_CACHE_URL` everywhere it survives: `docker/Dockerfile` (the `ARG`/`ENV`
      pair), `docker/docker-compose.yml` (the `build.args` block, replaced by
      `ZERO_CACHE_PUBLIC_URL` in the `yapm` service's `environment:`), `.github/workflows/release.yml`
      (the `build-args:` key), `.github/workflows/ci.yml` (the e2e job's env), `.env.example`, and
      `apps/web/playwright.config.ts`. Then confirm by grep that the identifier appears nowhere
      outside `openspec/changes/archive/`.

## 3. Publishing, and the compose stack that proves the quickstart

- [x] 3.1 `.github/workflows/release.yml`: add `if: ${{ !cancelled() }}` to the `publish` job, keeping
      `needs: release-please` for the version outputs. Design §D4 records why this rather than a
      tag-triggered workflow (a tag pushed by `GITHUB_TOKEN` triggers nothing) — put the one-line
      version of that in the workflow as a comment, because the next person will try the tag trigger.
- [x] 3.2 `docker/docker-compose.yml`: `ZERO_CACHE_PUBLIC_URL: ${ZERO_CACHE_PUBLIC_URL:-http://localhost:4848}`
      and `YAPM_ALLOW_INSECURE_DEFAULTS: "${YAPM_ALLOW_INSECURE_DEFAULTS:-false}"` in the `yapm`
      service's `environment:` — enumerated, per archived change `pm-digest-governance` §I11: a
      variable the schema validates but compose does not pass through is an instruction with no
      effect in the shipped deployment.
- [x] 3.3 `.env.example`: add both variables with their explanations, delete `VITE_ZERO_CACHE_URL`
      and its stale "baked into the web bundle by Vite at build time" paragraph, and change the
      header's env-file instruction to be **the same command the README prints**, generated by
      `scripts/init-env.mjs`. Mark `POSTGRES_PASSWORD`, `ZERO_ADMIN_PASSWORD` and both Zero API keys
      as values the app now refuses to run on in production.
- [x] 3.4 `.github/workflows/ci.yml` smoke job: run `node scripts/init-env.mjs` and boot with
      `docker compose --env-file .env -f docker/docker-compose.yml up -d --build --wait` — the exact
      shape the README prints. Tear-down keeps `--env-file .env` too, so the volumes it removes are
      the ones it created. The e2e job sets `YAPM_ALLOW_INSECURE_DEFAULTS=true` (it is not a
      production deployment and should not need generated secrets to run).

## 4. Tests

- [x] 4.1 `apps/server/src/config/shipped-defaults.test.ts` (unit): every shipped default is detected
      by name; several at once are all named in one list; a value never appears in the output; a
      configured environment yields an empty list; the `DATABASE_URL` password is read from the
      connection string and a non-default password is not flagged; a malformed `DATABASE_URL` does not
      throw out of the detector.
- [x] 4.2 A boot-gate test (unit, alongside `env.test.ts`'s style): production + defaults + no flag
      ⇒ the fatal path is taken and the message names `BETTER_AUTH_SECRET`; production + defaults +
      flag ⇒ the warn path; non-production + defaults ⇒ the warn path. Assert on the injected logger
      and an injected exit, not on a real `process.exit`.
- [x] 4.3 **The falsifiable check for the shipped-default table itself**: assert that every value in
      `SHIPPED_DEFAULTS` is byte-identical to the default the Zod schema actually produces (and, for
      the database password, to the one `docker-compose.yml` interpolates). A detector that has
      drifted from the defaults it is supposed to recognise is worse than no detector, and this is
      the only test that can catch it.
- [x] 4.4 `apps/server/src/app.test.ts`: `GET /api/config` returns the configured origin and
      `Cache-Control: no-store`; the origin it returns is the one passed in, not one read from the
      ambient environment.
- [x] 4.5 `apps/web/src/zero/runtime-config.test.ts` (unit, jsdom): **the headline check** — with
      `/api/config` stubbed to origin A the client is constructed with `cacheURL` A; re-stub to B,
      remount, and it is B, with no rebuild anywhere. Plus: while the fetch is pending no Zero client
      is constructed and no error copy renders; a rejecting fetch retries and eventually renders a
      message containing `/api/config`; a response missing `zeroCacheUrl` is treated as a failure
      rather than silently defaulted.
- [x] 4.6 A source-level guard test asserting `import.meta.env.VITE_ZERO_CACHE_URL` occurs nowhere
      under `apps/web/src` — the grep in the falsifiable-checks list, as a test that stays green
      forever rather than a one-off.
- [x] 4.7 Extend `apps/server/src/config/env-example.test.ts`: remove `VITE_ZERO_CACHE_URL` from
      `COMPOSE_ONLY` (it no longer exists), add the fourth leg parsing variable names out of
      `apps/docs/src/content/docs/self-hosting/configuration.md` and asserting set equality with the
      schema modulo the two existing exception lists, and name the two variables this change adds
      explicitly, following the file's own "this change's variables, named" precedent.
- [x] 4.8 A README-quickstart test asserting the **mechanism, not the prose**: every `docker compose`
      invocation in `README.md` that passes `-f docker/` also passes `--env-file`. This is what makes
      defect 1 unable to reappear by a later docs edit.
- [ ] 4.9 Run the compose smoke test locally through the new path
      (`POSTGRES_HOST_PORT=5449 ZERO_CACHE_HOST_PORT=4857 YAPM_HOST_PORT=3009 docker compose -p
      yapm-dh …`) and record the result in `design.md` under
      `## Decisions made during implementation`, including whether the app booted with **no**
      `YAPM_ALLOW_INSECURE_DEFAULTS` — which is the end-to-end proof that the env file is read.
      No new Playwright spec: PROCESS.md §3's big-feature rule is not met (no synced entity, no
      mutator, no permission surface, no signature UI), so do not add e2e reflexively.
      **NOT RUN LOCALLY.** PROCESS.md §3 makes CI the gate of record for the compose path and
      excludes docker from the local fast gates. The CI smoke job rewritten in 3.4 *is* this proof:
      it boots through `init-env.mjs` + `--env-file .env` with no `YAPM_ALLOW_INSECURE_DEFAULTS`, so
      an env file that is not read means a boot refusal and a red job. Recorded in design.md rather
      than claimed.

## 5. Documentation

- [x] 5.1 `apps/docs/src/content/docs/self-hosting/deploy.md` — production deployment and hardening.
      The exact secrets to change and **what each one protects** (`BETTER_AUTH_SECRET` encrypts the
      JWKS private key at rest: a known value plus a database read forges any user's sync token);
      the boot refusal and its one escape hatch; TLS termination and reverse-proxying **both**
      published ports (3000 and 4848 on 0.0.0.0), including that `ZERO_CACHE_PUBLIC_URL`,
      `BETTER_AUTH_URL` and `WEB_ORIGIN` must agree with what the browser actually reaches; resource
      and disk sizing (the ~0.85 GiB idle figure the README already cites, plus replica and pgdata
      growth); a first-run checklist. No fourth container, no required proxy — a proxy the operator
      already runs, described.
- [x] 5.2 `apps/docs/src/content/docs/self-hosting/upgrade.md` — upgrade and rollback. Both shapes
      with commands that work against the shipped compose file. Rollback stated plainly: forward-only
      migrations, no down-migration, an older image against a newer schema crash-loops, and the
      answer is restore from backup (link `backup-restore.md`). A "breaking upgrades" section naming
      this change: an instance previously on defaults now refuses to boot, and changing
      `BETTER_AUTH_SECRET` invalidates every session and the stored JWKS.
- [x] 5.3 `apps/docs/src/content/docs/self-hosting/configuration.md` — the configuration reference the
      two existing spec scenarios already cite. Every variable the schema validates: name, default,
      what it does, and whether it is security-relevant. Written in the shape task 4.7's check parses.
- [x] 5.4 `apps/docs/astro.config.mjs`: three sidebar entries, ordered so deployment comes first in
      the Self-hosting group. Expect a rebase here — the sibling `sso-admin-gating` build adds its
      own page to the same list.
- [x] 5.5 `README.md`: the quickstart becomes `node scripts/init-env.mjs` then
      `docker compose --env-file .env -f docker/docker-compose.yml up -d --build --wait`, with one
      sentence on why the flag is not optional. Link the three new pages.
- [x] 5.6 `SECURITY.md`: correct the self-hoster section to what is true after task 3.1 — `edge` and
      `sha-<7>` images on every push to `main`, version and `stable` tags on releases — and the
      upgrade line to the real command. **Claim no signing, no provenance and no scanning**, because
      this change makes none of them true.
- [x] 5.7 `TECHSTACK.md`: record that the browser-facing sync origin is runtime configuration served
      by the app, not a Vite build-time constant, and why (one prebuilt image must serve every host).
- [x] 5.8 `ROADMAP.md`: a row for this change.
- [x] 5.9 Root-doc staleness sweep per PROCESS.md §2 — `README`, `ROADMAP`, `TECHSTACK`,
      `.env.example`, `SECURITY`, `CONTRIBUTING`, and any `reference/` page this makes stale — and
      record the sweep's result in `design.md`, including "none" where nothing was stale.

## 6. Verification

- [ ] 6.1 `pnpm turbo lint typecheck test build` clean, with the actual output reported. Fast gates
      (`typecheck`, `lint`, affected `test`, `check-boundaries`) run and green locally; the full
      `build`, Playwright and the compose smoke test are CI's, per PROCESS.md §3.
- [x] 6.2 `pnpm --filter @yapm/docs build` clean (PROCESS.md §2's close gate).
- [x] 6.3 `node scripts/check-boundaries.mjs` clean — no app imported from a package, no ZQL or
      mutator outside `packages/schema`.
- [x] 6.4 Confirm the compose file still defines exactly three services.
