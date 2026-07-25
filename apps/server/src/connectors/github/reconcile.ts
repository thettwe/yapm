import {
  type ConnectorContext,
  type InstallationRecord,
  newId,
  parseIssueRefs,
  type WorkGraphMutation,
} from '@yapm/schema'
import {
  derivePrState,
  GITHUB_PROVIDER,
  mapCiConclusion,
  mapDeploymentState,
  mapReviewState,
} from './map.js'
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

interface RestDeployment {
  id: number
  ref?: string | null
  environment?: string | null
  sha?: string | null
}

interface RestDeploymentStatus {
  state: string
  environment?: string | null
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
    repos: {
      listDeployments(params: {
        owner: string
        repo: string
        per_page: number
        headers: Record<string, string>
      }): Promise<GithubRestResponse<RestDeployment[]>>
      listDeploymentStatuses(params: {
        owner: string
        repo: string
        deployment_id: number
        per_page: number
      }): Promise<GithubRestResponse<RestDeploymentStatus[]>>
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
// closed/merged so terminal drift — e.g. a missed merge — is corrected) and its deployments,
// each gated by its own stored ETag (a `304` costs no rate-limit budget and yields no
// mutations). On a PR change re-derive PR + CI + review state; on a deployment change re-derive
// deployment state from its latest status. This also serves as the first-install backfill,
// since webhooks are future-only, so a dropped `deployment_status` delivery is healed and
// pre-install deployments are populated. Mutations carry the INTERNAL installation id
// (`installation.id`), so the caller applies them directly. Callers drive one repo at a time (a
// single-entry `repoMapping`) so every emitted PR/deploy lands in that repo's mapped team.
// A conditional GET whose stored ETag is refreshed on a fresh 200 and whose `null` return means
// "unchanged" (a `304` returned as a response OR thrown as a RequestError — both handled). Pulls
// and deployments each carry their own ETag, so an unchanged PR list never suppresses a changed
// deployment poll (and vice-versa).
async function conditionalGet<T>(
  ctx: ConnectorContext,
  resource: string,
  fetch: (headers: Record<string, string>) => Promise<GithubRestResponse<T>>,
): Promise<GithubRestResponse<T> | null> {
  const etag = await ctx.getEtag(resource)
  let response: GithubRestResponse<T>
  try {
    response = await fetch(etag ? { 'if-none-match': etag } : {})
  } catch (error) {
    if (isNotModified(error)) return null
    throw error
  }
  if (response.status === 304) return null
  if (response.headers.etag) await ctx.setEtag(resource, response.headers.etag)
  return response
}

async function reconcilePulls(
  installation: InstallationRecord,
  ctx: ConnectorContext,
  client: GithubRestClient,
  owner: string,
  repo: string,
  repoFullName: string,
  now: number,
  mutations: WorkGraphMutation[],
): Promise<void> {
  const response = await conditionalGet(ctx, `pulls:${repoFullName}`, (headers) =>
    client.rest.pulls.list({
      owner,
      repo,
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
      headers,
    }),
  )
  if (!response) return

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

async function reconcileDeployments(
  installation: InstallationRecord,
  ctx: ConnectorContext,
  client: GithubRestClient,
  owner: string,
  repo: string,
  repoFullName: string,
  mutations: WorkGraphMutation[],
): Promise<void> {
  const response = await conditionalGet(ctx, `deployments:${repoFullName}`, (headers) =>
    client.rest.repos.listDeployments({ owner, repo, per_page: 100, headers }),
  )
  if (!response) return

  for (const deployment of response.data) {
    const statuses = await client.rest.repos.listDeploymentStatuses({
      owner,
      repo,
      deployment_id: deployment.id,
      per_page: 1,
    })
    const latest = statuses.data[0]
    mutations.push({
      kind: 'upsertDeployment',
      id: newId(),
      installationId: installation.id,
      provider: GITHUB_PROVIDER,
      repo: repoFullName,
      externalId: String(deployment.id),
      ref: deployment.ref ?? null,
      environment: latest?.environment ?? deployment.environment ?? null,
      state: latest ? mapDeploymentState(latest.state) : 'pending',
    })
  }
}

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

    await reconcilePulls(installation, ctx, client, owner, repo, repoFullName, now, mutations)
    await reconcileDeployments(installation, ctx, client, owner, repo, repoFullName, mutations)
  }

  return mutations
}
