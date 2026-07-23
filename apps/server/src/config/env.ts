import { isAbsolute, resolve } from 'node:path'
import * as z from 'zod'

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const

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

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: port.default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: postgresUrl,
  DATABASE_POOL_MAX: poolSize.default(10),
  WEB_DIST_DIR: z.string().min(1).optional(),
  SEED_WORKSPACE_NAME: z.string().min(1).default('yapm'),
  ZERO_QUERY_API_KEY: z.string().min(1).optional(),
  ZERO_MUTATE_API_KEY: z.string().min(1).optional(),
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
  // Reserved for outbound email (verification, invite delivery); unset disables email.
  SMTP_URL: optionalString,
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
  ZERO_QUERY_API_KEY: 'the shared secret zero-cache sends as X-Api-Key to /api/zero/query',
  ZERO_MUTATE_API_KEY: 'the shared secret zero-cache sends as X-Api-Key to /api/zero/mutate',
  BETTER_AUTH_SECRET: 'a random string (openssl rand -base64 32); change in production',
  BETTER_AUTH_URL:
    'the server base URL better-auth signs/verifies against, e.g. http://localhost:3000',
  WEB_ORIGIN: 'the browser origin of the SPA, e.g. http://localhost:5173 in dev',
  GITHUB_CLIENT_ID: 'a GitHub OAuth/App client id, or unset to disable GitHub sign-in',
  GITHUB_CLIENT_SECRET: 'the matching GitHub client secret, or unset to disable GitHub sign-in',
  YAPM_BOOTSTRAP_ADMIN_EMAIL:
    'the email that becomes the first admin, or unset for first-user-wins',
  SMTP_URL: 'smtp://user:pass@host:port for outbound email, or unset to disable email',
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
