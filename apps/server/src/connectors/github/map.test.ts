import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkGraphMutation } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import {
  derivePrState,
  mapCiConclusion,
  mapDeploymentState,
  mapGithubEvent,
  mapReviewState,
} from './map.js'

const FIXTURES = join(import.meta.dirname, '__fixtures__')
const NOW = 1_700_000_000_000

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

function mapFixture(eventType: string, name: string): WorkGraphMutation[] {
  return mapGithubEvent(eventType, fixture(name), '42', NOW)
}

describe('mapGithubEvent — pull_request', () => {
  it('maps an opened PR, deriving open state and linking the body ref', () => {
    const [mutation] = mapFixture('pull_request', 'pull_request.opened.json')
    expect(mutation).toMatchObject({
      kind: 'upsertPullRequest',
      installationId: '42',
      provider: 'github',
      repo: 'acme/app',
      number: 12,
      externalId: '5001',
      title: 'Fix the login race',
      state: 'open',
      url: 'https://github.com/acme/app/pull/12',
      headSha: 'abc123def456',
      openedAt: Date.parse('2026-07-20T10:00:00Z'),
      mergedAt: null,
      issueRefs: [
        { teamKey: 'ENG', number: 1, source: 'branch' },
        { teamKey: 'ENG', number: 1, source: 'body' },
      ],
    })
    expect(typeof (mutation as { id: string }).id).toBe('string')
  })

  it('maps a merged PR to the merged state with a merge timestamp', () => {
    const [mutation] = mapFixture('pull_request', 'pull_request.closed_merged.json')
    expect(mutation).toMatchObject({
      kind: 'upsertPullRequest',
      state: 'merged',
      mergedAt: Date.parse('2026-07-21T09:30:00Z'),
    })
  })
})

describe('mapGithubEvent — reviews, checks, deploys', () => {
  it('maps a submitted approval to an upsertReview', () => {
    const [mutation] = mapFixture('pull_request_review', 'pull_request_review.submitted.json')
    expect(mutation).toMatchObject({
      kind: 'upsertReview',
      prExternalId: '5001',
      externalId: '9001',
      author: 'reviewer-jane',
      state: 'approved',
      submittedAt: Date.parse('2026-07-20T14:15:00Z'),
    })
  })

  it('maps a completed check run to an upsertCiCheck under its parent PR', () => {
    const [mutation] = mapFixture('check_run', 'check_run.completed.json')
    expect(mutation).toMatchObject({
      kind: 'upsertCiCheck',
      prExternalId: '5001',
      externalId: '7001',
      name: 'build-and-test',
      conclusion: 'failure',
      headSha: 'abc123def456',
    })
  })

  it('drops a check run that references no pull request', () => {
    const payload = {
      action: 'completed',
      check_run: {
        id: 1,
        status: 'completed',
        conclusion: 'success',
        head_sha: 'x',
        pull_requests: [],
      },
      repository: { full_name: 'acme/app' },
    }
    expect(mapGithubEvent('check_run', payload, '42', NOW)).toEqual([])
  })

  it('maps a deployment status to an upsertDeployment', () => {
    const [mutation] = mapFixture('deployment_status', 'deployment_status.json')
    expect(mutation).toMatchObject({
      kind: 'upsertDeployment',
      repo: 'acme/app',
      externalId: '8001',
      ref: 'eng-1-login-race',
      environment: 'production',
      state: 'success',
    })
  })
})

describe('mapGithubEvent — unmodeled events', () => {
  it('yields no work-graph mutation for lifecycle and unmapped events', () => {
    expect(mapFixture('installation', 'installation.created.json')).toEqual([])
    for (const eventType of ['push', 'status', 'issues', 'ping', 'unknown']) {
      expect(
        mapGithubEvent(eventType, { repository: { full_name: 'acme/app' } }, '42', NOW),
      ).toEqual([])
    }
  })
})

describe('enum + state mapping', () => {
  it('treats non-terminal or unknown CI as pending', () => {
    expect(mapCiConclusion('in_progress', null)).toBe('pending')
    expect(mapCiConclusion('completed', 'stale')).toBe('pending')
    expect(mapCiConclusion('completed', null)).toBe('pending')
    expect(mapCiConclusion('completed', 'success')).toBe('success')
    expect(mapCiConclusion('completed', 'timed_out')).toBe('timed_out')
  })

  it('normalizes review states, defaulting unknown to commented', () => {
    expect(mapReviewState('APPROVED')).toBe('approved')
    expect(mapReviewState('CHANGES_REQUESTED')).toBe('changes_requested')
    expect(mapReviewState('DISMISSED')).toBe('dismissed')
    expect(mapReviewState('PENDING')).toBe('commented')
  })

  it('clamps unknown deployment states to pending', () => {
    expect(mapDeploymentState('in_progress')).toBe('in_progress')
    expect(mapDeploymentState('bogus')).toBe('pending')
  })

  it('derives PR state from the lifecycle booleans', () => {
    expect(derivePrState({ id: 1, number: 1, state: 'open', draft: true, head: null })).toBe(
      'draft',
    )
    expect(derivePrState({ id: 1, number: 1, state: 'open', head: null })).toBe('open')
    expect(derivePrState({ id: 1, number: 1, state: 'closed', head: null })).toBe('closed')
    expect(
      derivePrState({
        id: 1,
        number: 1,
        state: 'closed',
        merged_at: '2026-01-01T00:00:00Z',
        head: null,
      }),
    ).toBe('merged')
  })
})
