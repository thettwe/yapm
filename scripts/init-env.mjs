#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Writes the repo-root `.env` the documented quickstart passes to `--env-file`, with a generated
// value for every secret this repository publishes. `cp .env.example .env` alone would produce a
// file that is read and still says `yapm-dev-secret-change-me-in-production`.
//
// CONSTRAINT — dependency-free, and no import of anything under `apps/`: this runs against a clean
// checkout BEFORE `pnpm install`, so `node_modules` does not exist yet.
//
// The names below are `SHIPPED_DEFAULTS` from `apps/server/src/config/shipped-defaults.ts` with two
// deliberate differences: `DATABASE_URL` is replaced by `POSTGRES_PASSWORD`, which is what compose
// interpolates the connection string from, and `ZERO_ADMIN_PASSWORD` is added — the zero-cache
// container reads it and the app never sees it, so it is fillable here but not detectable there.
const GENERATED = [
  'BETTER_AUTH_SECRET',
  'POSTGRES_PASSWORD',
  'ZERO_ADMIN_PASSWORD',
  'ZERO_MUTATE_API_KEY',
  'ZERO_QUERY_API_KEY',
]

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const examplePath = join(repoRoot, '.env.example')
const envPath = join(repoRoot, '.env')

if (existsSync(envPath)) {
  console.error(`refusing to overwrite ${envPath}`)
  console.error('Delete it first if you want a fresh one — it may hold the only copy of a secret.')
  process.exit(1)
}

if (!existsSync(examplePath)) {
  console.error(`missing ${examplePath}; run this from a checkout of the repository`)
  process.exit(1)
}

const secret = () => randomBytes(32).toString('base64url')

const filled = []
const lines = readFileSync(examplePath, 'utf8').split('\n')
const output = lines.map((line) => {
  // Uncommented assignments only: a commented `# NAME=value` documents a default the operator has
  // not chosen, and uncommenting it here would turn documentation into configuration.
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
  const name = match?.[1]
  if (name === undefined || !GENERATED.includes(name)) return line
  filled.push(name)
  return `${name}=${secret()}`
})

writeFileSync(envPath, output.join('\n'), { mode: 0o600 })

console.log(`wrote ${envPath} (mode 0600)`)
console.log(`generated a random value for: ${filled.sort().join(', ')}`)
const missing = GENERATED.filter((name) => !filled.includes(name))
if (missing.length > 0) {
  console.warn(`not present in .env.example, so NOT generated: ${missing.sort().join(', ')}`)
}
console.log(
  'Next: docker compose --env-file .env -f docker/docker-compose.yml up -d --build --wait',
)
