import { describe, expect, it } from 'vitest'
import {
  type ChangedFile,
  FILES_PER_PAGE,
  listChangedFiles,
  MAX_PR_FILE_CALLS,
  projectChangedFile,
  RATE_LIMIT_FLOOR,
  splitRepoFullName,
} from './files.js'
import type { GithubRestClient } from './reconcile.js'

// What `GET /pulls/{n}/files` ACTUALLY returns. `patch`, `blob_url`, `raw_url` and `contents_url`
// come back whether or not they are asked for and GitHub documents no parameter that suppresses
// them, so the mock returns them: a mock that omitted `patch` would prove nothing about the seam.
interface RestFileEntry {
  filename: string
  status: string
  changes: number
  additions: number
  deletions: number
  sha: string
  patch: string
  blob_url: string
  raw_url: string
  contents_url: string
}

const PATCH_TEXT =
  '@@ -1,4 +1,4 @@\n-const REFUND_WINDOW_DAYS = 30\n+const REFUND_WINDOW_DAYS = 14\n'

const DROPPED_VALUES = [
  PATCH_TEXT,
  'REFUND_WINDOW_DAYS',
  '@@ -1,4 +1,4 @@',
  'https://github.com/acme/shop/blob/abc123/apps/server/src/billing/refund.ts',
  'https://github.com/acme/shop/raw/abc123/apps/server/src/billing/refund.ts',
  'https://api.github.com/repos/acme/shop/contents/apps/server/src/billing/refund.ts',
  'abc123def456',
]

function entry(overrides: Partial<RestFileEntry> = {}): RestFileEntry {
  return {
    filename: 'apps/server/src/billing/refund.ts',
    status: 'modified',
    changes: 8,
    additions: 5,
    deletions: 3,
    sha: 'abc123def456',
    patch: PATCH_TEXT,
    blob_url: 'https://github.com/acme/shop/blob/abc123/apps/server/src/billing/refund.ts',
    raw_url: 'https://github.com/acme/shop/raw/abc123/apps/server/src/billing/refund.ts',
    contents_url:
      'https://api.github.com/repos/acme/shop/contents/apps/server/src/billing/refund.ts',
    ...overrides,
  }
}

interface Recorded {
  owner: string
  repo: string
  pull_number: number
  per_page: number
}

function mockClient(
  data: RestFileEntry[],
  headers: { 'x-ratelimit-remaining'?: string } = {},
): { client: GithubRestClient; calls: Recorded[] } {
  const calls: Recorded[] = []
  const client = {
    rest: {
      pulls: {
        listFiles: (params: Recorded) => {
          calls.push(params)
          return Promise.resolve({ status: 200, headers, data })
        },
      },
    },
  } as unknown as GithubRestClient
  return { client, calls }
}

describe('projectChangedFile — the only constructor of ChangedFile', () => {
  it('keeps exactly path, status and changes from a much wider response object', () => {
    const projected = projectChangedFile(entry())
    expect(Object.keys(projected).sort()).toEqual(['changes', 'path', 'status'])
    expect(projected).toStrictEqual<ChangedFile>({
      path: 'apps/server/src/billing/refund.ts',
      status: 'modified',
      changes: 8,
    })
  })

  it('serializes with none of the dropped values anywhere in it', () => {
    const serialized = JSON.stringify(projectChangedFile(entry()))
    for (const value of DROPPED_VALUES) expect(serialized).not.toContain(value)
    expect(serialized).not.toContain('patch')
    expect(serialized).not.toContain('blob_url')
    expect(serialized).not.toContain('raw_url')
    expect(serialized).not.toContain('contents_url')
    expect(serialized).not.toContain('additions')
    expect(serialized).not.toContain('deletions')
    expect(serialized).not.toContain('sha')
  })
})

describe('listChangedFiles — the projection happens AT the seam', () => {
  it('drops patch content and every blob/raw/contents url before returning', async () => {
    const { client } = mockClient([
      entry(),
      entry({ filename: 'apps/web/src/settings/ai-view.tsx', status: 'added', changes: 120 }),
    ])
    const result = await listChangedFiles(client, 'acme', 'shop', 482)

    expect(result.files).toHaveLength(2)
    for (const file of result.files) {
      expect(Object.keys(file).sort()).toEqual(['changes', 'path', 'status'])
    }
    // The whole result, serialized: nothing the projection dropped can be anywhere in it.
    const serialized = JSON.stringify(result)
    for (const value of DROPPED_VALUES) expect(serialized).not.toContain(value)
    expect(serialized).not.toContain('patch')
    expect(serialized).not.toContain('@@')
    // The paths themselves DO survive the seam — they are converted to area labels one layer up.
    expect(result.files.map((file) => file.path)).toEqual([
      'apps/server/src/billing/refund.ts',
      'apps/web/src/settings/ai-view.tsx',
    ])
  })

  it('asks for one page of the maximum size and nothing else', async () => {
    const { client, calls } = mockClient([entry()])
    await listChangedFiles(client, 'acme', 'shop', 482)
    expect(calls).toEqual([{ owner: 'acme', repo: 'shop', pull_number: 482, per_page: 100 }])
  })

  it('reports the observed remaining quota, or null when the provider sent none', async () => {
    const withHeader = mockClient([entry()], { 'x-ratelimit-remaining': '4321' })
    expect((await listChangedFiles(withHeader.client, 'a', 'b', 1)).rateLimitRemaining).toBe(4321)

    const noHeader = mockClient([entry()])
    expect((await listChangedFiles(noHeader.client, 'a', 'b', 1)).rateLimitRemaining).toBeNull()

    const garbage = mockClient([entry()], { 'x-ratelimit-remaining': 'not-a-number' })
    expect((await listChangedFiles(garbage.client, 'a', 'b', 1)).rateLimitRemaining).toBeNull()

    const zero = mockClient([entry()], { 'x-ratelimit-remaining': '0' })
    expect((await listChangedFiles(zero.client, 'a', 'b', 1)).rateLimitRemaining).toBe(0)
  })

  it('returns an empty file list for a PR that touched nothing', async () => {
    const { client } = mockClient([])
    expect((await listChangedFiles(client, 'a', 'b', 1)).files).toEqual([])
  })

  // yapm reads ONE page. Saying so is the difference between a coarse label and a wrong one: an area
  // touched only by the 101st file is invisible, so the caller has to know the view is a prefix.
  it('reports truncation when the response fills the single page it asks for', async () => {
    const full = Array.from({ length: FILES_PER_PAGE }, (_, index) =>
      entry({ filename: `apps/server/src/billing/file-${index}.ts` }),
    )
    expect((await listChangedFiles(mockClient(full).client, 'a', 'b', 1)).truncated).toBe(true)

    const short = full.slice(0, FILES_PER_PAGE - 1)
    expect((await listChangedFiles(mockClient(short).client, 'a', 'b', 1)).truncated).toBe(false)
    expect((await listChangedFiles(mockClient([]).client, 'a', 'b', 1)).truncated).toBe(false)
  })
})

describe('the enrichment bounds and repo-name split', () => {
  it('caps calls per cycle and floors the shared rate budget', () => {
    expect(MAX_PR_FILE_CALLS).toBe(50)
    expect(RATE_LIMIT_FLOOR).toBe(500)
  })

  it('splits owner/repo and refuses anything else', () => {
    expect(splitRepoFullName('acme/shop')).toEqual({ owner: 'acme', repo: 'shop' })
    for (const invalid of ['acme', 'acme/', '/shop', 'acme/shop/extra', '']) {
      expect(splitRepoFullName(invalid)).toBeNull()
    }
  })
})
