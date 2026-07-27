import { newId, richTextToPlainText } from '@yapm/schema'
import type { DB, SearchDocumentRow } from '@yapm/schema/db'
import {
  createDatabase,
  type Database,
  migrateToLatest,
  reconcileDiffBatch,
  upsertSearchDocuments,
} from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthService, SessionUser } from '../auth.js'
import { createSearchRoutes } from './routes.js'

const DATABASE_URL = process.env.DATABASE_URL
if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the search route oracle test must not skip')
}

const silent = pino({ level: 'silent' })

const doc = (text: string): string =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })

function fakeAuth(): AuthService {
  return {
    handler: () => Promise.resolve(new Response(null)),
    getSessionUser: (headers: Headers): Promise<SessionUser | undefined> => {
      const id = headers.get('x-test-user')
      return Promise.resolve(id ? { id, email: `${id}@example.test` } : undefined)
    },
    migrateAuth: () => Promise.resolve({ created: [], altered: [] }),
    issueSyncToken: () => Promise.resolve({ token: 'token', expiresAt: null }),
    verifySyncToken: () => Promise.resolve(undefined),
  }
}

// Postgres' real `query_canceled`, raised through the same path a `statement_timeout` would take.
// The route must not be able to tell this apart from a miss in anything it emits.
function timingOutDb(db: Kysely<DB>): Kysely<DB> {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'transaction') {
        return () => ({
          execute: () => {
            const error = new Error('canceling statement due to statement timeout')
            Object.assign(error, { code: '57014' })
            return Promise.reject(error)
          },
        })
      }
      // Bound to the TARGET, never to the proxy: Kysely's builders read `#private` fields, which
      // throw when `this` is a Proxy.
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

describe.skipIf(DATABASE_URL === undefined)('GET /api/v1/search', () => {
  let database: Database
  const workspaceId = newId()
  const teamOneId = newId()
  const teamTwoId = newId()
  const memberId = newId()
  const strangerId = newId()
  let app: ReturnType<typeof createSearchRoutes>

  // `null` is the anonymous caller. Not `undefined`, which would silently take the default.
  const get = async (
    query: string,
    user: string | null = memberId,
    instance = app,
  ): Promise<{ status: number; body: string }> => {
    const response = await instance.request(
      `/api/v1/search?${query}`,
      user === null ? {} : { headers: { 'x-test-user': user } },
    )
    return { status: response.status, body: await response.text() }
  }

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    const db = database.db

    await db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'search-route-test' })
      .execute()
    await db
      .insertInto('team')
      .values([
        {
          id: teamOneId,
          workspace_id: workspaceId,
          name: 'One',
          key: `S${newId().slice(0, 4)}`,
        },
        {
          id: teamTwoId,
          workspace_id: workspaceId,
          name: 'Two',
          key: `T${newId().slice(0, 4)}`,
        },
      ])
      .execute()
    await db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: memberId, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: strangerId, role: 'member' },
      ])
      .execute()
    await db
      .insertInto('team_membership')
      .values({ id: newId(), team_id: teamOneId, user_id: memberId })
      .execute()
    await db
      .insertInto('issue')
      .values([
        {
          id: newId(),
          team_id: teamOneId,
          number: 1,
          title: 'In scope: qztroute-visible',
          status: 'todo',
          priority: 'medium',
          creator_id: memberId,
        },
        {
          id: newId(),
          team_id: teamTwoId,
          number: 1,
          title: 'Out of scope: qztroute-hidden',
          description: doc('Nobody outside team two may learn this row exists'),
          status: 'todo',
          priority: 'medium',
          creator_id: strangerId,
        },
      ])
      .execute()

    for (const entityType of ['issue', 'comment'] as const) {
      for (let pass = 0; pass < 20; pass += 1) {
        const rows = await reconcileDiffBatch(db, { entityType, limit: 200 })
        if (rows.length === 0) break
        const documents: SearchDocumentRow[] = rows.map((row) => ({
          entityType: row.entityType,
          entityId: row.entityId,
          teamId: row.teamId,
          issueId: row.issueId,
          commentId: row.commentId,
          title: row.title,
          body: richTextToPlainText(row.doc, { mentions: 'label' }),
          updatedAt: row.updatedAt,
        }))
        await upsertSearchDocuments(db, documents)
      }
    }

    app = createSearchRoutes({
      auth: fakeAuth(),
      db,
      logger: silent,
      textConfig: 'simple',
      statementTimeoutMs: 2000,
    })
  }, 120_000)

  afterAll(async () => {
    if (database === undefined) return
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.close()
  })

  it('rejects an anonymous caller identically whether the token would have matched', async () => {
    const wouldMatch = await get('q=qztroute-visible', null)
    const wouldMiss = await get('q=qztroute-absent', null)
    expect(wouldMatch.status).toBe(401)
    expect(wouldMatch).toEqual(wouldMiss)
  })

  it('answers an in-scope hit', async () => {
    const { status, body } = await get('q=qztroute-visible')
    expect(status).toBe(200)
    const payload = JSON.parse(body) as { results: { issueTitle: string }[]; truncated: boolean }
    expect(payload.results).toHaveLength(1)
    expect(payload.results[0]?.issueTitle).toBe('In scope: qztroute-visible')
    expect(payload.truncated).toBe(false)
  })

  // THE assertion. Every one of these is a way a caller could otherwise measure the existence of a
  // row they may not read — by a status code, by a key, by a byte.
  it('returns one identical response for every non-401 outcome', async () => {
    const timingOut = createSearchRoutes({
      auth: fakeAuth(),
      db: timingOutDb(database.db),
      logger: silent,
      textConfig: 'simple',
      statementTimeoutMs: 2000,
    })

    const outcomes = {
      miss: await get('q=qztroute-absent'),
      outOfScope: await get('q=qztroute-hidden'),
      teamIdOutsideScope: await get(`q=qztroute-hidden&teamId=${teamTwoId}`),
      nonMember: await get('q=qztroute-visible', newId()),
      strangerInNoTeam: await get('q=qztroute-visible', strangerId),
      blank: await get('q='),
      whitespace: await get('q=%20%20'),
      oneCharacter: await get('q=q'),
      unparseable: await get('q=%22%22%22%20OR%20-%20AND'),
      missingParameter: await get(''),
      timeout: await get('q=qztroute-visible', memberId, timingOut),
    }

    const distinct = new Set(Object.values(outcomes).map((outcome) => JSON.stringify(outcome)))
    expect([...distinct]).toEqual([
      JSON.stringify({ status: 200, body: '{"results":[],"truncated":false}' }),
    ])
  })

  it('narrows on a teamId inside the scope rather than widening on one outside it', async () => {
    const narrowed = await get(`q=qztroute-visible&teamId=${teamOneId}`)
    expect(JSON.parse(narrowed.body).results).toHaveLength(1)

    const widened = await get(`q=qztroute-hidden&teamId=${teamTwoId}`)
    expect(widened.body).toBe('{"results":[],"truncated":false}')
  })

  it('reports truncation over post-scoping rows only, and never a count', async () => {
    const { body } = await get('q=qztroute-visible&limit=1')
    const payload = JSON.parse(body) as Record<string, unknown>
    expect(payload.truncated).toBe(true)
    expect(Object.keys(payload).sort()).toEqual(['results', 'truncated'])
  })
})
