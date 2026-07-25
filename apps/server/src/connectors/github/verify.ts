import { Webhooks } from '@octokit/webhooks'
import type { ConnectorHeaders } from '@yapm/schema'

// The webhook secret (plus any fallbacks used during a zero-downtime rotation). The HMAC runs
// over the exact raw bytes GitHub sent; a match against any listed secret accepts the delivery.
export interface GithubWebhookSecrets {
  webhookSecret: string
  fallbackSecrets?: readonly string[]
}

const decoder = new TextDecoder()
const verifierCache = new Map<string, Webhooks>()

function verifier(secret: string): Webhooks {
  let cached = verifierCache.get(secret)
  if (!cached) {
    cached = new Webhooks({ secret })
    verifierCache.set(secret, cached)
  }
  return cached
}

// Verifies `X-Hub-Signature-256` (HMAC-SHA256, `sha256=` prefixed) over the raw body via
// octokit, which compares in constant time. Returns false when the header is missing or no
// configured secret matches; never throws on a bad signature.
export async function verifyGithubSignature(
  raw: Uint8Array | string,
  headers: ConnectorHeaders,
  secrets: GithubWebhookSecrets,
): Promise<boolean> {
  const signature = headers.get('x-hub-signature-256')
  if (!signature) return false
  const payload = typeof raw === 'string' ? raw : decoder.decode(raw)
  for (const secret of [secrets.webhookSecret, ...(secrets.fallbackSecrets ?? [])]) {
    if (await verifier(secret).verify(payload, signature)) return true
  }
  return false
}
