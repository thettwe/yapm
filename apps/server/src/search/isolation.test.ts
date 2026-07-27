import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMutatorToolSpecs, mutators, mutatorToolNames } from '@yapm/schema'
import { describe, expect, it } from 'vitest'

// The two absences that make search safe, asserted rather than reasoned about.
//
// `search_document.body` holds every issue description and every comment in the workspace with
// mentions resolved to people's NAMES (design D12). The AI substrate's guarantee is that it is fed
// team-level aggregates only, so a searchable projection of those documents is precisely the shape
// that would leak per-person data into a model. Nothing stops that but this file: the rule is a
// property of which modules name which symbols, which no type checker and no runtime test can see.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const SEARCH_MODULE = join(repoRoot, 'packages/schema/src/db/search.ts')

// The AI paths, named exactly as task 6.6 names them: everything under the server's AI directory,
// plus the four shared modules that assemble what a model is shown.
const AI_DIRECTORY = join(repoRoot, 'apps/server/src/ai')
const AI_MODULES = [
  'packages/schema/src/zero/digest.ts',
  'packages/schema/src/zero/ai-tools.ts',
  'packages/schema/src/zero/cycle-facts.ts',
  'packages/schema/src/db/cycle-facts.ts',
].map((path) => join(repoRoot, path))

function typescriptFilesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return typescriptFilesIn(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

// Derived from the module's own exports rather than hand-listed, so a helper added to
// `db/search.ts` by a later change is covered by this guard on the day it is written. The literals
// alongside them catch the two ways to reach the table without naming an export: the module path
// and raw SQL.
function forbiddenNames(): string[] {
  const source = readFileSync(SEARCH_MODULE, 'utf8')
  const exports = [
    ...source.matchAll(/^export (?:async )?(?:function|const|class|interface|type|enum) (\w+)/gm),
  ].map((match) => match[1] ?? '')
  return ['search_document', 'db/search.js', ...exports]
}

function namesSearch(source: string, forbidden: readonly string[]): string[] {
  return forbidden.filter((name) => new RegExp(`\\b${name}\\b`).test(source))
}

describe('search is never an AI data source (task 6.6)', () => {
  const forbidden = forbiddenNames()

  it('derives a non-empty guard list from the search module’s own exports', () => {
    expect(forbidden).toContain('search_document')
    expect(forbidden).toContain('searchDocuments')
    expect(forbidden).toContain('resolveSearchScope')
    expect(forbidden.length).toBeGreaterThan(10)
  })

  // Without this the guard could be a regex that matches nothing, and every assertion below would
  // pass on an empty promise.
  it('trips on the two modules that legitimately do read the index', () => {
    expect(namesSearch(readFileSync(SEARCH_MODULE, 'utf8'), forbidden)).not.toEqual([])
    expect(
      namesSearch(
        readFileSync(join(repoRoot, 'apps/server/src/search/routes.ts'), 'utf8'),
        forbidden,
      ),
    ).not.toEqual([])
  })

  it('scans every AI module task 6.6 names, and finds them all present', () => {
    const scanned = [...typescriptFilesIn(AI_DIRECTORY), ...AI_MODULES]
    expect(typescriptFilesIn(AI_DIRECTORY).length).toBeGreaterThanOrEqual(5)
    for (const file of AI_MODULES) expect(statSync(file).isFile()).toBe(true)

    // A symbol check rather than an import check, deliberately: `@yapm/schema/db` is a barrel that
    // re-exports the search module, so "does not import it" is unenforceable — "does not name
    // anything it exports, and never says `search_document`" is what can actually be checked.
    const offenders = scanned
      .map((file) => ({
        file: relative(repoRoot, file),
        names: namesSearch(readFileSync(file, 'utf8'), forbidden),
      }))
      .filter((entry) => entry.names.length > 0)

    expect(offenders).toEqual([])
  })
})

describe('search adds no agent tool (task 6.5)', () => {
  it('registers no search mutator, so the derived tool registry gains nothing', () => {
    // `ai-tools.ts` builds its tool set from `defineMutators`. Search adds no mutator — nothing
    // about it is optimistic — and adding none is the whole reason it never becomes a tool an
    // agent can call. A `search` group here would silently hand every model a workspace-wide
    // reader over descriptions and comments.
    expect(Object.keys(mutators)).not.toContain('search')

    const names = mutatorToolNames()
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => /search/i.test(name))).toEqual([])
    expect(
      buildMutatorToolSpecs()
        .map((spec) => spec.name)
        .sort(),
    ).toEqual([...names].sort())
  })
})
