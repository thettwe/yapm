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
import { type KnownPullRequest, reconcileInstallation } from './reconcile.js'
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

interface DeliveryDedupe {
  has(deliveryId: string): boolean
  markSeen(deliveryId: string): void
}

// Bounded FIFO dedupe of `X-GitHub-Delivery` ids: a fast-path against same-process webhook
// redelivery. A delivery id is recorded (`markSeen`) only AFTER processing resolves, so a
// transient failure that pg-boss retries in the same process still re-runs rather than being
// silently swallowed. The durable guarantee is the order-safe upsert-on-external-id write path
// (it dedupes on the provider external id and refuses to regress fresher state), so a re-run —
// or a process restart that forgets a delivery id — still converges safely.
function createDeliveryDedupe(): DeliveryDedupe {
  const seen = new Set<string>()
  return {
    has: (deliveryId) => seen.has(deliveryId),
    markSeen: (deliveryId) => {
      if (seen.has(deliveryId)) return
      seen.add(deliveryId)
      if (seen.size > DEDUPE_CAPACITY) {
        const oldest = seen.values().next().value
        if (oldest !== undefined) seen.delete(oldest)
      }
    },
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
  const dedupe = createDeliveryDedupe()
  let ownsBoss = options.boss === undefined
  let started = false

  const processDelivery = async (delivery: NormalizedDelivery): Promise<void> => {
    if (dedupe.has(delivery.deliveryId)) return
    await processGithubDelivery(workerDeps, delivery)
    dedupe.markSeen(delivery.deliveryId)
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

      // ETag writes are buffered here and flushed only AFTER the corresponding mutations are
      // durably applied. Advancing an ETag before the apply lands would make the next sweep get
      // a 304 and never heal a failed/partial apply, so a repo whose transaction throws is
      // retried against its old ETag.
      const pendingEtags = new Map<string, string>()
      const ctx: ConnectorContext = {
        client,
        getEtag: (resource) => getInstallationEtag(db, installation.id, resource),
        setEtag: (resource, etag) => {
          pendingEtags.set(resource, etag)
          return Promise.resolve()
        },
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

        // Stored non-terminal PRs so reconcile can re-poll their checks/reviews even when the
        // pulls list is unchanged (a dropped check never bumps the PR's updated_at).
        const knownPulls = await db
          .selectFrom('pull_request')
          .select(['external_id', 'number', 'head_sha'])
          .where('installation_id', '=', installation.id)
          .where('repo', '=', repoFullName)
          .where('state', 'in', ['draft', 'open'])
          .execute()
        const known: KnownPullRequest[] = knownPulls.map((pr) => ({
          externalId: pr.external_id,
          number: pr.number,
          headSha: pr.head_sha,
        }))

        const single: InstallationRecord = { ...record, repoMapping: { [repoFullName]: teamId } }
        pendingEtags.clear()
        const mutations = await reconcileInstallation(single, ctx, known)
        if (mutations.length > 0) {
          await dbProvider.transaction((tx) =>
            applyWorkGraphMutations(tx, { teamId, now: Date.now() }, mutations),
          )
        }
        // Durable now: persist the ETags this repo advanced.
        for (const [resource, etag] of pendingEtags) {
          await setInstallationEtag(db, installation.id, resource, etag)
        }
      }
      await recordConnectorSync(db, { configId, status: 'connected' })
    }
  }

  const reconcileOnce = async (): Promise<void> => {
    const configs = await listConnectorConfigsByProvider(db, GITHUB_PROVIDER)
    for (const config of configs) {
      // Honor the admin Enable/Disable toggle: a disabled connector is never reconciled.
      if (!config.enabled) continue
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
