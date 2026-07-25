import type { DigestContent, DigestEvidenceRef } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import {
  buildCycleFallback,
  buildEvidenceIndex,
  type DigestDeploymentRow,
  type DigestIssueRow,
  type DigestPrRow,
  hasNarrative,
  resolveEvidence,
} from './digest'

const pr = (over: Partial<DigestPrRow> & { id: string }): DigestPrRow => ({
  number: 7,
  state: 'merged',
  repo: 'acme/app',
  url: 'https://github.com/acme/app/pull/7',
  ciChecks: [],
  ...over,
})

const issue = (over: Partial<DigestIssueRow> & { id: string }): DigestIssueRow => ({
  number: 1,
  title: 'Ship it',
  status: 'done',
  issueLinks: [],
  ...over,
})

describe('hasNarrative', () => {
  const content: DigestContent = {
    headline: 'x',
    sections: [
      {
        title: 'Shipped',
        items: [{ kind: 'shipped', summary: 's', evidenceRefs: [], confidence: 'high' }],
      },
    ],
  }

  it('is true only for a ready digest with at least one item', () => {
    expect(hasNarrative('ready', content)).toBe(true)
    expect(hasNarrative('ai_off', content)).toBe(false)
    expect(hasNarrative('failed', content)).toBe(false)
    expect(hasNarrative('ready', { headline: '', sections: [] })).toBe(false)
    expect(hasNarrative('ready', null)).toBe(false)
    expect(hasNarrative(undefined, null)).toBe(false)
  })
})

describe('resolveEvidence', () => {
  const issues: DigestIssueRow[] = [
    issue({
      id: 'issue-1',
      number: 42,
      issueLinks: [
        { pullRequest: pr({ id: 'pr-1', ciChecks: [{ id: 'ci-1', conclusion: 'failure' }] }) },
      ],
    }),
  ]
  const deployments: DigestDeploymentRow[] = [
    { id: 'dep-1', repo: 'acme/app', environment: 'production', state: 'success' },
  ]
  const index = buildEvidenceIndex(issues, deployments)

  it('opens an issue in-app', () => {
    const ref: DigestEvidenceRef = { kind: 'issue', id: 'issue-1', label: 'ENG-42' }
    expect(resolveEvidence(ref, index)).toEqual({
      kind: 'issue',
      issueId: 'issue-1',
      label: 'ENG-42',
    })
  })

  it('links a PR to its external url', () => {
    const ref: DigestEvidenceRef = { kind: 'pull_request', id: 'pr-1' }
    expect(resolveEvidence(ref, index)).toEqual({
      kind: 'external',
      href: 'https://github.com/acme/app/pull/7',
      label: 'acme/app#7',
    })
  })

  it('links a CI check to its parent PR url', () => {
    const ref: DigestEvidenceRef = { kind: 'ci_check', id: 'ci-1' }
    expect(resolveEvidence(ref, index)).toEqual({
      kind: 'external',
      href: 'https://github.com/acme/app/pull/7',
      label: 'CI check',
    })
  })

  it('renders a deployment as a plain label', () => {
    const ref: DigestEvidenceRef = { kind: 'deployment', id: 'dep-1' }
    expect(resolveEvidence(ref, index)).toEqual({ kind: 'plain', label: 'production · success' })
  })

  it('falls back to a plain label for an id not in the synced slice', () => {
    const ref: DigestEvidenceRef = { kind: 'pull_request', id: 'missing', label: 'gone' }
    expect(resolveEvidence(ref, index)).toEqual({ kind: 'plain', label: 'gone' })
  })
})

describe('buildCycleFallback', () => {
  it('partitions shipped vs carried and computes the scope delta', () => {
    const issues: DigestIssueRow[] = [
      issue({ id: 'a', status: 'done', issueLinks: [{ pullRequest: pr({ id: 'pr-a' }) }] }),
      issue({ id: 'b', status: 'in_progress' }),
      issue({ id: 'c', status: 'canceled' }),
    ]
    const fallback = buildCycleFallback(issues, [
      { id: 'dep-1', repo: 'acme/app', environment: 'production', state: 'success' },
      { id: 'dep-2', repo: 'other/repo', environment: 'staging', state: 'failure' },
    ])
    expect(fallback.shipped.map((i) => i.id)).toEqual(['a'])
    expect(fallback.carried.map((i) => i.id)).toEqual(['b'])
    expect(fallback.scope).toEqual({ total: 3, shipped: 1, carried: 1, canceled: 1 })
    // Only deploys touching a repo linked from the cycle's PRs are shown.
    expect(fallback.deployments.map((d) => d.id)).toEqual(['dep-1'])
    expect(fallback.shipped[0]?.prs[0]?.ciHealth).toBeNull()
  })
})
