---
title: Configuration reference
description: Every environment variable yapm reads, its default, whether it is security-relevant, and what it does — checked mechanically against the validated schema so it cannot drift.
---

Every variable below is validated at boot with Zod. A missing or malformed value **fails boot naming
the variable and the format it expected** — never a healthy-looking instance with a feature silently
switched off.

Configuration is env-only. There is no config file, no admin-editable server setting, and nothing to
mount. Set variables in the repo-root `.env` and pass it to Compose:

```bash
node scripts/init-env.mjs                       # first run only — generates the secrets
docker compose --env-file .env -f docker/docker-compose.yml up -d --build --wait
```

`--env-file` is **not optional**. `-f docker/…` makes `docker/` Compose's project directory, so
without it Compose finds no environment file at all and applies every published default in silence.
See [Deploy and harden](/self-hosting/deploy/) for what those defaults cost you.

:::note[This page is a checked artifact]
`apps/server/src/config/env-example.test.ts` parses the variable names out of this page and asserts
set equality with the Zod schema and with `.env.example`. A variable added to the schema and not to
this table fails CI by name. That is the only reason a reference like this is still true six months
after it was written.
:::

**Security column.** *Yes* means the value is a secret or a trust boundary: leaking it, or leaving it
at the value this repository publishes, is exploitable. Four of them are refused outright in
production — see [the boot refusal](/self-hosting/deploy/#the-boot-refusal).

## Core

| Variable | Default | Security | What it does |
|---|---|---|---|
| `NODE_ENV` | `development` | — | `development` \| `test` \| `production`. Compose sets `production`, which is what arms the shipped-default refusal. |
| `HOST` | `0.0.0.0` | — | Bind address. Set by the container; you almost never set this yourself. |
| `PORT` | `3000` | — | Listen port inside the container. Publish a different host port with `YAPM_HOST_PORT` instead of changing this. |
| `LOG_LEVEL` | `info` | — | pino level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent`. |
| `DATABASE_URL` | *(required)* | **yes** | `postgres://user:password@host:5432/database`. Compose builds it from `POSTGRES_*`; the embedded password is one of the four values production refuses at its shipped value. |
| `DATABASE_POOL_MAX` | `10` | — | node-postgres pool ceiling for the app. |
| `WEB_DIST_DIR` | *(the built SPA)* | — | Path to the built SPA directory containing `index.html`. Supplied by the image; set it only when running the server outside its container. |
| `SEED_WORKSPACE_NAME` | `yapm` | — | Name of the workspace row seeded on first boot against an empty database. |
| `SEED_DEMO_CONTENT` | `false` | — | `true` seeds a demo team and a handful of issues when the first admin signs in on a fresh instance. One-shot: inert once any team exists. |
| `YAPM_ALLOW_INSECURE_DEFAULTS` | `false` | **yes** | `true` downgrades the production refusal on shipped-default secrets to a warning. **Evaluation only** — it is warned about by name on every boot and counted by `/readyz`, whose entry names nothing because it is unauthenticated; an admin reads the names from `/api/v1/configuration`. |

## Sync (zero-cache)

| Variable | Default | Security | What it does |
|---|---|---|---|
| `ZERO_QUERY_API_KEY` | *(compose: `yapm-zero-query-key-change-me`)* | **yes** | Shared secret zero-cache sends as `X-Api-Key` to `/api/zero/query`. Both containers read the same variable, so they cannot disagree. Refused in production at its shipped value. |
| `ZERO_MUTATE_API_KEY` | *(compose: `yapm-zero-mutate-key-change-me`)* | **yes** | The same, for `/api/zero/mutate` — the endpoint every write goes through. Refused in production at its shipped value. |
| `ZERO_CACHE_PUBLIC_URL` | `http://localhost:4848` | — | The zero-cache origin **the browser** opens its sync socket to, served to the SPA at runtime by `GET /api/config`. Never the in-network `zero-cache:4848`, which no end user can resolve. Behind TLS this is `wss://`-capable — set the `https://` origin. |

## Authentication

| Variable | Default | Security | What it does |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | `yapm-dev-secret-change-me-in-production` | **yes** | Signs sessions and the Zero sync JWT, and **encrypts the JWKS private key at rest**. A known value plus any database read is the ability to mint a sync token for any user. Refused in production at its shipped value. Changing it signs everyone out. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | — | The server base URL better-auth signs and verifies against. OAuth callbacks and the sync token's issuer/audience use it. Set it to the origin a browser actually reaches. |
| `WEB_ORIGIN` | `http://localhost:5173` | — | The SPA browser origin trusted for CORS. `http://localhost:5173` under `pnpm dev` (Vite on its own port); your app origin when the app serves the built SPA same-origin, which is what the compose stack does. |
| `GITHUB_CLIENT_ID` | *(unset)* | — | GitHub OAuth sign-in client id. Unset disables GitHub sign-in cleanly. |
| `GITHUB_CLIENT_SECRET` | *(unset)* | **yes** | The matching client secret. Set both or neither. |
| `YAPM_BOOTSTRAP_ADMIN_EMAIL` | *(unset)* | — | Binds the first-admin grant to a specific verified email. Unset means first-user-wins. |

## Cycles

| Variable | Default | Security | What it does |
|---|---|---|---|
| `CYCLE_MAINTENANCE` | `true` | — | Runs the cycle auto-rollover pass on the existing pg-boss scheduler. `false` in tests and e2e for deterministic timing; a cycle completed by hand still rolls over. |
| `CYCLE_MAINTENANCE_CRON` | `* * * * *` | — | How often that idempotent pass runs. Five-field cron, parsed at boot by the scheduler's own parser. |

## Email

All optional. With neither transport set, email is cleanly **off**: boot never fails, and the in-app
inbox works in full. Setting either transport makes `EMAIL_FROM` and `PUBLIC_URL` required.

| Variable | Default | Security | What it does |
|---|---|---|---|
| `SMTP_URL` | *(unset)* | **yes** | `smtp://user:pass@host:587` (or `smtps://`). One line that reaches Mailgun, Resend, Postmark, SendGrid, SES and Mailjet — they all issue SMTP credentials. Ignored with a warning when `RESEND_API_KEY` is also set. |
| `RESEND_API_KEY` | *(unset)* | **yes** | Sends over HTTPS instead of SMTP, for hosts that block outbound SMTP ports entirely. Wins when both transports are set. |
| `EMAIL_FROM` | *(unset)* | — | The From address outbound email is sent as, e.g. `yapm <notifications@example.com>`. Required once a transport is set. |
| `PUBLIC_URL` | *(unset)* | — | The browsable base URL a human clicks in an email. Deliberately distinct from `BETTER_AUTH_URL` and `WEB_ORIGIN` — overloading either is how those two came to disagree. Required once a transport is set. |
| `NOTIFICATION_EMAIL_CRON` | `*/2 * * * *` | — | How often unread, unemailed notifications are batched into one email per recipient. |
| `NOTIFICATION_RETENTION_DAYS` | `30` | — | How long a notification is kept before the retention sweep deletes it. Runs whether or not email is configured. |
| `NOTIFICATION_RETENTION_CRON` | `7 3 * * *` | — | When that sweep runs. |

## Connectors (GitHub App)

All optional; absent env cleanly **disables** the connector. The three `GITHUB_APP_*` values are
all-or-nothing — a partial triplet fails boot naming the missing one.

| Variable | Default | Security | What it does |
|---|---|---|---|
| `SECRETS_ENCRYPTION_KEY` | *(unset)* | **yes** | Base64-encoded 32 random bytes (`openssl rand -base64 32`) encrypting connector **and AI** secrets entered through the admin UI. Back it up: losing it makes those secrets unrecoverable. |
| `GITHUB_APP_ID` | *(unset)* | — | The numeric GitHub App id. |
| `GITHUB_APP_PRIVATE_KEY` | *(unset)* | **yes** | The App private key PEM (PKCS#1); `\n`-escape or base64 the multiline value. |
| `GITHUB_APP_WEBHOOK_SECRET` | *(unset)* | **yes** | The webhook secret every delivery is verified against. |
| `GITHUB_RECONCILE_CRON` | `*/15 * * * *` | — | How often the reconcile sweep re-polls GitHub with conditional (ETag/304) requests to heal a missed webhook. Only runs when the App is configured. |

## AI

BYO-key and never paywalled. All optional; absent env cleanly **disables** AI. Per-workspace keys are
normally entered in the admin UI (encrypted with `SECRETS_ENCRYPTION_KEY`); the keys here are
optional instance defaults for a single-instance self-host that prefers env over DB-resident secrets.

| Variable | Default | Security | What it does |
|---|---|---|---|
| `AI_ANTHROPIC_API_KEY` | *(unset)* | **yes** | Instance-default Anthropic key. |
| `AI_GOOGLE_API_KEY` | *(unset)* | **yes** | Instance-default Google Gemini key. |
| `AI_OPENAI_API_KEY` | *(unset)* | **yes** | Instance-default OpenAI key. |
| `AI_DEFAULT_PROVIDER` | *(unset)* | — | `anthropic` \| `google` \| `openai` — which of the three is the instance default. A value outside that set fails boot by name. |
| `AI_DIGEST_ON_CYCLE_CLOSE` | `true` | — | Pre-computes the team-internal cycle digest when a cycle closes, off the hot path via pg-boss. |
| `AI_RETRO_DRAFT` | `true` | — | Runs the lazy retro AI draft tail. Gated independently of the digest above. Per-team opt-in still applies either way. |
| `AI_PM_DIGEST` | `false` | — | Generates the PM-facing summary of a completed cycle. **Off by default, unlike the two above** — it is the only AI output read outside the team that did the work, so an upgrade must never switch it on. Requires `AI_DIGEST_ON_CYCLE_CLOSE=true` or boot fails naming both. |
| `AI_PM_DIGEST_READY_EMAIL` | `false` | — | Emails named readers a **link only** when a digest is released. Off at the instance floor because it is the one path that leaves the governed surface. Requires `AI_PM_DIGEST=true` or boot fails naming both. |
| `AI_DISCLOSURE_RETENTION_DAYS` | `365` | — | How long a disclosure audit record is kept. Enforced whether or not AI is enabled — a bound that lapses when the feature is switched off is not a bound. |
| `AI_DISCLOSURE_RETENTION_CRON` | `23 3 * * *` | — | When that sweep runs. Offset from notification retention so two bulk deletes do not start in the same minute. |

## Search

Postgres's own full-text search, in the container you already have. No `CREATE EXTENSION` of any
kind. A fresh instance indexes and searches with none of these set.

| Variable | Default | Security | What it does |
|---|---|---|---|
| `SEARCH_INDEX` | `true` | — | Maintains the server-side index in the background. `false` keeps `/api/v1/search` answering from whatever the index already holds; the in-browser pass is unaffected. |
| `SEARCH_INDEX_INTERVAL_SECONDS` | `10` | — | Seconds between incremental (tail) index passes, 1–3600. |
| `SEARCH_RECONCILE_CRON` | `*/5 * * * *` | — | When the full reconcile runs: whole-index diff, orphan canary, first-boot backfill, index-definition check. |
| `SEARCH_TEXT_CONFIG` | `simple` | — | The Postgres text-search configuration used by the index and every query. `simple` is language-neutral; `english` ranks English better at the cost of quietly optimising for English teams. |
| `SEARCH_STATEMENT_TIMEOUT_MS` | `2000` | — | Per-request `statement_timeout` for one search query, 100–60000. A timeout answers with the same status and bytes as a miss. |

## Attachments

| Variable | Default | Security | What it does |
|---|---|---|---|
| `STORAGE_PROVIDER` | `local` | — | `local` \| `s3`. `local` is the default **and is complete** — the `files` volume is all a self-hoster needs, and there is no fourth container. |
| `STORAGE_LOCAL_DIR` | `/var/lib/yapm/files` | — | Where the local provider writes, sharded `<team-uuid>/<attachment-uuid>`. Probed by `/readyz` (write, read back, unlink), so a missing or read-only mount fails readiness rather than somebody's first paste. |
| `S3_BUCKET` | *(unset)* | — | Required when `STORAGE_PROVIDER=s3`; a partial quartet fails boot naming the absent one. |
| `S3_REGION` | *(unset)* | — | The bucket's region (`auto` for Cloudflare R2). |
| `S3_ACCESS_KEY_ID` | *(unset)* | **yes** | Access key id. |
| `S3_SECRET_ACCESS_KEY` | *(unset)* | **yes** | Secret access key. |
| `S3_ENDPOINT` | *(unset)* | — | An S3-compatible endpoint for R2, Backblaze B2, Garage, SeaweedFS, or a MinIO you already run. Unset means AWS. |
| `S3_FORCE_PATH_STYLE` | `false` | — | `true` addresses objects as `<endpoint>/<bucket>/<key>` (MinIO, Garage). |
| `ATTACHMENT_MAX_BYTES` | `26214400` | — | The hard ceiling on one upload, 1024–1073741824. An upload declaring more is refused before a byte is read; a chunked one is cut off at the same ceiling. |
| `ATTACHMENT_ORPHAN_GRACE_HOURS` | `24` | — | How long an upload with neither an issue nor a comment survives before the nightly sweep takes it. |
| `ATTACHMENT_GC_CRON` | `23 4 * * *` | — | When that sweep runs. |

## Read by Compose, not by the app

These never reach the server process. They are read by the compose file itself (to build connection
strings and publish ports) or by the `postgres` and `zero-cache` containers — which is why the app
cannot refuse to boot on `ZERO_ADMIN_PASSWORD` however much it would like to.

| Variable | Default | Security | What it does |
|---|---|---|---|
| `POSTGRES_USER` | `yapm` | — | Database role. Compose interpolates it into `DATABASE_URL` and into all three zero-cache connection strings, so it is set in exactly one place. |
| `POSTGRES_PASSWORD` | `yapm` | **yes** | Its password. The app reads it back out of `DATABASE_URL` and **refuses to start in production** while it is still `yapm`. |
| `POSTGRES_DB` | `yapm` | — | Database name. |
| `POSTGRES_HOST_PORT` | `5440` | — | Host port the **dev** Postgres is published on (`docker/docker-compose.dev.yml`). The production stack does not publish Postgres at all. |
| `ZERO_CACHE_HOST_PORT` | `4848` | — | Host port zero-cache is published on. The browser connects to this origin directly — see `ZERO_CACHE_PUBLIC_URL`. |
| `ZERO_ADMIN_PASSWORD` | `change-me-in-production` | **yes** | Guards the zero-cache inspector and `/statz`. Required by zero-cache outside `NODE_ENV=development`. Only the zero-cache container reads it, so the app cannot detect it — `scripts/init-env.mjs` fills it, and the [first-run checklist](/self-hosting/deploy/#first-run-checklist) checks it. |
| `ZERO_LOG_LEVEL` | `info` | — | zero-cache's own level, independent of `LOG_LEVEL`. Raise it to `debug` while diagnosing a connection that will not settle. |
| `ZERO_IMAGE` | `rocicorp/zero:1.8.0` | — | Pin a different zero-cache image. Must match the `@rocicorp/zero` catalog version so the wire protocol and schema shape agree. |
| `YAPM_HOST_PORT` | `3000` | — | Host port the app is published on. The app always listens on 3000 inside its network. |
| `YAPM_IMAGE` | `yapm:local` | — | Run a prebuilt image instead of building locally, e.g. `ghcr.io/thettwe/yapm:edge`. See [Upgrade and rollback](/self-hosting/upgrade/). |
