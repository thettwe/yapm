import { pino } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { databaseCheck } from './health.js'

const silent = pino({ level: 'silent' })

describe('createApp', () => {
  it('answers /healthz without touching any dependency', async () => {
    const app = createApp({
      logger: silent,
      readinessChecks: [
        {
          name: 'database',
          run: () => Promise.reject(new Error('connection refused')),
        },
      ],
    })

    const response = await app.request('/healthz')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('reports ready when every check passes', async () => {
    const app = createApp({
      logger: silent,
      readinessChecks: [databaseCheck(() => Promise.resolve())],
    })

    const response = await app.request('/readyz')
    const body = (await response.json()) as {
      status: string
      checks: { name: string; ok: boolean }[]
    }

    expect(response.status).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.checks.map((check) => check.name)).toEqual(['database'])
    expect(body.checks.every((check) => check.ok)).toBe(true)
  })

  it('reports not ready with a reason naming the failing check', async () => {
    const app = createApp({
      logger: silent,
      readinessChecks: [
        databaseCheck(() => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432'))),
      ],
    })

    const response = await app.request('/readyz')
    const body = (await response.json()) as { status: string; reason: string }

    expect(response.status).toBe(503)
    expect(body.status).toBe('not_ready')
    expect(body.reason).toContain('database')
    expect(body.reason).toContain('ECONNREFUSED')
  })

  it('times out a hanging readiness check instead of hanging the probe', async () => {
    const app = createApp({
      logger: silent,
      readinessChecks: [databaseCheck(() => new Promise(() => {}), 10)],
    })

    const response = await app.request('/readyz')
    const body = (await response.json()) as { status: string; reason: string }

    expect(response.status).toBe(503)
    expect(body.reason).toContain('no response within 10ms')
  })

  it('unwraps the AggregateError node-postgres throws when a host is unreachable', async () => {
    const aggregate = new AggregateError([
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
    ])
    const app = createApp({
      logger: silent,
      readinessChecks: [databaseCheck(() => Promise.reject(aggregate))],
    })

    const response = await app.request('/readyz')
    const body = (await response.json()) as { status: string; reason: string }

    expect(response.status).toBe(503)
    expect(body.reason).toBe('database: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)')
  })
})

describe('GET /api/config', () => {
  it('serves the sync origin it was given', async () => {
    const app = createApp({
      logger: silent,
      readinessChecks: [],
      zeroCacheUrl: 'https://sync.example.com',
    })

    const response = await app.request('/api/config')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ zeroCacheUrl: 'https://sync.example.com' })
  })

  // A cached copy would survive a change of origin in exactly the deployment where the origin just
  // changed — an operator who moves the stack behind a domain and cannot work out why the old host
  // is still being dialled.
  it('forbids caching the answer', async () => {
    const app = createApp({
      logger: silent,
      readinessChecks: [],
      zeroCacheUrl: 'https://sync.example.com',
    })

    const response = await app.request('/api/config')

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  // The value comes through `AppOptions`, from the caller that validated it — never read out of the
  // ambient environment here, where a second reader could disagree with the one at boot.
  it('ignores the ambient environment', async () => {
    vi.stubEnv('ZERO_CACHE_PUBLIC_URL', 'https://ambient.example.com')

    const app = createApp({
      logger: silent,
      readinessChecks: [],
      zeroCacheUrl: 'https://injected.example.com',
    })

    const response = await app.request('/api/config')

    await expect(response.json()).resolves.toEqual({
      zeroCacheUrl: 'https://injected.example.com',
    })
  })

  // An app built without one 404s rather than fabricating a default: the SPA reports the endpoint by
  // name, which is a louder failure than a client quietly dialling localhost.
  it('is absent when no origin was configured', async () => {
    const app = createApp({ logger: silent, readinessChecks: [] })

    const response = await app.request('/api/config')

    expect(response.status).toBe(404)
  })
})
