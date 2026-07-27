import { describe, expect, it } from 'vitest'
import { InvalidStorageKeyError } from './provider.js'
import { createS3StorageProvider, type FetchLike, S3RequestError } from './s3.js'
import { REJECTED_KEYS, VALID_KEY } from './traversal.js'

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

interface Call {
  url: string
  method: string
  headers: Record<string, string>
}

function recorder(respond: (call: Call) => Response): { calls: Call[]; fetch: FetchLike } {
  const calls: Call[] = []
  const fetch: FetchLike = (input, init) => {
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value
    })
    const call = { url: input, method: init.method ?? 'GET', headers }
    calls.push(call)
    return Promise.resolve(respond(call))
  }
  return { calls, fetch }
}

const OPTIONS = {
  bucket: 'yapm-files',
  region: 'eu-central-1',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
}

describe('s3 storage provider', () => {
  it('round-trips put/get/delete over the injected fetch, signed, with no network call', async () => {
    const stored = new Map<string, Uint8Array>()
    const { calls, fetch } = recorder((call) => {
      if (call.method === 'PUT') {
        stored.set(call.url, BYTES)
        return new Response(null, { status: 200 })
      }
      if (call.method === 'DELETE') {
        stored.delete(call.url)
        return new Response(null, { status: 204 })
      }
      const body = stored.get(call.url)
      if (body === undefined) return new Response('', { status: 404 })
      return new Response(body, {
        status: 200,
        headers: { 'content-length': String(body.byteLength) },
      })
    })
    const provider = createS3StorageProvider({ ...OPTIONS, fetch })

    await provider.put(VALID_KEY, BYTES, 'image/png')
    const object = await provider.get(VALID_KEY)
    expect(object?.size).toBe(BYTES.byteLength)
    await provider.delete(VALID_KEY)
    expect(await provider.get(VALID_KEY)).toBeNull()

    // Every request carries a SigV4 Authorization header, computed by aws4fetch and handed to the
    // injected fetch — the credentials never leave this process and no socket is opened.
    expect(calls.length).toBe(4)
    for (const call of calls) {
      expect(call.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//)
      // NEVER a signed query string. `X-Amz-Signature` in a URL is what a presigner emits, and this
      // seam has no member that could return one.
      expect(call.url).not.toContain('X-Amz-Signature')
      expect(call.url).not.toContain('X-Amz-Expires')
    }
  })

  it('addresses virtual-host style by default and path style on request', async () => {
    const virtual = recorder(() => new Response(null, { status: 204 }))
    await createS3StorageProvider({ ...OPTIONS, fetch: virtual.fetch }).delete(VALID_KEY)
    expect(virtual.calls[0]?.url).toBe(
      `https://yapm-files.s3.eu-central-1.amazonaws.com/${VALID_KEY}`,
    )

    // R2/B2/Garage/MinIO: a custom endpoint, optionally path style.
    const path = recorder(() => new Response(null, { status: 204 }))
    await createS3StorageProvider({
      ...OPTIONS,
      endpoint: 'https://minio.internal:9000/',
      forcePathStyle: true,
      fetch: path.fetch,
    }).delete(VALID_KEY)
    expect(path.calls[0]?.url).toBe(`https://minio.internal:9000/yapm-files/${VALID_KEY}`)
  })

  it('returns null for a 404 get and treats a 404 delete as success', async () => {
    const { fetch } = recorder(() => new Response('<Error/>', { status: 404 }))
    const provider = createS3StorageProvider({ ...OPTIONS, fetch })

    expect(await provider.get(VALID_KEY)).toBeNull()
    await expect(provider.delete(VALID_KEY)).resolves.toBeUndefined()
  })

  it('throws a typed error carrying status and body on any other non-2xx', async () => {
    const { fetch } = recorder(() => new Response('AccessDenied', { status: 403 }))
    const provider = createS3StorageProvider({ ...OPTIONS, fetch })

    await expect(provider.put(VALID_KEY, BYTES, 'image/png')).rejects.toBeInstanceOf(S3RequestError)
    await expect(provider.get(VALID_KEY)).rejects.toMatchObject({
      status: 403,
      body: 'AccessDenied',
    })
    await expect(provider.health()).rejects.toBeInstanceOf(S3RequestError)
  })

  // The same table as the local provider's, because the two are peers: a key one refuses must be a
  // key the other refuses, before either does any work. Asserting the injected fetch was NEVER
  // invoked is what makes "before" checkable rather than asserted.
  it.each(REJECTED_KEYS)('rejects %j before building a request', async (key) => {
    const { calls, fetch } = recorder(() => new Response(null, { status: 200 }))
    const provider = createS3StorageProvider({ ...OPTIONS, fetch })

    await expect(provider.put(key, BYTES, 'image/png')).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    )
    await expect(provider.get(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)
    await expect(provider.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)

    expect(calls).toEqual([])
  })

  it('probes the bucket with HEAD in health', async () => {
    const { calls, fetch } = recorder(() => new Response(null, { status: 200 }))
    await createS3StorageProvider({ ...OPTIONS, fetch }).health()

    expect(calls[0]?.method).toBe('HEAD')
    expect(calls[0]?.url).toBe('https://yapm-files.s3.eu-central-1.amazonaws.com/')
  })
})
