import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NormalizedDelivery } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import { type GithubConnectorSecrets, githubConnector } from './connector.js'
import { createGithubWebhookRoute, GITHUB_WEBHOOK_PATH } from './routes.js'

const RAW = readFileSync(
  join(import.meta.dirname, '__fixtures__', 'pull_request.opened.json'),
  'utf8',
)
const SECRETS: GithubConnectorSecrets = {
  appId: '1',
  privateKey: 'PEM',
  webhookSecret: 'shh',
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function route(options: {
  enabled?: boolean
  enqueue?: (delivery: NormalizedDelivery) => Promise<void>
}) {
  return createGithubWebhookRoute({
    enabled: options.enabled ?? true,
    connector: githubConnector,
    secrets: options.enabled === false ? null : SECRETS,
    enqueue: options.enqueue ?? (() => Promise.resolve()),
  })
}

function post(app: ReturnType<typeof route>, body: string, headers: Record<string, string>) {
  return app.request(GITHUB_WEBHOOK_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

const goodHeaders = (body: string) => ({
  'x-github-event': 'pull_request',
  'x-github-delivery': 'del-1',
  'x-hub-signature-256': sign('shh', body),
})

describe('github webhook route', () => {
  it('verifies, enqueues, and returns 202', async () => {
    const enqueued: NormalizedDelivery[] = []
    const app = route({
      enqueue: (delivery) => {
        enqueued.push(delivery)
        return Promise.resolve()
      },
    })

    const response = await post(app, RAW, goodHeaders(RAW))
    expect(response.status).toBe(202)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toMatchObject({
      installationKey: '42',
      eventType: 'pull_request',
      deliveryId: 'del-1',
    })
  })

  it('rejects a missing signature with 400 and does not enqueue', async () => {
    let calls = 0
    const app = route({
      enqueue: () => {
        calls += 1
        return Promise.resolve()
      },
    })
    const response = await post(app, RAW, { 'x-github-event': 'pull_request' })
    expect(response.status).toBe(400)
    expect(calls).toBe(0)
  })

  it('rejects an invalid signature with 401', async () => {
    const app = route({})
    const response = await post(app, RAW, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': sign('wrong', RAW),
    })
    expect(response.status).toBe(401)
  })

  it('returns 404 when the connector is disabled', async () => {
    const app = route({ enabled: false })
    const response = await post(app, RAW, goodHeaders(RAW))
    expect(response.status).toBe(404)
  })
})
