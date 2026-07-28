import {
  AI_PROVIDERS,
  type AiProvider,
  type AuthContext,
  areaRuleSchema,
  newId,
} from '@yapm/schema'
import {
  ConnectorAuthorizationError,
  type DB,
  deleteConnectorSecret,
  getAiConfig,
  getConnectorConfig,
  getRedactedAiStatus,
  type SecretCodec,
  setAiProviderKey,
  upsertAiConfig,
} from '@yapm/schema/db'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Kysely } from 'kysely'
import * as z from 'zod'
import type { AuthService } from '../auth.js'
import type { AiEnv } from '../config/env.js'
import type { Logger } from '../logger.js'

export const AI_API_BASE = '/api/v1/ai'

export interface AiAdminRoutesOptions {
  auth: AuthService
  db: Kysely<DB>
  logger: Logger
  // Present only when SECRETS_ENCRYPTION_KEY is set — required to store UI-entered keys at rest.
  codec: SecretCodec | null
  // The instance-default env keys/provider (a fallback when a workspace stores no UI key).
  env: AiEnv
}

interface AdminSession {
  ctx: AuthContext
  workspaceId: string
}

declare module 'hono' {
  interface ContextVariableMap {
    aiAdmin: AdminSession
  }
}

const providerSchema = z.enum(AI_PROVIDERS)

const configBody = z.object({
  enabled: z.boolean().optional(),
  defaultProvider: providerSchema.nullable().optional(),
  models: z.partialRecord(providerSchema, z.string().min(1)).optional(),
  spendCapUsd: z.number().positive().nullable().optional(),
  // The ordered path→area map, replaced wholesale when present. Order is semantic (first match
  // wins), so a merge would silently change which rule applies.
  areas: z.array(areaRuleSchema).optional(),
})

const keyBody = z.object({ value: z.string().min(1) })

// The admin AI settings UI reads and mutates the server-only surface here — the AI config and
// keys reuse the connector encrypted-secrets surface, so they never sync through Zero. Every route
// is admin-gated: a non-admin is rejected before any surface is read, and no key material is ever
// returned (only the NAMES of configured providers). Mirrors the connectors admin surface.
export function createAiAdminRoutes(options: AiAdminRoutesOptions): Hono {
  const { auth, db, logger, codec, env } = options
  const app = new Hono()

  const requireAdmin = createMiddleware(async (c, next) => {
    const user = await auth.getSessionUser(c.req.raw.headers)
    if (user === undefined) return c.json({ error: 'unauthorized' }, 401)
    const member = await db
      .selectFrom('workspace_member')
      .select(['workspace_id', 'role'])
      .where('user_id', '=', user.id)
      .executeTakeFirst()
    if (member?.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
    c.set('aiAdmin', {
      ctx: { userID: user.id, role: member.role },
      workspaceId: member.workspace_id,
    })
    await next()
  })

  const envProviders = (Object.keys(env.keys) as AiProvider[]).filter((p) => env.keys[p])
  // Storing a UI key needs the codec (SECRETS_ENCRYPTION_KEY). Absent, only env-default keys work.
  const missingEnv = codec ? [] : ['SECRETS_ENCRYPTION_KEY']

  const statusPayload = async (ctx: AuthContext, workspaceId: string) => ({
    // AI can operate if either an env instance-default key exists or UI keys can be stored.
    configured: envProviders.length > 0 || codec !== null,
    canStoreKeys: codec !== null,
    missingEnv,
    envProviders,
    envDefaultProvider: env.defaultProvider,
    status: await getRedactedAiStatus(db, ctx, workspaceId),
  })

  const ai = new Hono()

  ai.get('/', requireAdmin, async (c) => {
    const { ctx, workspaceId } = c.get('aiAdmin')
    return c.json(await statusPayload(ctx, workspaceId))
  })

  // Toggle + settings. Merges the provided fields into the existing config blob so setting a model
  // never clears the toggle and vice versa.
  ai.post('/', requireAdmin, async (c) => {
    const { ctx, workspaceId } = c.get('aiAdmin')
    const parsed = configBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
    const body = parsed.data

    const existing = await getAiConfig(db, workspaceId)
    const current = existing?.data ?? { models: {}, areas: [] }
    const nextConfig = {
      models: { ...current.models, ...(body.models ?? {}) },
      // Omitted ⇒ the stored map is left untouched, so changing the spend cap never clobbers it.
      areas: body.areas ?? current.areas,
      ...(body.defaultProvider === undefined
        ? current.defaultProvider === undefined
          ? {}
          : { defaultProvider: current.defaultProvider }
        : body.defaultProvider === null
          ? {}
          : { defaultProvider: body.defaultProvider }),
      ...(body.spendCapUsd === undefined
        ? current.spendCapUsd === undefined
          ? {}
          : { spendCapUsd: current.spendCapUsd }
        : body.spendCapUsd === null
          ? {}
          : { spendCapUsd: body.spendCapUsd }),
    }

    await upsertAiConfig(db, ctx, {
      id: newId(),
      workspaceId,
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      config: nextConfig,
    })
    logger.info({ enabled: body.enabled }, 'ai config updated')
    return c.json(await statusPayload(ctx, workspaceId))
  })

  // Write-only masked key entry: accepts a plaintext key, stores it encrypted, never returns it.
  ai.put('/keys/:provider', requireAdmin, async (c) => {
    const { ctx, workspaceId } = c.get('aiAdmin')
    const provider = providerSchema.safeParse(c.req.param('provider'))
    if (!provider.success) return c.json({ error: 'invalid_provider' }, 400)
    if (!codec) return c.json({ error: 'encryption_unavailable' }, 400)
    const parsed = keyBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)

    await setAiProviderKey(db, ctx, codec, {
      configId: newId(),
      secretId: newId(),
      workspaceId,
      provider: provider.data,
      value: parsed.data.value,
    })
    logger.info({ provider: provider.data }, 'ai provider key set')
    return c.json(await statusPayload(ctx, workspaceId))
  })

  ai.delete('/keys/:provider', requireAdmin, async (c) => {
    const { ctx, workspaceId } = c.get('aiAdmin')
    const provider = providerSchema.safeParse(c.req.param('provider'))
    if (!provider.success) return c.json({ error: 'invalid_provider' }, 400)
    const config = await getConnectorConfig(db, workspaceId, 'ai')
    if (config) await deleteConnectorSecret(db, ctx, config.id, provider.data)
    return c.json(await statusPayload(ctx, workspaceId))
  })

  app.route(AI_API_BASE, ai)

  app.onError((error, c) => {
    if (error instanceof ConnectorAuthorizationError) {
      return c.json({ error: 'forbidden' }, 403)
    }
    logger.error({ err: error, path: c.req.path }, 'ai admin route error')
    return c.json({ error: 'internal_server_error' }, 500)
  })

  return app
}
