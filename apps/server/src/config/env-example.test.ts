import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { envSchema } from './env.js'

// PROCESS.md §2 claims "mechanical checks catch the detectable cases (`.env.example` vs the Zod
// schema)". No such check existed anywhere in the repo — this is it.
//
// The agreement is asserted by SET EQUALITY, modulo two lists that are LITERAL and COMMENTED rather
// than a loosened regex, so adding a variable to either is a deliberate, reviewable act.

// Set by the container, never written by an operator in a `.env`: the compose file supplies the
// connection string and the bind address, and the image supplies the built SPA's path.
const CONTAINER_SET = new Set(['DATABASE_URL', 'HOST', 'PORT', 'WEB_DIST_DIR'])

// Documented in `.env.example` because an operator does set them — but read by compose, by the
// zero-cache container or by Vite, never by the server process, so they are absent from the schema
// by design.
const COMPOSE_ONLY = new Set([
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_HOST_PORT',
  'ZERO_CACHE_HOST_PORT',
  'ZERO_ADMIN_PASSWORD',
  'ZERO_LOG_LEVEL',
  'ZERO_IMAGE',
  'YAPM_HOST_PORT',
  'YAPM_IMAGE',
])

function envExampleKeys(): Set<string> {
  const source = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8')
  const keys = new Set<string>()
  for (const line of source.split('\n')) {
    // Commented or not: a documented-but-defaulted variable is written as `# NAME=value`, and it
    // documents the variable just as much as an uncommented one does.
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)
    if (match?.[1] !== undefined) keys.add(match[1])
  }
  return keys
}

// The `yapm` service's own `environment:` block, read as text rather than through a YAML parser —
// compose is the artifact an operator runs, and this file has no yaml dependency to add for a check
// that is four lines of scanning. The block is the run of keys indented under `environment:` inside
// the `yapm:` service, and it ends at the first line that dedents out of it.
function composeYapmEnvKeys(): Set<string> {
  const source = readFileSync(
    new URL('../../../../docker/docker-compose.yml', import.meta.url),
    'utf8',
  )
  const keys = new Set<string>()
  let inService = false
  let inEnvironment = false
  for (const line of source.split('\n')) {
    if (/^ {2}[a-z-]+:\s*$/.test(line)) {
      inService = line.trim() === 'yapm:'
      inEnvironment = false
      continue
    }
    if (!inService) continue
    if (/^ {4}environment:\s*$/.test(line)) {
      inEnvironment = true
      continue
    }
    if (inEnvironment && /^ {0,4}\S/.test(line)) inEnvironment = false
    if (!inEnvironment) continue
    const match = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line)
    if (match?.[1] !== undefined) keys.add(match[1])
  }
  return keys
}

// The configuration reference in the docs site, read the same way and for the same reason. Two spec
// scenarios have required "the environment example and the configuration reference are compared
// against the validated schema … with no drift" since before the page existed. This is what makes
// the page a checked artifact rather than prose that was true on the day it was written.
//
// The shape it parses is one table row per variable, with the name in the FIRST cell in backticks.
function configurationReferenceKeys(): Set<string> {
  const source = readFileSync(
    new URL('../../../docs/src/content/docs/self-hosting/configuration.md', import.meta.url),
    'utf8',
  )
  const keys = new Set<string>()
  for (const line of source.split('\n')) {
    const match = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/.exec(line)
    if (match?.[1] !== undefined) keys.add(match[1])
  }
  return keys
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort()
}

describe('.env.example and the Zod env schema', () => {
  const documented = envExampleKeys()
  const declared = new Set(Object.keys(envSchema.shape))

  it('documents every variable the server reads, except the container-set ones', () => {
    const undocumented = sorted(declared).filter(
      (key) => !documented.has(key) && !CONTAINER_SET.has(key),
    )
    expect(undocumented).toEqual([])
  })

  it('declares every variable it documents, except the compose-only ones', () => {
    const undeclared = sorted(documented).filter(
      (key) => !declared.has(key) && !COMPOSE_ONLY.has(key),
    )
    expect(undeclared).toEqual([])
  })

  // The exception lists are the loophole, so they are checked too: a variable that stops being
  // container-set or compose-only must be removed from the list rather than left as a permanent
  // hole in the agreement above.
  it('keeps both exception lists honest', () => {
    expect(sorted(CONTAINER_SET).filter((key) => documented.has(key))).toEqual([])
    expect(sorted(COMPOSE_ONLY).filter((key) => declared.has(key))).toEqual([])
    expect(sorted(CONTAINER_SET).filter((key) => !declared.has(key))).toEqual([])
    expect(sorted(COMPOSE_ONLY).filter((key) => !documented.has(key))).toEqual([])
  })

  // THE THIRD LEG, and the one that makes the other two mean something for a self-hoster. A compose
  // service passes through only the variables it enumerates: a variable documented in `.env.example`
  // and validated by the schema, but absent from the `yapm` service's `environment:`, is an
  // instruction that has no effect in the three-container deployment this project ships. The
  // container-set variables are supplied by compose under different names or values, and the
  // compose-only ones are read by another service, so both lists are excused here too.
  it('passes every documented server variable through to the yapm container', () => {
    const passed = composeYapmEnvKeys()
    const missing = sorted(documented).filter(
      (key) => !passed.has(key) && !COMPOSE_ONLY.has(key) && !CONTAINER_SET.has(key),
    )
    expect(missing).toEqual([])
  })

  // This change's three variables, named explicitly. The set checks above would catch a missing one,
  // but naming them is what makes a future deletion of one a failing test rather than a silent
  // shrinking of the documented surface.
  it('documents, declares and ships the three variables the disclosure change added', () => {
    const passed = composeYapmEnvKeys()
    for (const key of [
      'AI_PM_DIGEST_READY_EMAIL',
      'AI_DISCLOSURE_RETENTION_DAYS',
      'AI_DISCLOSURE_RETENTION_CRON',
    ]) {
      expect(documented.has(key)).toBe(true)
      expect(declared.has(key)).toBe(true)
      expect(passed.has(key)).toBe(true)
    }
  })

  // Same precedent, for deployment-hardening's two. `ZERO_CACHE_PUBLIC_URL` in particular is only
  // useful if it reaches the container: it replaced a build-time constant, and a runtime variable
  // that compose does not pass through would be the same defect wearing a different name.
  it('documents, declares and ships the two variables this change adds', () => {
    const passed = composeYapmEnvKeys()
    const reference = configurationReferenceKeys()
    for (const key of ['YAPM_ALLOW_INSECURE_DEFAULTS', 'ZERO_CACHE_PUBLIC_URL']) {
      expect(documented.has(key)).toBe(true)
      expect(declared.has(key)).toBe(true)
      expect(passed.has(key)).toBe(true)
      expect(reference.has(key)).toBe(true)
    }
  })

  // THE FOURTH LEG. An operator reading the docs site never opens `.env.example`, so a reference
  // that has drifted from the schema is the same defect as an example that has — one layer further
  // from the code, where nothing else would catch it. Set equality in BOTH directions, modulo the
  // same two commented lists: the reference documents every variable the server validates, and it
  // invents none.
  it('documents every variable the schema validates in the configuration reference', () => {
    const reference = configurationReferenceKeys()
    const missing = sorted(declared).filter((key) => !reference.has(key))
    expect(missing).toEqual([])
  })

  it('names nothing in the configuration reference that no one reads', () => {
    const reference = configurationReferenceKeys()
    const invented = sorted(reference).filter(
      (key) => !declared.has(key) && !COMPOSE_ONLY.has(key) && !CONTAINER_SET.has(key),
    )
    expect(invented).toEqual([])
  })

  // The compose-only variables are the ones an operator is MOST likely to need the reference for —
  // `POSTGRES_PASSWORD` and `ZERO_ADMIN_PASSWORD` are two of the five secrets the hardening page
  // tells them to change — so their presence is asserted rather than merely permitted.
  it('carries the compose-only variables in the configuration reference too', () => {
    const reference = configurationReferenceKeys()
    const missing = sorted(COMPOSE_ONLY).filter((key) => !reference.has(key))
    expect(missing).toEqual([])
  })
})

// The MECHANISM behind every documented compose command, not the prose around it. `-f docker/…`
// makes `docker/` Compose's project directory, so a documented command without `--env-file` reads no
// env file at all and applies every published default in silence — which is how a production deploy
// came to run on a secret printed in this repository. The README quickstart is only the most visible
// instance: a restore procedure or a troubleshooting step that recreates a container without it does
// the same damage, so EVERY documented page is scanned rather than swept by hand.

// One `docker compose …` command, terminated by a newline, an inline-code backtick, or the start of
// the next one — so `a && docker compose b` is two commands, not one string in which either half's
// `--env-file` excuses the other.
const COMPOSE_COMMAND = /docker compose(?:(?!docker compose)[^\n`])*/g

// Two shapes have to be reassembled before scanning, because each is ONE command written across two
// source lines: a fenced block's `\` continuation, and an inline code span that the prose wrapped.
function composeCommands(markdown: string): string[] {
  const lines: string[] = []
  const prose: string[] = []
  let fenced = false
  let pending = ''

  for (const raw of markdown.split('\n')) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced
      continue
    }
    if (!fenced) {
      prose.push(raw.trim())
      continue
    }
    pending += raw.trim()
    if (pending.endsWith('\\')) {
      pending = `${pending.slice(0, -1)} `
      continue
    }
    lines.push(pending)
    pending = ''
  }
  if (pending.length > 0) lines.push(pending)

  // Prose is scanned as one joined string: a wrapped inline span is still one command, and outside
  // the fences there is no other line-sensitive structure to preserve.
  lines.push(prose.join(' '))

  return lines.flatMap((line) =>
    [...line.matchAll(COMPOSE_COMMAND)].map((match) => match[0].trim()),
  )
}

function documentedMarkdown(): { path: string; source: string }[] {
  const roots = ['../../../../README.md', '../../../../SECURITY.md']
  const docs = new URL('../../../docs/src/content/docs/', import.meta.url)
  const pages = readdirSync(docs, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.md') || entry.endsWith('.mdx'))
    .map((entry) => new URL(entry, docs))

  return [...roots.map((path) => new URL(path, import.meta.url)), ...pages].map((url) => ({
    path: url.pathname,
    source: readFileSync(url, 'utf8'),
  }))
}

describe('every documented compose command reads the operator env file', () => {
  const documents = documentedMarkdown()

  it('finds the compose invocations it is meant to be checking', () => {
    const found = documents.flatMap((document) => composeCommands(document.source))
    expect(found.filter((command) => command.includes('-f docker/')).length).toBeGreaterThan(0)
  })

  it('passes --env-file on every invocation that points -f into docker/', () => {
    const offending = documents.flatMap((document) =>
      composeCommands(document.source)
        .filter((command) => command.includes('-f docker/') && !command.includes('--env-file'))
        .map((command) => `${document.path}: ${command}`),
    )
    expect(offending).toEqual([])
  })
})
