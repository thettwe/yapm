import type * as z from 'zod'
import type { WorkGraphMutation } from './work-graph.js'

// The provider-neutral connector contract. GitHub is its first implementation (in
// `apps/server`, with octokit); GitLab etc. slot in later by implementing the same interface,
// with NO change to feature code. The three provider-specific concerns are isolated here —
// auth/config, `parseDelivery` + `ingest`, and `reconcile` — and everything downstream sees
// only a `WorkGraphMutation[]` (the firewall). Type-only: no UI, no octokit, no ZQL leaks.

// A minimal header reader (Web `Headers` satisfies it structurally) so the contract needs no
// DOM lib and no HTTP-framework dependency.
export interface ConnectorHeaders {
  get(name: string): string | null
}

export interface ConnectorLogger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

// The normalized envelope the HTTP handler produces after verifying a signature, before
// enqueueing. `installationKey` becomes the pg-boss `singletonKey` (per-installation FIFO);
// `deliveryId` is the idempotency key for redelivered webhooks.
export interface NormalizedDelivery {
  readonly installationKey: string
  readonly eventType: string
  readonly deliveryId: string
  readonly payload: unknown
}

// A stored installation as the worker/reconcile sees it (never the secret material).
export interface InstallationRecord {
  readonly id: string
  readonly externalInstallationId: string
  readonly repoMapping: Record<string, string>
}

// Per-call context handed to `ingest`/`reconcile`: the provider client (opaque here — the
// GitHub impl passes an installation octokit), the ETag store for free 304 reconciliation,
// and a logger. `client` is `unknown` so the contract stays provider-neutral.
export interface ConnectorContext {
  readonly client: unknown
  getEtag(resource: string): Promise<string | null>
  setEtag(resource: string, etag: string): Promise<void>
  readonly log: ConnectorLogger
}

export interface ConnectorDefinition<Config, Secrets> {
  readonly id: string
  readonly displayName: string

  // --- auth / config ---
  readonly configSchema: z.ZodType<Config>
  readonly secretSchema: z.ZodType<Secrets>
  verifySignature(raw: Uint8Array, headers: ConnectorHeaders, secrets: Secrets): Promise<boolean>

  // --- ingest: sync-fast path (HTTP handler, after verify) ---
  parseDelivery(raw: string, headers: ConnectorHeaders): NormalizedDelivery

  // --- ingest: async path (pg-boss worker) ---
  ingest(event: NormalizedDelivery, ctx: ConnectorContext): Promise<WorkGraphMutation[]>

  // --- reconcile: cron safety net + first-install backfill ---
  reconcile(installation: InstallationRecord, ctx: ConnectorContext): Promise<WorkGraphMutation[]>
}
