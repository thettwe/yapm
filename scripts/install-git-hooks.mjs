#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (!existsSync(join(repoRoot, '.git'))) {
  console.log('No .git directory — skipping git hook installation.')
  process.exit(0)
}

const local = join(repoRoot, 'node_modules', '.bin', 'lefthook')
const binary = existsSync(local) ? local : 'lefthook'
const result = spawnSync(binary, ['install'], { cwd: repoRoot, stdio: 'inherit' })
process.exit(result.status ?? 1)
