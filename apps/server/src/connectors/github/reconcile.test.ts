import type { ConnectorContext, InstallationRecord } from '@yapm/schema'
import { describe, expect, it, vi } from 'vitest'
import type { GithubRestClient, GithubRestResponse } from './reconcile.js'
import { reconcileInstallation } from './reconcile.js'

const RECORD: InstallationRecord = {
  id: 'inst-internal',
  externalInstallationId: '42',
  repoMapping: { 'acme/app': 'team-1' },
}

function response<T>(over: Partial<GithubRestResponse<T>> & { data: T }): GithubRestResponse<T> {
  return { status: 200, headers: {}, ...over }
}

function ctxWith(client: GithubRestClient, etags = new Map<string, string>()): ConnectorContext {
  return {
    client,
    getEtag: (resource) => Promise.resolve(etags.get(resource) ?? null),
    setEtag: (resource, etag) => {
      etags.set(resource, etag)
      return Promise.resolve()
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

describe('reconcileInstallation', () => {
  it('re-derives PR + CI + review state on a 200 and stores the new ETag', async () => {
    const client: GithubRestClient = {
      rest: {
        pulls: {
          list: vi.fn().mockResolvedValue(
            response({
              headers: { etag: 'W/"fresh"' },
              data: [
                {
                  id: 5001,
                  number: 12,
                  title: 'Fix',
                  state: 'open',
                  draft: false,
                  html_url: 'https://x/12',
                  body: 'Closes ENG-1',
                  created_at: '2026-07-20T10:00:00Z',
                  head: { sha: 'sha1', ref: 'eng-1-fix' },
                },
              ],
            }),
          ),
          listReviews: vi.fn().mockResolvedValue(
            response({
              data: [
                {
                  id: 9001,
                  state: 'APPROVED',
                  submitted_at: '2026-07-20T14:00:00Z',
                  user: { login: 'jane' },
                },
              ],
            }),
          ),
        },
        checks: {
          listForRef: vi.fn().mockResolvedValue(
            response({
              data: {
                check_runs: [
                  {
                    id: 7001,
                    name: 'ci',
                    status: 'completed',
                    conclusion: 'success',
                    head_sha: 'sha1',
                  },
                ],
              },
            }),
          ),
        },
        repos: {
          listDeployments: vi.fn().mockResolvedValue(
            response({
              headers: { etag: 'W/"deploy-fresh"' },
              data: [{ id: 8001, ref: 'main', environment: 'production', sha: 'sha1' }],
            }),
          ),
          listDeploymentStatuses: vi.fn().mockResolvedValue(
            response({
              data: [{ state: 'success', environment: 'production' }],
            }),
          ),
        },
      },
    }
    const etags = new Map<string, string>()
    const ctx = ctxWith(client, etags)

    const mutations = await reconcileInstallation(RECORD, ctx)

    expect(mutations).toEqual([
      expect.objectContaining({
        kind: 'upsertPullRequest',
        installationId: 'inst-internal',
        externalId: '5001',
        state: 'open',
        repo: 'acme/app',
        issueRefs: [
          { teamKey: 'ENG', number: 1, source: 'branch' },
          { teamKey: 'ENG', number: 1, source: 'body' },
        ],
      }),
      expect.objectContaining({
        kind: 'upsertCiCheck',
        prExternalId: '5001',
        externalId: '7001',
        conclusion: 'success',
      }),
      expect.objectContaining({
        kind: 'upsertReview',
        prExternalId: '5001',
        externalId: '9001',
        state: 'approved',
      }),
      expect.objectContaining({
        kind: 'upsertDeployment',
        installationId: 'inst-internal',
        repo: 'acme/app',
        externalId: '8001',
        environment: 'production',
        state: 'success',
      }),
    ])
    expect(etags.get('pulls:acme/app')).toBe('W/"fresh"')
    expect(etags.get('deployments:acme/app')).toBe('W/"deploy-fresh"')
    expect(client.rest.checks.listForRef).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'app', ref: 'sha1' }),
    )
    expect(etags.get('checks:acme/app:sha1')).toBeUndefined()
    expect(client.rest.repos.listDeploymentStatuses).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'app',
      deployment_id: 8001,
      per_page: 1,
    })
  })

  it('sends the stored ETags and yields nothing on a 304 response', async () => {
    const list = vi.fn().mockResolvedValue(response({ status: 304, data: [] }))
    const listDeployments = vi.fn().mockResolvedValue(response({ status: 304, data: [] }))
    const client = {
      rest: {
        pulls: { list, listReviews: vi.fn() },
        checks: { listForRef: vi.fn() },
        repos: { listDeployments, listDeploymentStatuses: vi.fn() },
      },
    } as unknown as GithubRestClient
    const etags = new Map([
      ['pulls:acme/app', 'W/"old"'],
      ['deployments:acme/app', 'W/"deploy-old"'],
    ])
    const ctx = ctxWith(client, etags)

    const mutations = await reconcileInstallation(RECORD, ctx)

    expect(mutations).toEqual([])
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'if-none-match': 'W/"old"' } }),
    )
    expect(listDeployments).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'if-none-match': 'W/"deploy-old"' } }),
    )
    expect(etags.get('pulls:acme/app')).toBe('W/"old"')
    expect(etags.get('deployments:acme/app')).toBe('W/"deploy-old"')
  })

  it('treats a thrown 304 RequestError as unchanged', async () => {
    const list = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Not Modified'), { status: 304 }))
    const listDeployments = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Not Modified'), { status: 304 }))
    const client = {
      rest: {
        pulls: { list, listReviews: vi.fn() },
        checks: { listForRef: vi.fn() },
        repos: { listDeployments, listDeploymentStatuses: vi.fn() },
      },
    } as unknown as GithubRestClient
    const mutations = await reconcileInstallation(RECORD, ctxWith(client))
    expect(mutations).toEqual([])
  })
})
