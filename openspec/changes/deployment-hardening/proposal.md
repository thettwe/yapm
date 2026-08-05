## Why

Every feature yapm ships is built, specified and archived. The last mile — **shipping it and
operating it** — is broken in four ways that compound into "yapm cannot currently be self-hosted
correctly". Each was verified against source, not inferred:

1. **The README quickstart silently ignores `.env`, so a production deploy runs on published
   secrets.** `README.md:172` is `docker compose -f docker/docker-compose.yml up -d --build --wait`
   with no `--env-file`. Because `-f` points into `docker/`, Compose takes `docker/` as the project
   directory and looks for `docker/.env`, which does not exist; `.env.example` is at the repo root.
   So every shipped default applies, silently: `BETTER_AUTH_SECRET` stays
   `yapm-dev-secret-change-me-in-production` (`apps/server/src/config/env.ts:171`),
   `POSTGRES_PASSWORD` stays `yapm`, `ZERO_ADMIN_PASSWORD` stays `change-me-in-production`, and both
   Zero API keys stay `yapm-zero-*-key-change-me`. **`BETTER_AUTH_SECRET` encrypts the JWKS private
   key at rest** — a known value there plus any database read is the ability to mint a sync JWT for
   any user. Nothing anywhere says a word about it.
2. **A published image can never sync on a real host.** `.github/workflows/release.yml:80` passes
   `VITE_ZERO_CACHE_URL=http://localhost:4848` as the image's only build-arg; `docker/Dockerfile:25`
   turns it into ENV; `apps/web/src/zero/provider.tsx:33` reads it as
   `import.meta.env.VITE_ZERO_CACHE_URL` — a **Vite compile-time constant** with no runtime override
   anywhere in `apps/web`, `packages`, `docker` or `apps/server/src/static.ts`. An operator following
   the documented `YAPM_IMAGE=ghcr.io/…` path gets an SPA that opens a WebSocket to
   `http://localhost:4848` *in the end user's browser*. Sync never connects, every read is empty, and
   neither `/readyz` nor the logs name the cause.
3. **No image has ever been published**, so every self-hoster claim in SECURITY.md is currently
   false. `publish` is `needs: release-please`, and release-please fails on every run ("GitHub
   Actions is not permitted to create or approve pull requests" — a repo setting only the maintainer
   can flip). `docker compose pull` cannot work, `YAPM_IMAGE` cannot work, and SECURITY.md promises
   an artifact that does not exist.
4. **The documented upgrade command fails and rollback is unrecoverable.** SECURITY.md:31 says
   `docker compose pull && docker compose up -d`, which does not work against the shipped compose
   file for a locally-built stack. Migrations run at boot, forward-only: rolling back to a previous
   image is a **crash loop with no way out**, and that is documented nowhere.

Plus the gap that makes all four invisible: `apps/docs/src/content/docs/self-hosting/` has eight
pages and **none** covers installation, deployment or configuration.

Vision principles served: *self-hosting teams first* — a product that demos but cannot be run is not
adopted; and *fail fast with the variable name*, which the repo already does for a partial GitHub App
triplet and does not do for the one secret that forges credentials.

## What Changes

**Secrets stop being silently defaulted (defect 1).** Three layers, because one is not enough:

- `scripts/init-env.mjs` writes a repo-root `.env` from `.env.example` with **generated** values for
  every shipped-default secret, and the README quickstart runs it and then passes `--env-file .env`.
  The documented command now reads the file an operator edits.
- **Boot-time detection.** A new `apps/server/src/config/shipped-defaults.ts` holds the literal
  shipped values by variable name. Under `NODE_ENV=production` a secret still at its shipped value is
  **fatal**: the process exits non-zero before listening, naming each variable, following the
  partial-GitHub-App-triplet precedent. Outside production it is a loud named warning. A single
  documented escape hatch, `YAPM_ALLOW_INSECURE_DEFAULTS=true`, downgrades the refusal to a warning
  for evaluation boxes — because the existing spec requirement "`docker compose up` still boots with
  an empty `.env`" is a promise to evaluators, and this change keeps it deliberately rather than
  breaking it silently. See design §D2.
- **A non-gating `/readyz` entry**, `configuration`, following the `nonGatingCheck('search')`
  precedent: an operator can see after the fact which variables are still shipped defaults.

**The sync origin becomes runtime configuration (defect 2).**

- The server serves `GET /api/config` — `{"zeroCacheUrl": …}`, `Cache-Control: no-store` — from a new
  server-read `ZERO_CACHE_PUBLIC_URL` (default `http://localhost:4848`, so `pnpm dev` is unchanged).
  It is under `/api` so Vite's existing dev proxy already covers it and no proxy rule is added.
- The SPA fetches it **before constructing the Zero client** and holds a neutral boot shell until it
  resolves — deliberately not an error flash. A failed fetch retries on the existing bounded backoff
  and only then names `/api/config`.
- `VITE_ZERO_CACHE_URL` is **deleted** — from the connection path, from `docker/Dockerfile`, from the
  compose build args, from `release.yml`, from `.env.example` and from CI. A test asserts
  `import.meta.env.VITE_ZERO_CACHE_URL` appears nowhere under `apps/web/src`.

**Image publishing is decoupled from release-please (defect 3).** The `publish` job keeps `needs:`
for the version outputs but gains `if: ${{ !cancelled() }}`, so `edge` and `sha-<7>` publish on every
push to `main` whether or not release-please succeeded; version, `stable` and `latest` tags still
require a real release. SECURITY.md is corrected to describe what is then true, and **claims no
signing and no scanning**, because this change makes neither true.

**The upgrade path is written down and rollback is honest (defect 4).** A new upgrade-and-rollback
page gives the real commands for both shapes (locally-built and prebuilt-image) and states plainly:
migrations are forward-only, there is no down-migration, and **rolling back an image after a
migration has applied requires restoring the database from backup.** No down-migration system is
invented here.

**Three docs pages the deployment story needs (defect 5):** production deployment & hardening
(the exact secrets and why, TLS termination and reverse-proxying the two published ports, sizing, a
first-run checklist), upgrade & rollback, and a **configuration reference** — which two existing spec
scenarios already reference and which does not exist. The reference is bound to the schema by an
extension to `apps/server/src/config/env-example.test.ts`, so it cannot drift.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `self-host-deploy`: the shipped defaults for security-relevant variables become **detected and, in
  production, fatal**; the browser-facing zero-cache origin becomes **runtime** configuration served
  by the app rather than a build-time constant baked into the bundle; the readiness report gains a
  non-gating `configuration` entry; the documented quickstart is required to read the operator's
  env file; and upgrade and rollback become specified operations with a stated, honest rollback
  answer.
- `ci-pipeline`: image publishing to GHCR is decoupled from the release job, so `edge` and
  `sha-<7>` tags exist for every commit on `main` independent of whether a release was cut.

## Impact

- `apps/server/src/config/shipped-defaults.ts` (new) — the literal default table and the detector.
- `apps/server/src/config/env.ts` — `ZERO_CACHE_PUBLIC_URL`, `YAPM_ALLOW_INSECURE_DEFAULTS`.
- `apps/server/src/index.ts` — the boot gate, the warning, the `configuration` readiness entry.
- `apps/server/src/app.ts` — `GET /api/config`.
- `apps/web/src/zero/runtime-config.ts` (new), `apps/web/src/zero/provider.tsx`,
  `apps/web/src/main.tsx` — fetch-then-construct, and the boot shell.
- `apps/web/vite.config.ts` — unchanged by design (`/api` is already proxied); noted so a reviewer
  does not go looking.
- `scripts/init-env.mjs` (new), `scripts/smoke.mjs` — the quickstart path, exercised in CI.
- `docker/docker-compose.yml`, `docker/Dockerfile`, `.github/workflows/release.yml`,
  `.github/workflows/ci.yml` — the build-arg's removal and the publish decoupling.
- `apps/server/src/config/env-example.test.ts` — the configuration reference joins the set-equality
  check; `VITE_ZERO_CACHE_URL` leaves the compose-only exception list.
- No migration (highest on `main` is `0022`), no new container, no new dependency, no new query,
  no new mutator, no new permission predicate.

Docs: `apps/docs/src/content/docs/self-hosting/deploy.md` (new — production deployment and
hardening), `.../self-hosting/upgrade.md` (new — upgrade and rollback),
`.../self-hosting/configuration.md` (new — the configuration reference the specs already cite),
`apps/docs/astro.config.mjs` (three sidebar entries), `README.md` (the quickstart), `SECURITY.md`
(what is actually published, and the corrected upgrade line), `.env.example` (the two new variables,
`VITE_ZERO_CACHE_URL` removed, the header's env-file instruction made the same as the README's),
`TECHSTACK.md` (the runtime-config decision), `ROADMAP.md` (a row for this change).

## Non-goals

- **No down-migrations, and no rollback tooling.** The honest answer is "restore from backup"; this
  change writes that down rather than building a system to avoid saying it.
- **No fourth container and no reverse-proxy requirement.** The hardening page explains how to put
  yapm behind a proxy an operator already runs; the three-container promise is unchanged.
- **No image signing, SBOM or vulnerability scanning.** Worth doing, not done here — so SECURITY.md
  will not claim it.
- **No secret manager, no secret rotation tooling.** Detecting a shipped default is not rotating it.
- **No change to `apps/server/src/auth.ts`, `auth-routes.ts` or the login form** — a sibling build
  (`sso-admin-gating`) owns those files.
- No change to what any user can see or do. This is a deployment change; the product surface is
  untouched apart from the pre-config boot shell.
