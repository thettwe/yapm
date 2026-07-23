#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = join('docker', 'docker-compose.dev.yml')

const user = process.env.POSTGRES_USER ?? 'yapm'
const password = process.env.POSTGRES_PASSWORD ?? 'yapm'
const database = process.env.POSTGRES_DB ?? 'yapm'
const pgPort = process.env.POSTGRES_HOST_PORT ?? '5440'
const cachePort = process.env.ZERO_CACHE_HOST_PORT ?? '4848'

const defaults = {
  DATABASE_URL: `postgres://${user}:${password}@localhost:${pgPort}/${database}`,
  VITE_ZERO_CACHE_URL: `http://localhost:${cachePort}`,
  SERVER_ORIGIN: `http://localhost:${process.env.PORT ?? '3000'}`,
}
for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value
}

console.log('› starting dev dependencies (postgres + zero-cache) …')
const up = spawnSync('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait', 'postgres'], {
  cwd: repoRoot,
  stdio: 'inherit',
})
if (up.status !== 0) {
  console.error('\nFailed to start dev dependencies. Is Docker running?')
  process.exit(up.status ?? 1)
}

const cache = spawnSync('docker', ['compose', '-f', composeFile, 'up', '-d', 'zero-cache'], {
  cwd: repoRoot,
  stdio: 'inherit',
})
if (cache.status !== 0) process.exit(cache.status ?? 1)

console.log(`› postgres → localhost:${pgPort}  zero-cache → localhost:${cachePort}`)
console.log('› starting server (watch) and Vite …\n')

const turboBin = join(repoRoot, 'node_modules', '.bin', 'turbo')
const turbo = spawn(turboBin, ['run', 'dev'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
})

const forward = (signal) => turbo.kill(signal)
process.on('SIGINT', () => forward('SIGINT'))
process.on('SIGTERM', () => forward('SIGTERM'))
turbo.on('exit', (code) => process.exit(code ?? 0))
