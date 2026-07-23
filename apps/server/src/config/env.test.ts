import { describe, expect, it } from 'vitest'
import { EnvValidationError, loadEnv } from './env.js'

const VALID = {
  DATABASE_URL: 'postgres://yapm:yapm@localhost:5432/yapm',
} satisfies NodeJS.ProcessEnv

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
})
