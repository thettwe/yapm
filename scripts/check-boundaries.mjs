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
  }
}

if (violations.length > 0) {
  console.error('Package boundary violations:\n')
  for (const v of violations) console.error(`  ✗ ${v}`)
  console.error(
    '\nBoundaries: packages never import apps; all ZQL/mutator definitions live in packages/schema (CLAUDE.md constraints 2–3).',
  )
  process.exit(1)
}

console.log(
  'Boundaries OK: no package→app imports, no ZQL/mutator definitions outside packages/schema.',
)
