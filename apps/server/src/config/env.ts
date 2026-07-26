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
