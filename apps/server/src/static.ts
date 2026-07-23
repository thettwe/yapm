import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'
import type { Logger } from './logger.js'

export interface SpaOptions {
  dir: string
  logger?: Logger
}

export function mountSpa(app: Hono, options: SpaOptions): void {
  const indexPath = join(options.dir, 'index.html')

  if (!existsSync(indexPath)) {
    options.logger?.warn(
      { dir: options.dir },
      'no built SPA found; serving a placeholder. Run `pnpm build` or set WEB_DIST_DIR',
    )
    app.get('*', (c) =>
      c.text('The yapm web build is not present in this deployment.\n', 503, {
        'Cache-Control': 'no-store',
      }),
    )
    return
  }

  app.use('*', serveStatic({ root: options.dir }))
  app.get('*', serveStatic({ root: options.dir, path: 'index.html' }))
}
