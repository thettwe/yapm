import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalStorageProvider } from './local.js'
import { InvalidStorageKeyError } from './provider.js'
import { REJECTED_KEYS, TEAM_ID, VALID_KEY, VALID_THUMB_KEY } from './traversal.js'

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return new Uint8Array(chunks.flatMap((chunk) => [...chunk]))
}

describe('local storage provider', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yapm-storage-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips put/get/delete for both the object and its thumbnail', async () => {
    const provider = createLocalStorageProvider({ dir })

    await provider.put(VALID_KEY, BYTES, 'image/png')
    await provider.put(VALID_THUMB_KEY, BYTES, 'image/webp')

    const stored = await provider.get(VALID_KEY)
    expect(stored?.size).toBe(BYTES.byteLength)
    expect([...(await drain(stored?.body as ReadableStream<Uint8Array>))]).toEqual([...BYTES])

    await provider.delete(VALID_KEY)
    expect(await provider.get(VALID_KEY)).toBeNull()
    // The thumbnail is a separate object and is untouched by deleting the original.
    expect((await provider.get(VALID_THUMB_KEY))?.size).toBe(BYTES.byteLength)
  })

  it('accepts a ReadableStream body', async () => {
    const provider = createLocalStorageProvider({ dir })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(BYTES.slice(0, 4))
        controller.enqueue(BYTES.slice(4))
        controller.close()
      },
    })

    await provider.put(VALID_KEY, stream, 'image/png')

    const stored = await provider.get(VALID_KEY)
    expect([...(await drain(stored?.body as ReadableStream<Uint8Array>))]).toEqual([...BYTES])
  })

  it('returns null for a missing key rather than throwing', async () => {
    const provider = createLocalStorageProvider({ dir })
    expect(await provider.get(VALID_KEY)).toBeNull()
  })

  // The GC sweep must be safely re-runnable, and a partial failure must not need a reconciliation
  // table — which is only true if deleting an absent key is a success.
  it('deletes idempotently', async () => {
    const provider = createLocalStorageProvider({ dir })
    await provider.put(VALID_KEY, BYTES, 'image/png')
    await provider.delete(VALID_KEY)
    await expect(provider.delete(VALID_KEY)).resolves.toBeUndefined()
    await expect(provider.delete(VALID_THUMB_KEY)).resolves.toBeUndefined()
  })

  // The whole traversal defence, and it must bite BEFORE the filesystem: `join` resolves `..`
  // happily, so a validation that ran after it would have already escaped the root.
  it.each(REJECTED_KEYS)('rejects %j before touching the filesystem', async (key) => {
    const provider = createLocalStorageProvider({ dir })

    await expect(provider.put(key, BYTES, 'image/png')).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    )
    await expect(provider.get(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)
    await expect(provider.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)

    // Nothing was created, anywhere under the root — not even the team shard directory.
    expect(await readdir(dir)).toEqual([])
  })

  it('leaves no partial file behind when a stream body fails mid-write', async () => {
    const provider = createLocalStorageProvider({ dir })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(BYTES)
        controller.error(new Error('client went away'))
      },
    })

    await expect(provider.put(VALID_KEY, stream, 'image/png')).rejects.toThrow()

    // The write goes to a temporary name and is renamed, so an aborted upload leaves neither the
    // real key nor a `.part` file a later read could serve as a truncated image.
    expect(await provider.get(VALID_KEY)).toBeNull()
    expect(await readdir(join(dir, TEAM_ID))).toEqual([])
  })

  it('probes the directory in health, and fails when it is not writable', async () => {
    await expect(createLocalStorageProvider({ dir }).health()).resolves.toBeUndefined()
    // Left clean: a probe that leaks a file would eventually fill a small VPS one readiness check
    // at a time.
    expect(await readdir(dir)).toEqual([])

    // A FILE where the directory should be: `mkdir` fails, which is the same class of failure as a
    // read-only or absent mount and is what must take an instance out of rotation at boot.
    const blocked = join(dir, 'blocked')
    await writeFile(blocked, 'not a directory')
    await expect(
      createLocalStorageProvider({ dir: join(blocked, 'files') }).health(),
    ).rejects.toThrow()
  })
})
