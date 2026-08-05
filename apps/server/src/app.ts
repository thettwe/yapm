import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type ReadinessCheck, runReadinessChecks } from './health.js'
import type { Logger } from './logger.js'
import { mountSpa } from './static.js'
import { createZeroRoutes, type ZeroRoutesOptions } from './zero/routes.js'

export interface AppOptions {
  logger: Logger
  readinessChecks: ReadinessCheck[]
  // The browser-reachable zero-cache origin the SPA fetches before it constructs a Zero client.
  // Passed in rather than read from the ambient environment here, so the value the app serves is
  // the value its caller validated.
  zeroCacheUrl?: string
  webDistDir?: string
  zero?: ZeroRoutesOptions
  authRoutes?: Hono
  githubWebhook?: Hono
  connectorAdmin?: Hono
  configurationAdmin?: Hono
  aiAdmin?: Hono
  search?: Hono
  files?: Hono
}

const QUIET_PATHS = new Set(['/healthz', '/readyz'])

export function createApp(options: AppOptions): Hono {
  const app = new Hono()
  const logger = options.logger

  app.use(async (c, next) => {
    const started = performance.now()
    await next()
    const durationMs = Math.round((performance.now() - started) * 1000) / 1000
    const entry = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    }
    if (QUIET_PATHS.has(c.req.path)) {
      logger.debug(entry, 'request')
    } else if (c.res.status >= 500) {
      logger.error(entry, 'request')
    } else if (c.res.status >= 400) {
      logger.warn(entry, 'request')
    } else {
      logger.info(entry, 'request')
    }
  })

  app.get('/healthz', (c) => c.json({ status: 'ok' }, 200, { 'Cache-Control': 'no-store' }))

  app.get('/readyz', async (c) => {
    const report = await runReadinessChecks(options.readinessChecks)
    return c.json(report, report.status === 'ready' ? 200 : 503, { 'Cache-Control': 'no-store' })
  })

  // Unauthenticated on purpose: the value is public to every browser that connects, and the SPA
  // needs it before it has a session. `no-store` because a cached copy would survive a change of
  // origin in exactly the deployment where the origin just changed.
  if (options.zeroCacheUrl !== undefined) {
    const zeroCacheUrl = options.zeroCacheUrl
    app.get('/api/config', (c) => c.json({ zeroCacheUrl }, 200, { 'Cache-Control': 'no-store' }))
  }

  if (options.authRoutes) {
    app.route('/', options.authRoutes)
  }

  if (options.githubWebhook) {
    app.route('/', options.githubWebhook)
  }

  if (options.connectorAdmin) {
    app.route('/', options.connectorAdmin)
  }

  if (options.configurationAdmin) {
    app.route('/', options.configurationAdmin)
  }

  if (options.aiAdmin) {
    app.route('/', options.aiAdmin)
  }

  if (options.search) {
    app.route('/', options.search)
  }

  if (options.files) {
    app.route('/', options.files)
  }

  if (options.zero) {
    app.route('/api/zero', createZeroRoutes(options.zero))
  }

  if (options.webDistDir) {
    mountSpa(app, { dir: options.webDistDir, logger })
  }

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse()
    }
    logger.error({ err: error, path: c.req.path }, 'unhandled error')
    return c.json({ error: 'internal_server_error' }, 500)
  })

  return app
}
