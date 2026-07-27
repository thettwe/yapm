import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildMutatorToolSpecs, mutatorToolNames } from './ai-tools.js'
import { schema } from './schema.js'

// THE TWO ABSENCES design §D5 rests on, asserted rather than reasoned about.
//
// `attachment` is a synced table with NO mutator — the only one in the repo. A row without bytes is
// meaningless and a Zero mutator cannot carry bytes, so every write happens on the REST upload path
// where the row and the object move together. Two consequences follow, and both are invisible to
// the type checker:
//
//   1. A client cannot forge an attachment row. The moment somebody adds `attachment.create` "so
//      the optimistic Files list is simpler", any client can insert a row naming any team, and the
//      serve route's single scoped statement will happily hand back bytes for it.
//   2. The derived agent-tool registry gains nothing it could call. `buildMutatorToolSpecs` is
//      exhaustive BY CONSTRUCTION over `defineMutators`, so an attachment mutator would appear as
//      an AI-callable tool the day it is written, with no separate decision to expose it.
//
// The absence is what makes both true, and an absence is not self-enforcing.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const MUTATOR_MODULES = [
  'packages/schema/src/zero/mutators.ts',
  'packages/schema/src/zero/server-mutators.ts',
].map((path) => join(repoRoot, path))

describe('the attachment table has no mutator, deliberately', () => {
  const names = mutatorToolNames()

  it('derives a non-empty mutator list, so the absence below is not vacuous', () => {
    expect(names.length).toBeGreaterThan(30)
    expect(names).toContain('issue.create')
    expect(names).toContain('comment.create')
  })

  it('has the attachment table in the Zero schema, so the missing mutator is the point', () => {
    expect(Object.keys(schema.tables)).toContain('attachment')
  })

  it('registers no mutator over the attachment table', () => {
    expect(names.filter((name) => /attachment/i.test(name))).toEqual([])
  })

  it('never writes the attachment table from any mutator module', () => {
    for (const path of MUTATOR_MODULES) {
      const source = readFileSync(path, 'utf8')
      // Non-vacuity: these modules do mutate, so a grep that finds nothing is a grep that works.
      expect(source).toMatch(/\bmutate\.issue\b/)
      expect(source).not.toMatch(/\bmutate\.attachment\b/)
    }
  })
})

describe('the AI tool registry gains no attachment entry', () => {
  it('stays exhaustive over defineMutators — the throw never fires', () => {
    expect(() => buildMutatorToolSpecs()).not.toThrow()
    expect(buildMutatorToolSpecs()).toHaveLength(mutatorToolNames().length)
  })

  it('exposes no attachment tool, because there is no attachment mutator to classify', () => {
    expect(buildMutatorToolSpecs().filter((spec) => /attachment/i.test(spec.name))).toEqual([])
  })
})
