import { serve } from '@hono/node-server'
import { newId } from '@yapm/schema'
import {
  assertReplicationHealthy,
  createDatabase,
  createSecretCodec,
  lookupWorkspaceRole,
  migrateToLatest,
  pingDatabase,
  readReplicationStatus,
  resolvePmAudienceTeamIds,
  type SecretCodec,
  seedWorkspace,
} from '@yapm/schema/db'
import { createAiAdminRoutes } from './ai/admin-routes.js'
import { createAiGateway } from './ai/gateway.js'
import { createApp } from './app.js'
import { createAuth } from './auth.js'
import { createAuthRoutes } from './auth-routes.js'
import {
  aiEnv,
  type Env,
  EnvValidationError,
  githubAppEnv,
  loadEnv,
  mailEnv,
} from './config/env.js'
import { createConnectorAdminRoutes } from './connectors/admin-routes.js'
import { createGithubConnector, githubConnector } from './connectors/github/index.js'
import { createGithubWebhookRoute } from './connectors/github/routes.js'
import { databaseCheck, gatingCheck, nonGatingCheck, replicationCheck } from './health.js'
import { RETRO_AI_DRAFT_INTERVAL_SECONDS } from './jobs/retro-draft.js'
import { type Scheduler, startScheduler } from './jobs/scheduler.js'
import { createLogger, type Logger } from './logger.js'
import { createMailer } from './mail/index.js'
import { createSearchFreshnessProbe } from './search/freshness.js'
import { createSearchRoutes } from './search/routes.js'
import { createStorageProvider } from './storage/index.js'
import { createFileRoutes } from './storage/routes.js'
import { createSessionContextResolver } from './zero/context.js'
import { createZeroDatabase } from './zero/db-provider.js'

function readEnvOrExit(): Env {
  try {
    return loadEnv()
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`${error.message}\n`)
      process.exit(1)
    }
    throw error
  }
}

async function main(): Promise<void> {
  const env = readEnvOrExit()
  const logger = createLogger(env)

  const database = createDatabase({
    connectionString: env.DATABASE_URL,
    maxConnections: env.DATABASE_POOL_MAX,
    log: (event) => {
      if (event.level === 'error') logger.error({ sql: event.message }, 'database error')
      else logger.trace({ sql: event.message }, 'database query')
    },
    onPoolError: (error) => logger.error({ err: error }, 'database pool error'),
  })

  const auth = createAuth(database.db, env)

  try {
    const applied = await migrateToLatest(database.db)
    for (const outcome of applied) {
      logger.info({ migration: outcome.name, direction: outcome.direction }, 'migration applied')
    }
    if (applied.length === 0) {
      logger.info('database schema already up to date')
    }

    // better-auth owns user/session/account/verification/jwks. Its getMigrations() is not
    // advisory-locked, so it only runs from this single boot path, after the Kysely Migrator.
    const authMigration = await auth.migrateAuth()
    if (authMigration.created.length > 0 || authMigration.altered.length > 0) {
      logger.info(
        { created: authMigration.created, altered: authMigration.altered },
        'auth schema migrated',
      )
    } else {
      logger.info('auth schema already up to date')
    }

    const seeded = await seedWorkspace(database.db, {
      id: newId(),
      name: env.SEED_WORKSPACE_NAME,
    })
    if (seeded) {
      logger.info({ workspace: { id: seeded.id, name: seeded.name } }, 'seeded workspace')
    }
  } catch (error) {
    logger.fatal({ err: error }, 'database migration failed; not starting the server')
    await database.close()
    process.exit(1)
  }

  const dbProvider = createZeroDatabase(database.db)

  const github = createGithubConnector({
    appEnv: githubAppEnv(env),
    db: database.db,
    dbProvider,
    logger,
    reconcileCron: env.GITHUB_RECONCILE_CRON,
  })
  if (github.enabled) {
    try {
      await github.start()
    } catch (error) {
      logger.error({ err: error }, 'failed to start the GitHub connector')
    }
  }
  const githubWebhook = createGithubWebhookRoute({
    enabled: github.enabled,
    connector: githubConnector,
    secrets: github.secrets,
    enqueue: (delivery) => github.enqueue(delivery),
  })

  const githubMissingEnv = (
    [
      ['GITHUB_APP_ID', env.GITHUB_APP_ID],
      ['GITHUB_APP_PRIVATE_KEY', env.GITHUB_APP_PRIVATE_KEY],
      ['GITHUB_APP_WEBHOOK_SECRET', env.GITHUB_APP_WEBHOOK_SECRET],
      ['SECRETS_ENCRYPTION_KEY', env.SECRETS_ENCRYPTION_KEY],
    ] as const
  )
    .filter(([, value]) => value === undefined)
    .map(([name]) => name)

  const connectorAdmin = createConnectorAdminRoutes({
    auth,
    db: database.db,
    logger,
    githubConfigured: github.enabled,
    githubMissingEnv,
  })

  // The shared encrypted-secrets codec (reused for AI provider keys). Absent when
  // SECRETS_ENCRYPTION_KEY is unset — UI-entered keys can't be stored, but env-default keys work.
  const secretCodec: SecretCodec | null = env.SECRETS_ENCRYPTION_KEY
    ? createSecretCodec(env.SECRETS_ENCRYPTION_KEY)
    : null

  const aiAdmin = createAiAdminRoutes({
    auth,
    db: database.db,
    logger,
    codec: secretCodec,
    env: aiEnv(env),
  })

  // The BYO-key gateway (one swappable seam over the AI SDK). It resolves the provider/model/key
  // per workspace at call time and returns null when AI is unconfigured, so it is safe to construct
  // unconditionally: a digest job for an AI-less workspace simply writes `ai_off`.
  const aiGateway = createAiGateway({ db: database.db, codec: secretCodec, env: aiEnv(env) })

  // Null when neither transport is configured. Null is not a degraded state: the inbox is complete
  // without it, invite links stay copyable, and no delivery job is registered.
  const mailer = createMailer(env, logger)
  const mail = mailEnv(env)

  // NEVER null, unlike the mailer: an instance with no byte store cannot show an image somebody
  // pasted, so `local` is what an unconfigured instance gets and it is complete.
  const storage = createStorageProvider(env, logger)

  const cycles =
    env.CYCLE_MAINTENANCE === 'true'
      ? {
          cron: env.CYCLE_MAINTENANCE_CRON,
          // Pre-compute a cycle digest at close unless disabled. Per-workspace AI config is
          // resolved at job time, so enabling AI via the admin UI takes effect without a restart.
          // The changed-file reader is null when the GitHub App env is absent; the digest then runs
          // un-enriched, exactly as before.
          ...(env.AI_DIGEST_ON_CYCLE_CLOSE === 'true'
            ? {
                digest: {
                  gateway: aiGateway,
                  changedFilesReader: github.changedFilesReader,
                  // The PM disclosure pass, on the SAME job and over the SAME already-built facts —
                  // no second fact read, no second queue, no new container. Default OFF, and off is
                  // not a degraded state: the whole surface simply does not exist. `env.ts` fails at
                  // boot if this is on while the digest job itself is off, because that combination
                  // describes a pass that would never run.
                  pmDisclosure: env.AI_PM_DIGEST === 'true',
                },
              }
            : {}),
        }
      : undefined

  // Notification retention is always wanted — it is what bounds the synced set, not an email
  // feature — so the scheduler starts whenever EITHER block is enabled. CYCLE_MAINTENANCE=false
  // (which the e2e stack sets, for deterministic timing) no longer silently disables it.
  const notifications = {
    retentionDays: env.NOTIFICATION_RETENTION_DAYS,
    retentionCron: env.NOTIFICATION_RETENTION_CRON,
    ...(mailer && mail
      ? { email: { mailer, publicUrl: mail.publicUrl, cron: env.NOTIFICATION_EMAIL_CRON } }
      : {}),
  }

  // Independently gated: off means the index stops being maintained, not that search errors. The
  // route keeps answering from whatever the index already holds, and the on-device pass is
  // untouched either way.
  const search =
    env.SEARCH_INDEX === 'true'
      ? {
          intervalSeconds: env.SEARCH_INDEX_INTERVAL_SECONDS,
          reconcileCron: env.SEARCH_RECONCILE_CRON,
          textConfig: env.SEARCH_TEXT_CONFIG,
        }
      : undefined

  // The lazy retro-draft tail, gated separately from the digest because a team may want one and not
  // the other and both spend on the same BYO key. The gateway is always constructed and resolves the
  // workspace's AI config at run time, so an instance with no key configured is not a special case
  // here: `generateStructured` returns null and the artifact is written `ai_off`. Nothing drafts at
  // all for a team that has not opted in, whatever this is set to.
  const retroDraft =
    env.AI_RETRO_DRAFT === 'true'
      ? { gateway: aiGateway, intervalSeconds: RETRO_AI_DRAFT_INTERVAL_SECONDS }
      : undefined

  // A SIXTH independent block on the SAME pg-boss instance, and the retention half is passed
  // UNCONDITIONALLY. `ai_disclosure_audit` exists whether or not AI is switched on, so its bound has
  // to be enforced whether or not AI is switched on — a bound that lapses when the feature is
  // disabled is not a bound. The ready-notice sweep is gated on all three of a transport, a public
  // URL and the instance floor being open.
  const disclosure = {
    retentionDays: env.AI_DISCLOSURE_RETENTION_DAYS,
    retentionCron: env.AI_DISCLOSURE_RETENTION_CRON,
    ...(mailer && mail && env.AI_PM_DIGEST_READY_EMAIL === 'true'
      ? { email: { mailer, publicUrl: mail.publicUrl, cron: env.NOTIFICATION_EMAIL_CRON } }
      : {}),
  }

  let scheduler: Scheduler | undefined
  try {
    scheduler = await startScheduler({
      db: database.db,
      dbProvider,
      logger,
      ...(cycles ? { cycles } : {}),
      notifications,
      ...(search ? { search } : {}),
      // A fourth independent block on the SAME pg-boss instance.
      attachments: {
        provider: storage,
        graceHours: env.ATTACHMENT_ORPHAN_GRACE_HOURS,
        cron: env.ATTACHMENT_GC_CRON,
      },
      // A fifth independent block on the SAME pg-boss instance.
      ...(retroDraft ? { retroDraft } : {}),
      disclosure,
    })
  } catch (error) {
    logger.error({ err: error }, 'failed to start the background job scheduler')
  }

  const searchFreshness = createSearchFreshnessProbe({
    db: database.db,
    ttlMs: env.SEARCH_INDEX_INTERVAL_SECONDS * 1000,
    statementTimeoutMs: env.SEARCH_STATEMENT_TIMEOUT_MS,
  })

  const app = createApp({
    logger,
    readinessChecks: [
      databaseCheck(() => pingDatabase(database.db)),
      replicationCheck(async () =>
        assertReplicationHealthy(await readReplicationStatus(database.db)),
      ),
      // Non-gating: how far behind the index is, for an operator, never a verdict on the process.
      // Memoised for one incremental-pass interval — the probe runs every ten seconds and the scan
      // behind it is O(corpus), so recomputing it per probe would be the readiness check costing
      // more than the traffic it guards.
      nonGatingCheck('search', searchFreshness),
      // GATING, unlike search freshness: a read-only or missing volume means every upload fails and
      // every image 404s, which is an instance that should not take traffic. For the local provider
      // this is a write-and-unlink probe in the configured directory, so a container with no
      // persistent mount fails at boot rather than at somebody's first paste.
      gatingCheck('storage', () => storage.health()),
    ],
    webDistDir: env.WEB_DIST_DIR,
    authRoutes: createAuthRoutes({
      auth,
      db: database.db,
      env,
      logger,
      ...(mailer && mail ? { mail: { mailer, publicUrl: mail.publicUrl } } : {}),
    }),
    githubWebhook,
    connectorAdmin,
    aiAdmin,
    search: createSearchRoutes({
      auth,
      db: database.db,
      logger,
      textConfig: env.SEARCH_TEXT_CONFIG,
      statementTimeoutMs: env.SEARCH_STATEMENT_TIMEOUT_MS,
    }),
    files: createFileRoutes({
      auth,
      db: database.db,
      provider: storage,
      logger,
      maxBytes: env.ATTACHMENT_MAX_BYTES,
    }),
    zero: {
      dbProvider,
      resolveContext: createSessionContextResolver({
        verifyToken: auth.verifySyncToken,
        lookupRole: (userID) => lookupWorkspaceRole(database.db, userID),
        // Resolved per `/query` request, like the role, so flipping the kill switch or removing
        // somebody from an audience stops new rows within one query refresh rather than at the next
        // sign-in. What it cannot do is un-read a digest somebody already read — which is the whole
        // argument for the human publish gate.
        lookupPmAudience: (userID) => resolvePmAudienceTeamIds(database.db, userID),
      }),
      logger,
      queryApiKey: env.ZERO_QUERY_API_KEY,
      mutateApiKey: env.ZERO_MUTATE_API_KEY,
    },
  })

  const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
    logger.info({ host: env.HOST, port: info.port }, 'yapm server listening')
  })

  installShutdownHandlers({
    server,
    close: async () => {
      if (scheduler) await scheduler.stop()
      await github.stop()
      await database.close()
    },
    logger,
  })
}

interface ShutdownOptions {
  server: { close: (callback?: (error?: Error) => void) => void }
  close: () => Promise<void>
  logger: Logger
}

function installShutdownHandlers(options: ShutdownOptions): void {
  let shuttingDown = false

  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    options.logger.info({ signal }, 'shutting down')
    options.server.close(() => {
      void options.close().then(
        () => process.exit(0),
        (error: unknown) => {
          options.logger.error({ err: error }, 'failed to close the database pool')
          process.exit(1)
        },
      )
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

await main()
