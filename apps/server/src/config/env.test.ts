import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EnvValidationError, githubAppEnv, loadEnv } from './env.js'

const VALID = {
  DATABASE_URL: 'postgres://yapm:yapm@localhost:5432/yapm',
} satisfies NodeJS.ProcessEnv

const APP_TRIPLET = {
  GITHUB_APP_ID: '123456',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nMII...\n-----END RSA PRIVATE KEY-----',
  GITHUB_APP_WEBHOOK_SECRET: 'whsec_test',
}

describe('loadEnv', () => {
  it('applies documented defaults', () => {
    const env = loadEnv({ ...VALID })

    expect(env.NODE_ENV).toBe('development')
    expect(env.HOST).toBe('0.0.0.0')
    expect(env.PORT).toBe(3000)
    expect(env.LOG_LEVEL).toBe('info')
    expect(env.DATABASE_POOL_MAX).toBe(10)
    expect(env.SEED_WORKSPACE_NAME).toBe('yapm')
  })

  it('resolves WEB_DIST_DIR to an absolute path', () => {
    const fromDefault = loadEnv({ ...VALID })
    expect(fromDefault.WEB_DIST_DIR.startsWith('/')).toBe(true)

    const fromRelative = loadEnv({ ...VALID, WEB_DIST_DIR: './public' })
    expect(fromRelative.WEB_DIST_DIR).toBe(`${process.cwd()}/public`)

    const fromAbsolute = loadEnv({ ...VALID, WEB_DIST_DIR: '/srv/yapm/web' })
    expect(fromAbsolute.WEB_DIST_DIR).toBe('/srv/yapm/web')
  })

  it('names a missing required variable and its expected format', () => {
    try {
      loadEnv({})
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const issues = (error as EnvValidationError).issues
      expect(issues).toHaveLength(1)
      expect(issues[0]?.variable).toBe('DATABASE_URL')
      expect(issues[0]?.message).toBe('is required but not set')
      expect(issues[0]?.expected).toBe('postgres://user:password@host:5432/database')
      expect((error as Error).message).toContain('DATABASE_URL')
      expect((error as Error).message).toContain('postgres://user:password@host:5432/database')
    }
  })

  it('rejects a database URL with the wrong scheme', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost:3306/yapm' })).toThrow(
      /DATABASE_URL: must use the postgres:\/\/ or postgresql:\/\/ scheme/,
    )
  })

  it('rejects a database URL that is not a URL at all', () => {
    expect(() => loadEnv({ DATABASE_URL: 'localhost' })).toThrow(/DATABASE_URL: must be a URL/)
  })

  it('rejects an out-of-range port and reports the expected format', () => {
    try {
      loadEnv({ ...VALID, PORT: '70000' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      const issues = (error as EnvValidationError).issues
      expect(issues[0]?.variable).toBe('PORT')
      expect(issues[0]?.expected).toBe('an integer between 1 and 65535, e.g. 3000')
    }
  })

  it('reports every invalid variable at once', () => {
    try {
      loadEnv({ DATABASE_URL: 'mysql://localhost/yapm', LOG_LEVEL: 'loud', PORT: 'abc' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      const variables = (error as EnvValidationError).issues.map((issue) => issue.variable)
      expect(variables.sort()).toEqual(['DATABASE_URL', 'LOG_LEVEL', 'PORT'])
    }
  })

  it('leaves the GitHub connector disabled when no App env is set', () => {
    const env = loadEnv({ ...VALID })
    expect(env.GITHUB_APP_ID).toBeUndefined()
    expect(env.SECRETS_ENCRYPTION_KEY).toBeUndefined()
    expect(githubAppEnv(env)).toBeNull()
  })

  it('accepts a full GitHub App triplet and exposes it via githubAppEnv', () => {
    const env = loadEnv({ ...VALID, ...APP_TRIPLET })
    expect(githubAppEnv(env)).toEqual({
      appId: APP_TRIPLET.GITHUB_APP_ID,
      privateKey: APP_TRIPLET.GITHUB_APP_PRIVATE_KEY,
      webhookSecret: APP_TRIPLET.GITHUB_APP_WEBHOOK_SECRET,
    })
  })

  it('fast-fails a partial GitHub App triplet, naming the missing variables', () => {
    try {
      loadEnv({ ...VALID, GITHUB_APP_ID: '123456' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const variables = (error as EnvValidationError).issues.map((issue) => issue.variable).sort()
      expect(variables).toEqual(['GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_WEBHOOK_SECRET'])
    }
  })

  it('treats a whitespace-only GitHub App value as unset (no partial-config error)', () => {
    const env = loadEnv({ ...VALID, GITHUB_APP_ID: '   ' })
    expect(githubAppEnv(env)).toBeNull()
  })

  it('accepts a valid base64 32-byte SECRETS_ENCRYPTION_KEY', () => {
    const key = randomBytes(32).toString('base64')
    expect(loadEnv({ ...VALID, SECRETS_ENCRYPTION_KEY: key }).SECRETS_ENCRYPTION_KEY).toBe(key)
  })

  it('rejects a SECRETS_ENCRYPTION_KEY that does not decode to 32 bytes', () => {
    try {
      loadEnv({ ...VALID, SECRETS_ENCRYPTION_KEY: randomBytes(16).toString('base64') })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      const issues = (error as EnvValidationError).issues
      expect(issues[0]?.variable).toBe('SECRETS_ENCRYPTION_KEY')
    }
  })
})
