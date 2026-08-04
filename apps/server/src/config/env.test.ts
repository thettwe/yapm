import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { aiEnv, EnvValidationError, githubAppEnv, loadEnv, mailEnv, storageEnv } from './env.js'

const VALID = {
  DATABASE_URL: 'postgres://yapm:yapm@localhost:5432/yapm',
} satisfies NodeJS.ProcessEnv

const SMTP = 'smtp://user:pass@relay.example.com:587'

const MAIL_REQUIRED = {
  EMAIL_FROM: 'yapm <notifications@example.com>',
  PUBLIC_URL: 'https://yapm.example.com',
}

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

  // pg-boss only parses a cron at `schedule()` time, inside scheduler registration whose failure is
  // caught and logged — so before this, a typo booted a perfectly healthy instance whose sweeps
  // were silently unregistered. The worst shape of failure for a job you notice by its absence.
  it('rejects an unparseable cron expression, naming the variable and the expected format', () => {
    try {
      loadEnv({ ...VALID, NOTIFICATION_RETENTION_CRON: 'every day at 3am' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      const issues = (error as EnvValidationError).issues
      expect(issues[0]?.variable).toBe('NOTIFICATION_RETENTION_CRON')
      expect(issues[0]?.message).toMatch(/^must be a cron expression: /)
      expect(issues[0]?.expected).toContain('five-field cron expression')
    }
  })

  it('checks every cron variable, not just one of them', () => {
    try {
      loadEnv({
        ...VALID,
        CYCLE_MAINTENANCE_CRON: 'hourly',
        NOTIFICATION_EMAIL_CRON: '*/2 * * *ish *',
        NOTIFICATION_RETENTION_CRON: 'nightly',
        GITHUB_RECONCILE_CRON: 'sometimes',
        SEARCH_RECONCILE_CRON: 'occasionally',
      })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      const variables = (error as EnvValidationError).issues.map((issue) => issue.variable)
      expect(variables.sort()).toEqual([
        'CYCLE_MAINTENANCE_CRON',
        'GITHUB_RECONCILE_CRON',
        'NOTIFICATION_EMAIL_CRON',
        'NOTIFICATION_RETENTION_CRON',
        'SEARCH_RECONCILE_CRON',
      ])
    }
  })

  it('accepts the shipped defaults and a hand-written expression', () => {
    const env = loadEnv({ ...VALID, NOTIFICATION_EMAIL_CRON: '*/5 6-20 * * 1-5' })

    expect(env.NOTIFICATION_EMAIL_CRON).toBe('*/5 6-20 * * 1-5')
    expect(env.CYCLE_MAINTENANCE_CRON).toBe('* * * * *')
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

  it('leaves AI disabled and boot unaffected when no AI env is set', () => {
    const env = loadEnv({ ...VALID })
    expect(env.AI_ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.AI_DEFAULT_PROVIDER).toBeUndefined()
    expect(env.AI_DIGEST_ON_CYCLE_CLOSE).toBe('true')
    expect(aiEnv(env)).toEqual({ keys: {}, defaultProvider: null })
  })

  // The PM disclosure pass is default-OFF, and the default differs from the internal digest's on
  // purpose: inheriting `true` would have switched disclosure generation on for every instance at
  // upgrade.
  it('leaves the PM disclosure pass off by default', () => {
    expect(loadEnv({ ...VALID }).AI_PM_DIGEST).toBe('false')
    expect(loadEnv({ ...VALID, AI_PM_DIGEST: 'TRUE ' }).AI_PM_DIGEST).toBe('true')
  })

  // The PM pass runs inside the cycle-digest worker, so this combination describes a job that would
  // never run. Booting healthy and silently doing nothing is the failure this refuses.
  it('fast-fails AI_PM_DIGEST=true while the digest job is off, naming both variables', () => {
    try {
      loadEnv({ ...VALID, AI_PM_DIGEST: 'true', AI_DIGEST_ON_CYCLE_CLOSE: 'false' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const issue = (error as EnvValidationError).issues[0]
      expect(issue?.variable).toBe('AI_PM_DIGEST')
      expect(issue?.message).toContain('AI_DIGEST_ON_CYCLE_CLOSE')
    }
  })

  it('accepts AI_PM_DIGEST=true alongside the digest job', () => {
    expect(
      loadEnv({ ...VALID, AI_PM_DIGEST: 'true', AI_DIGEST_ON_CYCLE_CLOSE: 'true' }).AI_PM_DIGEST,
    ).toBe('true')
  })

  // The ready notice is off at the instance floor, and that default is the decision: it is the one
  // path in this feature that leaves the governed surface.
  it('leaves the PM digest ready notice off by default', () => {
    expect(loadEnv({ ...VALID }).AI_PM_DIGEST_READY_EMAIL).toBe('false')
  })

  it('fast-fails AI_PM_DIGEST_READY_EMAIL=true while the PM digest is off, naming both', () => {
    try {
      loadEnv({ ...VALID, AI_PM_DIGEST_READY_EMAIL: 'true' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const issue = (error as EnvValidationError).issues[0]
      expect(issue?.variable).toBe('AI_PM_DIGEST_READY_EMAIL')
      expect(issue?.message).toContain('AI_PM_DIGEST')
    }
  })

  // No refinement against the mailer: no transport is a CLEAN DISABLEMENT everywhere else in this
  // product, and this follows it rather than inventing a second posture.
  it('accepts the ready notice with no mail transport configured at all', () => {
    const env = loadEnv({
      ...VALID,
      AI_PM_DIGEST_READY_EMAIL: 'true',
      AI_PM_DIGEST: 'true',
      AI_DIGEST_ON_CYCLE_CLOSE: 'true',
    })
    expect(env.AI_PM_DIGEST_READY_EMAIL).toBe('true')
    expect(mailEnv(env)).toBeNull()
  })

  // The bound is a year, and it is configurable. Stated rather than inferred, because
  // "retention-bounded" is a phrase this change earns and an unstated window is not a bound.
  it('defaults the disclosure retention window to 365 days, staggered off notification retention', () => {
    const env = loadEnv({ ...VALID })
    expect(env.AI_DISCLOSURE_RETENTION_DAYS).toBe(365)
    expect(env.AI_DISCLOSURE_RETENTION_CRON).toBe('23 3 * * *')
    expect(env.NOTIFICATION_RETENTION_CRON).toBe('7 3 * * *')
    expect(env.AI_DISCLOSURE_RETENTION_CRON).not.toBe(env.NOTIFICATION_RETENTION_CRON)
  })

  it('rejects a malformed disclosure retention cron by name', () => {
    try {
      loadEnv({ ...VALID, AI_DISCLOSURE_RETENTION_CRON: 'nightly please' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      expect((error as EnvValidationError).issues[0]?.variable).toBe('AI_DISCLOSURE_RETENTION_CRON')
    }
  })

  it('exposes instance-default AI provider keys and the default provider via aiEnv', () => {
    const env = loadEnv({
      ...VALID,
      AI_ANTHROPIC_API_KEY: 'sk-ant',
      AI_OPENAI_API_KEY: 'sk-oai',
      AI_DEFAULT_PROVIDER: 'anthropic',
    })
    expect(aiEnv(env)).toEqual({
      keys: { anthropic: 'sk-ant', openai: 'sk-oai' },
      defaultProvider: 'anthropic',
    })
  })

  it('rejects an unknown AI_DEFAULT_PROVIDER', () => {
    try {
      loadEnv({ ...VALID, AI_DEFAULT_PROVIDER: 'llama' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      expect((error as EnvValidationError).issues[0]?.variable).toBe('AI_DEFAULT_PROVIDER')
    }
  })

  it('treats a whitespace-only AI key as unset', () => {
    const env = loadEnv({ ...VALID, AI_GOOGLE_API_KEY: '   ' })
    expect(env.AI_GOOGLE_API_KEY).toBeUndefined()
    expect(aiEnv(env).keys.google).toBeUndefined()
  })
})

describe('mailEnv', () => {
  it('boots clean with no transport configured and leaves email off', () => {
    const env = loadEnv({ ...VALID })

    expect(env.SMTP_URL).toBeUndefined()
    expect(env.RESEND_API_KEY).toBeUndefined()
    expect(mailEnv(env)).toBeNull()
  })

  it('applies the notification sweep defaults', () => {
    const env = loadEnv({ ...VALID })

    expect(env.NOTIFICATION_EMAIL_CRON).toBe('*/2 * * * *')
    expect(env.NOTIFICATION_RETENTION_DAYS).toBe(30)
    expect(env.NOTIFICATION_RETENTION_CRON).toBe('7 3 * * *')
  })

  it('selects SMTP when only SMTP_URL is set', () => {
    const env = loadEnv({ ...VALID, ...MAIL_REQUIRED, SMTP_URL: SMTP })

    expect(mailEnv(env)).toEqual({
      transport: 'smtp',
      url: SMTP,
      from: MAIL_REQUIRED.EMAIL_FROM,
      publicUrl: MAIL_REQUIRED.PUBLIC_URL,
      ignored: null,
    })
  })

  it('selects Resend when only RESEND_API_KEY is set', () => {
    const env = loadEnv({ ...VALID, ...MAIL_REQUIRED, RESEND_API_KEY: 're_test' })

    expect(mailEnv(env)).toEqual({
      transport: 'resend',
      apiKey: 're_test',
      from: MAIL_REQUIRED.EMAIL_FROM,
      publicUrl: MAIL_REQUIRED.PUBLIC_URL,
      ignored: null,
    })
  })

  it('selects Resend and names SMTP_URL as ignored when both are set', () => {
    const env = loadEnv({
      ...VALID,
      ...MAIL_REQUIRED,
      RESEND_API_KEY: 're_test',
      SMTP_URL: SMTP,
    })

    expect(mailEnv(env)).toEqual({
      transport: 'resend',
      apiKey: 're_test',
      from: MAIL_REQUIRED.EMAIL_FROM,
      publicUrl: MAIL_REQUIRED.PUBLIC_URL,
      ignored: 'SMTP_URL',
    })
  })

  it('fails boot naming EMAIL_FROM when a transport is set without it', () => {
    try {
      loadEnv({ ...VALID, PUBLIC_URL: MAIL_REQUIRED.PUBLIC_URL, SMTP_URL: SMTP })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const issues = (error as EnvValidationError).issues
      expect(issues.map((issue) => issue.variable)).toEqual(['EMAIL_FROM'])
      expect(issues[0]?.message).toContain('SMTP_URL')
      expect(issues[0]?.expected).toContain('required when SMTP_URL or RESEND_API_KEY is set')
    }
  })

  it('fails boot naming PUBLIC_URL when a transport is set without it', () => {
    try {
      loadEnv({ ...VALID, EMAIL_FROM: MAIL_REQUIRED.EMAIL_FROM, RESEND_API_KEY: 're_test' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      const issues = (error as EnvValidationError).issues
      expect(issues.map((issue) => issue.variable)).toEqual(['PUBLIC_URL'])
      expect(issues[0]?.message).toContain('RESEND_API_KEY')
    }
  })

  it('names both when a transport is set with neither', () => {
    try {
      loadEnv({ ...VALID, SMTP_URL: SMTP })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      const issues = (error as EnvValidationError).issues
      expect(issues.map((issue) => issue.variable)).toEqual(['EMAIL_FROM', 'PUBLIC_URL'])
    }
  })

  it('rejects a malformed PUBLIC_URL naming the variable', () => {
    try {
      loadEnv({ ...VALID, ...MAIL_REQUIRED, PUBLIC_URL: 'yapm.example.com', SMTP_URL: SMTP })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const issues = (error as EnvValidationError).issues
      expect(issues[0]?.variable).toBe('PUBLIC_URL')
      expect(issues[0]?.expected).toContain('browsable base URL')
    }
  })

  // Left unchecked, a non-URL reaches nodemailer, which throws `TypeError: Cannot create property
  // 'mailer' on string` — naming neither the variable nor the format.
  it('rejects a SMTP_URL that is not a URL, naming the variable and the format', () => {
    try {
      loadEnv({ ...VALID, ...MAIL_REQUIRED, SMTP_URL: 'not-a-url' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const issues = (error as EnvValidationError).issues
      expect(issues[0]?.variable).toBe('SMTP_URL')
      expect(issues[0]?.message).toContain('must be a URL')
      expect(issues[0]?.expected).toContain('smtp://user:pass@host:587')
    }
  })

  it('rejects a SMTP_URL on the wrong scheme, naming the scheme it got', () => {
    try {
      loadEnv({ ...VALID, ...MAIL_REQUIRED, SMTP_URL: 'https://relay.example.com:587' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      const issues = (error as EnvValidationError).issues
      expect(issues[0]?.variable).toBe('SMTP_URL')
      expect(issues[0]?.message).toContain('smtp:// or smtps://')
      expect(issues[0]?.message).toContain('https://')
    }
  })

  it('accepts an smtps:// URL for implicit TLS', () => {
    const env = loadEnv({
      ...VALID,
      ...MAIL_REQUIRED,
      SMTP_URL: 'smtps://user:pass@relay.example.com:465',
    })

    expect(env.SMTP_URL).toBe('smtps://user:pass@relay.example.com:465')
  })

  it('rejects an EMAIL_FROM with no address in it', () => {
    try {
      loadEnv({
        ...VALID,
        PUBLIC_URL: MAIL_REQUIRED.PUBLIC_URL,
        EMAIL_FROM: 'yapm',
        SMTP_URL: SMTP,
      })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      const issues = (error as EnvValidationError).issues
      expect(issues[0]?.variable).toBe('EMAIL_FROM')
      expect(issues[0]?.message).toContain('must contain an email address')
      expect(issues[0]?.expected).toContain('notifications@example.com')
    }
  })

  it('accepts a bare EMAIL_FROM address as well as a display-name form', () => {
    const env = loadEnv({
      ...VALID,
      PUBLIC_URL: MAIL_REQUIRED.PUBLIC_URL,
      EMAIL_FROM: 'notifications@example.com',
      SMTP_URL: SMTP,
    })

    expect(env.EMAIL_FROM).toBe('notifications@example.com')
  })

  it('treats whitespace-only mail variables as unset, so a blank compose var disables email', () => {
    const env = loadEnv({ ...VALID, SMTP_URL: '   ', RESEND_API_KEY: '  ', EMAIL_FROM: ' ' })

    expect(env.SMTP_URL).toBeUndefined()
    expect(mailEnv(env)).toBeNull()
  })

  it('rejects a NOTIFICATION_RETENTION_DAYS of zero', () => {
    try {
      loadEnv({ ...VALID, NOTIFICATION_RETENTION_DAYS: '0' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect((error as EnvValidationError).issues[0]?.variable).toBe('NOTIFICATION_RETENTION_DAYS')
    }
  })
})

describe('search index configuration', () => {
  it('applies the documented defaults', () => {
    const env = loadEnv({ ...VALID })

    expect(env.SEARCH_INDEX).toBe('true')
    expect(env.SEARCH_INDEX_INTERVAL_SECONDS).toBe(10)
    expect(env.SEARCH_RECONCILE_CRON).toBe('*/5 * * * *')
    expect(env.SEARCH_TEXT_CONFIG).toBe('simple')
    expect(env.SEARCH_STATEMENT_TIMEOUT_MS).toBe(2000)
  })

  // The value reaches SQL as a LITERAL — a parameter cannot appear in an index expression — so the
  // shape is a boot-time gate, failing fast BY NAME rather than at the first DDL.
  it('rejects a text-search configuration that is not a bare identifier, naming the variable', () => {
    for (const value of ["simple'; drop table issue--", 'English', '1simple', '']) {
      try {
        loadEnv({ ...VALID, SEARCH_TEXT_CONFIG: value })
        expect.unreachable('loadEnv should have thrown')
      } catch (error) {
        const issue = (error as EnvValidationError).issues[0]
        expect(issue?.variable).toBe('SEARCH_TEXT_CONFIG')
        expect(issue?.expected).toContain('pg_ts_config')
      }
    }
  })

  it('rejects an out-of-range interval and statement timeout', () => {
    for (const [variable, value] of [
      ['SEARCH_INDEX_INTERVAL_SECONDS', '0'],
      ['SEARCH_INDEX_INTERVAL_SECONDS', '3601'],
      ['SEARCH_STATEMENT_TIMEOUT_MS', '99'],
      ['SEARCH_STATEMENT_TIMEOUT_MS', '60001'],
    ]) {
      try {
        loadEnv({ ...VALID, [variable as string]: value })
        expect.unreachable('loadEnv should have thrown')
      } catch (error) {
        expect((error as EnvValidationError).issues[0]?.variable).toBe(variable)
      }
    }
  })
})

describe('storage configuration', () => {
  const S3_QUARTET = {
    S3_BUCKET: 'yapm-files',
    S3_REGION: 'eu-central-1',
    S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    S3_SECRET_ACCESS_KEY: 'secret',
  }

  it('defaults to the complete local provider with nothing set', () => {
    const env = loadEnv({ ...VALID })

    expect(env.STORAGE_PROVIDER).toBe('local')
    expect(env.STORAGE_LOCAL_DIR).toBe('/var/lib/yapm/files')
    expect(env.ATTACHMENT_MAX_BYTES).toBe(26214400)
    expect(env.ATTACHMENT_ORPHAN_GRACE_HOURS).toBe(24)
    expect(env.ATTACHMENT_GC_CRON).toBe('23 4 * * *')
    expect(storageEnv(env)).toEqual({ provider: 'local', dir: '/var/lib/yapm/files' })
  })

  it('fails boot naming each individually missing S3 variable', () => {
    for (const missing of Object.keys(S3_QUARTET)) {
      const source: NodeJS.ProcessEnv = { ...VALID, ...S3_QUARTET, STORAGE_PROVIDER: 's3' }
      delete source[missing]
      try {
        loadEnv(source)
        expect.unreachable('loadEnv should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError)
        const issues = (error as EnvValidationError).issues
        expect(issues.map((issue) => issue.variable)).toEqual([missing])
        expect(issues[0]?.message).toContain('STORAGE_PROVIDER=s3')
      }
    }
  })

  it('reads whitespace-only S3 values as absent, so a blank compose var is still a boot failure', () => {
    try {
      loadEnv({ ...VALID, ...S3_QUARTET, STORAGE_PROVIDER: 's3', S3_BUCKET: '   ' })
      expect.unreachable('loadEnv should have thrown')
    } catch (error) {
      expect((error as EnvValidationError).issues[0]?.variable).toBe('S3_BUCKET')
    }
  })

  it('returns a complete s3 arm when the quartet is present', () => {
    const env = loadEnv({
      ...VALID,
      ...S3_QUARTET,
      STORAGE_PROVIDER: 's3',
      S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      S3_FORCE_PATH_STYLE: 'true',
    })

    expect(storageEnv(env)).toEqual({
      provider: 's3',
      bucket: 'yapm-files',
      region: 'eu-central-1',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      forcePathStyle: true,
    })
  })

  it('leaves the S3 quartet unrequired under the local provider', () => {
    expect(() => loadEnv({ ...VALID, STORAGE_PROVIDER: 'local' })).not.toThrow()
  })

  it('rejects an out-of-range size or grace window and a malformed cron, naming the variable', () => {
    for (const [variable, value] of [
      ['ATTACHMENT_MAX_BYTES', '1023'],
      ['ATTACHMENT_MAX_BYTES', '1073741825'],
      ['ATTACHMENT_ORPHAN_GRACE_HOURS', '0'],
      ['ATTACHMENT_ORPHAN_GRACE_HOURS', '8761'],
      ['ATTACHMENT_GC_CRON', 'every-day-at-four'],
    ]) {
      try {
        loadEnv({ ...VALID, [variable as string]: value })
        expect.unreachable('loadEnv should have thrown')
      } catch (error) {
        expect((error as EnvValidationError).issues[0]?.variable).toBe(variable)
      }
    }
  })
})
