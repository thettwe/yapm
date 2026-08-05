import type { WorkspaceRole } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import { createConfigurationAdminRoutes } from './admin-routes.js'
import { CONFIGURATION_API_PATH, SHIPPED_DEFAULTS } from './shipped-defaults.js'

const EVERY_DEFAULT = {
  BETTER_AUTH_SECRET: SHIPPED_DEFAULTS.BETTER_AUTH_SECRET,
  DATABASE_URL: `postgres://yapm:${SHIPPED_DEFAULTS.DATABASE_URL}@postgres:5432/yapm`,
  ZERO_MUTATE_API_KEY: SHIPPED_DEFAULTS.ZERO_MUTATE_API_KEY,
  ZERO_QUERY_API_KEY: SHIPPED_DEFAULTS.ZERO_QUERY_API_KEY,
}

function routes(role: WorkspaceRole | null, signedIn = true) {
  const looked: string[] = []
  const app = createConfigurationAdminRoutes({
    getSessionUser: () => Promise.resolve(signedIn ? { id: 'user-1' } : undefined),
    lookupRole: (userId) => {
      looked.push(userId)
      return Promise.resolve(role)
    },
    env: EVERY_DEFAULT,
  })
  return { app, looked }
}

describe(`GET ${CONFIGURATION_API_PATH}`, () => {
  it('names every variable still at a shipped default, for an admin', async () => {
    const { app } = routes('admin')
    const response = await app.request(CONFIGURATION_API_PATH)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as { shippedDefaults: { name: string; remedy: string }[] }
    expect(body.shippedDefaults.map((entry) => entry.name)).toEqual([
      'BETTER_AUTH_SECRET',
      'DATABASE_URL',
      'ZERO_MUTATE_API_KEY',
      'ZERO_QUERY_API_KEY',
    ])
    // The remedy for the database password names the variable an operator actually edits.
    expect(body.shippedDefaults[1]?.remedy).toContain('POSTGRES_PASSWORD')
  })

  it('never prints a value, only names and remedies', async () => {
    const { app } = routes('admin')
    const body = await (await app.request(CONFIGURATION_API_PATH)).text()
    for (const value of Object.values(SHIPPED_DEFAULTS)) {
      // `yapm` — the shipped database password — is a substring of the remedy text, so it is
      // excused here exactly as it is in the logger check.
      if (value === SHIPPED_DEFAULTS.DATABASE_URL) continue
      expect(body).not.toContain(value)
    }
  })

  // The point of the split: a scanner that can reach `/readyz` through the public proxy learns a
  // count and nothing else, and neither a member nor a viewer can turn that into a list.
  it('tells a member, a viewer and an anonymous caller nothing', async () => {
    for (const role of ['member', 'viewer'] as const) {
      const { app } = routes(role)
      const response = await app.request(CONFIGURATION_API_PATH)
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('BETTER_AUTH_SECRET')
    }

    const { app: anonymous, looked } = routes(null, false)
    const response = await anonymous.request(CONFIGURATION_API_PATH)
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain('BETTER_AUTH_SECRET')
    // Auth before existence: no role lookup happens for a caller with no session.
    expect(looked).toEqual([])
  })

  it('refuses a signed-in user with no membership row at all', async () => {
    const { app } = routes(null)
    expect((await app.request(CONFIGURATION_API_PATH)).status).toBe(403)
  })
})
