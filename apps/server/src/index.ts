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
  type SecretCodec,
  searchIndexFreshness,
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
import { databaseCheck, nonGatingCheck, replicationCheck } from './health.js'
import { type Scheduler, startScheduler } from './jobs/scheduler.js'
import { createLogger, type Logger } from './logger.js'
import { createMailer } from './mail/index.js'
import { createSearchRoutes } from './search/routes.js'
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

  const cycles =
    env.CYCLE_MAINTENANCE === 'true'
      ? {
          cron: env.CYCLE_MAINTENANCE_CRON,
          // Pre-compute a cycle digest at close unless disabled. Per-workspace AI config is
          // resolved at job time, so enabling AI via the admin UI takes effect without a restart.
          ...(env.AI_DIGEST_ON_CYCLE_CLOSE === 'true' ? { digest: { gateway: aiGateway } } : {}),
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

  let scheduler: Scheduler | undefined
  try {
    scheduler = await startScheduler({
      db: database.db,
      dbProvider,
      logger,
      ...(cycles ? { cycles } : {}),
      notifications,
      ...(search ? { search } : {}),
    })
  } catch (error) {
    logger.error({ err: error }, 'failed to start the background job scheduler')
  }

  const app = createApp({
    logger,
    readinessChecks: [
      databaseCheck(() => pingDatabase(database.db)),
      replicationCheck(async () =>
        assertReplicationHealthy(await readReplicationStatus(database.db)),
      ),
      // Non-gating: how far behind the index is, for an operator, never a verdict on the process.
      nonGatingCheck('search', async () => {
        const freshness = await searchIndexFreshness(database.db)
        const age = freshness.oldestUnindexedAgeSeconds
        return `documents=${freshness.documents} sources=${freshness.sources} oldestUnindexedAgeSeconds=${age === null ? 'none' : age}`
      }),
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
    zero: {
      dbProvider,
      resolveContext: createSessionContextResolver({
        verifyToken: auth.verifySyncToken,
        lookupRole: (userID) => lookupWorkspaceRole(database.db, userID),
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
