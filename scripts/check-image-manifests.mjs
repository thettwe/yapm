#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dockerfilePath = join(repoRoot, 'docker', 'Dockerfile')
const SCAN_ROOTS = ['apps', 'packages']
const INSTALL_MARKER = 'pnpm install --frozen-lockfile'

function workspaceManifests() {
  const manifests = []
  for (const root of SCAN_ROOTS) {
    for (const entry of readdirSync(join(repoRoot, root))) {
      const dir = join(repoRoot, root, entry)
      if (!statSync(dir).isDirectory()) continue
      try {
        statSync(join(dir, 'package.json'))
      } catch {
        continue
      }
      manifests.push(`${root}/${entry}/package.json`)
    }
  }
  return manifests
}

const dockerfile = readFileSync(dockerfilePath, 'utf8')
const installIndex = dockerfile.indexOf(INSTALL_MARKER)
if (installIndex < 0) {
  console.error(`docker/Dockerfile no longer runs "${INSTALL_MARKER}" — update this guard.`)
  process.exit(1)
}

const preInstall = dockerfile.slice(0, installIndex)
const missing = workspaceManifests().filter((manifest) => !preInstall.includes(manifest))

if (missing.length > 0) {
  console.error('docker/Dockerfile is missing workspace manifests before the install layer.')
  console.error('pnpm install does not fail on an absent package — it silently installs nothing')
  console.error('for it, and the build breaks later with an unresolvable import.\n')
  for (const manifest of missing) {
    const dir = manifest.slice(0, manifest.lastIndexOf('/'))
    console.error(`  ✗ COPY ${manifest} ./${dir}/`)
  }
  console.error(`\n${missing.length} manifest(s) missing.`)
  process.exit(1)
}

console.log('Image manifests OK: every workspace package.json is copied before pnpm install.')
