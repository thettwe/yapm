import {
  applyWorkGraphMutations,
  type ConnectorContext,
  type ConnectorDefinition,
  type NormalizedDelivery,
  newId,
  type WorkGraphMutation,
} from '@yapm/schema'
import {
  type DB,
  deleteConnectorInstallation,
  findConnectorConfigByProvider,
  findConnectorInstallation,
  getConnectorConfigById,
  resolveTeamForRepo,
  upsertConnectorInstallation,
} from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import type { Logger } from '../../logger.js'
import type { ZeroDatabase } from '../../zero/db-provider.js'
import type { GithubConnectorConfig, GithubConnectorSecrets } from './connector.js'
import type { InstallationEvent } from './payloads.js'
import { repositoryFullName } from './payloads.js'

const GITHUB_PROVIDER = 'github'

export interface GithubWorkerDeps {
  db: Kysely<DB>
  dbProvider: ZeroDatabase
  connector: ConnectorDefinition<GithubConnectorConfig, GithubConnectorSecrets>
  logger: Logger
}

// Rewrites the provider's external installation id (as `ingest` stamps it) to the internal
// `connector_installation` id the work-graph FK references. Narrowing per variant keeps the
// discriminated-union type intact.
function withInstallationId(
  mutation: WorkGraphMutation,
  installationId: string,
): WorkGraphMutation {
  switch (mutation.kind) {
    case 'upsertPullRequest':
      return { ...mutation, installationId }
    case 'upsertCiCheck':
      return { ...mutation, installationId }
    case 'upsertReview':
      return { ...mutation, installationId }
    case 'upsertDeployment':
      return { ...mutation, installationId }
  }
}

// The `installation` / `installation_repositories` lifecycle events maintain the per-install
// record itself (not the work graph). A create/edit upserts it onto the workspace's single
// GitHub config; a delete removes it (cascading its work-graph rows away).
async function handleLifecycle(
  deps: GithubWorkerDeps,
  delivery: NormalizedDelivery,
): Promise<void> {
  const payload = delivery.payload as InstallationEvent
  const externalId = String(payload.installation.id)

  if (payload.action === 'deleted') {
    await deleteConnectorInstallation(deps.db, GITHUB_PROVIDER, externalId)
    return
  }

  const config = await findConnectorConfigByProvider(deps.db, GITHUB_PROVIDER)
  if (!config) {
    deps.logger.warn({ externalId }, 'github installation event with no connector config; ignoring')
    return
  }
  await upsertConnectorInstallation(deps.db, {
    id: newId(),
    configId: config.id,
    externalInstallationId: externalId,
    accountLogin: payload.installation.account?.login ?? null,
  })
}

// The offline ingest path: resolve the repo's team (drop the delivery if the installation is
// unknown or the repo is unmapped — never write an un-scoped row), map the payload to
// mutations, rewrite to the internal installation id, and apply through the shared write path.
export async function processGithubDelivery(
  deps: GithubWorkerDeps,
  delivery: NormalizedDelivery,
): Promise<void> {
  if (delivery.eventType === 'installation' || delivery.eventType === 'installation_repositories') {
    await handleLifecycle(deps, delivery)
    return
  }

  const installation = await findConnectorInstallation(
    deps.db,
    GITHUB_PROVIDER,
    delivery.installationKey,
  )
  if (!installation) {
    deps.logger.warn(
      { installationKey: delivery.installationKey, eventType: delivery.eventType },
      'github webhook for an unknown installation; dropping',
    )
    return
  }

  // Honor the admin Enable/Disable toggle: a disabled connector ingests nothing. Lifecycle
  // events are handled above so an uninstall still cleans up; only work-graph deliveries drop.
  const config = await getConnectorConfigById(deps.db, installation.connector_config_id)
  if (!config?.enabled) {
    deps.logger.debug(
      { installationKey: delivery.installationKey, eventType: delivery.eventType },
      'github webhook for a disabled connector; dropping',
    )
    return
  }

  const repo = repositoryFullName(delivery.payload)
  if (!repo) return

  const teamId = await resolveTeamForRepo(deps.db, installation.id, repo)
  if (!teamId) {
    deps.logger.debug({ repo }, 'github webhook for an unmapped repo; dropping')
    return
  }

  // repo_mapping has no FK to team, so a mapping to a since-deleted team resolves to a truthy
  // id whose row is gone. Applying would violate the work-graph team FK and dead-letter every
  // delivery for the repo; drop it instead, mirroring the reconcile sweep's deleted-team skip.
  const team = await deps.db
    .selectFrom('team')
    .select('id')
    .where('id', '=', teamId)
    .executeTakeFirst()
  if (!team) {
    deps.logger.debug({ repo, teamId }, 'github webhook for a deleted team; dropping')
    return
  }

  // `ingest` is pure mapping and never touches the network, so no installation token is minted
  // on the webhook path; `client` is unused here.
  const ctx: ConnectorContext = {
    client: null,
    getEtag: () => Promise.resolve(null),
    setEtag: () => Promise.resolve(),
    log: deps.logger,
  }

  const mutations = await deps.connector.ingest(delivery, ctx)
  if (mutations.length === 0) return

  const scoped = mutations.map((mutation) => withInstallationId(mutation, installation.id))
  const now = Date.now()
  await deps.dbProvider.transaction((tx) => applyWorkGraphMutations(tx, { teamId, now }, scoped))
}
