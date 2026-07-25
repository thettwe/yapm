import { type AuthContext, newId } from '@yapm/schema'
import {
  ConnectorAuthorizationError,
  type DB,
  getConnectorConfig,
  getConnectorInstallation,
  getRedactedConnectorStatus,
  removeInstallationRepoTeam,
  setInstallationRepoTeam,
  upsertConnectorConfig,
} from '@yapm/schema/db'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Kysely } from 'kysely'
import * as z from 'zod'
import type { AuthService } from '../auth.js'
import type { Logger } from '../logger.js'

export const CONNECTORS_API_BASE = '/api/v1/connectors'

const GITHUB_PROVIDER = 'github'

export interface ConnectorAdminRoutesOptions {
  auth: AuthService
  db: Kysely<DB>
  logger: Logger
  // Whether the GitHub App env triplet + encryption key are present in this process. A UI
  // "not configured" state names the missing variables; the connector cannot be enabled
  // for real ingestion without them.
  githubConfigured: boolean
  githubMissingEnv: string[]
}

interface AdminSession {
  ctx: AuthContext
  workspaceId: string
}

declare module 'hono' {
  interface ContextVariableMap {
    connectorAdmin: AdminSession
  }
}

const enableBody = z.object({ enabled: z.boolean() })
const repoMapBody = z.object({ repo: z.string().min(1), teamId: z.string().min(1) })

// The admin settings UI reads and mutates the server-only connector surface here — secrets and
// config never sync through Zero, so they cannot ride the client cache. Every route is
// admin-gated: a non-admin (member/viewer/anonymous) is rejected before any surface is read, so
// no redacted status or mapping ever reaches a non-admin.
export function createConnectorAdminRoutes(options: ConnectorAdminRoutesOptions): Hono {
  const { auth, db, logger } = options
  const app = new Hono()

  const requireAdmin = createMiddleware(async (c, next) => {
    const user = await auth.getSessionUser(c.req.raw.headers)
    if (user === undefined) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    // Resolve the caller's workspace from their own membership row (not "the oldest
    // workspace"): the connector config is keyed per workspace, and this scopes reads/writes
    // to the admin's workspace. Self-host has exactly one, so this is that one.
    const member = await db
      .selectFrom('workspace_member')
      .select(['workspace_id', 'role'])
      .where('user_id', '=', user.id)
      .executeTakeFirst()
    if (member?.role !== 'admin') {
      return c.json({ error: 'forbidden' }, 403)
    }
    c.set('connectorAdmin', {
      ctx: { userID: user.id, role: member.role },
      workspaceId: member.workspace_id,
    })
    await next()
  })

  const github = new Hono()

  github.get('/', requireAdmin, async (c) => {
    const { ctx, workspaceId } = c.get('connectorAdmin')
    const status = await getRedactedConnectorStatus(db, ctx, workspaceId, GITHUB_PROVIDER)
    return c.json({
      provider: GITHUB_PROVIDER,
      configured: options.githubConfigured,
      missingEnv: options.githubMissingEnv,
      status,
    })
  })

  github.post('/', requireAdmin, async (c) => {
    const { ctx, workspaceId } = c.get('connectorAdmin')
    const parsed = enableBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_body' }, 400)
    }
    await upsertConnectorConfig(db, ctx, {
      id: newId(),
      workspaceId,
      provider: GITHUB_PROVIDER,
      enabled: parsed.data.enabled,
    })
    logger.info({ enabled: parsed.data.enabled }, 'github connector config updated')
    const status = await getRedactedConnectorStatus(db, ctx, workspaceId, GITHUB_PROVIDER)
    return c.json({
      provider: GITHUB_PROVIDER,
      configured: options.githubConfigured,
      missingEnv: options.githubMissingEnv,
      status,
    })
  })

  // Resolve an installation only within the caller's own workspace config: a multi-workspace
  // (cloud) admin must never reach another workspace's installation by its global external id.
  const resolveWorkspaceInstallation = async (
    workspaceId: string,
    externalId: string,
  ): Promise<{ id: string } | null> => {
    const config = await getConnectorConfig(db, workspaceId, GITHUB_PROVIDER)
    if (!config) return null
    return getConnectorInstallation(db, config.id, externalId)
  }

  // A repo may only map to a team inside the caller's own workspace.
  const teamInWorkspace = async (teamId: string, workspaceId: string): Promise<boolean> => {
    const team = await db
      .selectFrom('team')
      .select('id')
      .where('id', '=', teamId)
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst()
    return team !== undefined
  }

  github.put('/installations/:externalId/repos', requireAdmin, async (c) => {
    const { ctx, workspaceId } = c.get('connectorAdmin')
    const externalId = c.req.param('externalId')
    const parsed = repoMapBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_body' }, 400)
    }
    const installation = await resolveWorkspaceInstallation(workspaceId, externalId)
    if (!installation) {
      return c.json({ error: 'installation_not_found' }, 404)
    }
    if (!(await teamInWorkspace(parsed.data.teamId, workspaceId))) {
      return c.json({ error: 'team_not_found' }, 404)
    }
    await setInstallationRepoTeam(db, ctx, {
      installationId: installation.id,
      repoFullName: parsed.data.repo,
      teamId: parsed.data.teamId,
    })
    return c.json({ ok: true })
  })

  github.delete('/installations/:externalId/repos', requireAdmin, async (c) => {
    const { ctx, workspaceId } = c.get('connectorAdmin')
    const externalId = c.req.param('externalId')
    const repo = c.req.query('repo')
    if (!repo) {
      return c.json({ error: 'missing_repo' }, 400)
    }
    const installation = await resolveWorkspaceInstallation(workspaceId, externalId)
    if (!installation) {
      return c.json({ error: 'installation_not_found' }, 404)
    }
    await removeInstallationRepoTeam(db, ctx, installation.id, repo)
    return c.json({ ok: true })
  })

  app.route(`${CONNECTORS_API_BASE}/github`, github)

  // Belt-and-braces: an accessor's own admin assertion should never be reached (the middleware
  // gates first), but if it throws it maps to 403 rather than a 500.
  app.onError((error, c) => {
    if (error instanceof ConnectorAuthorizationError) {
      return c.json({ error: 'forbidden' }, 403)
    }
    logger.error({ err: error, path: c.req.path }, 'connector admin route error')
    return c.json({ error: 'internal_server_error' }, 500)
  })

  return app
}
