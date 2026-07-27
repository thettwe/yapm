#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findViolations } from './lib/boundaries.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

const violations = []

for (const root of SCAN_ROOTS) {
  const abs = join(repoRoot, root)
  for (const file of sourceFiles(abs)) {
    // The matcher is path-shape-driven and its tests are written in POSIX form; Windows would
    // otherwise silently match nothing at all.
    const rel = relative(repoRoot, file).split(sep).join('/')
    violations.push(...findViolations(rel, readFileSync(file, 'utf8')))
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
