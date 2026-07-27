import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { type StorageProvider, type StoredObject, validateKey } from './provider.js'

export interface LocalStorageOptions {
  dir: string
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  )
}

// The DEFAULT provider, and complete on its own — not a fallback. A self-hoster with no object
// store gets every attachment feature, which is what CLAUDE.md #1's three containers actually
// requires: MinIO-as-a-prerequisite is how the alternatives bloat their compose file.
export function createLocalStorageProvider(options: LocalStorageOptions): StorageProvider {
  const root = options.dir

  const pathFor = (key: string): string => {
    // FIRST, before any path is joined. `join` happily resolves `..`, so validation must precede
    // it — this is the whole traversal defence, and it is an allowlist.
    validateKey(key)
    return join(root, key)
  }

  return {
    kind: 'local',

    async put(key, body, _contentType) {
      const path = pathFor(key)
      await mkdir(dirname(path), { recursive: true })
      // Write to a temporary name IN THE SAME DIRECTORY and rename, so a crashed or aborted upload
      // leaves no half file for a later read to serve as a truncated image. Same directory because
      // `rename` across filesystems is not atomic (and on some mounts, not possible).
      const temp = `${path}.${process.pid}.${Date.now()}.part`
      try {
        if (body instanceof Uint8Array) {
          await writeFile(temp, body)
        } else {
          const handle = await open(temp, 'w')
          try {
            await handle.writeFile(Readable.fromWeb(body))
          } finally {
            await handle.close()
          }
        }
        await rename(temp, path)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
    },

    async get(key): Promise<StoredObject | null> {
      const path = pathFor(key)
      let size: number
      try {
        size = (await stat(path)).size
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
      // Streamed rather than read: the route pipes this to the response body.
      const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
      return { body: stream, size }
    },

    async delete(key) {
      const path = pathFor(key)
      try {
        await unlink(path)
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    },

    // Write, read back, unlink. A read-only or missing mount therefore fails `/readyz` AT BOOT
    // rather than at somebody's first upload — which is the failure mode a container with no
    // persistent volume actually has.
    async health() {
      await mkdir(root, { recursive: true })
      const probe = join(root, `.health-${process.pid}`)
      const payload = new Uint8Array([0x79, 0x61, 0x70, 0x6d])
      try {
        await writeFile(probe, payload)
        const { size } = await stat(probe)
        if (size !== payload.length) {
          throw new Error(`storage probe wrote ${payload.length} bytes and read back ${size}`)
        }
      } finally {
        await rm(probe, { force: true })
      }
    },
  }
}
