import type { ConnectorHeaders } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import { parseGithubDelivery } from './parse-delivery.js'

function headers(map: Record<string, string>): ConnectorHeaders {
  return { get: (name) => map[name.toLowerCase()] ?? null }
}

describe('parseGithubDelivery', () => {
  it('reads the event, delivery id, and installation key from headers + payload', () => {
    const raw = JSON.stringify({ action: 'opened', installation: { id: 42 } })
    const delivery = parseGithubDelivery(
      raw,
      headers({ 'x-github-event': 'pull_request', 'x-github-delivery': 'del-1' }),
    )
    expect(delivery).toMatchObject({
      installationKey: '42',
      eventType: 'pull_request',
      deliveryId: 'del-1',
    })
    expect((delivery.payload as { action: string }).action).toBe('opened')
  })

  it('falls back to unknown when no installation id is present', () => {
    const delivery = parseGithubDelivery('{}', headers({ 'x-github-event': 'ping' }))
    expect(delivery.installationKey).toBe('unknown')
    expect(delivery.eventType).toBe('ping')
    expect(typeof delivery.deliveryId).toBe('string')
  })
})
