import type { WorkspaceRole } from '@yapm/schema'
import { Hono } from 'hono'
import {
  CONFIGURATION_API_PATH,
  findShippedDefaults,
  SHIPPED_DEFAULT_REMEDIES,
  type ShippedDefaultsSource,
} from './shipped-defaults.js'

export interface ConfigurationAdminRoutesOptions {
  // Narrowed to the one method this needs, so the route can be tested without an auth service or a
  // database — the same seam `createSessionContextResolver` uses for the sync path.
  getSessionUser: (headers: Headers) => Promise<{ id: string } | undefined>
  lookupRole: (userId: string) => Promise<WorkspaceRole | null>
  env: ShippedDefaultsSource
}

// The operator-only half of the shipped-default report. `/readyz` says HOW MANY security-relevant
// variables are still at a published value; this says WHICH, and it is admin-gated because the
// answer is a confirmed list of which known secrets a host is running on. Auth is checked BEFORE
// anything is read, so a member, a viewer and an anonymous caller all learn nothing.
export function createConfigurationAdminRoutes(options: ConfigurationAdminRoutesOptions): Hono {
  const app = new Hono()

  app.get(CONFIGURATION_API_PATH, async (c) => {
    const user = await options.getSessionUser(c.req.raw.headers)
    if (user === undefined) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    if ((await options.lookupRole(user.id)) !== 'admin') {
      return c.json({ error: 'forbidden' }, 403)
    }

    const variables = findShippedDefaults(options.env)
    return c.json(
      {
        // Names and remedies, never values: this response is as copy-pasteable into an issue as a
        // log line is, and a value in it would publish the secret a second time.
        shippedDefaults: variables.map((name) => ({
          name,
          remedy: SHIPPED_DEFAULT_REMEDIES[name] ?? name,
        })),
      },
      200,
      { 'Cache-Control': 'no-store' },
    )
  })

  return app
}
