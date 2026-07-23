import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

const silent = pino({ level: 'silent' })

function makeWebDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yapm-web-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>yapm</title>')
  writeFileSync(join(dir, 'assets', 'app.js'), 'export const ok = true\n')
  return dir
}

const distDir = makeWebDist()
const emptyDir = mkdtempSync(join(tmpdir(), 'yapm-empty-'))

describe('SPA static serving', () => {
  const app = createApp({ logger: silent, readinessChecks: [], webDistDir: distDir })

  it('serves index.html at the root', async () => {
    const response = await app.request('/')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    await expect(response.text()).resolves.toContain('<title>yapm</title>')
  })

  it('serves hashed assets', async () => {
    const response = await app.request('/assets/app.js')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('javascript')
    await expect(response.text()).resolves.toContain('export const ok = true')
  })

  it('falls back to index.html for client-side routes', async () => {
    const response = await app.request('/workspace/settings')

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('<title>yapm</title>')
  })

  it('does not shadow the health endpoints', async () => {
    const response = await app.request('/healthz')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('serves a placeholder when the web build is missing', async () => {
    const missing = createApp({ logger: silent, readinessChecks: [], webDistDir: emptyDir })
    const response = await missing.request('/')

    expect(response.status).toBe(503)
    await expect(response.text()).resolves.toContain('web build is not present')
  })
})
