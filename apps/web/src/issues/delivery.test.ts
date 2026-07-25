import type { IssueStatus } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import { deliveryView, type LinkedIssueRow, linkedEntitiesFor } from './delivery'

function view(status: IssueStatus, links: readonly LinkedIssueRow[]) {
  return deliveryView({ status }, linkedEntitiesFor(links))
}

describe('deliveryView', () => {
  it('renders the quiet not-linked state when there are no linked entities', () => {
    const result = view('in_progress', [])
    expect(result.strip).toBeNull()
    expect(result.divergence).toBeNull()
  })

  it('surfaces PR state, CI health, and review age for a linked open PR', () => {
    const openedAt = Date.now() - 3_600_000
    const result = view('in_review', [
      {
        pullRequest: {
          state: 'open',
          openedAt,
          ciChecks: [{ conclusion: 'success' }],
          reviews: [],
        },
      },
    ])
    expect(result.strip).not.toBeNull()
    expect(result.strip?.pr).toBe('open')
    expect(result.strip?.ci).toBe('passing')
    expect(result.strip?.reviewAgeMs).toBeGreaterThan(0)
  })

  it('upgrades an open PR to approved when the newest review approves', () => {
    const result = view('in_review', [
      {
        pullRequest: {
          state: 'open',
          openedAt: Date.now() - 7_200_000,
          ciChecks: [],
          reviews: [{ state: 'approved', submittedAt: Date.now() - 60_000 }],
        },
      },
    ])
    expect(result.strip?.pr).toBe('approved')
  })

  it('flags divergence when a PR is merged but the issue is not done', () => {
    const result = view('in_progress', [
      {
        pullRequest: {
          state: 'merged',
          openedAt: Date.now() - 10_000_000,
          ciChecks: [],
          reviews: [],
        },
      },
    ])
    expect(result.strip?.pr).toBe('merged')
    expect(result.divergence).toBe('status_behind_merge')
  })

  it('rolls up CI to failing when any check fails', () => {
    const result = view('in_progress', [
      {
        pullRequest: {
          state: 'open',
          openedAt: Date.now() - 100_000,
          ciChecks: [{ conclusion: 'success' }, { conclusion: 'failure' }],
          reviews: [],
        },
      },
    ])
    expect(result.strip?.ci).toBe('failing')
  })

  it('flags a done issue whose CI is failing', () => {
    const result = view('done', [
      {
        pullRequest: {
          state: 'merged',
          openedAt: Date.now() - 100_000,
          ciChecks: [{ conclusion: 'failure' }],
          reviews: [],
        },
      },
    ])
    expect(result.divergence).toBe('done_but_ci_failing')
  })
})
