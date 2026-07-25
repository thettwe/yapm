import type { ConnectorDefinition } from '@yapm/schema'
import * as z from 'zod'
import { mapGithubEvent } from './map.js'
import { parseGithubDelivery } from './parse-delivery.js'
import { reconcileInstallation } from './reconcile.js'
import { type GithubWebhookSecrets, verifyGithubSignature } from './verify.js'

// v1 GitHub connector has no non-secret settings (repo→team mapping lives on the installation
// record). The schema is present so the provider-neutral framework has a `configSchema`.
const configSchema = z.object({})

const secretSchema = z.object({
  appId: z.string(),
  privateKey: z.string(),
  webhookSecret: z.string(),
  fallbackSecrets: z.array(z.string()).optional(),
})

export type GithubConnectorConfig = z.infer<typeof configSchema>
export type GithubConnectorSecrets = z.infer<typeof secretSchema> & GithubWebhookSecrets

// The GitHub implementation of the provider-neutral contract. `verifySignature` and
// `parseDelivery` are the sync HTTP-handler path; `ingest` is the offline mapping run in the
// pg-boss worker; `reconcile` is the ETag safety net. All downstream code sees only
// `WorkGraphMutation[]`.
export const githubConnector: ConnectorDefinition<GithubConnectorConfig, GithubConnectorSecrets> = {
  id: 'github',
  displayName: 'GitHub',
  configSchema,
  secretSchema,
  verifySignature: (raw, headers, secrets) => verifyGithubSignature(raw, headers, secrets),
  parseDelivery: (raw, headers) => parseGithubDelivery(raw, headers),
  ingest: (event) =>
    Promise.resolve(
      mapGithubEvent(event.eventType, event.payload, event.installationKey, Date.now()),
    ),
  reconcile: (installation, ctx) => reconcileInstallation(installation, ctx),
}
