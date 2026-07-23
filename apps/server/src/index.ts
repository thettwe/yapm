import { serve } from '@hono/node-server'
import { newId } from '@yapm/schema'
import {
  assertReplicationHealthy,
  createDatabase,
  lookupWorkspaceRole,
  migrateToLatest,
  pingDatabase,
  readReplicationStatus,
  seedWorkspace,
} from '@yapm/schema/db'
import { createApp } from './app.js'
import { createAuth } from './auth.js'
import { createAuthRoutes } from './auth-routes.js'
import { type Env, EnvValidationError, loadEnv } from './config/env.js'
import { databaseCheck, replicationCheck } from './health.js'
import { createLogger, type Logger } from './logger.js'
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

  const app = createApp({
    logger,
    readinessChecks: [
      databaseCheck(() => pingDatabase(database.db)),
      replicationCheck(async () =>
        assertReplicationHealthy(await readReplicationStatus(database.db)),
      ),
    ],
    webDistDir: env.WEB_DIST_DIR,
    authRoutes: createAuthRoutes({ auth, db: database.db, env, logger }),
    zero: {
      dbProvider: createZeroDatabase(database.db),
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

  installShutdownHandlers({ server, close: database.close, logger })
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
