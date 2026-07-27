import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import { richTextToPlainText } from '../rich-text/plaintext.js'
import { SNIPPET_START_DELIMITER, SNIPPET_STOP_DELIMITER } from '../search/snippet.js'
import { createDatabase, type Database } from './client.js'
import { migrateToLatest } from './migrate.js'
import {
  DEFAULT_TEXT_SEARCH_CONFIG,
  ensureSearchIndex,
  intersectScope,
  reconcileDiffBatch,
  resolveSearchScope,
  SEARCH_FTS_INDEX_NAME,
  type SearchDocumentRow,
  type SearchHit,
  type SearchScope,
  SearchTextConfigError,
  searchDocuments,
  upsertSearchDocuments,
} from './search.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the search permission-oracle test must not be skipped',
  )
}

const doc = (text: string): string =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })

// The indexer, composed here from the SAME exported helpers `apps/server/src/jobs/search.ts`
// composes. It is deliberately not an import of that job: `packages/schema` never imports an app
// (CLAUDE.md #3), and the job itself — its batching, its watermark tail, its FK-violation tolerance
// — is covered by `apps/server/src/jobs/search.pg.test.ts`. What this file needs from an indexer is
// only that the table holds current documents when the searches run.
//
// Neither seeded document carries a mention, so no id -> name map is loaded; the job's `'label'`
// resolution is asserted where the job lives.
//
// `teamIds` is not decoration. The diff is global by design and every Postgres suite in the repo
// runs against ONE database, so an unscoped upsert here re-indexes rows this file does not own —
// which silently heals `apps/server/src/jobs/search.pg.test.ts`'s deliberately backdated issue and
// fails it. It also protects this file: the diff orders by id, ids are UUIDv7, and this fixture is
// the newest thing in the database, so an unscoped batch would be the first to drop it.
async function indexToConvergence(database: Database, teamIds: readonly string[]): Promise<void> {
  for (const entityType of ['issue', 'comment'] as const) {
    for (let pass = 0; pass < 50; pass += 1) {
      const rows = await reconcileDiffBatch(database.db, { entityType, limit: 200, teamIds })
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
      await upsertSearchDocuments(database.db, documents)
    }
  }
}

// The response the route serialises, reduced to the bytes a caller can observe. Everything the
// oracle assertions compare goes through here: two searches are indistinguishable exactly when
// these strings are equal.
function wire(hits: readonly SearchHit[]): string {
  return JSON.stringify({ results: hits, truncated: false })
}

describe.skipIf(DATABASE_URL === undefined)('search over live Postgres', () => {
  let database: Database
  const workspaceId = newId()
  const teamOneId = newId()
  const teamTwoId = newId()
  const memberId = newId()
  const adminId = newId()
  const outsiderId = newId()
  const teamOneKey = `Q${newId().slice(0, 4)}`
  const teamTwoKey = `R${newId().slice(0, 4)}`
  const alphaIssueId = newId()
  const alphaCommentId = newId()
  const bravoIssueId = newId()
  const foxtrotIssueId = newId()
  const triageIssueId = newId()
  const canceledIssueId = newId()
  const hotelInScopeId = newId()
  const hotelOutOfScopeIds = [newId(), newId(), newId()]

  let memberScope: SearchScope
  let adminScope: SearchScope
  let outsiderScope: SearchScope

  const search = (scope: SearchScope, query: string, limit = 20): Promise<SearchHit[]> =>
    searchDocuments(database.db, {
      scope,
      query,
      limit,
      textConfig: DEFAULT_TEXT_SEARCH_CONFIG,
    })

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    const db = database.db

    await db.insertInto('workspace').values({ id: workspaceId, name: 'search-test' }).execute()
    await db
      .insertInto('team')
      .values([
        { id: teamOneId, workspace_id: workspaceId, name: 'Team One', key: teamOneKey },
        { id: teamTwoId, workspace_id: workspaceId, name: 'Team Two', key: teamTwoKey },
      ])
      .execute()
    await db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: memberId, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: adminId, role: 'admin' },
      ])
      .execute()
    // The member belongs to T1 only. The admin belongs to no team at all — their reach must come
    // from the workspace-admin bypass, not from a membership row.
    await db
      .insertInto('team_membership')
      .values({ id: newId(), team_id: teamOneId, user_id: memberId })
      .execute()

    await db
      .insertInto('issue')
      .values([
        {
          id: alphaIssueId,
          team_id: teamOneId,
          number: 1,
          title: 'Nothing distinctive in this title',
          status: 'todo',
          priority: 'medium',
          creator_id: memberId,
        },
        {
          id: bravoIssueId,
          team_id: teamTwoId,
          number: 1,
          title: 'Nothing distinctive here either',
          description: doc('A description mentioning qzt-bravo in team two'),
          status: 'todo',
          priority: 'medium',
          creator_id: adminId,
        },
        {
          id: foxtrotIssueId,
          team_id: teamOneId,
          number: 2,
          title: 'Title carrying qzt-foxtrot exactly once',
          status: 'in_progress',
          priority: 'high',
          creator_id: memberId,
        },
        {
          id: triageIssueId,
          team_id: teamOneId,
          number: 3,
          title: 'Reported from outside: qzt-golf',
          status: 'todo',
          priority: 'low',
          creator_id: memberId,
          needs_triage: true,
        },
        {
          id: canceledIssueId,
          team_id: teamOneId,
          number: 4,
          title: 'Abandoned work on qzt-golf',
          status: 'canceled',
          priority: 'low',
          creator_id: memberId,
        },
      ])
      .execute()

    // The crowd-out corpus for `qzt-hotel`: three matches in T2, all NEWER than the single match in
    // T1, so the recency tiebreak puts every out-of-scope row above the in-scope one. Searched at a
    // limit of three, this is what tells a scoping filter applied INSIDE the indexed scan from one
    // applied after the ranking and the limit — the latter spends all three slots on rows the caller
    // may not read and returns nothing, which is a count of out-of-scope rows leaking as the absence
    // of the caller's own.
    await db
      .insertInto('issue')
      .values([
        {
          id: hotelInScopeId,
          team_id: teamOneId,
          number: 5,
          title: 'The one qzt-hotel the caller may read',
          status: 'todo',
          priority: 'low',
          creator_id: memberId,
        },
        ...hotelOutOfScopeIds.map((id, offset) => ({
          id,
          team_id: teamTwoId,
          number: offset + 2,
          title: `A qzt-hotel the caller may not read (${offset})`,
          status: 'todo' as const,
          priority: 'low' as const,
          creator_id: adminId,
        })),
      ])
      .execute()

    // Written as raw SQL for the reason `apps/server/src/jobs/search.pg.test.ts` gives: `updated_at`
    // is `Generated<Timestamp>`, and Kysely's `Generated<S>` wraps rather than unwraps, so a `Date`
    // is not assignable through the insert builder.
    await sql`
      update issue set updated_at = ${new Date('2020-01-01T00:00:00.000Z')}
      where id = ${hotelInScopeId}
    `.execute(db)
    for (const [offset, id] of hotelOutOfScopeIds.entries()) {
      await sql`
        update issue set updated_at = ${new Date(`2030-01-0${offset + 1}T00:00:00.000Z`)}
        where id = ${id}
      `.execute(db)
    }

    await db
      .insertInto('comment')
      .values([
        {
          id: alphaCommentId,
          issue_id: alphaIssueId,
          team_id: teamOneId,
          author_id: memberId,
          body: doc('A comment body carrying qzt-alpha for the scoped hit'),
        },
        {
          id: newId(),
          issue_id: foxtrotIssueId,
          team_id: teamOneId,
          author_id: memberId,
          body: doc('A comment on the foxtrot issue that names no token'),
        },
        {
          id: newId(),
          issue_id: foxtrotIssueId,
          team_id: teamOneId,
          author_id: memberId,
          body: doc('A second comment on the foxtrot issue, also tokenless'),
        },
      ])
      .execute()

    // The retrospective anonymity boundary, seeded so its absence from every result is asserted
    // rather than assumed. No search path may reach these two rows.
    const retroId = newId()
    const columnId = newId()
    await db
      .insertInto('retro')
      .values({
        id: retroId,
        team_id: teamOneId,
        title: 'Retro under test',
        format: 'wentwell_didnt_action',
        created_by: memberId,
      })
      .execute()
    await db
      .insertInto('retro_column')
      .values({
        id: columnId,
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
        column_id: columnId,
        author_id: memberId,
        body: 'A private draft saying qzt-charlie',
        rank: 'a0',
      })
      .execute()
    await db
      .insertInto('retro_card')
      .values({
        id: newId(),
        retro_id: retroId,
        team_id: teamOneId,
        column_id: columnId,
        body: 'A published card saying qzt-delta',
        rank: 'a0',
      })
      .execute()

    await indexToConvergence(database, [teamOneId, teamTwoId])

    memberScope = await resolveSearchScope(db, memberId)
    adminScope = await resolveSearchScope(db, adminId)
    outsiderScope = await resolveSearchScope(db, outsiderId)
  }, 120_000)

  afterAll(async () => {
    if (database === undefined) return
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.close()
  })

  describe('a member of one team cannot tell an out-of-scope hit from a miss', () => {
    it('returns the in-scope comment with a snippet', async () => {
      const hits = await search(memberScope, 'qzt-alpha')
      expect(hits).toHaveLength(1)
      const hit = hits[0]
      expect(hit?.type).toBe('comment')
      expect(hit?.id).toBe(alphaCommentId)
      expect(hit?.issueId).toBe(alphaIssueId)
      expect(hit?.teamId).toBe(teamOneId)
      expect(hit?.issueKey).toBe(`${teamOneKey}-1`)
      // The delimiters land INSIDE the hyphenated token — `simple` indexes `qzt-alpha` as three
      // lexemes — so the excerpt is compared with them removed.
      const plain = (hit?.snippet ?? '')
        .split(SNIPPET_START_DELIMITER)
        .join('')
        .split(SNIPPET_STOP_DELIMITER)
        .join('')
      expect(plain).toContain('qzt-alpha')
      expect(hit?.snippet).toContain(SNIPPET_START_DELIMITER)
      expect(hit?.snippet).toContain(SNIPPET_STOP_DELIMITER)
      // `ts_headline` returns MARKUP by default; two control characters replace it, so nothing
      // downstream is ever handed HTML to interpolate.
      expect(hit?.snippet).not.toContain('<b>')
    })

    it('answers an out-of-scope token with the same bytes as a token that exists nowhere', async () => {
      const outOfScope = await search(memberScope, 'qzt-bravo')
      const nowhere = await search(memberScope, 'qzt-echo')
      expect(wire(outOfScope)).toBe(wire(nowhere))
      expect(wire(outOfScope)).toBe(wire([]))
    })

    // The scoping filter must live INSIDE the indexed scan, above the limit. Moving it outside —
    // ranking and limiting the whole corpus, then discarding what the caller may not read — passes
    // every other assertion in this file while turning the result count into a measure of how many
    // out-of-scope rows matched.
    it('does not let higher-ranked out-of-scope rows crowd out an in-scope one', async () => {
      const hits = await search(memberScope, 'qzt-hotel', hotelOutOfScopeIds.length)
      expect(hits.map((hit) => hit.issueId)).toEqual([hotelInScopeId])
    })

    // The same property stated as an indistinguishability: the caller's own results must be byte-
    // identical whether or not the out-of-scope rows exist at all.
    it('returns the in-scope row identically at every limit the out-of-scope rows could fill', async () => {
      const atFullLimit = wire(await search(memberScope, 'qzt-hotel', 20))
      for (let limit = 1; limit <= hotelOutOfScopeIds.length + 1; limit += 1) {
        expect(wire(await search(memberScope, 'qzt-hotel', limit))).toBe(atFullLimit)
      }
    })

    it('never returns a retro draft or a retro card, to a member or to a workspace admin', async () => {
      for (const scope of [memberScope, adminScope]) {
        expect(await search(scope, 'qzt-charlie')).toEqual([])
        expect(await search(scope, 'qzt-delta')).toEqual([])
      }
    })

    it('is unchanged by re-running the indexer', async () => {
      const before = [
        wire(await search(memberScope, 'qzt-alpha')),
        wire(await search(memberScope, 'qzt-bravo')),
        wire(await search(adminScope, 'qzt-bravo')),
        wire(await search(memberScope, 'qzt-golf')),
      ]
      await indexToConvergence(database, [teamOneId, teamTwoId])
      const after = [
        wire(await search(memberScope, 'qzt-alpha')),
        wire(await search(memberScope, 'qzt-bravo')),
        wire(await search(adminScope, 'qzt-bravo')),
        wire(await search(memberScope, 'qzt-golf')),
      ]
      expect(after).toEqual(before)
    })
  })

  describe('scope', () => {
    it('gives a non-member an empty team set and zero rows', async () => {
      expect(outsiderScope).toEqual({ teams: [], isAdmin: false })
      expect(wire(await search(outsiderScope, 'qzt-alpha'))).toBe(wire([]))
    })

    it('narrows to empty for a team the caller is not in, byte-identically to a miss', async () => {
      const narrowed = intersectScope(memberScope, teamTwoId)
      expect(narrowed.teams).toEqual([])
      expect(wire(await search(narrowed, 'qzt-bravo'))).toBe(
        wire(await search(memberScope, 'qzt-echo')),
      )
    })

    it('covers every team of the workspace for an admin who is in none of them', async () => {
      expect(adminScope.isAdmin).toBe(true)
      expect(adminScope.teams).toContain(teamOneId)
      expect(adminScope.teams).toContain(teamTwoId)
      const hits = await search(adminScope, 'qzt-bravo')
      expect(hits).toHaveLength(1)
      expect(hits[0]?.teamId).toBe(teamTwoId)
    })

    it('intersects rather than widens when the team is in scope', () => {
      expect(intersectScope(memberScope, teamOneId).teams).toEqual([teamOneId])
      expect(intersectScope(memberScope, undefined).teams).toEqual(memberScope.teams)
    })
  })

  describe('results', () => {
    it('returns an issue once for a title token, not once per comment', async () => {
      const hits = await search(memberScope, 'qzt-foxtrot')
      expect(hits).toHaveLength(1)
      expect(hits[0]?.type).toBe('issue')
      expect(hits[0]?.id).toBe(foxtrotIssueId)
    })

    it('includes needs_triage and canceled issues, carrying their state', async () => {
      const hits = await search(memberScope, 'qzt-golf')
      const byId = new Map(hits.map((hit) => [hit.id, hit]))
      expect(byId.get(triageIssueId)?.needsTriage).toBe(true)
      expect(byId.get(canceledIssueId)?.status).toBe('canceled')
      expect(byId.get(canceledIssueId)?.needsTriage).toBe(false)
    })

    it('orders byte-stably across two runs', async () => {
      expect(wire(await search(memberScope, 'qzt-golf'))).toBe(
        wire(await search(memberScope, 'qzt-golf')),
      )
    })

    it('caps at the limit without reporting what was withheld', async () => {
      const hits = await search(memberScope, 'qzt-golf', 1)
      expect(hits).toHaveLength(1)
      expect(Object.keys(hits[0] ?? {}).sort()).toEqual([
        'id',
        'issueId',
        'issueKey',
        'issueTitle',
        'needsTriage',
        'snippet',
        'status',
        'teamId',
        'type',
        'updatedAt',
      ])
    })
  })

  // Last in the file, and restored at the end: this is the only test that touches DDL.
  describe('ensureSearchIndex', () => {
    const indexdef = async (): Promise<string | undefined> => {
      const { rows } = await sql<{ indexdef: string }>`
        select indexdef from pg_indexes
        where schemaname = current_schema() and indexname = ${SEARCH_FTS_INDEX_NAME}
      `.execute(database.db)
      return rows[0]?.indexdef
    }

    it('leaves a matching index alone, rebuilds on a changed configuration, and refuses an unknown one', async () => {
      expect(await ensureSearchIndex(database.db, 'simple')).toEqual({
        status: 'unchanged',
        textConfig: 'simple',
      })

      expect(await ensureSearchIndex(database.db, 'english')).toEqual({
        status: 'rebuilt',
        textConfig: 'english',
      })
      expect(await indexdef()).toContain("'english'::regconfig")

      await expect(ensureSearchIndex(database.db, 'qzt_no_such_config')).rejects.toBeInstanceOf(
        SearchTextConfigError,
      )
      await expect(ensureSearchIndex(database.db, 'qzt_no_such_config')).rejects.toThrow(
        'SEARCH_TEXT_CONFIG',
      )
      // The refusal must leave search answering with the previous configuration rather than dark.
      expect(await indexdef()).toContain("'english'::regconfig")

      expect(await ensureSearchIndex(database.db, 'simple')).toEqual({
        status: 'rebuilt',
        textConfig: 'simple',
      })
      expect(await indexdef()).toContain("'simple'::regconfig")
    }, 60_000)
  })
})
