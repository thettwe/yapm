import type { AuthContext } from '@yapm/schema'
import type { Hono } from 'hono'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { type AuthResolution, CREDENTIAL_ABSENT, CREDENTIAL_REJECTED } from './context.js'
import type { ZeroDatabase } from './db-provider.js'

const silent = pino({ level: 'silent' })

const MEMBER: AuthContext = { userID: 'member-1', role: 'member' }
const AUTHENTICATED: AuthResolution = { kind: 'authenticated', ctx: MEMBER }

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

function appWith(options: { resolveContext: () => AuthResolution; queryApiKey?: string }): Hono {
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
    const app = appWith({ resolveContext: () => AUTHENTICATED })

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
    const app = appWith({ resolveContext: () => CREDENTIAL_ABSENT })

    const query = firstQuery((await postQuery(app, 'workspace.current')).text)

    expect(query?.ast?.table).toBe('workspace')
    expect(query?.ast?.where).toEqual({ type: 'or', conditions: [] })
  })

  it('ignores client-supplied arguments for a query that declares none', async () => {
    const app = appWith({ resolveContext: () => AUTHENTICATED })

    const plain = firstQuery((await postQuery(app, 'workspace.current')).text)
    const widened = firstQuery(
      (await postQuery(app, 'workspace.current', { args: [{ limit: 1000, id: 'other' }] })).text,
    )

    expect(widened?.ast).toEqual(plain?.ast)
  })

  it('rejects a query name that is not in the registry', async () => {
    const app = appWith({ resolveContext: () => AUTHENTICATED })

    const query = firstQuery((await postQuery(app, 'workspace.everything')).text)

    expect(query?.ast).toBeUndefined()
    expect(query?.error).toBe('app')
    expect(query?.message).toContain('workspace.everything')
  })

  it('answers a rejected credential with 401 rather than a null-user QueryResponse', async () => {
    const app = appWith({ resolveContext: () => CREDENTIAL_REJECTED })

    const { status, text } = await postQuery(app, 'workspace.current')

    expect(status).toBe(401)
    expect(JSON.parse(text)).toEqual({ error: 'unauthorized' })
  })

  it('checks the API key before the credential, so a rejected token cannot probe it', async () => {
    const app = appWith({ resolveContext: () => CREDENTIAL_REJECTED, queryApiKey: 'secret' })

    expect((await postQuery(app, 'workspace.current')).status).toBe(403)
  })

  it('rejects callers that do not present the configured API key', async () => {
    const app = appWith({ resolveContext: () => AUTHENTICATED, queryApiKey: 'secret' })

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

describe('the Zero mutate endpoint', () => {
  it('answers a rejected credential with 401 before opening a transaction', async () => {
    const app = appWith({ resolveContext: () => CREDENTIAL_REJECTED })

    const response = await app.request('/api/zero/mutate?schema=zero_0&appID=zero', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientGroupID: 'cg1',
        mutations: [
          {
            type: 'custom',
            id: 1,
            clientID: 'c1',
            name: 'workspace.rename',
            args: [],
            timestamp: 0,
          },
        ],
        pushVersion: 1,
        timestamp: 0,
        requestID: 'r1',
      }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })
})
