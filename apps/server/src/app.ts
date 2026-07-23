import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type ReadinessCheck, runReadinessChecks } from './health.js'
import type { Logger } from './logger.js'
import { mountSpa } from './static.js'

export interface AppOptions {
  logger: Logger
  readinessChecks: ReadinessCheck[]
  webDistDir?: string
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
