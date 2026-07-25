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
    ])
    expect(etags.get('pulls:acme/app')).toBe('W/"fresh"')
    expect(client.rest.checks.listForRef).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'app',
      ref: 'sha1',
    })
  })

  it('sends the stored ETag and yields nothing on a 304 response', async () => {
    const list = vi.fn().mockResolvedValue(response({ status: 304, data: [] }))
    const client = {
      rest: { pulls: { list, listReviews: vi.fn() }, checks: { listForRef: vi.fn() } },
    } as unknown as GithubRestClient
    const etags = new Map([['pulls:acme/app', 'W/"old"']])
    const ctx = ctxWith(client, etags)

    const mutations = await reconcileInstallation(RECORD, ctx)

    expect(mutations).toEqual([])
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'if-none-match': 'W/"old"' } }),
    )
    expect(etags.get('pulls:acme/app')).toBe('W/"old"')
  })

  it('treats a thrown 304 RequestError as unchanged', async () => {
    const list = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Not Modified'), { status: 304 }))
    const client = {
      rest: { pulls: { list, listReviews: vi.fn() }, checks: { listForRef: vi.fn() } },
    } as unknown as GithubRestClient
    const mutations = await reconcileInstallation(RECORD, ctxWith(client))
    expect(mutations).toEqual([])
  })
})
