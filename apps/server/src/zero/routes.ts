import { mustGetMutator, mustGetQuery } from '@rocicorp/zero'
import { handleMutateRequest, handleQueryRequest } from '@rocicorp/zero/server'
import { queries, schema } from '@yapm/schema'
import { createServerMutators } from '@yapm/schema/server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Logger } from '../logger.js'
import type { ResolveAuthContext } from './context.js'
import type { ZeroDatabase } from './db-provider.js'

export interface ZeroRoutesOptions {
  dbProvider: ZeroDatabase
  resolveContext: ResolveAuthContext
  logger: Logger
  queryApiKey?: string | undefined
  mutateApiKey?: string | undefined
}

function requireApiKey(request: Request, expected: string | undefined): void {
  if (expected === undefined) return
  if (request.headers.get('x-api-key') !== expected) {
    throw new HTTPException(403, { message: 'invalid X-Api-Key' })
  }
}

export function createZeroRoutes(options: ZeroRoutesOptions): Hono {
  const app = new Hono()

  // The authoritative pass runs the server mutators (base shared mutators plus the
  // server-only `issue.create` override that assigns the per-team number).
  const serverMutators = createServerMutators()

  app.post('/query', async (c) => {
    requireApiKey(c.req.raw, options.queryApiKey)
    const ctx = await options.resolveContext(c.req.raw)

    const response = await handleQueryRequest({
      handler: (name, args) => mustGetQuery(queries, name).fn({ args, ctx }),
      schema,
      request: c.req.raw,
      userID: ctx?.userID ?? null,
    })

    return c.json(response)
  })

  app.post('/mutate', async (c) => {
    requireApiKey(c.req.raw, options.mutateApiKey)
    const ctx = await options.resolveContext(c.req.raw)

    const response = await handleMutateRequest({
      dbProvider: options.dbProvider,
      handler: (transact) =>
        transact((tx, name, args) => mustGetMutator(serverMutators, name).fn({ tx, args, ctx })),
      request: c.req.raw,
      userID: ctx?.userID ?? null,
    })

    return c.json(response)
  })

  return app
}
