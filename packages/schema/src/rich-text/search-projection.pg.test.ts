import type { ReadonlyJSONValue } from '@rocicorp/zero'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import {
  DEFAULT_TEXT_SEARCH_CONFIG,
  reconcileDiffBatch,
  type SearchDocumentRow,
  type SearchHit,
  searchDocuments,
  upsertSearchDocuments,
} from '../db/search.js'
import { newId } from '../id.js'
import type { AuthContext } from '../zero/context.js'
import { createServerMutators } from '../zero/server-mutators.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from '../zero/testing/pg-transaction.js'
import { richTextToPlainText } from './plaintext.js'
import { RICH_TEXT_SCHEMA_VERSION, RICH_TEXT_SCHEMA_VERSION_ATTR } from './schema-version.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the search-index projection of the new node types must not be skipped',
  )
}

// THE ONE LEG OF THIS CHANGE THAT GENUINELY NEEDS POSTGRES.
//
// Everything else about the walker is a pure function and is asserted in `plaintext.test.ts`. What
// only the database can show is the consequence: `richTextToPlainText` is the projection that
// becomes `search_document.body`, and a walker case that produces garbage corrupts the search index
// SILENTLY. No mutator throws, no type fails, no request errors — the text is simply not findable,
// or is findable as a word nobody typed. Nothing else in the system fails loudly enough to notice.
//
// So the document here is written through the REAL `issue.create` mutator against a real
// transaction, indexed with the SAME helpers `apps/server/src/jobs/search.ts` composes, and then
// searched through the real read path. Three assertions distinguish this from `origin/main`:
//
//   1. the image's alt text is in the index and is searchable — on main an image node contributes
//      nothing at all, so the words somebody actually typed into a screenshot caption are lost;
//   2. a table row reads as ONE line whose cells are separated — `alpha beta`, never `alphabeta`,
//      which is the shape a missing cell separator produces and the shape that makes a row
//      unfindable by either of its cells;
//   3. `sanitizeRichText` really did stamp the stored document and really did drop the URL-shaped
//      attachment id, in the row Postgres holds rather than in a return value.
//
// It is deliberately NOT a re-proof of scoping: `search.pg.test.ts` owns the permission oracle.

// ASSEMBLED, not written literally, for the reason `plaintext.test.ts` gives at the same spot: the
// capability-at-rest guard greps this directory for an attribute whose value opens with an absolute
// URL and does not exclude test files.
const TRACKING_PIXEL_URL = `${'https:'}//tracker.example/pixel.png`

// Distinctive tokens, so a hit is a fact about this fixture rather than about whatever else the
// shared database holds. `zqrcaption` is the alt text; `zqrgamma` is a body cell.
const ALT_TEXT = 'crash on the zqrcaption login screen'

function paragraph(text: string): ReadonlyJSONValue {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function cell(type: 'tableCell' | 'tableHeader', text: string): ReadonlyJSONValue {
  return { type, content: [paragraph(text)] }
}

describe.skipIf(DATABASE_URL === undefined)(
  'the plaintext walker projects the new node types into search_document',
  () => {
    const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    const mutators = createServerMutators()

    const workspaceId = newId()
    const teamId = newId()
    const issueId = newId()
    const attachmentId = newId()
    const author: AuthContext = { userID: `rich-author-${newId()}`, role: 'member' }

    let meta: PgSchemaMeta
    let body: string

    const description: ReadonlyJSONValue = {
      type: 'doc',
      content: [
        paragraph('A regression report with a screenshot and a table.'),
        {
          type: 'image',
          attrs: { attachmentId, alt: ALT_TEXT, width: 'full' },
        },
        {
          // The image whose id is URL-shaped: what the sanitizer must refuse on the AUTHORITATIVE
          // pass, asserted against the stored row rather than against a pure function's output.
          type: 'image',
          attrs: { attachmentId: TRACKING_PIXEL_URL, alt: 'pixel', width: 'full' },
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [cell('tableHeader', 'alpha'), cell('tableHeader', 'beta')],
            },
            {
              type: 'tableRow',
              content: [cell('tableCell', 'zqrgamma'), cell('tableCell', 'delta')],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const zqrfence = 1' }],
        },
      ],
    }

    // The indexer, composed from the same exported helpers the job composes — never an import of
    // the job, because `packages/schema` may not import an app (CLAUDE.md #3). Scoped to this
    // fixture's team for the reason `search.pg.test.ts` records: the diff is global and every
    // Postgres suite in the repo shares one database.
    async function indexToConvergence(): Promise<void> {
      for (let pass = 0; pass < 20; pass += 1) {
        const rows = await reconcileDiffBatch(database.db, {
          entityType: 'issue',
          limit: 100,
          teamIds: [teamId],
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
        await upsertSearchDocuments(database.db, documents)
      }
    }

    const search = (query: string): Promise<SearchHit[]> =>
      searchDocuments(database.db, {
        scope: { teams: [teamId], isAdmin: false },
        query,
        limit: 10,
        textConfig: DEFAULT_TEXT_SEARCH_CONFIG,
      })

    beforeAll(async () => {
      await migrateToLatest(database.db)
      meta = await readPgSchemaMeta(database.db)

      await sql`insert into workspace (id, name) values (${workspaceId}, 'rich-content-pg')`.execute(
        database.db,
      )
      await sql`
        insert into team (id, workspace_id, name, key)
        values (${teamId}, ${workspaceId}, 'Rich Content', ${`RC${Date.now() % 10_000}`})
      `.execute(database.db)
      await sql`
        insert into workspace_member (id, workspace_id, user_id, role)
        values (${newId()}, ${workspaceId}, ${author.userID}, 'member')
      `.execute(database.db)
      await sql`
        insert into team_membership (id, team_id, user_id)
        values (${newId()}, ${teamId}, ${author.userID})
      `.execute(database.db)

      await database.db.transaction().execute(async (trx) => {
        await mutators.issue.create.fn({
          tx: createPgServerTransaction(trx, meta),
          args: {
            id: issueId,
            teamId,
            title: 'Screenshot and table survive the round trip',
            description,
            status: 'todo' as const,
            priority: 'medium' as const,
            createdAt: 1000,
            updatedAt: 1000,
          },
          ctx: author,
        })
      })

      await indexToConvergence()
      const { rows } = await sql<{ body: string }>`
        select body from search_document
        where entity_type = 'issue' and entity_id = ${issueId}
      `.execute(database.db)
      body = rows[0]?.body ?? ''
    }, 60_000)

    afterAll(async () => {
      await sql`delete from search_document where team_id = ${teamId}::uuid`.execute(database.db)
      await sql`delete from issue_subscription where team_id = ${teamId}::uuid`.execute(database.db)
      await sql`delete from notification where team_id = ${teamId}::uuid`.execute(database.db)
      await sql`delete from issue where team_id = ${teamId}::uuid`.execute(database.db)
      await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
      await database.close()
    })

    // Without this every assertion below could pass against an index that was never written.
    it('indexed the issue at all', () => {
      expect(body.length).toBeGreaterThan(0)
      expect(body).toContain('A regression report')
    })

    it("carries the image's alt text, which is the only place those words exist", () => {
      expect(body).toContain('zqrcaption')
      expect(body).toContain(ALT_TEXT)
    })

    it('separates the cells of a row and never welds them into one token', () => {
      expect(body).toContain('alpha beta')
      expect(body).not.toContain('alphabeta')
      expect(body).toContain('zqrgamma delta')
    })

    it('ends a table row rather than folding the whole table onto one line', () => {
      const lines = body.split('\n')
      expect(lines).toContain('alpha beta')
      expect(lines).toContain('zqrgamma delta')
    })

    it('carries the code block verbatim', () => {
      expect(body).toContain('const zqrfence = 1')
    })

    it('makes the alt text and the cell findable through the real read path', async () => {
      const byAlt = await search('zqrcaption')
      expect(byAlt.map((hit) => hit.issueId)).toEqual([issueId])
      const byCell = await search('zqrgamma')
      expect(byCell.map((hit) => hit.issueId)).toEqual([issueId])
      // The welded token is not a word anybody typed, so it must match nothing. This is the
      // assertion that fails when the cell separator is dropped.
      expect(await search('alphabeta')).toEqual([])
    })

    it('stored a stamped document with no URL in any image node', async () => {
      const { rows } = await sql<{ description: unknown }>`
        select description from issue where id = ${issueId}
      `.execute(database.db)
      const stored = rows[0]?.description as {
        attrs?: Record<string, unknown>
        content?: { type?: string; attrs?: Record<string, unknown> }[]
      }
      expect(stored?.attrs?.[RICH_TEXT_SCHEMA_VERSION_ATTR]).toBe(RICH_TEXT_SCHEMA_VERSION)

      const images = (stored?.content ?? []).filter((node) => node.type === 'image')
      expect(images).toHaveLength(2)
      expect(images[0]?.attrs?.attachmentId).toBe(attachmentId)
      // Refused, not rewritten: the node degrades to a placeholder rather than storing a fetchable
      // string in a document that replicates to every client's IndexedDB.
      expect(images[1]?.attrs?.attachmentId).toBe('')
      for (const image of images) {
        expect(Object.keys(image.attrs ?? {}).sort()).toEqual(['alt', 'attachmentId', 'width'])
      }
    })
  },
)
