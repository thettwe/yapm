import { mustGetMutator, mustGetQuery } from '@rocicorp/zero'
import { handleMutateRequest, handleQueryRequest } from '@rocicorp/zero/server'
import { queries, schema } from '@yapm/schema'
import { createServerMutators } from '@yapm/schema/server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Logger } from '../logger.js'
import { type ResolveAuthContext, resolvedContext } from './context.js'
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

// A rejected credential must be answered with a status, never with a body. Zero reads a
// `QueryResponse` carrying `userID` as the authoritative identity of the socket, so
// `200 {userID: null}` tells zero-cache the connection belongs to nobody: it fails the
// connection's validation, drops it from the client group, and the group's next piece of
// shared background work dies with `InvalidConnectionRequest`, taking every client on the
// view-syncer with it. A 401 instead lands the one stale client in `needs-auth`, which the
// client recovers from by re-minting. See reference/zero.md §10.7.
const UNAUTHORIZED = { error: 'unauthorized' } as const

// Both Zero handlers build their own console-backed `LogContext` and default it to `info`,
// so without an explicit level they ignore `LOG_LEVEL` and a denied mutation prints a
// warning on a server configured quiet. `error` is the floor @rocicorp/logger offers —
// `silent` cannot be honoured exactly. Declared locally rather than imported so the server
// takes no direct dependency on Zero's logger package.
type ZeroLogLevel = 'error' | 'warn' | 'info' | 'debug'

function zeroLogLevel(logger: Logger): ZeroLogLevel {
  switch (logger.level) {
    case 'trace':
    case 'debug':
      return 'debug'
    case 'info':
      return 'info'
    case 'warn':
      return 'warn'
    default:
      return 'error'
  }
}

export function createZeroRoutes(options: ZeroRoutesOptions): Hono {
  const app = new Hono()
  const logLevel = zeroLogLevel(options.logger)

  // The authoritative pass runs the server mutators (base shared mutators plus the
  // server-only `issue.create` override that assigns the per-team number).
  const serverMutators = createServerMutators()

  app.post('/query', async (c) => {
    requireApiKey(c.req.raw, options.queryApiKey)
    const resolution = await options.resolveContext(c.req.raw)
    if (resolution.kind === 'rejected') return c.json(UNAUTHORIZED, 401)
    const ctx = resolvedContext(resolution)

    const response = await handleQueryRequest({
      handler: (name, args) => mustGetQuery(queries, name).fn({ args, ctx }),
      schema,
      request: c.req.raw,
      userID: ctx?.userID ?? null,
      logLevel,
    })

    return c.json(response)
  })

  app.post('/mutate', async (c) => {
    requireApiKey(c.req.raw, options.mutateApiKey)
    const resolution = await options.resolveContext(c.req.raw)
    if (resolution.kind === 'rejected') return c.json(UNAUTHORIZED, 401)
    const ctx = resolvedContext(resolution)

    const response = await handleMutateRequest({
      dbProvider: options.dbProvider,
      handler: (transact) =>
        transact((tx, name, args) => mustGetMutator(serverMutators, name).fn({ tx, args, ctx })),
      request: c.req.raw,
      userID: ctx?.userID ?? null,
      logLevel,
    })

    return c.json(response)
  })

  return app
}
