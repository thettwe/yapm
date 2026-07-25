import { type ConnectorHeaders, type NormalizedDelivery, newId } from '@yapm/schema'

// Turns a verified raw delivery into the normalized envelope the queue carries. `installationKey`
// (the payload's `installation.id`) is the pg-boss FIFO `singletonKey`; `deliveryId`
// (`X-GitHub-Delivery`) is the idempotency key for redelivered webhooks.
export function parseGithubDelivery(raw: string, headers: ConnectorHeaders): NormalizedDelivery {
  const eventType = headers.get('x-github-event') ?? 'unknown'
  const deliveryId = headers.get('x-github-delivery') ?? newId()
  const payload = JSON.parse(raw) as { installation?: { id?: number } }
  const installationId = payload.installation?.id
  return {
    installationKey: installationId === undefined ? 'unknown' : String(installationId),
    eventType,
    deliveryId,
    payload,
  }
}
