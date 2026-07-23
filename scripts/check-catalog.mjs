#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]
const ALLOWED_PROTOCOLS = ['catalog:', 'workspace:', 'link:', 'file:']

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function packageDirs(globs) {
  const dirs = []
  for (const pattern of globs) {
    if (!pattern.endsWith('/*')) {
      dirs.push(join(repoRoot, pattern))
      continue
    }
    const parent = join(repoRoot, pattern.slice(0, -2))
    let entries = []
    try {
      entries = await readdir(parent, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) dirs.push(join(parent, entry.name))
    }
  }

  const withManifest = []
  for (const dir of dirs) {
    try {
      await stat(join(dir, 'package.json'))
      withManifest.push(dir)
    } catch {}
  }
  return withManifest
}

function catalogNames(workspace) {
  const names = new Map()
  for (const [name] of Object.entries(workspace.catalog ?? {})) {
    names.set(name, 'catalog:')
  }
  for (const [catalog, entries] of Object.entries(workspace.catalogs ?? {})) {
    for (const [name] of Object.entries(entries ?? {})) {
      if (!names.has(name)) names.set(name, `catalog:${catalog}`)
    }
  }
  return names
}

const workspace = parse(await readFile(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'))
const cataloged = catalogNames(workspace)
const dirs = [repoRoot, ...(await packageDirs(workspace.packages ?? []))]
const violations = []

for (const dir of dirs) {
  const manifestPath = join(dir, 'package.json')
  const manifest = await readJson(manifestPath)
  const where = relative(repoRoot, manifestPath) || 'package.json'

  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (typeof spec !== 'string') continue
      if (ALLOWED_PROTOCOLS.some((protocol) => spec.startsWith(protocol))) continue

      const expected = cataloged.get(name)
      violations.push(
        expected
          ? `${where} → ${field}.${name} = "${spec}" — use "${expected}" (version lives in pnpm-workspace.yaml)`
          : `${where} → ${field}.${name} = "${spec}" — add ${name} to the catalog in pnpm-workspace.yaml and reference it as "catalog:"`,
      )
    }
  }
}

if (violations.length > 0) {
  console.error('Catalog bypass detected. Every external dependency version belongs in the')
  console.error('pnpm catalog (pnpm-workspace.yaml), referenced as "catalog:".\n')
  for (const violation of violations) console.error(`  ${violation}`)
  console.error(`\n${violations.length} violation(s).`)
  process.exit(1)
}

console.log(`Catalog check passed: ${dirs.length} manifests, ${cataloged.size} cataloged entries.`)
