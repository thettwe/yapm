import type { APIResponse, Page } from '@playwright/test'
import type { Database } from '@yapm/schema/db'
import { findTeamId, openDb } from './db'
import { expect, test } from './fixtures'
import { ADMIN, ensureAccount, openWorkspaceOverview, uniqueEmail } from './support'

// ONE spec, deliberately, and it exists for the things a vitest process cannot reach.
//
// `routes.pg.test.ts` already proves the refusal shape against live Postgres by calling the Hono app
// in-process. What it cannot exercise is the whole pipe: a real better-auth session cookie, a real
// multipart body over HTTP, the real `sharp` native binding decoding real bytes, and the local
// provider writing to a real filesystem — end to end, in the server process the e2e harness boots.
// A mis-registered route, a body parser that never sees the part, a session that does not reach the
// file routes, or a sharp binary that fails to load all pass every unit test and fail here.
//
// What this tier does NOT cover, said plainly rather than implied: the runtime Docker image, its
// named `files` volume and its uid-1001 user. The e2e job runs the server on the host under `tsx`;
// the image is the compose smoke job's ground, and that is where the volume and the non-root write
// are proven.
//
// The falsifiable check is the last leg. A member of another team asking for a real attachment id
// must receive a response byte-identical to the one for an id that was never uploaded — same
// status, same body, same headers. Any oracle at all (a 403 beside a 404, a different body, a
// missing header) fails it, and the whole storage design is that one property.

// A 1x1 PNG. Small on purpose: what is under test is the pipe and the refusal, not throughput —
// and it is a REAL PNG, so `sharp` genuinely decodes it and the thumbnail leg means something.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const NEVER_UPLOADED = '019f8f00-0000-7000-8000-00000000dead'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function randomKey(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

interface CapturedRefusal {
  status: number
  body: string
  headers: [string, string][]
}

// Everything except the headers that are facts about this hop rather than about the response.
// `date` moves; `connection`/`keep-alive` belong to the vite proxy in front of the server. If the
// two refusals differed in anything else at all, this comparison says so.
const HOP_HEADERS = new Set(['date', 'connection', 'keep-alive'])

async function captureRefusal(page: Page, path: string): Promise<CapturedRefusal> {
  const response = await page.request.get(path)
  const headers = Object.entries(response.headers())
    .filter(([name]) => !HOP_HEADERS.has(name))
    .sort(([a], [b]) => a.localeCompare(b))
  return { status: response.status(), body: await response.text(), headers }
}

async function createTeam(page: Page, name: string): Promise<void> {
  await page.goto('/')
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Key').fill(randomKey())
  await dialog.getByRole('button', { name: 'Create team' }).click()
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible({ timeout: 20_000 })
}

async function upload(page: Page, teamId: string, filename: string): Promise<APIResponse> {
  return await page.request.post('/api/v1/files', {
    multipart: {
      teamId,
      // A LYING part type. The server sniffs the bytes and stores what it found, so the response
      // saying `image/png` is a fact about the sniffer rather than about this header.
      file: { name: filename, mimeType: 'image/jpeg', buffer: PNG },
    },
  })
}

test.describe('attachments', () => {
  let db: Database

  test.beforeAll(() => {
    db = openDb()
  })

  test.afterAll(async () => {
    await db.close()
  })

  test('bytes round-trip for the owning team, and another team gets the byte-identical refusal', async ({
    page,
    newContext,
  }) => {
    test.slow()

    await ensureAccount(page, ADMIN)
    await openWorkspaceOverview(page)

    const ownTeam = unique('Files Own')
    const otherTeam = unique('Files Other')
    await createTeam(page, ownTeam)
    await createTeam(page, otherTeam)

    await page.goto('/')
    await page.getByTestId('create-invite').click()
    const inviteDialog = page.getByRole('dialog')
    await inviteDialog.getByLabel('Role').selectOption('member')
    await inviteDialog.getByLabel('Team (optional)').selectOption({ label: ownTeam })
    await inviteDialog.getByRole('button', { name: 'Create invite' }).click()
    const inviteLink = await page.getByTestId('invite-link').first().inputValue()

    const ownTeamId = await findTeamId(db, ownTeam)
    const otherTeamId = await findTeamId(db, otherTeam)

    // The admin's upload into the team the teammate is NOT in. This is the row the falsifiable
    // check asks for by id at the end.
    const adminUpload = await upload(page, otherTeamId, 'admin.png')
    expect(adminUpload.status()).toBe(201)
    const foreign = (await adminUpload.json()) as { id: string }

    const teammateContext = await newContext()
    const teammate = await teammateContext.newPage()
    await teammate.goto(inviteLink)
    await teammate.getByRole('button', { name: 'Create one' }).click()
    await teammate.getByLabel('Name').fill('Files Teammate')
    await teammate.getByLabel('Email').fill(uniqueEmail('files-teammate'))
    await teammate.getByLabel('Password', { exact: true }).fill('teammate-password-1234')
    await teammate.getByTestId('login-submit').click()
    await openWorkspaceOverview(teammate)

    // 1. A plain member uploads through the real multipart pipe.
    const response = await upload(teammate, ownTeamId, 'pasted.png')
    expect(response.status()).toBe(201)
    const uploaded = (await response.json()) as {
      id: string
      contentType: string
      byteSize: number
      hasThumbnail: boolean
    }
    expect(uploaded.contentType).toBe('image/png')
    expect(uploaded.byteSize).toBe(PNG.byteLength)
    // `sharp` really ran, in this process, against these bytes.
    expect(uploaded.hasThumbnail).toBe(true)
    // The response is a name and four facts. NOTHING in it is a URL — the client computes the
    // path from the id. A `url`/`src`/`href` key here would be the capability-at-rest this whole
    // design exists to prevent, replicated into every teammate's IndexedDB the moment change 17
    // writes it into a document.
    expect(Object.keys(uploaded).sort()).toEqual(['byteSize', 'contentType', 'hasThumbnail', 'id'])

    // 2. The same bytes come back, over HTTP, from the real filesystem.
    const fetched = await teammate.request.get(`/api/v1/files/${uploaded.id}`)
    expect(fetched.status()).toBe(200)
    expect(Buffer.compare(await fetched.body(), PNG)).toBe(0)
    const headers = fetched.headers()
    expect(headers['content-type']).toBe('image/png')
    expect(headers['cache-control']).toBe('private, max-age=300')
    expect(headers['content-disposition']).toContain('inline')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['content-security-policy']).toContain("default-src 'none'")

    const thumb = await teammate.request.get(`/api/v1/files/${uploaded.id}/thumb`)
    expect(thumb.status()).toBe(200)
    expect(thumb.headers()['content-type']).toBe('image/webp')

    // 3. THE FALSIFIABLE CHECK. The teammate names a real attachment in a team they are not in,
    // and names an id that was never uploaded. The two responses must be indistinguishable.
    const refusedReal = await captureRefusal(teammate, `/api/v1/files/${foreign.id}`)
    const refusedGhost = await captureRefusal(teammate, `/api/v1/files/${NEVER_UPLOADED}`)
    expect(refusedReal).toEqual(refusedGhost)
    expect(refusedReal.status).toBe(404)
    expect(refusedReal.body).toBe(JSON.stringify({ error: 'not_found' }))

    // Not a row nobody can read: the admin who uploaded it still gets the bytes. Without this the
    // leg above would pass against a route that refuses everyone.
    const adminRead = await page.request.get(`/api/v1/files/${foreign.id}`)
    expect(adminRead.status()).toBe(200)
    expect(Buffer.compare(await adminRead.body(), PNG)).toBe(0)
  })
})
