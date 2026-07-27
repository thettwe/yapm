#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const APP_PACKAGES = ['@yapm/web', '@yapm/server', '@yapm/docs']
const ZERO_DEFINITION_NAMES = [
  'createSchema',
  'createBuilder',
  'table',
  'defineQuery',
  'defineQueries',
  'defineMutator',
  'defineMutators',
]

// CLAUDE.md #3, "packages/schema has no UI dependencies", was a doc-level rule with nothing behind
// it until this list existed. `apps/server` imports `@yapm/schema`, so any one of these in a schema
// file quietly drags an editor's worth of graph into the server bundle — a bigger image nobody
// attributes to the change that caused it, and something lint, typecheck and build all pass.
const SCHEMA_FORBIDDEN_IMPORTS = [
  '@tiptap/*',
  '@yapm/ui',
  'react',
  'react-dom',
  '@base-ui/react',
  'lucide-react',
  '@floating-ui/*',
]

const SCAN_ROOTS = ['apps', 'packages']
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.tanstack'])

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function inPackages(rel) {
  return rel.startsWith(`packages${sep}`)
}

function inSchema(rel) {
  return rel.startsWith(`packages${sep}schema${sep}`)
}

const violations = []

for (const root of SCAN_ROOTS) {
  const abs = join(repoRoot, root)
  for (const file of sourceFiles(abs)) {
    const rel = relative(repoRoot, file)
    const source = readFileSync(file, 'utf8')

    if (inPackages(rel)) {
      for (const app of APP_PACKAGES) {
        const pattern = new RegExp(`from ['"]${app}(/[^'"]*)?['"]`)
        if (pattern.test(source)) {
          violations.push(
            `${rel}: package imports from app "${app}" — packages MUST NOT import from apps`,
          )
        }
      }
    }

    if (!inSchema(rel)) {
      const imports = source.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@rocicorp\/zero['"]/g,
      )
      for (const match of imports) {
        const named = match[1].split(',').map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            .trim(),
        )
        const banned = named.filter((n) => ZERO_DEFINITION_NAMES.includes(n))
        if (banned.length > 0) {
          violations.push(
            `${rel}: imports Zero definition API {${banned.join(', ')}} — all ZQL and mutators MUST be defined in packages/schema`,
          )
        }
      }
    }

    if (inSchema(rel)) {
      for (const spec of SCHEMA_FORBIDDEN_IMPORTS) {
        const wildcard = spec.endsWith('/*')
        const base = wildcard ? spec.slice(0, -2) : spec
        const tail = wildcard ? '/[^\'"]*' : '(/[^\'"]*)?'
        // `import 'pkg'` as well as `from 'pkg'`: a side-effect import of an editor package is
        // exactly as expensive to the server bundle as a named one.
        if (new RegExp(`(?:from|import)\\s+['"]${base}${tail}['"]`).test(source)) {
          violations.push(
            `${rel}: schema imports "${spec}" — packages/schema MUST NOT depend on the UI. apps/server imports @yapm/schema, so a TipTap, React or ProseMirror import here ships an editor to the server. See packages/schema/src/rich-text/plaintext.ts: it imports NOTHING, and that is why a rich-text walk is allowed to live in schema at all. The markdown serialiser lives in packages/ui/src/lib/markdown.ts for this reason.`,
          )
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Package boundary violations:\n')
  for (const v of violations) console.error(`  ✗ ${v}`)
  console.error(
    '\nBoundaries: packages never import apps; all ZQL/mutator definitions live in packages/schema; packages/schema has no UI dependencies (CLAUDE.md constraints 2–3).',
  )
  process.exit(1)
}

console.log(
  'Boundaries OK: no package→app imports, no ZQL/mutator definitions outside packages/schema, no UI dependencies in packages/schema.',
)
