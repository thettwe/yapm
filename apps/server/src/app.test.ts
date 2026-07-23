import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
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
