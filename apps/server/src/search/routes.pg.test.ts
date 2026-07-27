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
import { createApp } from '../app.js'
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
  // The two actors task 6.3 adds to the member: the retro's own facilitator, who has every
  // in-product reason to see retro text, and the workspace admin, whose scope covers every team.
  // If any path could reach a retro row, one of these three is who it would reach it for.
  const facilitatorId = newId()
  const adminId = newId()
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
        { id: newId(), workspace_id: workspaceId, user_id: facilitatorId, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: adminId, role: 'admin' },
      ])
      .execute()
    await db
      .insertInto('team_membership')
      .values([
        { id: newId(), team_id: teamOneId, user_id: memberId },
        { id: newId(), team_id: teamOneId, user_id: facilitatorId },
      ])
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
        // Task 6.4's corpus: the SAME token on three in-scope rows and three out-of-scope ones, so
        // `truncated` can be caught depending on rows the caller may not read. A pre-scoping count
        // would report truncation at a limit the caller's own three rows never reach.
        ...[2, 3, 4].flatMap((number) => [
          {
            id: newId(),
            team_id: teamOneId,
            number,
            title: `In scope ${number}: qztroute-many`,
            status: 'todo' as const,
            priority: 'medium' as const,
            creator_id: memberId,
          },
          {
            id: newId(),
            team_id: teamTwoId,
            number,
            title: `Out of scope ${number}: qztroute-many`,
            status: 'todo' as const,
            priority: 'medium' as const,
            creator_id: strangerId,
          },
        ]),
      ])
      .execute()

    // The retrospective anonymity boundary, seeded inside the caller's OWN team so its absence is
    // a property of the indexable allowlist rather than of scoping. `retro_card_author` is written
    // too: the binding search must never make inferable exists here, not only in the schema-drift
    // test's absence assertion.
    const retroId = newId()
    const retroColumnId = newId()
    const retroCardId = newId()
    await db
      .insertInto('retro')
      .values({
        id: retroId,
        team_id: teamOneId,
        title: 'Retro under test',
        format: 'wentwell_didnt_action',
        facilitator_id: facilitatorId,
        created_by: facilitatorId,
      })
      .execute()
    await db
      .insertInto('retro_column')
      .values({
        id: retroColumnId,
        retro_id: retroId,
        team_id: teamOneId,
        key: 'went_well',
        title: 'Went well',
        accent_token: 'positive',
        rank: 'a0',
      })
      .execute()
    await db
      .insertInto('retro_draft')
      .values({
        id: newId(),
        retro_id: retroId,
        team_id: teamOneId,
        column_id: retroColumnId,
        author_id: memberId,
        body: 'Still being written: qztroute-draft',
        rank: 'a0',
      })
      .execute()
    await db
      .insertInto('retro_card')
      .values({
        id: retroCardId,
        retro_id: retroId,
        team_id: teamOneId,
        column_id: retroColumnId,
        body: 'Published anonymously: qztroute-card',
        rank: 'a0',
      })
      .execute()
    await db
      .insertInto('retro_card_author')
      .values({ card_id: retroCardId, retro_id: retroId, author_id: memberId })
      .execute()

    // `teamIds` for the reason decision I42 added it: the diff is global by design and every
    // Postgres suite in the repo runs against ONE database, so an unscoped upsert here re-indexes
    // rows this file does not own — which is what silently healed the backdated issue in
    // `apps/server/src/jobs/search.pg.test.ts`. It also protects this suite from itself: the diff
    // orders by UUIDv7 id ascending, so over a shared accumulating database an unscoped
    // `limit: 200` drops the NEWEST rows first, and these fixtures are the newest thing in it.
    for (const entityType of ['issue', 'comment'] as const) {
      for (let pass = 0; pass < 20; pass += 1) {
        const rows = await reconcileDiffBatch(db, {
          entityType,
          limit: 200,
          teamIds: [teamOneId, teamTwoId],
        })
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

  // Task 6.3. Not a scoping question — the draft and the card are in the caller's OWN team, and
  // the facilitator and the admin are the two actors with the strongest claim to see them. What
  // makes them invisible is that no retro row is indexable at all.
  describe('the retrospective boundary', () => {
    const actors = { member: memberId, facilitator: facilitatorId, admin: adminId }

    it('returns nothing for a retro draft or a retro card, to any actor', async () => {
      for (const [name, actor] of Object.entries(actors)) {
        for (const token of ['qztroute-draft', 'qztroute-card']) {
          const outcome = await get(`q=${token}`, actor)
          expect(outcome, `${name} searching ${token}`).toEqual({
            status: 200,
            body: '{"results":[],"truncated":false}',
          })
        }
      }
    })

    // Without this the test above would pass for an actor who can see nothing at all, which is
    // the vacuous version of the same assertion.
    it('answers those same actors for an indexable row, so the silence above is about retros', async () => {
      for (const [name, actor] of Object.entries(actors)) {
        const { status, body } = await get('q=qztroute-visible', actor)
        const results = (JSON.parse(body) as { results: unknown[] }).results
        expect({ name, status, count: results.length }).toEqual({ name, status: 200, count: 1 })
      }
    })
  })

  // Task 6.4. Six rows carry `qztroute-many`; three of them are in the caller's scope. Every
  // assertion below would change if `truncated` were computed anywhere but over the rows the
  // caller actually receives.
  describe('truncated', () => {
    const many = async (limit: number, user = memberId) => {
      const { body } = await get(`q=qztroute-many&limit=${limit}`, user)
      return JSON.parse(body) as { results: unknown[]; truncated: boolean }
    }

    it('is true exactly when the returned rows reach the limit', async () => {
      expect(await many(1)).toMatchObject({ truncated: true })
      expect(await many(2)).toMatchObject({ truncated: true })
      const atCapacity = await many(3)
      expect(atCapacity.results).toHaveLength(3)
      expect(atCapacity.truncated).toBe(true)
    })

    it('is false at a limit the caller’s own rows cannot fill, though six rows match', async () => {
      // The admin's scope proves the other three documents exist and match the same token, so a
      // `false` below is the scoping filter running BEFORE the count rather than a thin corpus.
      const admin = await many(10, adminId)
      expect(admin.results).toHaveLength(6)

      const scoped = await many(4)
      expect(scoped.results).toHaveLength(3)
      expect(scoped.truncated).toBe(false)
      expect(await many(6)).toMatchObject({ truncated: false })
    })
  })

  // Task 6.7. The refusal to record queries is one middleware away from being false, and nothing
  // else in the repo would notice. So it is asserted through the WHOLE app — the request logger
  // included — rather than by reading `routes.ts`.
  describe('query strings never reach a logger', () => {
    const lines: string[] = []
    const capturing = pino({ level: 'trace' }, { write: (chunk: string) => void lines.push(chunk) })

    const drive = async (token: string, db: Kysely<DB>, user: string | null = memberId) => {
      const whole = createApp({
        logger: capturing,
        readinessChecks: [],
        search: createSearchRoutes({
          auth: fakeAuth(),
          db,
          logger: capturing,
          textConfig: 'simple',
          statementTimeoutMs: 2000,
        }),
      })
      return await whole.request(
        `/api/v1/search?q=${encodeURIComponent(token)}`,
        user === null ? {} : { headers: { 'x-test-user': user } },
      )
    }

    it('emits not one line carrying the query, on a hit, a miss, a timeout or a 401', async () => {
      lines.length = 0
      const hit = await drive('qztroute-visible', database.db)
      const miss = await drive('qztroute-nowhere-at-all', database.db)
      const timedOut = await drive('qztroute-visible', timingOutDb(database.db))
      const anonymous = await drive('qztroute-visible', database.db, null)

      expect([hit.status, miss.status, timedOut.status, anonymous.status]).toEqual([
        200, 200, 200, 401,
      ])
      // The app DID log — otherwise the absence below proves nothing.
      expect(lines.length).toBeGreaterThanOrEqual(4)
      expect(lines.join('\n')).toContain('"path":"/api/v1/search"')
      expect(lines.join('\n')).toContain('search statement timed out')

      for (const needle of [
        'qztroute-visible',
        'qztroute-nowhere-at-all',
        encodeURIComponent('qztroute-visible'),
        '?q=',
      ]) {
        expect(lines.filter((line) => line.includes(needle))).toEqual([])
      }
    })
  })
})
