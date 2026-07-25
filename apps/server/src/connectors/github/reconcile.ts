import {
  type ConnectorContext,
  type InstallationRecord,
  newId,
  parseIssueRefs,
  type WorkGraphMutation,
} from '@yapm/schema'
import { derivePrState, GITHUB_PROVIDER, mapCiConclusion, mapReviewState } from './map.js'
import type { GithubPullRequest, GithubReview } from './payloads.js'

// The subset of the octokit REST surface the reconcile sweep uses. A recorded/mocked client
// satisfies it structurally, so reconciliation is tested with zero network I/O.
export interface GithubRestResponse<T> {
  status: number
  headers: { etag?: string | undefined }
  data: T
}

interface RestCheckRun {
  id: number
  name?: string | null
  status: string
  conclusion?: string | null
  head_sha?: string | null
}

export interface GithubRestClient {
  rest: {
    pulls: {
      list(params: {
        owner: string
        repo: string
        state: 'all'
        sort: 'updated'
        direction: 'desc'
        per_page: number
        headers: Record<string, string>
      }): Promise<GithubRestResponse<GithubPullRequest[]>>
      listReviews(params: {
        owner: string
        repo: string
        pull_number: number
      }): Promise<GithubRestResponse<GithubReview[]>>
    }
    checks: {
      listForRef(params: {
        owner: string
        repo: string
        ref: string
      }): Promise<GithubRestResponse<{ check_runs: RestCheckRun[] }>>
    }
  }
}

// octokit may surface a conditional-request `304 Not Modified` either as a thrown RequestError
// or a normal response; both are handled (reference §3.4). A thrown 304 means "unchanged".
export function isNotModified(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 304
}

function toEpochMs(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

// The safety net: re-poll each mapped repo's PRs (most-recently-updated first, including
// closed/merged so terminal drift — e.g. a missed merge — is corrected) with the stored ETag
// (a `304` costs no rate-limit budget and yields no mutations), and on a change re-derive
// PR + CI + review state. This also serves as the first-install backfill, since webhooks are
// future-only. Mutations carry the INTERNAL installation id (`installation.id`), so the caller
// applies them directly. Callers drive one repo at a time (a single-entry `repoMapping`) so
// every emitted PR/deploy lands in that repo's mapped team.
export async function reconcileInstallation(
  installation: InstallationRecord,
  ctx: ConnectorContext,
): Promise<WorkGraphMutation[]> {
  const client = ctx.client as GithubRestClient
  const mutations: WorkGraphMutation[] = []
  const now = Date.now()

  for (const repoFullName of Object.keys(installation.repoMapping)) {
    const slash = repoFullName.indexOf('/')
    if (slash <= 0) continue
    const owner = repoFullName.slice(0, slash)
    const repo = repoFullName.slice(slash + 1)
    const resource = `pulls:${repoFullName}`
    const etag = await ctx.getEtag(resource)

    let response: GithubRestResponse<GithubPullRequest[]>
    try {
      response = await client.rest.pulls.list({
        owner,
        repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
        headers: etag ? { 'if-none-match': etag } : {},
      })
    } catch (error) {
      if (isNotModified(error)) continue
      throw error
    }
    if (response.status === 304) continue
    if (response.headers.etag) await ctx.setEtag(resource, response.headers.etag)

    for (const pr of response.data) {
      const externalId = String(pr.id)
      const headSha = pr.head?.sha ?? null
      mutations.push({
        kind: 'upsertPullRequest',
        id: newId(),
        installationId: installation.id,
        provider: GITHUB_PROVIDER,
        repo: repoFullName,
        number: pr.number,
        externalId,
        title: pr.title ?? null,
        state: derivePrState(pr),
        url: pr.html_url ?? null,
        headSha,
        openedAt: toEpochMs(pr.created_at, now),
        mergedAt: pr.merged_at ? toEpochMs(pr.merged_at, now) : null,
        updatedAt: toEpochMs(pr.updated_at, now),
        issueRefs: parseIssueRefs({ branch: pr.head?.ref, body: pr.body }),
      })

      if (headSha) {
        const checks = await client.rest.checks.listForRef({ owner, repo, ref: headSha })
        for (const run of checks.data.check_runs) {
          mutations.push({
            kind: 'upsertCiCheck',
            id: newId(),
            installationId: installation.id,
            provider: GITHUB_PROVIDER,
            prExternalId: externalId,
            externalId: String(run.id),
            name: run.name ?? null,
            conclusion: mapCiConclusion(run.status, run.conclusion),
            headSha: run.head_sha ?? headSha,
          })
        }
      }

      const reviews = await client.rest.pulls.listReviews({ owner, repo, pull_number: pr.number })
      for (const review of reviews.data) {
        mutations.push({
          kind: 'upsertReview',
          id: newId(),
          installationId: installation.id,
          provider: GITHUB_PROVIDER,
          prExternalId: externalId,
          externalId: String(review.id),
          author: review.user?.login ?? null,
          state: mapReviewState(review.state),
          submittedAt: toEpochMs(review.submitted_at, now),
        })
      }
    }
  }

  return mutations
}
