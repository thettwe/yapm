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

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: port.default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: postgresUrl,
  DATABASE_POOL_MAX: poolSize.default(10),
  WEB_DIST_DIR: z.string().min(1).optional(),
  SEED_WORKSPACE_NAME: z.string().min(1).default('yapm'),
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
