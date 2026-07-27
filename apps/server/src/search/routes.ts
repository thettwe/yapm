import { isServerSearchable, SERVER_RESULT_LIMIT } from '@yapm/schema'
import type { DB, SearchHit } from '@yapm/schema/db'
import { intersectScope, resolveSearchScope, searchDocuments } from '@yapm/schema/db'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { type Kysely, sql } from 'kysely'
import * as z from 'zod'
import type { AuthService } from '../auth.js'
import type { Logger } from '../logger.js'

export const SEARCH_API_BASE = '/api/v1/search'

export interface SearchRoutesOptions {
  auth: AuthService
  db: Kysely<DB>
  logger: Logger
  textConfig: string
  statementTimeoutMs: number
}

export interface SearchResult {
  readonly type: 'issue' | 'comment'
  readonly id: string
  readonly issueId: string
  readonly teamId: string
  readonly issueKey: string | null
  readonly issueTitle: string
  readonly status: string
  readonly needsTriage: boolean
  readonly snippet: string
  readonly updatedAt: string
}

export interface SearchResponse {
  readonly results: readonly SearchResult[]
  readonly truncated: boolean
}

// THE one shape every non-401 outcome collapses to. A miss, an out-of-scope hit, a blank query, a
// one-character query, an unparseable query and a statement timeout all serialise to exactly these
// bytes. A different status or a different key on any one of them would be an oracle: the caller
// would learn something about rows they may not read from the SHAPE of the refusal.
const EMPTY: SearchResponse = { results: [], truncated: false }

// `q` is deliberately unconstrained beyond being a string. A `min(2)` here would produce a 400 for
// a one-character query and a 200 for a two-character miss, which is a status difference the caller
// can measure; the minimum is applied as a 200-with-no-results below instead. `.catch()` on the two
// optional fields turns a malformed `limit` or `teamId` into a default rather than a 400, for the
// same reason.
const querySchema = z.object({
  q: z.string().catch(''),
  teamId: z.string().uuid().optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(SERVER_RESULT_LIMIT).optional().catch(undefined),
})

function serialise(hits: readonly SearchHit[], limit: number): SearchResponse {
  return {
    results: hits.map((hit) => ({
      type: hit.type,
      id: hit.id,
      issueId: hit.issueId,
      teamId: hit.teamId,
      issueKey: hit.issueKey,
      issueTitle: hit.issueTitle,
      // `needs_triage` and `canceled` rows are INCLUDED and carry their state, so the surface can
      // label them. Search means "what exists"; the lists are what curate.
      status: hit.status,
      needsTriage: hit.needsTriage,
      snippet: hit.snippet,
      updatedAt: hit.updatedAt.toISOString(),
    })),
    // Post-scoping rows only, and no count of what was withheld: `truncated` must never be able to
    // depend on a row the caller may not read.
    truncated: hits.length === limit,
  }
}

// Postgres' `query_canceled`, raised by `statement_timeout`.
const QUERY_CANCELED = '57014'

function isStatementTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === QUERY_CANCELED
  )
}

// The read-only search surface. It is a ROUTE rather than a synced query because ZQL has no
// full-text operator; CLAUDE.md #2 governs ZQL and mutators, and this is neither (design D1).
//
// NO QUERY STRING REACHES ANY LOGGER, here or anywhere downstream. "What did who search for" is
// exactly the per-person analytic this product refuses to collect, and Hono's `c.req.path` excludes
// the query string, so the request logger is silent about it too.
export function createSearchRoutes(options: SearchRoutesOptions): Hono {
  const { auth, db, logger, textConfig, statementTimeoutMs } = options
  const app = new Hono()

  const requireSession = createMiddleware(async (c, next) => {
    const user = await auth.getSessionUser(c.req.raw.headers)
    // Before ANY table is read, and the route's only non-200 outcome.
    if (user === undefined) return c.json({ error: 'unauthorized' }, 401)
    c.set('searchUserId', user.id)
    await next()
  })

  app.get(SEARCH_API_BASE, requireSession, async (c) => {
    const parsed = querySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams))
    const limit = parsed.limit ?? SERVER_RESULT_LIMIT

    // Blank, whitespace-only and sub-minimum queries answer before the index is touched. The rule
    // is a property of the QUERY, never of whether anything would have matched.
    if (!isServerSearchable(parsed.q)) return c.json(EMPTY)

    const userId = c.get('searchUserId')
    const scope = intersectScope(await resolveSearchScope(db, userId), parsed.teamId)

    try {
      const hits = await db.transaction().execute(async (trx) => {
        // `set local` so the ceiling dies with the transaction rather than leaking onto the next
        // caller to borrow this pooled connection.
        await sql`set local statement_timeout = ${sql.lit(statementTimeoutMs)}`.execute(trx)
        return searchDocuments(trx, { scope, query: parsed.q, limit, textConfig })
      })
      return c.json(serialise(hits, limit))
    } catch (error) {
      if (!isStatementTimeout(error)) throw error
      // Counted and logged server-side WITHOUT the query, and answered with the same status and the
      // same bytes as a miss. A 503 here would be a status oracle over corpus size, and a `partial`
      // flag would be the same oracle wearing a different hat. The accepted cost — a silent timeout
      // the caller cannot see — is named in design D9 rather than papered over.
      logger.warn({ statementTimeoutMs }, 'search statement timed out; answered as a miss')
      return c.json(EMPTY)
    }
  })

  return app
}

declare module 'hono' {
  interface ContextVariableMap {
    searchUserId: string
  }
}
