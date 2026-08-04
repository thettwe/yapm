import { isAbsolute, resolve } from 'node:path'
import { CronExpressionParser } from 'cron-parser'
import * as z from 'zod'

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const

// Every scheduled sweep in this process is driven by a cron string from env, and pg-boss only
// parses it at `schedule()` time — deep inside scheduler registration, whose failure is caught and
// logged so the app still serves. A typo therefore booted a healthy instance with retention and
// email delivery silently switched off. Validated HERE, at boot, with pg-boss's OWN parser and its
// own options (`strict: false`), so what env accepts is exactly what pg-boss accepts.
const cronExpression = z.string().check((ctx) => {
  try {
    CronExpressionParser.parse(ctx.value, { tz: 'UTC', strict: false })
  } catch (error) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: `must be a cron expression: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
})

const postgresUrl = z.string().check((ctx) => {
  let url: URL
  try {
    url = new URL(ctx.value)
  } catch {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: 'must be a URL',
    })
    return
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: `must use the postgres:// or postgresql:// scheme, got "${url.protocol}//"`,
    })
  }
})

const port = z.coerce.number().int().min(1).max(65535)
const poolSize = z.coerce.number().int().min(1).max(1000)
// Treat empty/whitespace (e.g. an unset `${VAR:-}` in docker-compose) as absent, so an
// unconfigured optional provider disables it rather than crashing boot.
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
  z.string().optional(),
)

// The master key for encrypting connector secrets at rest (AES-256-GCM). Optional — absent
// simply means no secrets are stored via the UI. When present it must decode to 32 bytes.
const optionalBase64Key = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
  z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === 32,
      'must be base64-encoded 32 bytes (openssl rand -base64 32)',
    )
    .optional(),
)

// The GitHub App is configured by a triplet. All three or none: a partial triplet is a
// deliberate-but-broken config, so boot fast-fails naming the missing variable(s).
const GITHUB_APP_VARS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_WEBHOOK_SECRET',
] as const

// A mail transport cannot send without a From address, and an email full of localhost links is a
// silent failure no test catches — so both are required as soon as EITHER transport is configured,
// on the GITHUB_APP_VARS precedent. Not required otherwise: unconfigured email is cleanly off.
const MAIL_REQUIRED_VARS = ['EMAIL_FROM', 'PUBLIC_URL'] as const
const MAIL_TRANSPORT_VARS = ['RESEND_API_KEY', 'SMTP_URL'] as const

// The S3 quartet, on the GITHUB_APP_VARS precedent: STORAGE_PROVIDER=s3 with any of these missing is
// a deliberate-but-broken config, so boot fast-fails naming each one. `local` requires nothing —
// object storage is an option, never a prerequisite.
const S3_REQUIRED_VARS = [
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const

const optionalHttpUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
  z.string().url().optional(),
)

// nodemailer takes the URL apart itself and throws an opaque `TypeError: Cannot create property
// 'mailer' on string` on a non-URL, naming neither the variable nor the format — so the scheme is
// checked here, at boot, before a listener exists. smtps:// is implicit TLS, smtp:// is STARTTLS.
const optionalSmtpUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
  z
    .string()
    .check((ctx) => {
      let url: URL
      try {
        url = new URL(ctx.value)
      } catch {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          message: 'must be a URL',
        })
        return
      }
      if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          message: `must use the smtp:// or smtps:// scheme, got "${url.protocol}//"`,
        })
      }
    })
    .optional(),
)

// A From with no address in it is accepted by both transports and rejected by the provider at send
// time, in their log rather than ours. Deliberately loose — this asserts only that an address is
// present, bare or in angle brackets, not RFC 5322.
const MAIL_FROM_ADDRESS = /(^|<)[^<>@\s,]+@[^<>@\s,]+(>|$)/

const optionalMailFrom = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
  z
    .string()
    .regex(MAIL_FROM_ADDRESS, 'must contain an email address, bare or in angle brackets')
    .optional(),
)

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: port.default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    DATABASE_URL: postgresUrl,
    DATABASE_POOL_MAX: poolSize.default(10),
    WEB_DIST_DIR: z.string().min(1).optional(),
    SEED_WORKSPACE_NAME: z.string().min(1).default('yapm'),
    // Seed a demo team + issues on a fresh instance so the list has content in dev. One-shot:
    // it does nothing once any team exists, so it is safe (if inert) to leave on.
    SEED_DEMO_CONTENT: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['true', 'false']),
      )
      .default('false'),
    ZERO_QUERY_API_KEY: z.string().min(1).optional(),
    ZERO_MUTATE_API_KEY: z.string().min(1).optional(),
    // Cycle auto-rollover scheduler (pg-boss on the existing Postgres). Enabled by default;
    // disable it in tests/e2e for deterministic timing. The cron controls how often the
    // idempotent maintenance pass (activate due cycles, complete ended ones) runs.
    CYCLE_MAINTENANCE: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['true', 'false']),
      )
      .default('true'),
    CYCLE_MAINTENANCE_CRON: cronExpression.default('* * * * *'),
    // Auth (better-auth, in-process). Defaults let an empty .env boot for local dev;
    // BETTER_AUTH_SECRET MUST be changed in production.
    BETTER_AUTH_SECRET: z.string().min(1).default('yapm-dev-secret-change-me-in-production'),
    BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    // Optional providers — absent credentials simply disable the provider, never crash boot.
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    // First authenticated user becomes admin; set to bind that to a specific verified email.
    YAPM_BOOTSTRAP_ADMIN_EMAIL: optionalString,
    // Outbound email. Two transports, both optional; neither configured cleanly disables email —
    // the in-app inbox works fully without one, and boot never fails for want of a mailer.
    // SMTP_URL reaches every relay that issues SMTP credentials (Mailgun, Resend, Postmark,
    // SendGrid, SES, Mailjet); RESEND_API_KEY exists because some hosts block outbound SMTP ports
    // entirely, and on those an HTTPS sender is the only path out. Resend wins when both are set.
    // SMTP_URL and EMAIL_FROM have a checkable shape and are checked at boot. RESEND_API_KEY is an
    // opaque credential with no syntax to verify — a wrong key surfaces as a caught, logged 401 on
    // the first send, never as a crash.
    SMTP_URL: optionalSmtpUrl,
    RESEND_API_KEY: optionalString,
    EMAIL_FROM: optionalMailFrom,
    // The browsable base URL a human clicks in an email. Deliberately NOT BETTER_AUTH_URL (the
    // origin better-auth signs against) or WEB_ORIGIN (the CORS-trusted SPA origin) — overloading
    // either is how those two came to disagree.
    PUBLIC_URL: optionalHttpUrl,
    // The notification email sweep and the retention sweep, both on the existing pg-boss instance.
    NOTIFICATION_EMAIL_CRON: cronExpression.default('*/2 * * * *'),
    NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    NOTIFICATION_RETENTION_CRON: cronExpression.default('7 3 * * *'),
    // Connectors (GitHub App). All optional: absent env cleanly DISABLES the connector, never
    // crashes boot. SECRETS_ENCRYPTION_KEY encrypts connector secrets entered via the admin UI;
    // env-provided App credentials do not require it.
    SECRETS_ENCRYPTION_KEY: optionalBase64Key,
    GITHUB_APP_ID: optionalString,
    GITHUB_APP_PRIVATE_KEY: optionalString,
    GITHUB_APP_WEBHOOK_SECRET: optionalString,
    // How often the connector's reconcile sweep re-polls GitHub with conditional (ETag/304)
    // requests to heal any missed webhook. Only runs when the GitHub App is configured.
    GITHUB_RECONCILE_CRON: cronExpression.default('*/15 * * * *'),
    // AI (BYO-key gateway). ALL optional: absent env cleanly DISABLES AI, never crashes boot.
    // These are the OPTIONAL instance-default provider keys for a single-instance self-host that
    // prefers env over DB-resident secrets (mirroring githubAppEnv); UI-entered per-workspace
    // keys use SECRETS_ENCRYPTION_KEY instead. AI_DEFAULT_PROVIDER picks which of the three is the
    // instance default. AI_DIGEST_ON_CYCLE_CLOSE gates the digest pre-compute job (default on).
    AI_ANTHROPIC_API_KEY: optionalString,
    AI_GOOGLE_API_KEY: optionalString,
    AI_OPENAI_API_KEY: optionalString,
    AI_DEFAULT_PROVIDER: z.preprocess(
      (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
      z.enum(['anthropic', 'google', 'openai']).optional(),
    ),
    AI_DIGEST_ON_CYCLE_CLOSE: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['true', 'false']),
      )
      .default('true'),
    // The lazy retro-draft tail, on the EXISTING pg-boss instance and gated INDEPENDENTLY of
    // AI_DIGEST_ON_CYCLE_CLOSE. Off means the tail is never registered: `pending` rows accumulate
    // harmlessly and drain if it is turned back on. Nothing drafts for a team that has not opted in,
    // whatever this is set to.
    AI_RETRO_DRAFT: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['true', 'false']),
      )
      .default('true'),
    // The PM disclosure pass, and it is its OWN toggle rather than a reuse of
    // AI_DIGEST_ON_CYCLE_CLOSE for two reasons. One variable governing a team-internal artifact AND a
    // cross-boundary disclosure is exactly the coupling AI_RETRO_DRAFT was created to avoid, and the
    // argument is strictly stronger here because one of the two crosses a permission boundary. And
    // the DEFAULT differs: AI_DIGEST_ON_CYCLE_CLOSE defaults to true, so inheriting it would have
    // switched disclosure generation on for every existing instance at upgrade.
    //
    // Nothing is disclosed for a workspace that has not turned the policy on, whatever this is set
    // to; this is the instance floor, not the workspace ceiling.
    AI_PM_DIGEST: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['true', 'false']),
      )
      .default('false'),
    // The optional "your cycle digest is ready" notice to the named readers. Off at the instance
    // floor, and that default is the decision rather than an oversight: it is the one path in this
    // feature that leaves the governed surface, so an operator opts into it explicitly. On top of it
    // sit the per-recipient `email_notifications` preference and the presence of a transport.
    //
    // The message carries A LINK ONLY, never the digest body — a mailed artifact sits outside the
    // kill switch, outside retention and outside the audit log simultaneously.
    AI_PM_DIGEST_READY_EMAIL: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['true', 'false']),
      )
      .default('false'),
    // The disclosure audit log's retention bound, on the EXISTING pg-boss instance and registered
    // UNCONDITIONALLY — like notification retention and unlike every AI block. An instance that once
    // had disclosure enabled and then turned AI_PM_DIGEST off must still have its audit log swept: a
    // bound that stops being enforced when the feature is disabled is not a bound.
    //
    // 365 rather than notification retention's 30. The question an audit log is asked — what did we
    // share with product, and when did the policy change — is asked at annual-review cadence, and a
    // shorter window loses the record of a policy change made two quarters ago that is STILL in
    // effect. The table is server-only and syncs to nobody, so the only pressure on it is unbounded
    // growth, which a year bounds at a cost of kilobytes.
    AI_DISCLOSURE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
    // Offset from notification retention's `7 3 * * *`: both are nightly, and there is no reason for
    // two bulk deletes to start in the same minute on one Postgres.
    AI_DISCLOSURE_RETENTION_CRON: cronExpression.default('23 3 * * *'),
    // Server-side search index maintenance, on the EXISTING pg-boss instance. Off means the
    // `/api/v1/search` route keeps answering — with whatever the index already holds — rather than
    // failing; the on-device pass is unaffected either way.
    SEARCH_INDEX: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['true', 'false']),
      )
      .default('true'),
    // pg-boss cron granularity is one minute and "seconds of staleness" needs better, so the tail
    // worker re-arms itself with this delay; a fixed one-minute cron watchdog heals a broken chain
    // and is deliberately NOT tunable (there is no reason to turn it).
    SEARCH_INDEX_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(3600).default(10),
    SEARCH_RECONCILE_CRON: cronExpression.default('*/5 * * * *'),
    // Interpolated into SQL as a LITERAL — a parameter cannot appear in an index expression — so
    // the shape is pinned here, at boot, failing fast BY NAME. Existence is a separate rail: the
    // reconcile job checks `pg_ts_config` before any DDL and leaves the old index in place if the
    // configuration is unknown. `simple` rather than `english` because stemming would quietly
    // optimise for English teams.
    SEARCH_TEXT_CONFIG: z
      .string()
      .regex(/^[a-z_][a-z0-9_]{0,62}$/, 'must be a Postgres text-search configuration name')
      .default('simple'),
    // The search read's own `statement_timeout`. A timeout returns the same status and the same
    // bytes as a miss (a 503 beside a 200 would be an oracle over corpus size), so this bounds the
    // work rather than shaping the answer.
    SEARCH_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(2000),
    // Attachment byte storage. `local` is the DEFAULT and is COMPLETE — a self-hoster with no
    // object store gets full functionality, so this is not a fallback. `s3` is the option, and it
    // is all-or-nothing (see the refinement below).
    //
    // There is no signed-URL variable here and there never will be: an <img src> lives in a
    // document that syncs to every team member's IndexedDB, so a URL stored in one is a bearer
    // capability at rest on every client. The app proxies bytes for BOTH providers instead, which
    // is what makes the permission check literally the same code either way.
    STORAGE_PROVIDER: z
      .preprocess(
        (value) =>
          typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined,
        z.enum(['local', 's3']),
      )
      .default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('/var/lib/yapm/files'),
    S3_BUCKET: optionalString,
    S3_REGION: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    // Optional, and the reason R2 / Backblaze B2 / Garage / SeaweedFS / a MinIO an operator
    // already runs are all reachable. Absent means AWS: https://s3.<region>.amazonaws.com.
    S3_ENDPOINT: optionalHttpUrl,
    S3_FORCE_PATH_STYLE: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['true', 'false']),
      )
      .default('false'),
    // The one hard limit on a single upload, enforced by `hono/body-limit` on whichever of two
    // exclusive paths applies: an upload declaring a Content-Length over this ceiling is refused
    // before a byte is read; one declaring no length (chunked) is counted as it arrives and cut
    // off at the same ceiling.
    ATTACHMENT_MAX_BYTES: z.coerce.number().int().min(1024).max(1073741824).default(26214400),
    // How long an attachment with neither an issue nor a comment survives before the sweep takes
    // it. The sharp edge is written down rather than smoothed over: somebody who pastes an image
    // and then leaves the tab open longer than this without the document saving loses it.
    ATTACHMENT_ORPHAN_GRACE_HOURS: z.coerce.number().int().min(1).max(8760).default(24),
    ATTACHMENT_GC_CRON: cronExpression.default('23 4 * * *'),
  })
  .check((ctx) => {
    const value = ctx.value
    const present = GITHUB_APP_VARS.filter((name) => value[name] !== undefined)
    if (present.length === 0 || present.length === GITHUB_APP_VARS.length) return
    for (const name of GITHUB_APP_VARS) {
      if (value[name] === undefined) {
        ctx.issues.push({
          code: 'custom',
          input: value[name],
          path: [name],
          message: 'is required when any GITHUB_APP_* variable is set (the App needs all three)',
        })
      }
    }
  })
  .check((ctx) => {
    const value = ctx.value
    const transport = MAIL_TRANSPORT_VARS.find((name) => value[name] !== undefined)
    if (transport === undefined) return
    for (const name of MAIL_REQUIRED_VARS) {
      if (value[name] === undefined) {
        ctx.issues.push({
          code: 'custom',
          input: value[name],
          path: [name],
          message: `is required when ${transport} is set (an email transport needs a From address and a public base URL)`,
        })
      }
    }
  })
  .check((ctx) => {
    // The PM pass runs INSIDE the cycle-digest worker, over the facts that worker already built, so
    // `AI_PM_DIGEST=true` with `AI_DIGEST_ON_CYCLE_CLOSE=false` describes a job that is never
    // registered. Rather than booting healthy and silently doing nothing, this fails at boot naming
    // BOTH variables. An operator who wants only the PM digest is asking for something this
    // architecture does not offer, and saying so at boot is cheaper than a support thread.
    const value = ctx.value
    if (value.AI_PM_DIGEST !== 'true' || value.AI_DIGEST_ON_CYCLE_CLOSE === 'true') return
    ctx.issues.push({
      code: 'custom',
      input: value.AI_PM_DIGEST,
      path: ['AI_PM_DIGEST'],
      message:
        'cannot be true while AI_DIGEST_ON_CYCLE_CLOSE is false: the PM digest runs inside the cycle-digest job, so it would never run',
    })
  })
  .check((ctx) => {
    // The same shape, for the same reason, one layer out: a ready notice for an artifact that is
    // never generated is a config an operator wrote deliberately and got nothing from. Fails at boot
    // naming BOTH variables rather than booting healthy and silently mailing nobody. No refinement
    // is added against the mailer — no transport is a clean disablement everywhere else in this
    // product, and this follows it rather than inventing a second posture.
    const value = ctx.value
    if (value.AI_PM_DIGEST_READY_EMAIL !== 'true' || value.AI_PM_DIGEST === 'true') return
    ctx.issues.push({
      code: 'custom',
      input: value.AI_PM_DIGEST_READY_EMAIL,
      path: ['AI_PM_DIGEST_READY_EMAIL'],
      message:
        'cannot be true while AI_PM_DIGEST is false: no PM digest is ever generated, so no notice would ever be sent',
    })
  })
  .check((ctx) => {
    const value = ctx.value
    if (value.STORAGE_PROVIDER !== 's3') return
    for (const name of S3_REQUIRED_VARS) {
      if (value[name] === undefined) {
        ctx.issues.push({
          code: 'custom',
          input: value[name],
          path: [name],
          message:
            'is required when STORAGE_PROVIDER=s3 (the bucket, its region and a credential pair are all needed to sign a request)',
        })
      }
    }
  })

export type Env = Omit<z.infer<typeof envSchema>, 'WEB_DIST_DIR'> & {
  WEB_DIST_DIR: string
}

export const EXPECTED_FORMAT: Record<string, string> = {
  NODE_ENV: 'one of development | test | production',
  HOST: 'a hostname or IP to bind, e.g. 0.0.0.0',
  PORT: 'an integer between 1 and 65535, e.g. 3000',
  LOG_LEVEL: `one of ${LOG_LEVELS.join(' | ')}`,
  DATABASE_URL: 'postgres://user:password@host:5432/database',
  DATABASE_POOL_MAX: 'an integer between 1 and 1000, e.g. 10',
  WEB_DIST_DIR: 'a path to the built SPA directory containing index.html',
  SEED_WORKSPACE_NAME: 'a non-empty string',
  SEED_DEMO_CONTENT: "'true' to seed demo issues on a fresh instance, or 'false'",
  ZERO_QUERY_API_KEY: 'the shared secret zero-cache sends as X-Api-Key to /api/zero/query',
  ZERO_MUTATE_API_KEY: 'the shared secret zero-cache sends as X-Api-Key to /api/zero/mutate',
  CYCLE_MAINTENANCE: "'true' to run the cycle auto-rollover scheduler, or 'false' to disable it",
  CYCLE_MAINTENANCE_CRON:
    "a five-field cron expression (minute hour day-of-month month day-of-week), e.g. '* * * * *' for every minute",
  BETTER_AUTH_SECRET: 'a random string (openssl rand -base64 32); change in production',
  BETTER_AUTH_URL:
    'the server base URL better-auth signs/verifies against, e.g. http://localhost:3000',
  WEB_ORIGIN:
    'the SPA browser origin trusted for CORS, e.g. http://localhost:5173 with `pnpm dev` (Vite) or your app origin when the app serves the built SPA same-origin',
  GITHUB_CLIENT_ID: 'a GitHub OAuth/App client id, or unset to disable GitHub sign-in',
  GITHUB_CLIENT_SECRET: 'the matching GitHub client secret, or unset to disable GitHub sign-in',
  YAPM_BOOTSTRAP_ADMIN_EMAIL:
    'the email that becomes the first admin, or unset for first-user-wins',
  SMTP_URL:
    'smtp://user:pass@host:587 for outbound email over an SMTP relay, or unset (ignored when RESEND_API_KEY is also set)',
  RESEND_API_KEY:
    'a Resend API key to send over HTTPS instead of SMTP (for hosts that block outbound SMTP ports), or unset',
  EMAIL_FROM:
    'the From address outbound email is sent as, e.g. yapm <notifications@example.com>; required when SMTP_URL or RESEND_API_KEY is set',
  PUBLIC_URL:
    'the browsable base URL used to build email deep links, e.g. https://yapm.example.com; required when SMTP_URL or RESEND_API_KEY is set',
  NOTIFICATION_EMAIL_CRON:
    "a five-field cron expression for the notification email sweep, e.g. '*/2 * * * *' for every two minutes",
  NOTIFICATION_RETENTION_DAYS:
    'an integer number of days to keep notifications before deleting them, e.g. 30',
  NOTIFICATION_RETENTION_CRON:
    "a five-field cron expression for the notification retention sweep, e.g. '7 3 * * *' for 03:07 daily",
  SECRETS_ENCRYPTION_KEY:
    'base64-encoded 32 random bytes (openssl rand -base64 32) to encrypt connector secrets at rest, or unset',
  GITHUB_APP_ID:
    'the numeric GitHub App ID; set with the other GITHUB_APP_* vars, or leave all unset',
  GITHUB_APP_PRIVATE_KEY:
    'the GitHub App private key PEM (PKCS#1); set with the other GITHUB_APP_* vars, or leave all unset',
  GITHUB_APP_WEBHOOK_SECRET:
    'the GitHub App webhook secret; set with the other GITHUB_APP_* vars, or leave all unset',
  GITHUB_RECONCILE_CRON:
    "a five-field cron expression for the connector reconcile sweep, e.g. '*/15 * * * *'",
  AI_ANTHROPIC_API_KEY:
    'an Anthropic API key as the instance-default AI provider key, or unset (per-workspace keys are entered in the admin UI)',
  AI_GOOGLE_API_KEY: 'a Google Gemini API key as the instance-default AI provider key, or unset',
  AI_OPENAI_API_KEY: 'an OpenAI API key as the instance-default AI provider key, or unset',
  AI_DEFAULT_PROVIDER:
    'one of anthropic | google | openai — the instance-default AI provider, or unset',
  AI_DIGEST_ON_CYCLE_CLOSE:
    "'true' to pre-compute a cycle digest when a cycle closes (default), or 'false' to disable it",
  AI_RETRO_DRAFT:
    "'true' to run the lazy retro AI draft tail (default), or 'false' to disable it — per-team opt-in still applies",
  AI_PM_DIGEST:
    "'true' to generate PM-facing cycle digests for teams whose admin has turned disclosure on, or 'false' (the default); requires AI_DIGEST_ON_CYCLE_CLOSE=true",
  AI_PM_DIGEST_READY_EMAIL:
    "'true' to email named readers a link when a cycle digest is published — a link only, never the digest body — or 'false' (the default); requires AI_PM_DIGEST=true and a mail transport",
  AI_DISCLOSURE_RETENTION_DAYS:
    'an integer number of days to keep disclosure audit records before deleting them, e.g. 365 (the default — an audit log is read at annual-review cadence)',
  AI_DISCLOSURE_RETENTION_CRON:
    "a five-field cron expression for the disclosure audit retention sweep, e.g. '23 3 * * *' for 03:23 daily",
  SEARCH_INDEX:
    "'true' to maintain the server-side search index in the background (default), or 'false' to disable it",
  SEARCH_INDEX_INTERVAL_SECONDS:
    'an integer number of seconds between search index passes, 1 to 3600, e.g. 10',
  SEARCH_RECONCILE_CRON:
    "a five-field cron expression for the search reconcile/backfill pass, e.g. '*/5 * * * *' for every five minutes",
  SEARCH_TEXT_CONFIG:
    "a Postgres text-search configuration name matching ^[a-z_][a-z0-9_]{0,62}$ and present in pg_ts_config, e.g. 'simple' (the default) or 'english'",
  SEARCH_STATEMENT_TIMEOUT_MS:
    'an integer millisecond ceiling for one search query, 100 to 60000, e.g. 2000',
  STORAGE_PROVIDER:
    "one of local | s3 — where attachment bytes live; 'local' (the default) is complete on its own",
  STORAGE_LOCAL_DIR:
    'an absolute directory for attachment bytes under the local provider, e.g. /var/lib/yapm/files',
  S3_BUCKET: 'the bucket attachments are stored in; required when STORAGE_PROVIDER=s3',
  S3_REGION:
    "the bucket's region, e.g. eu-central-1 (use 'auto' for R2); required when STORAGE_PROVIDER=s3",
  S3_ACCESS_KEY_ID: 'the access key id; required when STORAGE_PROVIDER=s3',
  S3_SECRET_ACCESS_KEY: 'the secret access key; required when STORAGE_PROVIDER=s3',
  S3_ENDPOINT:
    'an S3-compatible endpoint URL for R2/B2/Garage/MinIO, e.g. https://<account>.r2.cloudflarestorage.com, or unset for AWS',
  S3_FORCE_PATH_STYLE:
    "'true' to address objects as <endpoint>/<bucket>/<key> (MinIO, Garage), or 'false' for virtual-host style (the default)",
  ATTACHMENT_MAX_BYTES:
    'an integer byte ceiling for one upload, 1024 to 1073741824, e.g. 26214400 (25 MiB)',
  ATTACHMENT_ORPHAN_GRACE_HOURS:
    'an integer number of hours an unattached upload survives before the sweep deletes it, 1 to 8760, e.g. 24',
  ATTACHMENT_GC_CRON:
    "a five-field cron expression for the orphaned-attachment sweep, e.g. '23 4 * * *' for 04:23 daily",
}

export interface EnvIssue {
  variable: string
  message: string
  expected: string
}

export class EnvValidationError extends Error {
  issues: EnvIssue[]

  constructor(issues: EnvIssue[]) {
    super(formatIssues(issues))
    this.name = 'EnvValidationError'
    this.issues = issues
  }
}

function formatIssues(issues: EnvIssue[]): string {
  const lines = issues.map(
    (issue) => `  ${issue.variable}: ${issue.message}\n      expected: ${issue.expected}`,
  )
  return `Invalid environment configuration:\n${lines.join('\n')}`
}

const packageRoot = resolve(import.meta.dirname, '../..')

function defaultWebDistDir(): string {
  return resolve(packageRoot, '../web/dist')
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const variable = issue.path.join('.') || '(root)'
      const message =
        issue.code === 'invalid_type' && source[variable] === undefined
          ? 'is required but not set'
          : issue.message
      return {
        variable,
        message,
        expected: EXPECTED_FORMAT[variable] ?? 'see apps/server/src/config/env.ts',
      }
    })
    throw new EnvValidationError(issues)
  }

  const parsed = result.data
  const webDistDir = parsed.WEB_DIST_DIR ?? defaultWebDistDir()

  return {
    ...parsed,
    WEB_DIST_DIR: isAbsolute(webDistDir) ? webDistDir : resolve(process.cwd(), webDistDir),
  }
}

export interface GithubAppEnv {
  appId: string
  privateKey: string
  webhookSecret: string
}

// The GitHub App credentials as a triplet when all present, else null (connector disabled).
// The env schema guarantees the triplet is all-or-nothing, so a non-null result is complete.
export function githubAppEnv(env: Env): GithubAppEnv | null {
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_WEBHOOK_SECRET) {
    return {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
    }
  }
  return null
}

export type AiProviderName = 'anthropic' | 'google' | 'openai'

export interface AiEnv {
  // Instance-default provider keys from env (a per-provider fallback used when a workspace has no
  // UI-entered key for that provider). Empty when none are set.
  keys: Partial<Record<AiProviderName, string>>
  // The instance-default provider, if configured.
  defaultProvider: AiProviderName | null
}

// The AI instance-default provider keys + default provider from env, mirroring `githubAppEnv`.
// Every field optional: an empty result simply means no env-level AI defaults, so AI is driven
// entirely by per-workspace UI config (or is off). Never throws — absent env disables cleanly.
export function aiEnv(env: Env): AiEnv {
  const keys: Partial<Record<AiProviderName, string>> = {}
  if (env.AI_ANTHROPIC_API_KEY) keys.anthropic = env.AI_ANTHROPIC_API_KEY
  if (env.AI_GOOGLE_API_KEY) keys.google = env.AI_GOOGLE_API_KEY
  if (env.AI_OPENAI_API_KEY) keys.openai = env.AI_OPENAI_API_KEY
  return { keys, defaultProvider: env.AI_DEFAULT_PROVIDER ?? null }
}

export type MailEnv =
  | {
      transport: 'resend'
      apiKey: string
      from: string
      publicUrl: string
      ignored: 'SMTP_URL' | null
    }
  | { transport: 'smtp'; url: string; from: string; publicUrl: string; ignored: null }

// The selected mail transport from env, or null when email is off, mirroring `githubAppEnv`.
//
// Resend wins the tie deliberately: an operator who added RESEND_API_KEY on top of an existing
// SMTP_URL has almost certainly done so because their host blocks outbound SMTP, which is the whole
// reason the HTTPS sender exists. Refusing to boot on a config where neither value is malformed
// would be a footgun on upgrade, so the ambiguity resolves to a documented precedence plus one warn
// log naming the ignored variable.
//
// `from` and `publicUrl` are non-optional here because the env schema's mail refinement already
// failed boot if either was missing alongside a transport — a non-null result is complete.
export function mailEnv(env: Env): MailEnv | null {
  const from = env.EMAIL_FROM
  const publicUrl = env.PUBLIC_URL
  if (from === undefined || publicUrl === undefined) return null
  if (env.RESEND_API_KEY) {
    return {
      transport: 'resend',
      apiKey: env.RESEND_API_KEY,
      from,
      publicUrl,
      ignored: env.SMTP_URL ? 'SMTP_URL' : null,
    }
  }
  if (env.SMTP_URL) {
    return { transport: 'smtp', url: env.SMTP_URL, from, publicUrl, ignored: null }
  }
  return null
}

export type StorageEnv =
  | { provider: 'local'; dir: string }
  | {
      provider: 's3'
      bucket: string
      region: string
      accessKeyId: string
      secretAccessKey: string
      endpoint: string | null
      forcePathStyle: boolean
    }

// The selected byte store from env, mirroring `githubAppEnv`/`mailEnv` in shape — and differing
// from both in the one way that matters: it NEVER returns null. Email is an optional feature whose
// absence is a complete product; storage is not, so `local` is what an unconfigured instance gets.
//
// The env schema's refinement already failed boot if any of the S3 quartet was missing alongside
// `STORAGE_PROVIDER=s3`, so the `s3` arm is complete by construction rather than by a cast.
export function storageEnv(env: Env): StorageEnv {
  if (env.STORAGE_PROVIDER === 's3') {
    return {
      provider: 's3',
      bucket: env.S3_BUCKET ?? '',
      region: env.S3_REGION ?? '',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      endpoint: env.S3_ENDPOINT ?? null,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    }
  }
  return { provider: 'local', dir: env.STORAGE_LOCAL_DIR }
}
