import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadEnv } from './env.js'
import {
  describeShippedDefaults,
  enforceShippedDefaults,
  findShippedDefaults,
  SHIPPED_DEFAULTS,
} from './shipped-defaults.js'

const CONFIGURED = {
  BETTER_AUTH_SECRET: 'JdN0hhVn2t4wUpIeMEqe2QSGkQBjP2j1_9UQBfHOR0M',
  DATABASE_URL: 'postgres://yapm:U9Mv3Rz8fJp2@postgres:5432/yapm',
  ZERO_MUTATE_API_KEY: 'BhaGQ0nR7BbCe4nH_hnUnQ',
  ZERO_QUERY_API_KEY: 'KaN2p4dQpq4wYkQ5mVQTOA',
}

const EVERY_DEFAULT = {
  BETTER_AUTH_SECRET: SHIPPED_DEFAULTS.BETTER_AUTH_SECRET,
  DATABASE_URL: `postgres://yapm:${SHIPPED_DEFAULTS.DATABASE_URL}@postgres:5432/yapm`,
  ZERO_MUTATE_API_KEY: SHIPPED_DEFAULTS.ZERO_MUTATE_API_KEY,
  ZERO_QUERY_API_KEY: SHIPPED_DEFAULTS.ZERO_QUERY_API_KEY,
}

interface Recorded {
  level: 'fatal' | 'warn'
  detail: object
  message: string
}

function recordingGate(env: Record<string, unknown>): { records: Recorded[]; exits: number[] } {
  const records: Recorded[] = []
  const exits: number[] = []
  enforceShippedDefaults({
    env,
    logger: {
      fatal: (detail, message) => records.push({ level: 'fatal', detail, message }),
      warn: (detail, message) => records.push({ level: 'warn', detail, message }),
    },
    exit: (code) => exits.push(code),
  })
  return { records, exits }
}

describe('findShippedDefaults', () => {
  it('names every variable still at a shipped default', () => {
    expect(findShippedDefaults(EVERY_DEFAULT)).toEqual([
      'BETTER_AUTH_SECRET',
      'DATABASE_URL',
      'ZERO_MUTATE_API_KEY',
      'ZERO_QUERY_API_KEY',
    ])
  })

  it('names each one on its own, so a partially hardened instance is still reported', () => {
    for (const name of Object.keys(SHIPPED_DEFAULTS)) {
      const env = { ...CONFIGURED, [name]: EVERY_DEFAULT[name as keyof typeof EVERY_DEFAULT] }
      expect(findShippedDefaults(env)).toEqual([name])
    }
  })

  it('says nothing about a fully configured instance', () => {
    expect(findShippedDefaults(CONFIGURED)).toEqual([])
  })

  it('says nothing about an environment that sets none of them', () => {
    expect(findShippedDefaults({})).toEqual([])
  })

  // The whole output is logged, so this is the assertion that keeps the detector from publishing
  // the secret it is complaining about a second time.
  it('reports names, never values', () => {
    const reported = findShippedDefaults(EVERY_DEFAULT).join(' ')
    for (const value of Object.values(SHIPPED_DEFAULTS)) {
      expect(reported).not.toContain(value)
    }
  })

  it('reads the database password out of the connection string, not the whole string', () => {
    expect(findShippedDefaults({ DATABASE_URL: EVERY_DEFAULT.DATABASE_URL })).toEqual([
      'DATABASE_URL',
    ])
    expect(
      findShippedDefaults({ DATABASE_URL: 'postgres://yapm:U9Mv3Rz8fJp2@db.internal:5432/yapm' }),
    ).toEqual([])
    // Same shipped password, a completely different host and database: still the published secret.
    expect(
      findShippedDefaults({
        DATABASE_URL: `postgresql://someone:${SHIPPED_DEFAULTS.DATABASE_URL}@db.example.com:6543/prod`,
      }),
    ).toEqual(['DATABASE_URL'])
  })

  it('does not throw on a malformed or password-less connection string', () => {
    for (const value of ['', 'not-a-url', 'postgres://postgres:5432/yapm', 12345, undefined]) {
      expect(() => findShippedDefaults({ DATABASE_URL: value })).not.toThrow()
      expect(findShippedDefaults({ DATABASE_URL: value })).toEqual([])
    }
  })
})

describe('enforceShippedDefaults', () => {
  it('refuses to boot in production with no escape hatch, naming BETTER_AUTH_SECRET', () => {
    const { records, exits } = recordingGate({ ...EVERY_DEFAULT, NODE_ENV: 'production' })

    expect(records.map((record) => record.level)).toEqual(['fatal'])
    expect(exits).toEqual([1])
    expect(records[0]?.message).toContain('BETTER_AUTH_SECRET')
    expect(records[0]?.message).toContain('ZERO_QUERY_API_KEY')
    expect(records[0]?.message).toContain('DATABASE_URL')
    expect(records[0]?.message).toContain('YAPM_ALLOW_INSECURE_DEFAULTS')
    expect(records[0]?.detail).toMatchObject({
      variables: [
        'BETTER_AUTH_SECRET',
        'DATABASE_URL',
        'ZERO_MUTATE_API_KEY',
        'ZERO_QUERY_API_KEY',
      ],
    })
  })

  it('downgrades the refusal to one warning when the escape hatch is set', () => {
    const { records, exits } = recordingGate({
      ...EVERY_DEFAULT,
      NODE_ENV: 'production',
      YAPM_ALLOW_INSECURE_DEFAULTS: 'true',
    })

    expect(records.map((record) => record.level)).toEqual(['warn'])
    expect(exits).toEqual([])
    expect(records[0]?.message).toContain('BETTER_AUTH_SECRET')
  })

  it('warns outside production without needing the escape hatch', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      const { records, exits } = recordingGate({ ...EVERY_DEFAULT, NODE_ENV: nodeEnv })
      expect(records.map((record) => record.level)).toEqual(['warn'])
      expect(exits).toEqual([])
      expect(records[0]?.message).toContain('BETTER_AUTH_SECRET')
    }
  })

  it('is silent on a configured instance, in production and out of it', () => {
    for (const nodeEnv of ['production', 'development']) {
      const { records, exits } = recordingGate({ ...CONFIGURED, NODE_ENV: nodeEnv })
      expect(records).toEqual([])
      expect(exits).toEqual([])
    }
  })

  it('prints no configured value on any branch', () => {
    const environments = [
      { ...EVERY_DEFAULT, NODE_ENV: 'production' },
      { ...EVERY_DEFAULT, NODE_ENV: 'production', YAPM_ALLOW_INSECURE_DEFAULTS: 'true' },
      { ...EVERY_DEFAULT, NODE_ENV: 'development' },
    ]
    for (const env of environments) {
      const { records } = recordingGate(env)
      const printed = records.map((record) => `${record.message} ${JSON.stringify(record.detail)}`)
      expect(printed).toHaveLength(1)
      for (const value of Object.values(SHIPPED_DEFAULTS)) {
        // `yapm` — the shipped database password — is a substring of nearly everything, so it is
        // the remedy text that has to be checked against it rather than the message as a whole.
        if (value === SHIPPED_DEFAULTS.DATABASE_URL) continue
        expect(printed[0]).not.toContain(value)
      }
      expect(printed[0]).not.toContain(EVERY_DEFAULT.DATABASE_URL)
    }
  })
})

describe('describeShippedDefaults', () => {
  it('names the offenders for /readyz', () => {
    const detail = describeShippedDefaults(EVERY_DEFAULT)
    expect(detail).toContain('BETTER_AUTH_SECRET')
    expect(detail).toContain('ZERO_MUTATE_API_KEY')
    expect(detail).not.toContain(SHIPPED_DEFAULTS.BETTER_AUTH_SECRET)
  })

  it('says so plainly when nothing is defaulted', () => {
    expect(describeShippedDefaults(CONFIGURED)).toBe('no shipped defaults in use')
  })
})

// THE DRIFT CHECK. A detector whose table has drifted from the defaults it is supposed to recognise
// is worse than no detector: it reports a hardened instance while the published secret is still in
// place. Nothing else in the repository can catch that, because both halves look correct on their
// own — so every value in `SHIPPED_DEFAULTS` is bound here, byte for byte, to the artifact that
// actually produces it: the Zod schema for `BETTER_AUTH_SECRET`, and the compose file's
// `${VAR:-default}` interpolation for the rest (the Zero keys are `optional()` in the schema and
// have no default there, and `DATABASE_URL` is assembled by compose from `POSTGRES_PASSWORD`).
describe('SHIPPED_DEFAULTS matches the defaults this repository actually ships', () => {
  const compose = readFileSync(new URL('../../../../docker/docker-compose.yml', import.meta.url), {
    encoding: 'utf8',
  })

  // Every `${NAME:-value}` in the compose file, asserted to be self-consistent: the same variable
  // appears with the same default in the `yapm` and `zero-cache` services, and a divergence there
  // is its own defect.
  function composeDefault(name: string): string {
    const pattern = new RegExp(`\\$\\{${name}:-([^}]*)\\}`, 'g')
    const found = [...compose.matchAll(pattern)].map((match) => match[1] ?? '')
    expect(found.length).toBeGreaterThan(0)
    expect([...new Set(found)]).toHaveLength(1)
    return found[0] as string
  }

  it('covers exactly the four variables this process can observe', () => {
    expect(Object.keys(SHIPPED_DEFAULTS).sort()).toEqual([
      'BETTER_AUTH_SECRET',
      'DATABASE_URL',
      'ZERO_MUTATE_API_KEY',
      'ZERO_QUERY_API_KEY',
    ])
  })

  it('holds the value the Zod schema produces for BETTER_AUTH_SECRET', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://yapm:configured@localhost:5432/yapm' })
    expect(env.BETTER_AUTH_SECRET).toBe(SHIPPED_DEFAULTS.BETTER_AUTH_SECRET)
    // The Zero keys are deliberately `optional()` with no schema default: their shipped values live
    // in compose. If one ever gains a default here it has to be the same string, or the detector
    // and the shipped stack disagree.
    expect(env.ZERO_QUERY_API_KEY).toBeUndefined()
    expect(env.ZERO_MUTATE_API_KEY).toBeUndefined()
  })

  it('holds the values docker-compose.yml interpolates', () => {
    expect(composeDefault('BETTER_AUTH_SECRET')).toBe(SHIPPED_DEFAULTS.BETTER_AUTH_SECRET)
    expect(composeDefault('ZERO_QUERY_API_KEY')).toBe(SHIPPED_DEFAULTS.ZERO_QUERY_API_KEY)
    expect(composeDefault('ZERO_MUTATE_API_KEY')).toBe(SHIPPED_DEFAULTS.ZERO_MUTATE_API_KEY)
    expect(composeDefault('POSTGRES_PASSWORD')).toBe(SHIPPED_DEFAULTS.DATABASE_URL)
  })

  // The end-to-end form of the same claim, through the real schema: the environment a `docker
  // compose up` with an empty `.env` hands the app is detected on every single variable.
  it('detects the environment an empty .env actually produces', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: composeDefault('BETTER_AUTH_SECRET'),
      ZERO_QUERY_API_KEY: composeDefault('ZERO_QUERY_API_KEY'),
      ZERO_MUTATE_API_KEY: composeDefault('ZERO_MUTATE_API_KEY'),
      DATABASE_URL: `postgres://${composeDefault('POSTGRES_USER')}:${composeDefault('POSTGRES_PASSWORD')}@postgres:5432/${composeDefault('POSTGRES_DB')}`,
    })

    expect(findShippedDefaults(env)).toEqual([
      'BETTER_AUTH_SECRET',
      'DATABASE_URL',
      'ZERO_MUTATE_API_KEY',
      'ZERO_QUERY_API_KEY',
    ])

    const { records, exits } = recordingGate(env)
    expect(records.map((record) => record.level)).toEqual(['fatal'])
    expect(exits).toEqual([1])
  })
})
