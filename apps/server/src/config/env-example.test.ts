import { readFileSync } from 'node:fs'
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
  'VITE_ZERO_CACHE_URL',
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

  // This change's three variables, named explicitly. The set check above would catch a missing one,
  // but naming them is what makes a future deletion of one a failing test rather than a silent
  // shrinking of the documented surface.
  it('documents and declares the three variables this change adds', () => {
    for (const key of [
      'AI_PM_DIGEST_READY_EMAIL',
      'AI_DISCLOSURE_RETENTION_DAYS',
      'AI_DISCLOSURE_RETENTION_CRON',
    ]) {
      expect(documented.has(key)).toBe(true)
      expect(declared.has(key)).toBe(true)
    }
  })
})
