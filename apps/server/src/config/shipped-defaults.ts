// The literal secrets this repository publishes. They exist so an empty `.env` boots for local
// development; they are also readable by anyone who has ever seen this repository, which makes an
// instance still running on one indistinguishable from an instance with no secrets at all.
//
// `BETTER_AUTH_SECRET` is the sharp one: it encrypts the JWKS private key at rest, so a known value
// plus any database read is the ability to mint a sync JWT for any user.
//
// CONSTRAINT — `ZERO_ADMIN_PASSWORD` is deliberately absent. It is read by the zero-cache container
// and never reaches this process, so the only way to detect it here would be to add it to the `yapm`
// service's `environment:` purely to look at it — a variable the app declares and does nothing with,
// which is exactly what `env-example.test.ts`'s set-equality check exists to prevent. It is covered
// instead by `scripts/init-env.mjs` (which does fill it) and by the hardening page's checklist.
//
// CONSTRAINT — `DATABASE_URL`'s entry is the shipped PASSWORD component, not a whole connection
// string: the host, port and database name are deployment facts, and only the password is a secret
// this repo publishes.
export const SHIPPED_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  BETTER_AUTH_SECRET: 'yapm-dev-secret-change-me-in-production',
  DATABASE_URL: 'yapm',
  ZERO_MUTATE_API_KEY: 'yapm-zero-mutate-key-change-me',
  ZERO_QUERY_API_KEY: 'yapm-zero-query-key-change-me',
})

// What an operator does about each one. Named per variable because "change your secrets" sends
// somebody to the wrong file for the database password, which under the shipped compose stack is
// interpolated from `POSTGRES_PASSWORD` rather than written as a connection string.
export const SHIPPED_DEFAULT_REMEDIES: Readonly<Record<string, string>> = Object.freeze({
  BETTER_AUTH_SECRET: 'set BETTER_AUTH_SECRET to 32 random bytes; it encrypts the JWKS private key',
  DATABASE_URL: 'set POSTGRES_PASSWORD (compose derives DATABASE_URL from it)',
  ZERO_MUTATE_API_KEY: 'set ZERO_MUTATE_API_KEY to a random value',
  ZERO_QUERY_API_KEY: 'set ZERO_QUERY_API_KEY to a random value',
})

// `unknown` rather than `string | undefined` so both `process.env` and the parsed `Env` (whose
// ports and pool sizes are numbers) can be handed to the detector without a cast.
export type ShippedDefaultsSource = Record<string, unknown>

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function databasePassword(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    return decodeURIComponent(new URL(value).password)
  } catch {
    // A malformed connection string is the env schema's verdict to give, not this detector's: it
    // reports what it can read and stays silent about what it cannot.
    return undefined
  }
}

// The offending variable NAMES, sorted. Never a value — this list is logged, and a log line that
// prints the secret it is complaining about has published it a second time.
export function findShippedDefaults(env: ShippedDefaultsSource): string[] {
  const found: string[] = []
  for (const [name, shipped] of Object.entries(SHIPPED_DEFAULTS)) {
    const actual = name === 'DATABASE_URL' ? databasePassword(env[name]) : readString(env[name])
    if (actual === shipped) found.push(name)
  }
  return found.sort()
}

export interface ShippedDefaultsGateLogger {
  fatal: (obj: object, msg: string) => void
  warn: (obj: object, msg: string) => void
}

export interface ShippedDefaultsGateOptions {
  env: ShippedDefaultsSource
  logger: ShippedDefaultsGateLogger
  exit: (code: number) => void
}

const REMEDY = 'run `node scripts/init-env.mjs` and restart with --env-file .env'

// Production plus a published secret is a refusal, not a warning: a warning is a line in a log an
// operator reads once on a stack that came up working, and the failure it fails to prevent is
// somebody forging any user's sync token. `YAPM_ALLOW_INSECURE_DEFAULTS=true` is the one documented
// escape hatch, for evaluation boxes — see design §D2.
export function enforceShippedDefaults(options: ShippedDefaultsGateOptions): void {
  const variables = findShippedDefaults(options.env)
  if (variables.length === 0) return

  const remedies = variables.map((name) => SHIPPED_DEFAULT_REMEDIES[name] ?? name)
  const production = readString(options.env.NODE_ENV) === 'production'
  const permitted = readString(options.env.YAPM_ALLOW_INSECURE_DEFAULTS) === 'true'

  if (production && !permitted) {
    options.logger.fatal(
      { variables, remedies },
      `refusing to start: ${variables.join(', ')} still hold the values this repository ships, which are public; ${REMEDY}, or set YAPM_ALLOW_INSECURE_DEFAULTS=true to run anyway`,
    )
    options.exit(1)
    return
  }

  options.logger.warn(
    { variables, remedies, production, permitted },
    `${variables.join(', ')} still hold the values this repository ships, which are public; ${REMEDY}`,
  )
}

// The `/readyz` line. Non-gating deliberately: an instance on a published secret is misconfigured,
// not unable to serve, and taking it out of rotation would convert a warning into an outage.
export function describeShippedDefaults(env: ShippedDefaultsSource): string {
  const variables = findShippedDefaults(env)
  return variables.length === 0
    ? 'no shipped defaults in use'
    : `shipped defaults still in use: ${variables.join(', ')}`
}
