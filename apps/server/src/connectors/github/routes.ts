import type { ConnectorDefinition, ConnectorHeaders, NormalizedDelivery } from '@yapm/schema'
import { Hono } from 'hono'
import type { GithubConnectorConfig, GithubConnectorSecrets } from './connector.js'

export const GITHUB_WEBHOOK_PATH = '/api/github/webhooks'

export interface GithubWebhookRouteOptions {
  enabled: boolean
  connector: ConnectorDefinition<GithubConnectorConfig, GithubConnectorSecrets>
  secrets: GithubConnectorSecrets | null
  enqueue: (delivery: NormalizedDelivery) => Promise<void>
}

const encoder = new TextEncoder()

// The verify-fast/enqueue path: capture the RAW body (before any parse — re-serializing would
// break the HMAC), verify `X-Hub-Signature-256`, enqueue, and return 202. All graph mapping
// happens later in the worker. A disabled connector returns 404 (no route surface leaks).
export function createGithubWebhookRoute(options: GithubWebhookRouteOptions): Hono {
  const app = new Hono()

  app.post(GITHUB_WEBHOOK_PATH, async (c) => {
    if (!options.enabled || !options.secrets) {
      return c.json({ error: 'connector_disabled' }, 404)
    }

    const raw = await c.req.text()
    const headers: ConnectorHeaders = { get: (name) => c.req.header(name) ?? null }

    if (!headers.get('x-hub-signature-256')) {
      return c.json({ error: 'missing_signature' }, 400)
    }
    const verified = await options.connector.verifySignature(
      encoder.encode(raw),
      headers,
      options.secrets,
    )
    if (!verified) {
      return c.json({ error: 'invalid_signature' }, 401)
    }

    let delivery: NormalizedDelivery
    try {
      delivery = options.connector.parseDelivery(raw, headers)
    } catch {
      return c.json({ error: 'invalid_payload' }, 400)
    }

    await options.enqueue(delivery)
    return c.json({ status: 'accepted', deliveryId: delivery.deliveryId }, 202)
  })

  return app
}
