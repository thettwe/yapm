import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newId } from '@yapm/schema'
import { createDatabase, type Database, migrateToLatest } from '@yapm/schema/db'
import { sql } from 'kysely'
import { pino } from 'pino'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthService, SessionUser } from '../auth.js'
import { createLocalStorageProvider } from './local.js'
import { createFileRoutes, FILES_API_BASE } from './routes.js'

const DATABASE_URL = process.env.DATABASE_URL
if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the attachment refusal oracle test must not skip',
  )
}

const silent = pino({ level: 'silent' })

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

interface CapturedResponse {
  status: number
  body: string
  headers: [string, string][]
}

// The whole response, minus `Date` (which moves) and `content-length` on the byte path (which is a
// fact about the payload, not about the refusal). Everything else is compared verbatim, because
// "byte-identical" is the claim and a header set compared loosely is not that claim.
async function capture(response: Response): Promise<CapturedResponse> {
  const headers: [string, string][] = []
  response.headers.forEach((value, name) => {
    if (name !== 'date') headers.push([name, value])
  })
  headers.sort(([a], [b]) => a.localeCompare(b))
  return { status: response.status, body: await response.text(), headers }
}

describe.skipIf(DATABASE_URL === undefined)('/api/v1/files', () => {
  let database: Database
  let dir: string
  let app: ReturnType<typeof createFileRoutes>

  const workspaceId = newId()
  const teamAId = newId()
  const teamBId = newId()
  const memberA = `a-${newId()}`
  const memberB = `b-${newId()}`
  const viewerA = `v-${newId()}`

  let png: Uint8Array
  let uploadedId: string

  // `File` wants a BlobPart, which the server package's lib does not declare; a Blob built from the
  // bytes is the same value with a name TypeScript knows.
  const pngBlob = (): Blob => new Blob([png])

  const request = async (
    path: string,
    user: string | null,
    init: RequestInit = {},
  ): Promise<Response> =>
    app.request(path, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(user === null ? {} : { 'x-test-user': user }),
      },
    })

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    const db = database.db

    await db.insertInto('workspace').values({ id: workspaceId, name: 'files-route-test' }).execute()
    await db
      .insertInto('team')
      .values([
        { id: teamAId, workspace_id: workspaceId, name: 'A', key: `A${newId().slice(-6)}` },
        { id: teamBId, workspace_id: workspaceId, name: 'B', key: `B${newId().slice(-6)}` },
      ])
      .execute()
    await db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: memberA, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: memberB, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: viewerA, role: 'viewer' },
      ])
      .execute()
    await db
      .insertInto('team_membership')
      .values([
        { id: newId(), team_id: teamAId, user_id: memberA },
        { id: newId(), team_id: teamBId, user_id: memberB },
        { id: newId(), team_id: teamAId, user_id: viewerA },
      ])
      .execute()

    dir = await mkdtemp(join(tmpdir(), 'yapm-files-route-'))
    app = createFileRoutes({
      auth: fakeAuth(),
      db,
      provider: createLocalStorageProvider({ dir }),
      logger: silent,
      maxBytes: 1024 * 1024,
    })

    png = new Uint8Array(
      await sharp({
        create: { width: 24, height: 18, channels: 3, background: { r: 10, g: 120, b: 200 } },
      })
        .png()
        .toBuffer(),
    )
  }, 60_000)

  afterAll(async () => {
    await database?.close()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('uploads a PNG as a member of team A and returns an id and no URL', async () => {
    const form = new FormData()
    form.set('file', new File([pngBlob()], 'diagram.png', { type: 'image/png' }))
    form.set('teamId', teamAId)

    const response = await request(FILES_API_BASE, memberA, { method: 'POST', body: form })
    expect(response.status).toBe(201)
    const payload = (await response.json()) as Record<string, unknown>

    expect(payload).toEqual({
      id: expect.any(String),
      contentType: 'image/png',
      byteSize: png.byteLength,
      hasThumbnail: true,
    })
    // NOTHING in this response is a capability. The client computes `/api/v1/files/<id>`; if a URL
    // ever appeared here it would be the string that ends up inside a synced document.
    expect(JSON.stringify(payload)).not.toContain('http')
    expect(Object.keys(payload).sort()).toEqual(['byteSize', 'contentType', 'hasThumbnail', 'id'])

    uploadedId = payload.id as string
  })

  // THE FALSIFIABLE CHECK. Three requests from a member of the OTHER team: the real id, a UUID that
  // was never uploaded, and a string that is not a UUID at all. All three must be indistinguishable
  // — same status, same body bytes, same header set and values. A 403 beside a 404, or a 400 for the
  // malformed id, is an oracle: it tells a caller which ids name rows they may not read.
  it('answers a member of team B identically for a real id, an unknown id and a non-UUID', async () => {
    const real = await capture(await request(`${FILES_API_BASE}/${uploadedId}`, memberB))
    const unknown = await capture(await request(`${FILES_API_BASE}/${newId()}`, memberB))
    const malformed = await capture(await request(`${FILES_API_BASE}/not-a-uuid`, memberB))

    expect(real.status).toBe(404)
    expect(real.body).toBe('{"error":"not_found"}')
    expect(Object.fromEntries(real.headers)).toMatchObject({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-type': 'application/json; charset=UTF-8',
    })

    expect(unknown).toEqual(real)
    expect(malformed).toEqual(real)
  })

  it('serves the exact uploaded bytes to a member of team A, cached privately and inline', async () => {
    const response = await request(`${FILES_API_BASE}/${uploadedId}`, memberA)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-disposition')).toContain('inline')
    expect(response.headers.get('content-disposition')).toContain('filename="diagram.png"')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes]).toEqual([...png])
  })

  it('serves the thumbnail as WebP', async () => {
    const response = await request(`${FILES_API_BASE}/${uploadedId}/thumb`, memberA)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
  })

  it('answers an anonymous caller with 401, before any row is read', async () => {
    const response = await request(`${FILES_API_BASE}/${uploadedId}`, null)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })

  it('refuses a viewer upload — read-only here as everywhere else', async () => {
    const form = new FormData()
    form.set('file', new File([pngBlob()], 'diagram.png', { type: 'image/png' }))
    form.set('teamId', teamAId)

    const response = await request(FILES_API_BASE, viewerA, { method: 'POST', body: form })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('{"error":"not_found"}')

    // …but a viewer READS. The role ceiling is about writing.
    expect((await request(`${FILES_API_BASE}/${uploadedId}`, viewerA)).status).toBe(200)
  })

  it('refuses an upload naming a team the caller is not in', async () => {
    const form = new FormData()
    form.set('file', new File([pngBlob()], 'diagram.png', { type: 'image/png' }))
    form.set('teamId', teamBId)

    const response = await request(FILES_API_BASE, memberA, { method: 'POST', body: form })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('{"error":"not_found"}')
  })

  // The one place a cross-team edge could be forged into existence.
  it('refuses an upload whose issueId is in a different team', async () => {
    const foreignIssue = newId()
    await database.db
      .insertInto('issue')
      .values({
        id: foreignIssue,
        team_id: teamBId,
        title: 'in the other team',
        status: 'todo',
        priority: 'no_priority',
        creator_id: memberB,
      })
      .execute()

    const form = new FormData()
    form.set('file', new File([pngBlob()], 'diagram.png', { type: 'image/png' }))
    form.set('teamId', teamAId)
    form.set('issueId', foreignIssue)

    const response = await request(FILES_API_BASE, memberA, { method: 'POST', body: form })
    expect(response.status).toBe(404)
  })

  it('refuses an upload larger than the limit before the body is read', async () => {
    const small = createFileRoutes({
      auth: fakeAuth(),
      db: database.db,
      provider: createLocalStorageProvider({ dir }),
      logger: silent,
      maxBytes: 64,
    })
    const form = new FormData()
    form.set('file', new File([pngBlob()], 'diagram.png', { type: 'image/png' }))
    form.set('teamId', teamAId)

    const response = await small.request(FILES_API_BASE, {
      method: 'POST',
      body: form,
      headers: { 'x-test-user': memberA },
    })
    expect(response.status).toBe(413)
  })

  // AN SVG IS AN HTML DOCUMENT. It round-trips, it is downloadable, and the origin never renders it.
  it('stores and serves an SVG as an octet-stream download, never as image/svg+xml', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    const form = new FormData()
    form.set('file', new File([svg], 'diagram.svg', { type: 'image/svg+xml' }))
    form.set('teamId', teamAId)

    const upload = await request(FILES_API_BASE, memberA, { method: 'POST', body: form })
    expect(upload.status).toBe(201)
    const created = (await upload.json()) as { id: string; hasThumbnail: boolean }
    expect(created.hasThumbnail).toBe(false)

    const response = await request(`${FILES_API_BASE}/${created.id}`, memberA)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe(svg)

    // `/thumb` on a row with no thumbnail is the standard refusal, not a 200 with the original.
    const thumb = await request(`${FILES_API_BASE}/${created.id}/thumb`, memberA)
    expect(thumb.status).toBe(404)
    expect(await thumb.text()).toBe('{"error":"not_found"}')
  })

  it('attaches once, from null, and never re-parents', async () => {
    const issueId = newId()
    await database.db
      .insertInto('issue')
      .values({
        id: issueId,
        team_id: teamAId,
        title: 'attach me',
        status: 'todo',
        priority: 'no_priority',
        creator_id: memberA,
      })
      .execute()

    const form = new FormData()
    form.set('file', new File([pngBlob()], 'pasted.png', { type: 'image/png' }))
    form.set('teamId', teamAId)
    const created = (await (
      await request(FILES_API_BASE, memberA, { method: 'POST', body: form })
    ).json()) as { id: string }

    const first = await request(`${FILES_API_BASE}/${created.id}`, memberA, {
      method: 'PATCH',
      body: JSON.stringify({ issueId }),
      headers: { 'content-type': 'application/json' },
    })
    expect(first.status).toBe(200)

    const second = await request(`${FILES_API_BASE}/${created.id}`, memberA, {
      method: 'PATCH',
      body: JSON.stringify({ issueId: newId() }),
      headers: { 'content-type': 'application/json' },
    })
    expect(second.status).toBe(404)

    const row = await database.db
      .selectFrom('attachment')
      .select('issue_id')
      .where('id', '=', created.id)
      .executeTakeFirst()
    expect(row?.issue_id).toBe(issueId)
  })

  it('deletes idempotently, and the second call is the standard refusal', async () => {
    const form = new FormData()
    form.set('file', new File([pngBlob()], 'temp.png', { type: 'image/png' }))
    form.set('teamId', teamAId)
    const created = (await (
      await request(FILES_API_BASE, memberA, { method: 'POST', body: form })
    ).json()) as { id: string }

    expect(
      (await request(`${FILES_API_BASE}/${created.id}`, memberA, { method: 'DELETE' })).status,
    ).toBe(204)

    const second = await request(`${FILES_API_BASE}/${created.id}`, memberA, { method: 'DELETE' })
    expect(second.status).toBe(404)
    expect(await second.text()).toBe('{"error":"not_found"}')

    // And the bytes are gone with the row.
    expect((await request(`${FILES_API_BASE}/${created.id}`, memberA)).status).toBe(404)
  })

  // A row whose bytes have vanished — the sweep crashed between the object and the row, or an
  // operator emptied the directory — must fold into the SAME refusal, never a 500.
  it('refuses identically when the row exists and the bytes do not', async () => {
    const form = new FormData()
    form.set('file', new File([pngBlob()], 'ghost.png', { type: 'image/png' }))
    form.set('teamId', teamAId)
    const created = (await (
      await request(FILES_API_BASE, memberA, { method: 'POST', body: form })
    ).json()) as { id: string }

    await rm(join(dir, teamAId, created.id), { force: true })

    const missing = await capture(await request(`${FILES_API_BASE}/${created.id}`, memberA))
    const unknown = await capture(await request(`${FILES_API_BASE}/${newId()}`, memberA))
    expect(missing).toEqual(unknown)
  })

  it('stores the sniffed type, never the claimed one', async () => {
    const form = new FormData()
    // A PNG claiming to be a JPEG, named `.gif`. Only the bytes are not attacker-controlled.
    form.set('file', new File([pngBlob()], 'liar.gif', { type: 'image/jpeg' }))
    form.set('teamId', teamAId)

    const created = (await (
      await request(FILES_API_BASE, memberA, { method: 'POST', body: form })
    ).json()) as { id: string; contentType: string }
    expect(created.contentType).toBe('image/png')

    const stored = await database.db
      .selectFrom('attachment')
      .select('content_type')
      .where('id', '=', created.id)
      .executeTakeFirst()
    expect(stored?.content_type).toBe('image/png')
  })

  it('orphans rather than cascades when the comment it hangs off is deleted', async () => {
    const issueId = newId()
    const commentId = newId()
    await database.db
      .insertInto('issue')
      .values({
        id: issueId,
        team_id: teamAId,
        title: 'orphan me',
        status: 'todo',
        priority: 'no_priority',
        creator_id: memberA,
      })
      .execute()
    await sql`
      insert into comment (id, issue_id, team_id, author_id, body)
      values (${commentId}, ${issueId}, ${teamAId}, ${memberA}, ${JSON.stringify({ type: 'doc' })}::jsonb)
    `.execute(database.db)

    const form = new FormData()
    form.set('file', new File([pngBlob()], 'on-a-comment.png', { type: 'image/png' }))
    form.set('teamId', teamAId)
    form.set('commentId', commentId)
    const created = (await (
      await request(FILES_API_BASE, memberA, { method: 'POST', body: form })
    ).json()) as { id: string }

    await database.db.deleteFrom('comment').where('id', '=', commentId).execute()

    const row = await database.db
      .selectFrom('attachment')
      .select(['id', 'comment_id'])
      .where('id', '=', created.id)
      .executeTakeFirst()
    // The row SURVIVES with a null edge. A cascade would have deleted it and left the bytes on
    // disk, which is the worst outcome: the orphan becomes invisible.
    expect(row?.comment_id).toBeNull()
    expect((await request(`${FILES_API_BASE}/${created.id}`, memberA)).status).toBe(200)
  })
})
