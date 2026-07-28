import type { GithubRestClient } from './reconcile.js'

// The single boundary between `GET /pulls/{n}/files` and everything downstream.
//
// That endpoint returns a `patch` field per file WHETHER OR NOT IT IS ASKED FOR, alongside
// `blob_url`, `raw_url` and `contents_url` — GitHub documents no parameter that suppresses them. So
// dropping them is this file's job, and it happens HERE, at the seam, before any value is returned
// to a caller: not downstream, not before the prompt. Putting patch content in front of a model was
// explicitly declined (it would need a secret scanner that does not exist in-stack, and it would
// invert the shipped "worst case is a bad paragraph, never a leak" guarantee). Do not reintroduce it.

// The per-cycle call cap. A CONSTANT, not an env var, following the scheduler's stated rule that
// everything an operator would plausibly turn is one — and this is a safety bound on a shared rate
// budget, not a preference.
export const MAX_PR_FILE_CALLS = 50

// Reconciliation is the connector's load-bearing sweep. A digest must never be the thing that
// starves it, so enrichment stops for the rest of a run below this remaining quota.
export const RATE_LIMIT_FLOOR = 500

// One page, the maximum GitHub allows. No pagination: a PR touching more than 100 files is already
// "big and everywhere", and paginating to the documented 3000-file ceiling to refine a label that
// coarse is not worth the quota. A full page is REPORTED as truncation rather than passed off as the
// whole set — see `ChangedFilesResult.truncated`.
export const FILES_PER_PAGE = 100

// A CLOSED three-field type. There is no field capable of holding patch content, so a later change
// that tried to carry it would fail to compile rather than fail quietly.
export interface ChangedFile {
  readonly path: string
  readonly status: string
  readonly changes: number
}

// The ONLY constructor of `ChangedFile`. Every field is named explicitly, so a wider response object
// (which is what octokit actually returns) contributes exactly these three values and nothing else.
export function projectChangedFile(entry: {
  filename: string
  status: string
  changes: number
}): ChangedFile {
  return { path: entry.filename, status: entry.status, changes: entry.changes }
}

export interface ChangedFilesResult {
  readonly files: readonly ChangedFile[]
  // The installation's reported remaining primary-rate-limit quota, or null when the provider did
  // not report one. The caller stops enriching below `RATE_LIMIT_FLOOR`.
  readonly rateLimitRemaining: number | null
  // True when the response filled the single page yapm asks for, so `files` is a PREFIX of what the
  // pull request touched. Carried rather than swallowed: a caller that presented a partial file set
  // as complete would under-map an area a file past the page boundary is the only one to touch.
  readonly truncated: boolean
}

export async function listChangedFiles(
  client: GithubRestClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<ChangedFilesResult> {
  const response = await client.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: FILES_PER_PAGE,
  })
  const remaining = response.headers['x-ratelimit-remaining']
  const parsed = remaining === undefined ? Number.NaN : Number.parseInt(remaining, 10)
  return {
    // Projected BEFORE returning, so no caller can ever hold an unprojected entry.
    files: response.data.map(projectChangedFile),
    rateLimitRemaining: Number.isNaN(parsed) ? null : parsed,
    truncated: response.data.length >= FILES_PER_PAGE,
  }
}

export interface ChangedFilesRequest {
  externalInstallationId: string
  // The provider's full name, `owner/repo`, exactly as `pull_request.repo` stores it.
  repoFullName: string
  number: number
}

// The narrow accessor non-connector callers (the digest job) get. It hands back projected metadata
// and never an octokit client, so octokit stays inside `connectors/github`.
export type ChangedFilesReader = (request: ChangedFilesRequest) => Promise<ChangedFilesResult>

export function splitRepoFullName(repoFullName: string): { owner: string; repo: string } | null {
  const parts = repoFullName.split('/')
  const owner = parts[0]
  const repo = parts[1]
  if (parts.length !== 2 || !owner || !repo) return null
  return { owner, repo }
}
