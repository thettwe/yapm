import type { AuthContext } from '@yapm/schema'
import type { Hono } from 'hono'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { ZeroDatabase } from './db-provider.js'

const silent = pino({ level: 'silent' })

const MEMBER: AuthContext = { userID: 'member-1', role: 'member' }

const unusedDbProvider = {
  transaction: () => {
    throw new Error('the query endpoint must not open a database transaction')
  },
} as unknown as ZeroDatabase

interface TransformedQuery {
  id: string
  name: string
  ast?: { table: string; where?: unknown; limit?: number }
  error?: string
  message?: string
}

interface QueryResponseBody {
  kind: string
  userID?: string | null
  queries: TransformedQuery[]
}

function appWith(options: {
  resolveContext: () => AuthContext | undefined
  queryApiKey?: string
}): Hono {
  return createApp({
    logger: silent,
    readinessChecks: [],
    zero: {
      dbProvider: unusedDbProvider,
      resolveContext: options.resolveContext,
      logger: silent,
      ...(options.queryApiKey === undefined ? {} : { queryApiKey: options.queryApiKey }),
    },
  })
}

async function postQuery(
  app: Hono,
  name: string,
  options: { args?: unknown[]; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string }> {
  const response = await app.request('/api/zero/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
    body: JSON.stringify(['transform', [{ id: 'q1', name, args: options.args ?? [] }]]),
  })
  return { status: response.status, text: await response.text() }
}

function firstQuery(text: string): TransformedQuery | undefined {
  return (JSON.parse(text) as QueryResponseBody).queries[0]
}

describe('the Zero query endpoint', () => {
  it('resolves a named query against the caller context', async () => {
    const app = appWith({ resolveContext: () => MEMBER })

    const { status, text } = await postQuery(app, 'workspace.current')
    const query = firstQuery(text)

    expect(status).toBe(200)
    expect(JSON.parse(text).userID).toBe(MEMBER.userID)
    expect(query?.name).toBe('workspace.current')
    expect(query?.ast?.table).toBe('workspace')
    expect(query?.ast?.where).toBeUndefined()
    expect(query?.ast?.limit).toBe(1)
  })

  it('returns a query that matches no rows when there is no auth context', async () => {
    const app = appWith({ resolveContext: () => undefined })

    const query = firstQuery((await postQuery(app, 'workspace.current')).text)

    expect(query?.ast?.table).toBe('workspace')
    expect(query?.ast?.where).toEqual({ type: 'or', conditions: [] })
  })

  it('ignores client-supplied arguments for a query that declares none', async () => {
    const app = appWith({ resolveContext: () => MEMBER })

    const plain = firstQuery((await postQuery(app, 'workspace.current')).text)
    const widened = firstQuery(
      (await postQuery(app, 'workspace.current', { args: [{ limit: 1000, id: 'other' }] })).text,
    )

    expect(widened?.ast).toEqual(plain?.ast)
  })

  it('rejects a query name that is not in the registry', async () => {
    const app = appWith({ resolveContext: () => MEMBER })

    const query = firstQuery((await postQuery(app, 'workspace.everything')).text)

    expect(query?.ast).toBeUndefined()
    expect(query?.error).toBe('app')
    expect(query?.message).toContain('workspace.everything')
  })

  it('rejects callers that do not present the configured API key', async () => {
    const app = appWith({ resolveContext: () => MEMBER, queryApiKey: 'secret' })

    const rejected = await postQuery(app, 'workspace.current')
    const wrong = await postQuery(app, 'workspace.current', { headers: { 'x-api-key': 'nope' } })
    const accepted = await postQuery(app, 'workspace.current', {
      headers: { 'x-api-key': 'secret' },
    })

    expect(rejected.status).toBe(403)
    expect(wrong.status).toBe(403)
    expect(accepted.status).toBe(200)
  })
})
