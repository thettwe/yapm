import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// THE ABSENCE THIS CHANGE DEPENDS ON, ASSERTED RATHER THAN REASONED ABOUT — structured like
// `apps/server/src/search/isolation.test.ts`, for the same reason it exists.
//
// An `<img src>` lives in a document that syncs via Zero. Whatever string sits in that node
// replicates to every team member's IndexedDB and persists as long as the document does. A signed
// URL there is a bearer capability at rest on every client, permanently broken the moment it
// expires, and re-signing it means rewriting `issue.description` on a timer.
//
// The scope predicted exactly how this gets undone: somebody adds `StorageProvider.getUrl()` "just
// for S3", or writes a `src` into the document "so the renderer is simpler". Either silently turns
// every attachment into a bearer capability replicated to every client — AND IT WOULD PASS REVIEW,
// because the code looks clean. So the mitigation cannot be review.
//
// Rule (b) is the one that matters. (a) and (c) catch the words; (b) catches the idea.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const STORAGE_DIR = join(repoRoot, 'apps/server/src/storage')
const PROVIDER_MODULE = join(STORAGE_DIR, 'provider.ts')

// The `StorageProvider` interface's members, exactly, in declaration order. Adding one fails,
// whatever it is called.
const ALLOWED_MEMBERS = ['kind', 'put', 'get', 'delete', 'health']

const CAPABILITY_WORDS = [
  'presign',
  'signedUrl',
  'getSignedUrl',
  'createPresignedUrl',
  'X-Amz-Signature',
  'getUrl',
]

// Where change 17 will add the TipTap image node. The guard is in place BEFORE the code it guards
// exists, which is the only time it is cheap.
const RICH_TEXT_DIRS = [
  join(repoRoot, 'packages/schema/src/rich-text'),
  join(repoRoot, 'packages/ui/src/editor'),
]

function typescriptFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return typescriptFilesIn(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

// Parsed out of the SOURCE, not read off the type: a type-level check would be satisfied by any
// interface with these five members and would say nothing about a sixth.
function declaredMembers(): string[] {
  const source = readFileSync(PROVIDER_MODULE, 'utf8')
  const body = /export interface StorageProvider \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? ''
  return [...body.matchAll(/^\s{2}(?:readonly\s+)?(\w+)\s*[?]?\s*:/gm)].map(
    (match) => match[1] ?? '',
  )
}

describe('the storage seam can never mint a capability (task 8.1)', () => {
  // Without this the parse could silently return nothing and every assertion below would pass on an
  // empty promise — the isolation test's precedent, and the failure mode a regex guard actually has.
  it('derives a non-empty member list from provider.ts source', () => {
    const members = declaredMembers()
    expect(members.length).toBeGreaterThan(0)
    expect(members).toContain('put')
    expect(members).toContain('get')
  })

  // (b) THE ASSERTION THAT CATCHES THE IDEA. A `getUrl()`, a `presign()`, a `signedUrlFor()` or
  // anything else that could hand a caller a string a browser can fetch without a session fails
  // here on the day it is written, whatever name it is given.
  it('declares exactly kind, put, get, delete, health — and nothing else', () => {
    expect(declaredMembers()).toEqual(ALLOWED_MEMBERS)
  })

  // (a) The words, for the paths that are not the interface itself: a helper in `s3.ts`, a
  // `signQuery: true`, an `X-Amz-Signature` in a URL builder.
  //
  // SHIPPED SOURCE ONLY, `.test.ts` excluded — a test that asserts a signed query string is NEVER
  // produced has to name the thing it is asserting the absence of, and this file is the extreme
  // case of that. The invariant is about what the server can do, not about what its tests can say.
  it('names no presigning symbol anywhere in shipped storage source', () => {
    const files = typescriptFilesIn(STORAGE_DIR).filter((file) => !/\.test\.tsx?$/.test(file))
    // A guard over an empty directory is a guard that proves nothing.
    expect(files.length).toBeGreaterThanOrEqual(6)

    const offenders = files
      .map((file) => ({
        file: relative(repoRoot, file),
        words: CAPABILITY_WORDS.filter((word) =>
          new RegExp(`\\b${word}\\b`, 'i').test(readFileSync(file, 'utf8')),
        ),
      }))
      .filter((entry) => entry.words.length > 0)

    expect(offenders).toEqual([])
  })

  // (c) No stored image node may carry an absolute URL — because a URL in a synced document is the
  // capability-at-rest this whole design refuses. The renderer computes `/api/v1/files/<id>` from
  // an opaque id; there is nothing to store but the id.
  it('puts no http(s) URL in a rich-text or editor attribute, before change 17 writes the node', () => {
    const files = RICH_TEXT_DIRS.flatMap(typescriptFilesIn)
    // These directories are allowed not to exist yet; when they do, they are scanned.
    const offenders = files
      .map((file) => ({
        file: relative(repoRoot, file),
        // An attribute assignment or object key whose value is an absolute URL. A bare `http` in a
        // comment or in an XML namespace string is not what this is about.
        hits: [...readFileSync(file, 'utf8').matchAll(/(\w+)\s*[:=]\s*['"`]https?:\/\//g)].map(
          (match) => match[1] ?? '',
        ),
      }))
      .filter((entry) => entry.hits.length > 0)

    expect(offenders).toEqual([])
  })
})
