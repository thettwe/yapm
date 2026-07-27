import { AwsClient } from 'aws4fetch'
import { type StorageProvider, type StoredObject, validateKey } from './provider.js'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface S3StorageOptions {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  // Optional, and the reason R2 / Backblaze B2 / Garage / SeaweedFS / a MinIO an operator already
  // runs are all reachable. MinIO is supported as a thing somebody may already have; it is never a
  // thing yapm's compose file requires.
  endpoint?: string | undefined
  forcePathStyle?: boolean | undefined
  // Injected so tests need no credentials and make no network call — exactly as `mail/resend.ts`
  // injects it.
  fetch?: FetchLike | undefined
}

export class S3RequestError extends Error {
  status: number
  body: string

  constructor(operation: string, status: number, body: string) {
    super(`S3 ${operation} failed: ${status} ${body}`)
    this.name = 'S3RequestError'
    this.status = status
    this.body = body
  }
}

// Four signed HTTP verbs against a path. No vendor SDK, on the `resend.ts` judgement applied to a
// second HTTPS API: `aws4fetch` computes a SigV4 Authorization header and leaves the transport to
// the platform `fetch` Node 24 already has, in ~4 KB with zero runtime dependencies.
//
// Note what is NOT here, and cannot be added: nothing signs a query string, nothing returns a URL.
// `signQuery` is what would turn this file into a presigner, and the guard test greps for its
// symptoms while the seam's five-member shape is what actually prevents it.
export function createS3StorageProvider(options: S3StorageOptions): StorageProvider {
  const { bucket, region, accessKeyId, secretAccessKey, forcePathStyle } = options
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const endpoint = (options.endpoint ?? `https://s3.${region}.amazonaws.com`).replace(/\/+$/, '')

  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region })

  const bucketUrl = (): string => {
    if (forcePathStyle === true) return `${endpoint}/${bucket}`
    const parsed = new URL(endpoint)
    return `${parsed.protocol}//${bucket}.${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`
  }

  const urlFor = (key: string): string => {
    // FIRST, before a request is built. Asserted by the provider tests: the injected `fetch` must
    // never be invoked for a malformed key.
    validateKey(key)
    return `${bucketUrl()}/${key}`
  }

  // Sign, then hand the signed pieces to the INJECTED fetch. `client.fetch` would call the global
  // one and make the seam untestable without credentials; this keeps the injection point identical
  // to `resend.ts`.
  const send = async (
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: Uint8Array },
  ): Promise<Response> => {
    const signed = await client.sign(url, {
      method: init.method,
      ...(init.headers ? { headers: init.headers } : {}),
      ...(init.body === undefined ? {} : { body: init.body }),
    })
    const headers: Record<string, string> = {}
    signed.headers.forEach((value, name) => {
      headers[name] = value
    })
    return fetchImpl(signed.url, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    })
  }

  return {
    kind: 's3',

    async put(key, body, contentType) {
      // A stream is collected before signing: SigV4 over an unsigned payload is fine (aws4fetch
      // sets `X-Amz-Content-Sha256: UNSIGNED-PAYLOAD` for s3), but a chunked PUT with no
      // `Content-Length` is rejected by most S3 implementations. The upload path has already
      // bounded this by `ATTACHMENT_MAX_BYTES` and has already buffered the bytes to sniff them,
      // so this is not a second copy in practice.
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await collect(body))
      const response = await send(urlFor(key), {
        method: 'PUT',
        headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) },
        body: bytes,
      })
      if (!response.ok) throw new S3RequestError('PUT', response.status, await response.text())
    },

    async get(key): Promise<StoredObject | null> {
      const response = await send(urlFor(key), { method: 'GET' })
      if (response.status === 404) return null
      if (!response.ok) throw new S3RequestError('GET', response.status, await response.text())
      const size = Number(response.headers.get('content-length') ?? '0')
      const body = response.body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() })
      return { body: body as ReadableStream<Uint8Array>, size }
    },

    async delete(key) {
      const response = await send(urlFor(key), { method: 'DELETE' })
      // S3 returns 204 for a delete whether or not the key existed; 404 is what some compatible
      // stores return instead. Both are success, because `delete` is idempotent by contract.
      if (response.ok || response.status === 404) return
      throw new S3RequestError('DELETE', response.status, await response.text())
    },

    async health() {
      const response = await send(bucketUrl(), { method: 'HEAD' })
      if (!response.ok) throw new S3RequestError('HEAD', response.status, await response.text())
    },
  }
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.buffer
}
