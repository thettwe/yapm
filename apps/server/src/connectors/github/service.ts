import {
  applyWorkGraphMutations,
  type ConnectorContext,
  type InstallationRecord,
  type NormalizedDelivery,
} from '@yapm/schema'
import {
  type DB,
  getInstallationEtag,
  listConnectorConfigsByProvider,
  listConnectorInstallations,
  recordConnectorSync,
  setInstallationEtag,
} from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import { fromKysely, type Job, PgBoss } from 'pg-boss'
import type { GithubAppEnv } from '../../config/env.js'
import type { Logger } from '../../logger.js'
import type { ZeroDatabase } from '../../zero/db-provider.js'
import { createGithubApp, type GithubApp, githubSecretsFromEnv } from './app.js'
import { type GithubConnectorSecrets, githubConnector } from './connector.js'
import { processGithubDelivery } from './worker.js'

export const GITHUB_WEBHOOK_QUEUE = 'github-webhook'
export const GITHUB_WEBHOOK_DLQ = 'github-webhook-dlq'
export const GITHUB_RECONCILE_QUEUE = 'github-reconcile'
const GITHUB_PROVIDER = 'github'
const DEDUPE_CAPACITY = 5000

export interface GithubConnectorOptions {
  appEnv: GithubAppEnv | null
  db: Kysely<DB>
  dbProvider: ZeroDatabase
  logger: Logger
  reconcileCron: string
  // Injectable so integration tests drive the same worker/queue without the App network path.
  boss?: PgBoss
  app?: GithubApp
}

export interface GithubConnector {
  readonly enabled: boolean
  readonly secrets: GithubConnectorSecrets | null
  enqueue(delivery: NormalizedDelivery): Promise<void>
  processDelivery(delivery: NormalizedDelivery): Promise<void>
  reconcileOnce(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
}

// Bounded FIFO dedupe of `X-GitHub-Delivery` ids: a fast-path against same-process webhook
// redelivery. The durable guarantee is the order-safe upsert-on-external-id write path (it
// dedupes on the provider external id and refuses to regress fresher state), so a process
// restart that forgets a delivery id still re-applies safely.
function createDeliveryDedupe(): (deliveryId: string) => boolean {
  const seen = new Set<string>()
  return (deliveryId) => {
    if (seen.has(deliveryId)) return true
    seen.add(deliveryId)
    if (seen.size > DEDUPE_CAPACITY) {
      const oldest = seen.values().next().value
      if (oldest !== undefined) seen.delete(oldest)
    }
    return false
  }
}

const disabledConnector: GithubConnector = {
  enabled: false,
  secrets: null,
  enqueue: () => Promise.resolve(),
  processDelivery: () => Promise.resolve(),
  reconcileOnce: () => Promise.resolve(),
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

export function createGithubConnector(options: GithubConnectorOptions): GithubConnector {
  if (!options.appEnv) return disabledConnector

  const { db, dbProvider, logger } = options
  const secrets = githubSecretsFromEnv(options.appEnv)
  const app = options.app ?? createGithubApp(secrets)
  const boss = options.boss ?? new PgBoss({ db: fromKysely(db), schema: 'pgboss' })
  const workerDeps = { db, dbProvider, connector: githubConnector, logger }
  const alreadyProcessed = createDeliveryDedupe()
  let ownsBoss = options.boss === undefined
  let started = false

  const processDelivery = async (delivery: NormalizedDelivery): Promise<void> => {
    if (alreadyProcessed(delivery.deliveryId)) return
    await processGithubDelivery(workerDeps, delivery)
  }

  const reconcileConfig = async (configId: string): Promise<void> => {
    const installations = await listConnectorInstallations(db, configId)

    for (const installation of installations) {
      const record: InstallationRecord = {
        id: installation.id,
        externalInstallationId: installation.external_installation_id,
        repoMapping: installation.repo_mapping,
      }
      let client: unknown
      try {
        client = await app.installationClient(installation.external_installation_id)
      } catch (error) {
        logger.error({ err: error, installation: record.id }, 'failed to build installation client')
        await recordConnectorSync(db, {
          configId,
          status: 'error',
          lastError: 'installation client unavailable',
        })
        continue
      }

      const ctx: ConnectorContext = {
        client,
        getEtag: (resource) => getInstallationEtag(db, installation.id, resource),
        setEtag: (resource, etag) => setInstallationEtag(db, installation.id, resource, etag),
        log: logger,
      }

      // One repo at a time so every emitted PR/deploy lands in that repo's mapped team. A
      // mapping to a since-deleted team is skipped (never written un-scoped), mirroring the
      // webhook drop path.
      for (const [repoFullName, teamId] of Object.entries(installation.repo_mapping)) {
        const team = await db
          .selectFrom('team')
          .select('id')
          .where('id', '=', teamId)
          .executeTakeFirst()
        if (!team) continue
        const single: InstallationRecord = { ...record, repoMapping: { [repoFullName]: teamId } }
        const mutations = await githubConnector.reconcile(single, ctx)
        if (mutations.length === 0) continue
        await dbProvider.transaction((tx) =>
          applyWorkGraphMutations(tx, { teamId, now: Date.now() }, mutations),
        )
      }
      await recordConnectorSync(db, { configId, status: 'connected' })
    }
  }

  const reconcileOnce = async (): Promise<void> => {
    const configs = await listConnectorConfigsByProvider(db, GITHUB_PROVIDER)
    for (const config of configs) {
      await reconcileConfig(config.id)
    }
  }

  const start = async (): Promise<void> => {
    if (started) return
    started = true
    if (ownsBoss) {
      boss.on('error', (error) => logger.error({ err: error }, 'github connector pg-boss error'))
      await boss.start()
    }

    await boss.createQueue(GITHUB_WEBHOOK_DLQ)
    await boss.createQueue(GITHUB_WEBHOOK_QUEUE, {
      policy: 'key_strict_fifo',
      retryLimit: 5,
      retryDelay: 1,
      retryBackoff: true,
      retryDelayMax: 300,
      deadLetter: GITHUB_WEBHOOK_DLQ,
    })
    await boss.createQueue(GITHUB_RECONCILE_QUEUE)

    await boss.work(
      GITHUB_WEBHOOK_QUEUE,
      { batchSize: 1 },
      async ([job]: Job<NormalizedDelivery>[]) => {
        if (job) await processDelivery(job.data)
      },
    )
    await boss.work(GITHUB_RECONCILE_QUEUE, async () => {
      await reconcileOnce()
    })
    await boss.schedule(GITHUB_RECONCILE_QUEUE, options.reconcileCron)
    logger.info({ reconcileCron: options.reconcileCron }, 'github connector started')
  }

  const stop = async (): Promise<void> => {
    if (!started) return
    started = false
    if (ownsBoss) {
      ownsBoss = false
      await boss.stop({ graceful: true })
    }
  }

  const enqueue = (delivery: NormalizedDelivery): Promise<void> =>
    boss
      .send(GITHUB_WEBHOOK_QUEUE, delivery, {
        singletonKey: `installation-${delivery.installationKey}`,
      })
      .then(() => undefined)

  return {
    enabled: true,
    secrets,
    enqueue,
    processDelivery,
    reconcileOnce,
    start,
    stop,
  }
}
