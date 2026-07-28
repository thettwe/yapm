import type { Kysely } from 'kysely'
import * as z from 'zod'
import type { SecretCodec } from '../secrets/codec.js'
import { type AreaMap, areaMapSchema } from '../zero/areas.js'
import { AI_PROVIDERS, type AiProvider, type AuthContext, canManage } from '../zero/context.js'
import {
  ConnectorAuthorizationError,
  getConnectorConfig,
  listConnectorSecretKeys,
  setConnectorSecret,
  upsertConnectorConfig,
} from './connector.js'
import { getWorkspaceAiSpendUsd } from './cycle-digest.js'
import type { DB } from './types.js'

// The AI configuration reuses the connector surface verbatim: one `connector_config` row per
// workspace with this provider, its `enabled` column the master AI toggle, its `config` jsonb
// the non-secret settings, and each provider's API key a `connector_secret` under it. No new
// table, no new crypto — the key is decrypted only in `apps/server` and never syncs through Zero.
export const AI_CONNECTOR_PROVIDER = 'ai'

const aiProviderSchema = z.enum(AI_PROVIDERS)

// The non-secret AI settings blob (the `config` jsonb of the `ai` connector_config row): which
// provider is the workspace default, the chosen model per configured provider (volatile IDs, so
// stored as free strings), and an optional per-workspace estimated-spend cap in USD.
export const aiConfigDataSchema = z.object({
  defaultProvider: aiProviderSchema.optional(),
  models: z.partialRecord(aiProviderSchema, z.string().min(1)).default({}),
  spendCapUsd: z.number().positive().optional(),
  // The ordered path→product-area map. Server-only like the rest of this blob, and an EMPTY map is
  // the off switch for area enrichment: no provider call is made at all.
  areas: areaMapSchema,
})

export type AiConfigData = z.infer<typeof aiConfigDataSchema>

const EMPTY_CONFIG: AiConfigData = { models: {}, areas: [] }

// Parse a stored `config` jsonb into the typed AI settings, tolerating a legacy/empty blob.
function parseConfig(config: unknown): AiConfigData {
  const parsed = aiConfigDataSchema.safeParse(config)
  return parsed.success ? parsed.data : { ...EMPTY_CONFIG }
}

export interface AiConfig {
  enabled: boolean
  data: AiConfigData
}

// System read: the master toggle + settings for a workspace, or null when AI was never
// configured. No secret material — keys are read only through `getAiProviderKey`.
export async function getAiConfig(db: Kysely<DB>, workspaceId: string): Promise<AiConfig | null> {
  const config = await getConnectorConfig(db, workspaceId, AI_CONNECTOR_PROVIDER)
  if (!config) return null
  return { enabled: config.enabled, data: parseConfig(config.config) }
}

export interface UpsertAiConfigOptions {
  // Client-minted UUIDv7, generated at the call site (used only if the row is inserted).
  id: string
  workspaceId: string
  enabled?: boolean
  config?: AiConfigData
  now?: Date
}

// Admin-gated (via `upsertConnectorConfig`). Toggling `enabled` never clobbers the stored
// settings, and vice versa — only the provided fields change on conflict.
export async function upsertAiConfig(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  options: UpsertAiConfigOptions,
): Promise<void> {
  await upsertConnectorConfig(db, ctx, {
    id: options.id,
    workspaceId: options.workspaceId,
    provider: AI_CONNECTOR_PROVIDER,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    ...(options.config === undefined ? {} : { config: options.config }),
    now: options.now,
  })
}

export interface SetAiProviderKeyOptions {
  // Client-minted UUIDv7 for the config row (used only if it does not exist yet).
  configId: string
  // Client-minted UUIDv7 for the secret row (used only if the secret is inserted).
  secretId: string
  workspaceId: string
  provider: AiProvider
  value: string
  now?: Date
}

// Admin-gated. Ensures the `ai` config row exists (so a key can be attached to it), then stores
// the provider's API key as an encrypted `connector_secret` keyed by the provider name. The
// plaintext is never persisted, logged, or returned.
export async function setAiProviderKey(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  codec: SecretCodec,
  options: SetAiProviderKeyOptions,
): Promise<void> {
  const existing = await getConnectorConfig(db, options.workspaceId, AI_CONNECTOR_PROVIDER)
  const configId = existing?.id ?? options.configId
  if (!existing) {
    await upsertConnectorConfig(db, ctx, {
      id: configId,
      workspaceId: options.workspaceId,
      provider: AI_CONNECTOR_PROVIDER,
      now: options.now,
    })
  }
  await setConnectorSecret(db, ctx, codec, {
    id: options.secretId,
    configId,
    key: options.provider,
    value: options.value,
    now: options.now,
  })
}

// System read: decrypt a workspace's provider key into server memory for one gateway call.
// Never reaches a client.
export async function getAiProviderKey(
  db: Kysely<DB>,
  codec: SecretCodec,
  workspaceId: string,
  provider: AiProvider,
): Promise<string | null> {
  const config = await getConnectorConfig(db, workspaceId, AI_CONNECTOR_PROVIDER)
  if (!config) return null
  const row = await db
    .selectFrom('connector_secret')
    .select('ciphertext')
    .where('connector_config_id', '=', config.id)
    .where('key', '=', provider)
    .executeTakeFirst()
  return row ? codec.decrypt(row.ciphertext) : null
}

// The AI providers that have a stored key for a workspace (the NAMES only — never the key
// material). Drives the admin settings UI's provider picker and the gateway's availability check.
export async function listConfiguredAiProviders(
  db: Kysely<DB>,
  workspaceId: string,
): Promise<AiProvider[]> {
  const config = await getConnectorConfig(db, workspaceId, AI_CONNECTOR_PROVIDER)
  if (!config) return []
  const keys = await listConnectorSecretKeys(db, config.id)
  return keys.filter((key): key is AiProvider => (AI_PROVIDERS as readonly string[]).includes(key))
}

export interface RedactedAiStatus {
  enabled: boolean
  defaultProvider: AiProvider | null
  models: Partial<Record<AiProvider, string>>
  spendCapUsd: number | null
  // The per-workspace ESTIMATED running total (sum of every ready digest's estimated cost) the cap
  // is checked against — surfaced so an admin setting a cap can see spend-so-far.
  spendSoFarUsd: number
  // Which providers have a stored key (names only — never the key material).
  configuredProviders: AiProvider[]
  // The ordered path→area map. Admin-only, like everything else here.
  areas: AreaMap
}

// Admin-gated. Everything the AI settings UI renders — the toggle, default provider, chosen
// models, spend cap, and which providers have a key — with no secret material of any kind.
export async function getRedactedAiStatus(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  workspaceId: string,
): Promise<RedactedAiStatus | null> {
  // Belt-and-braces: the route middleware gates first, but the accessor asserts admin too so it
  // can never leak status to a non-admin even if called directly (mirrors the connector surface).
  if (!canManage(ctx)) throw new ConnectorAuthorizationError()
  const config = await getConnectorConfig(db, workspaceId, AI_CONNECTOR_PROVIDER)
  if (!config) return null
  const data = parseConfig(config.config)
  const keys = await listConnectorSecretKeys(db, config.id)
  const configuredProviders = keys.filter((key): key is AiProvider =>
    (AI_PROVIDERS as readonly string[]).includes(key),
  )
  const spendSoFarUsd = await getWorkspaceAiSpendUsd(db, workspaceId)
  return {
    enabled: config.enabled,
    defaultProvider: data.defaultProvider ?? null,
    models: data.models,
    spendCapUsd: data.spendCapUsd ?? null,
    spendSoFarUsd,
    configuredProviders,
    areas: data.areas,
  }
}
