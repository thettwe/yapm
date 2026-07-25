import { type Kysely, sql } from 'kysely'
import type { SecretCodec } from '../secrets/codec.js'
import {
  type AuthContext,
  type ConnectorConfigData,
  type ConnectorStatus,
  canManage,
} from '../zero/context.js'
import type { ConnectorConfig, ConnectorConfigUpdate, ConnectorInstallation, DB } from './types.js'

// The connector surface is admin-only: writes triggered by the settings UI require a
// workspace admin. System operations (webhook ingest, reconcile) run without a user and
// call the un-gated accessors below (mapping resolution, ETag/status telemetry, secret
// decryption for auth).
export class ConnectorAuthorizationError extends Error {
  constructor() {
    super('connector configuration requires a workspace admin')
    this.name = 'ConnectorAuthorizationError'
  }
}

function assertConnectorAdmin(ctx: AuthContext | undefined): void {
  if (!canManage(ctx)) throw new ConnectorAuthorizationError()
}

export interface UpsertConnectorConfigOptions {
  // Client-minted UUIDv7, generated at the call site (constraint #4).
  id: string
  workspaceId: string
  provider: string
  enabled?: boolean
  config?: ConnectorConfigData
  now?: Date
}

// Admin-gated. Creates or updates the per-workspace/provider config; only the provided
// fields are changed on conflict, so toggling `enabled` never clobbers the stored `config`.
export async function upsertConnectorConfig(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  options: UpsertConnectorConfigOptions,
): Promise<ConnectorConfig> {
  assertConnectorAdmin(ctx)
  const now = options.now ?? new Date()
  const config = options.config === undefined ? undefined : JSON.stringify(options.config)
  const update: ConnectorConfigUpdate = { updated_at: now }
  if (options.enabled !== undefined) update.enabled = options.enabled
  if (config !== undefined) update.config = config

  return db
    .insertInto('connector_config')
    .values({
      id: options.id,
      workspace_id: options.workspaceId,
      provider: options.provider,
      updated_at: now,
      ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
      ...(config === undefined ? {} : { config }),
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'provider']).doUpdateSet(update))
    .returningAll()
    .executeTakeFirstOrThrow()
}

// System read (no secrets exposed): the connector-build path checks whether a workspace has
// enabled a provider.
export async function getConnectorConfig(
  db: Kysely<DB>,
  workspaceId: string,
  provider: string,
): Promise<ConnectorConfig | null> {
  const row = await db
    .selectFrom('connector_config')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('provider', '=', provider)
    .executeTakeFirst()
  return row ?? null
}

export async function listConnectorConfigs(
  db: Kysely<DB>,
  workspaceId: string,
): Promise<ConnectorConfig[]> {
  return db
    .selectFrom('connector_config')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .orderBy('provider')
    .execute()
}

export interface RecordConnectorSyncOptions {
  configId: string
  status: ConnectorStatus
  lastError?: string | null
  now?: Date
}

// System write: ingest/reconcile record connection health. A successful sync stamps
// `last_synced_at` and clears the error; otherwise `last_error` is set.
export async function recordConnectorSync(
  db: Kysely<DB>,
  options: RecordConnectorSyncOptions,
): Promise<void> {
  const now = options.now ?? new Date()
  const update: ConnectorConfigUpdate = { status: options.status, updated_at: now }
  if (options.status === 'connected') {
    update.last_synced_at = now
    update.last_error = null
  } else if (options.lastError !== undefined) {
    update.last_error = options.lastError
  }
  await db.updateTable('connector_config').set(update).where('id', '=', options.configId).execute()
}

export interface SetConnectorSecretOptions {
  // Client-minted UUIDv7.
  id: string
  configId: string
  key: string
  value: string
  now?: Date
}

// Admin-gated. Encrypts the plaintext with the codec and stores/replaces the named secret.
// The plaintext is never persisted, logged, or returned.
export async function setConnectorSecret(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  codec: SecretCodec,
  options: SetConnectorSecretOptions,
): Promise<void> {
  assertConnectorAdmin(ctx)
  const now = options.now ?? new Date()
  const ciphertext = codec.encrypt(options.value)
  await db
    .insertInto('connector_secret')
    .values({
      id: options.id,
      connector_config_id: options.configId,
      key: options.key,
      ciphertext,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['connector_config_id', 'key']).doUpdateSet({ ciphertext, updated_at: now }),
    )
    .execute()
}

// System read: the connector mints auth from the decrypted secret. Never reaches a client.
export async function getConnectorSecret(
  db: Kysely<DB>,
  codec: SecretCodec,
  configId: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('connector_secret')
    .select('ciphertext')
    .where('connector_config_id', '=', configId)
    .where('key', '=', key)
    .executeTakeFirst()
  return row ? codec.decrypt(row.ciphertext) : null
}

// Admin-gated.
export async function deleteConnectorSecret(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  configId: string,
  key: string,
): Promise<void> {
  assertConnectorAdmin(ctx)
  await db
    .deleteFrom('connector_secret')
    .where('connector_config_id', '=', configId)
    .where('key', '=', key)
    .execute()
}

// Redacted-only: the secret NAMES, never the ciphertext or plaintext.
export async function listConnectorSecretKeys(db: Kysely<DB>, configId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('connector_secret')
    .select('key')
    .where('connector_config_id', '=', configId)
    .orderBy('key')
    .execute()
  return rows.map((row) => row.key)
}

export interface UpsertConnectorInstallationOptions {
  // Client-minted UUIDv7.
  id: string
  configId: string
  externalInstallationId: string
  accountLogin?: string | null
  now?: Date
}

// System write: the install/uninstall webhook records the installation. The admin-managed
// `repo_mapping` and the reconcile `etags` are left untouched here — they are updated through
// their own accessors so a lifecycle event never clobbers them.
export async function upsertConnectorInstallation(
  db: Kysely<DB>,
  options: UpsertConnectorInstallationOptions,
): Promise<ConnectorInstallation> {
  const now = options.now ?? new Date()
  return db
    .insertInto('connector_installation')
    .values({
      id: options.id,
      connector_config_id: options.configId,
      external_installation_id: options.externalInstallationId,
      account_login: options.accountLogin ?? null,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc
        .columns(['connector_config_id', 'external_installation_id'])
        .doUpdateSet({ account_login: options.accountLogin ?? null, updated_at: now }),
    )
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function getConnectorInstallation(
  db: Kysely<DB>,
  configId: string,
  externalInstallationId: string,
): Promise<ConnectorInstallation | null> {
  const row = await db
    .selectFrom('connector_installation')
    .selectAll()
    .where('connector_config_id', '=', configId)
    .where('external_installation_id', '=', externalInstallationId)
    .executeTakeFirst()
  return row ?? null
}

export async function listConnectorInstallations(
  db: Kysely<DB>,
  configId: string,
): Promise<ConnectorInstallation[]> {
  return db
    .selectFrom('connector_installation')
    .selectAll()
    .where('connector_config_id', '=', configId)
    .orderBy('external_installation_id')
    .execute()
}

export interface SetRepoTeamOptions {
  installationId: string
  repoFullName: string
  teamId: string
  now?: Date
}

// Admin-gated: maps a repo (full name) to a team so ingested rows land inside a team
// boundary. Merges into the `repo_mapping` jsonb without touching other entries.
export async function setInstallationRepoTeam(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  options: SetRepoTeamOptions,
): Promise<void> {
  assertConnectorAdmin(ctx)
  const now = options.now ?? new Date()
  const patch = JSON.stringify({ [options.repoFullName]: options.teamId })
  await sql`
    update connector_installation
    set repo_mapping = repo_mapping || ${patch}::jsonb, updated_at = ${now}
    where id = ${options.installationId}
  `.execute(db)
}

// Admin-gated: removes a repo -> team mapping entry.
export async function removeInstallationRepoTeam(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  installationId: string,
  repoFullName: string,
  now: Date = new Date(),
): Promise<void> {
  assertConnectorAdmin(ctx)
  await sql`
    update connector_installation
    set repo_mapping = repo_mapping - ${repoFullName}, updated_at = ${now}
    where id = ${installationId}
  `.execute(db)
}

// System read: which team owns a repo's ingested rows, or null when unmapped (a webhook for
// an unmapped repo is dropped, never written un-scoped).
export async function resolveTeamForRepo(
  db: Kysely<DB>,
  installationId: string,
  repoFullName: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('connector_installation')
    .select(sql<string | null>`repo_mapping ->> ${repoFullName}`.as('team_id'))
    .where('id', '=', installationId)
    .executeTakeFirst()
  return row?.team_id ?? null
}

// System write: reconcile stores the conditional-request ETag per (installation, resource).
export async function setInstallationEtag(
  db: Kysely<DB>,
  installationId: string,
  resource: string,
  etag: string,
  now: Date = new Date(),
): Promise<void> {
  const patch = JSON.stringify({ [resource]: etag })
  await sql`
    update connector_installation
    set etags = etags || ${patch}::jsonb, updated_at = ${now}
    where id = ${installationId}
  `.execute(db)
}

export async function getInstallationEtag(
  db: Kysely<DB>,
  installationId: string,
  resource: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('connector_installation')
    .select(sql<string | null>`etags ->> ${resource}`.as('etag'))
    .where('id', '=', installationId)
    .executeTakeFirst()
  return row?.etag ?? null
}

export interface RedactedInstallation {
  externalInstallationId: string
  accountLogin: string | null
  repoMapping: Record<string, string>
}

export interface RedactedConnectorStatus {
  provider: string
  enabled: boolean
  status: ConnectorStatus
  lastSyncedAt: Date | null
  lastError: string | null
  secretKeys: string[]
  installations: RedactedInstallation[]
}

// Admin-gated. Assembles everything the settings UI shows — enabled flag, status, telemetry,
// installations, and the NAMES of stored secrets — with no secret material of any kind. This
// is the read side of the server-only surface (secrets/config never sync through Zero).
export async function getRedactedConnectorStatus(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  workspaceId: string,
  provider: string,
): Promise<RedactedConnectorStatus | null> {
  assertConnectorAdmin(ctx)
  const config = await getConnectorConfig(db, workspaceId, provider)
  if (!config) return null

  const [secretKeys, installations] = await Promise.all([
    listConnectorSecretKeys(db, config.id),
    listConnectorInstallations(db, config.id),
  ])

  return {
    provider: config.provider,
    enabled: config.enabled,
    status: config.status,
    lastSyncedAt: config.last_synced_at,
    lastError: config.last_error,
    secretKeys,
    installations: installations.map((installation) => ({
      externalInstallationId: installation.external_installation_id,
      accountLogin: installation.account_login,
      repoMapping: installation.repo_mapping,
    })),
  }
}
