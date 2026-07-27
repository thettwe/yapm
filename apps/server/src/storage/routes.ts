import { newId } from '@yapm/schema'
import type { AttachmentRow, DB } from '@yapm/schema/db'
import {
  attachAttachment,
  canUploadToTeam,
  createAttachment,
  deleteAttachment,
  findAttachmentForReader,
  targetsAreInTeam,
} from '@yapm/schema/db'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import { secureHeaders } from 'hono/secure-headers'
import type { Kysely } from 'kysely'
import type { AuthService } from '../auth.js'
import type { Logger } from '../logger.js'
import { objectKeyFor, type StorageProvider, thumbnailKeyFor } from './provider.js'
import { contentDispositionFor, FALLBACK_MEDIA_TYPE, sniffMediaType } from './sniff.js'
import { createThumbnail } from './thumbnail.js'

export const FILES_API_BASE = '/api/v1/files'

export interface FileRoutesOptions {
  auth: AuthService
  db: Kysely<DB>
  provider: StorageProvider
  logger: Logger
  maxBytes: number
}

// THE one shape every non-401 outcome collapses to, on the `search/routes.ts` `EMPTY` model —
// status, body AND headers together, so they cannot drift apart across the seven call sites below.
//
// An id that matches no row, an id that is not a UUID at all, a row belonging to a team the caller
// is not in, a row whose bytes are absent from the provider, and `/thumb` on a row with no
// thumbnail all serialise to exactly these bytes. A different status or a different key on any one
// of them would be an oracle: the caller would learn something about rows they may not read from
// the SHAPE of the refusal, and a 403-beside-a-404 is the classic form of it.
//
// A malformed id is a 404, NOT a 400 — the same judgement `search`'s `.catch()` schema makes. A
// malformed id leaks nothing *today*, but "every read failure is one shape" is checkable and "every
// read failure that could leak something is one shape" is a judgement somebody re-litigates.
//
// `no-store` on the refusal is deliberate asymmetry against the 300-second cache on success: a
// cached refusal would survive the membership change that fixed it. It is not an oracle, because
// refusals are identical TO EACH OTHER, which is what the falsifiable check asserts.
const REFUSAL = {
  status: 404,
  body: JSON.stringify({ error: 'not_found' }),
  headers: {
    'content-type': 'application/json; charset=UTF-8',
    'cache-control': 'no-store',
  },
} as const

// Served bytes are cached PRIVATELY for five minutes. Images render instantly on revisit and a
// twenty-thumbnail issue costs zero requests on the second view.
//
// The cost, stated rather than hidden: for up to five minutes after being removed from a team, that
// person's browser can still paint images it already downloaded. It cannot fetch new ones. Accepted
// because it is a five-minute window on bytes they could equally have screenshotted, and because
// `no-cache` + ETag pays a 304 per image — twenty of them with no reverse proxy is a visible
// stutter against the sub-100ms posture. `private`, never `public`: no intermediary may store it.
const BYTE_CACHE_CONTROL = 'private, max-age=300'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface UploadResponse {
  readonly id: string
  readonly contentType: string
  readonly byteSize: number
  readonly hasThumbnail: boolean
  // AND NO URL. The client computes `/api/v1/files/<id>`; the id it stores in a document is a name,
  // not a capability. See `provider.ts` for why that distinction is the whole design.
}

// Every default hono would add that is either wrong here (HSTS is the deployment's business, not a
// file route's) or noise is switched off explicitly, so the header set on these responses is
// exactly what this file names — which is what makes "byte-identical refusals" a checkable claim.
const FILE_SECURE_HEADERS = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], sandbox: [] },
  crossOriginResourcePolicy: 'same-origin',
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
  referrerPolicy: 'no-referrer',
  strictTransportSecurity: false,
  xDnsPrefetchControl: false,
  xDownloadOptions: false,
  xFrameOptions: 'DENY',
  xPermittedCrossDomainPolicies: false,
  xXssProtection: false,
})

export function createFileRoutes(options: FileRoutesOptions): Hono {
  const { auth, db, provider, logger, maxBytes } = options
  const app = new Hono()

  // On BOTH branches, success and refusal, so the header set is one thing rather than two that can
  // drift. Even a mis-sniffed response then has no script capability: `default-src 'none'; sandbox`
  // plus `nosniff` means a browser cannot be talked into executing an attachment in this origin.
  //
  // Path-scoped rather than `use('*')`: this app is mounted at `/`, so a wildcard here would apply
  // these headers to the SPA and to every other route in the process.
  app.use(FILES_API_BASE, FILE_SECURE_HEADERS)
  app.use(`${FILES_API_BASE}/*`, FILE_SECURE_HEADERS)

  const refuse = (): Response =>
    new Response(REFUSAL.body, { status: REFUSAL.status, headers: { ...REFUSAL.headers } })

  const requireSession = createMiddleware(async (c, next) => {
    const user = await auth.getSessionUser(c.req.raw.headers)
    // Before ANY table is read, and the only outcome on these routes that is not the refusal.
    if (user === undefined) return c.json({ error: 'unauthorized' }, 401)
    c.set('fileUserId', user.id)
    await next()
  })

  // parse → session → ONE scoped statement → bytes. The order is fixed, and the scoped statement is
  // one statement: a row fetched and then rejected by an `if` here is a timing difference, and a
  // shape one refactor turns into a 403.
  const serve = async (
    id: string,
    userId: string,
    variant: 'original' | 'thumb',
  ): Promise<Response> => {
    const row = await findAttachmentForReader(db, { id, userId })
    if (row === null) return refuse()
    if (variant === 'thumb' && !row.hasThumbnail) return refuse()

    const key =
      variant === 'thumb' ? thumbnailKeyFor(row.teamId, row.id) : objectKeyFor(row.teamId, row.id)
    const object = await provider.get(key)
    // Bytes gone, row present. Folded into the same refusal rather than a 500: the caller learns
    // "no such file", which is true, and learns nothing about the instance's storage health.
    if (object === null) return refuse()

    return byteResponse(object.body, object.size, row, variant)
  }

  app.get(`${FILES_API_BASE}/:id`, requireSession, async (c) => {
    const id = c.req.param('id')
    if (!UUID_PATTERN.test(id)) return refuse()
    return serve(id, c.get('fileUserId'), 'original')
  })

  app.get(`${FILES_API_BASE}/:id/thumb`, requireSession, async (c) => {
    const id = c.req.param('id')
    if (!UUID_PATTERN.test(id)) return refuse()
    return serve(id, c.get('fileUserId'), 'thumb')
  })

  // `bodyLimit` takes ONE of two paths, and it is worth being exact about which, because "and also
  // bounds the stream" is the comfortable thing to believe and not what the middleware does:
  //
  //   - `Content-Length` present and no `transfer-encoding` → compared to `maxSize` BEFORE a byte
  //     is read, and the body is then passed through UNCOUNTED. A header that lies about a larger
  //     body cannot get past this; a header that lies about a smaller one is bounded by the HTTP
  //     layer's own content-length framing, which stops reading at the declared length, not by
  //     this middleware.
  //   - No usable `Content-Length` (chunked) → every chunk is counted while reading and the
  //     request is refused the moment the running total passes `maxSize`.
  //
  // Either way an over-size upload is refused before it is buffered. One file per request:
  // batching would make partial failure a shape the client has to reason about, and a browser can
  // issue N requests. This is a REQUEST-SHAPE refusal, not a row refusal — it says nothing about
  // any row, so it carries its own status rather than the read path's.
  app.post(
    FILES_API_BASE,
    requireSession,
    bodyLimit({
      maxSize: maxBytes,
      onError: (c) =>
        c.json({ error: 'payload_too_large', maxBytes }, 413, { 'cache-control': 'no-store' }),
    }),
    async (c) => {
      const userId = c.get('fileUserId')

      let form: Awaited<ReturnType<typeof c.req.parseBody>>
      try {
        form = await c.req.parseBody()
      } catch {
        // A truncated or malformed multipart body — including one aborted mid-stream because its
        // Content-Length lied. Nothing was written, so there is nothing to clean up.
        return c.json({ error: 'invalid_request' }, 400, { 'cache-control': 'no-store' })
      }

      const file = form.file
      // LOWER-CASED WHERE IT IS READ, once. Postgres compares `uuid` case-insensitively, so
      // `canUploadToTeam` accepts an upper-cased team id — but the storage key is built from this
      // same string and `STORAGE_KEY_PATTERN` is lower-case hex only. Without this, an authorised
      // upload naming `019FA434-…` becomes an `InvalidStorageKeyError` and a 500 instead of a 201.
      const teamId = typeof form.teamId === 'string' ? form.teamId.toLowerCase() : ''
      if (!(file instanceof File) || teamId.length === 0) {
        return c.json({ error: 'invalid_request' }, 400, { 'cache-control': 'no-store' })
      }
      const issueId =
        typeof form.issueId === 'string' && form.issueId.length > 0 ? form.issueId : null
      const commentId =
        typeof form.commentId === 'string' && form.commentId.length > 0 ? form.commentId : null

      // Membership in `teamId` WITH write access — viewers are read-only everywhere else and are
      // read-only here — checked before a byte of the part is read. Naming a team you are not in
      // gets the same answer as naming a team that does not exist.
      if (!(await canUploadToTeam(db, { userId, teamId }))) return refuse()
      // The one place a cross-team edge could be forged into existence.
      if (!(await targetsAreInTeam(db, { teamId, issueId, commentId }))) return refuse()

      const bytes = new Uint8Array(await file.arrayBuffer())
      // The SNIFFED type, never `file.type` — a multipart part's Content-Type is an
      // attacker-controlled string, and storing it to serve it later is the SVG hole with steps.
      const sniffed = sniffMediaType(bytes)
      const contentType = sniffed ?? FALLBACK_MEDIA_TYPE

      const id = newId()
      const key = objectKeyFor(teamId, id)
      const thumbKey = thumbnailKeyFor(teamId, id)
      const written: string[] = []

      try {
        await provider.put(key, bytes, contentType)
        written.push(key)

        // Once, here, never on the read path. Failure is non-fatal by construction: a file sharp
        // cannot decode is stored with `has_thumbnail = false` and the upload succeeds.
        const thumbnail = sniffed === null ? null : await createThumbnail(bytes)
        if (thumbnail !== null) {
          await provider.put(thumbKey, thumbnail.bytes, thumbnail.contentType)
          written.push(thumbKey)
        }

        const row = await createAttachment(db, {
          id,
          teamId,
          uploaderId: userId,
          filename: file.name,
          contentType,
          byteSize: bytes.byteLength,
          hasThumbnail: thumbnail !== null,
          issueId,
          commentId,
        })

        const response: UploadResponse = {
          id: row.id,
          contentType: row.contentType,
          byteSize: row.byteSize,
          hasThumbnail: row.hasThumbnail,
        }
        return c.json(response, 201, { 'cache-control': 'no-store' })
      } catch (error) {
        // Anything written before the failure is removed BEFORE responding, so a failed upload
        // leaves no object the sweep would have to find by listing a bucket.
        for (const orphan of written) {
          try {
            await provider.delete(orphan)
          } catch (cleanupError) {
            logger.error({ err: cleanupError, key: orphan }, 'failed to clean up a partial upload')
          }
        }
        throw error
      }
    },
  )

  // Attach once, from null, within the team. This is how change 17 attaches an image to the issue
  // that did not exist when the paste happened.
  app.patch(`${FILES_API_BASE}/:id`, requireSession, async (c) => {
    const id = c.req.param('id')
    if (!UUID_PATTERN.test(id)) return refuse()
    const userId = c.get('fileUserId')

    let payload: unknown
    try {
      payload = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_request' }, 400, { 'cache-control': 'no-store' })
    }
    const body = (payload ?? {}) as { issueId?: unknown; commentId?: unknown }
    const issueId = typeof body.issueId === 'string' ? body.issueId : null
    const commentId = typeof body.commentId === 'string' ? body.commentId : null
    if (issueId === null && commentId === null) {
      return c.json({ error: 'invalid_request' }, 400, { 'cache-control': 'no-store' })
    }

    const row = await findAttachmentForReader(db, { id, userId })
    if (row === null) return refuse()
    if (!(await canUploadToTeam(db, { userId, teamId: row.teamId }))) return refuse()
    if (!(await targetsAreInTeam(db, { teamId: row.teamId, issueId, commentId }))) return refuse()

    const attached = await attachAttachment(db, { id, userId, issueId, commentId })
    // Already attached: the statement's `is null` guards matched nothing. Never re-parented.
    if (attached === null) return refuse()
    return c.json(
      {
        id: attached.id,
        contentType: attached.contentType,
        byteSize: attached.byteSize,
        hasThumbnail: attached.hasThumbnail,
      },
      200,
      { 'cache-control': 'no-store' },
    )
  })

  // Object, thumbnail, row — and idempotent, so the second call is the standard refusal rather than
  // an error. Objects before the row, for the same reason as the sweep: a crash between them leaves
  // a row whose bytes are gone (already the standard refusal) rather than bytes nobody can name.
  app.delete(`${FILES_API_BASE}/:id`, requireSession, async (c) => {
    const id = c.req.param('id')
    if (!UUID_PATTERN.test(id)) return refuse()
    const userId = c.get('fileUserId')

    const row = await findAttachmentForReader(db, { id, userId })
    if (row === null) return refuse()
    if (!(await canUploadToTeam(db, { userId, teamId: row.teamId }))) return refuse()

    await provider.delete(thumbnailKeyFor(row.teamId, row.id))
    await provider.delete(objectKeyFor(row.teamId, row.id))
    await deleteAttachment(db, row.id)
    return c.body(null, 204, { 'cache-control': 'no-store' })
  })

  return app
}

// `Content-Disposition: inline` ONLY for a sniffed raster type. Everything else — including
// anything whose bytes look like SVG, XML or HTML — is `application/octet-stream` + `attachment`,
// so the browser downloads it and never renders it in this origin.
//
// The stored `content_type` was itself sniffed at upload, so this is a second, cheaper check of the
// same fact rather than a first one: the rule is applied at SERVE time and not only at upload,
// because a row written before a future sniffing change must not be able to opt itself in.
function byteResponse(
  body: ReadableStream<Uint8Array>,
  size: number,
  row: AttachmentRow,
  variant: 'original' | 'thumb',
): Response {
  const inline = variant === 'thumb' || row.contentType.startsWith('image/')
  const contentType = variant === 'thumb' ? 'image/webp' : row.contentType
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(size),
      'content-disposition': contentDispositionFor(
        variant === 'thumb' ? `${row.filename}.thumb.webp` : row.filename,
        inline,
      ),
      'cache-control': BYTE_CACHE_CONTROL,
    },
  })
}

declare module 'hono' {
  interface ContextVariableMap {
    fileUserId: string
  }
}
