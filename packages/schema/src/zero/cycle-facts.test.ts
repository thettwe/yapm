import { describe, expect, it } from 'vitest'
import { buildCycleFacts, type CycleFactsInput } from './cycle-facts.js'

const input: CycleFactsInput = {
  cycle: { id: 'cycle-1', teamId: 'team-1', name: 'Cycle 7' },
  teamKey: 'eng',
  issues: [
    {
      id: 'issue-shipped',
      number: 142,
      title: 'Guest checkout',
      status: 'done',
      pullRequests: [
        {
          id: 'pr-1',
          number: 482,
          title: 'Add guest checkout',
          state: 'merged',
          ciChecks: [{ id: 'check-1', conclusion: 'success' }],
        },
      ],
    },
    {
      id: 'issue-carried',
      number: 143,
      title: 'Billing refactor',
      status: 'in_progress',
      pullRequests: [],
    },
    {
      id: 'issue-red',
      number: 144,
      title: 'Refund window',
      status: 'done',
      pullRequests: [
        {
          id: 'pr-2',
          number: 483,
          title: 'Cut refund window',
          state: 'merged',
          ciChecks: [{ id: 'check-2', conclusion: 'failure' }],
        },
      ],
    },
    {
      id: 'issue-canceled',
      number: 145,
      title: 'Dropped work',
      status: 'canceled',
      pullRequests: [],
    },
  ],
}

// Recursively collect every object key present in a value.
function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, keys)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      allKeys(child, keys)
    }
  }
  return keys
}

describe('buildCycleFacts — team-level aggregates computed by yapm', () => {
  const facts = buildCycleFacts(input)

  it('computes the counts deterministically (numbers by yapm, not the model)', () => {
    expect(facts.counts).toEqual({
      total: 4,
      shipped: 2,
      carried: 1,
      canceled: 1,
      withLinkedPr: 2,
      withFailingCi: 1,
    })
  })

  it('rolls up CI health per issue and labels evidence with the team key', () => {
    const shipped = facts.issues.find((issue) => issue.issueId === 'issue-shipped')
    expect(shipped?.ciHealth).toBe('passing')
    expect(shipped?.evidenceRefs).toContainEqual({
      kind: 'issue',
      id: 'issue-shipped',
      label: 'ENG-142',
    })
    expect(shipped?.evidenceRefs).toContainEqual({
      kind: 'pull_request',
      id: 'pr-1',
      label: '#482',
    })
    const red = facts.issues.find((issue) => issue.issueId === 'issue-red')
    expect(red?.ciHealth).toBe('failing')
  })

  it('collects every evidence id as the cite-or-omit known-id set', () => {
    expect(new Set(facts.evidenceIds)).toEqual(
      new Set([
        'issue-shipped',
        'pr-1',
        'check-1',
        'issue-carried',
        'issue-red',
        'pr-2',
        'check-2',
        'issue-canceled',
      ]),
    )
  })

  it('carries NO assignee/author/reviewer/creator/user dimension anywhere in the result', () => {
    const keys = allKeys(facts)
    for (const forbidden of [
      'assignee',
      'assigneeId',
      'author',
      'authorId',
      'reviewer',
      'creator',
      'creatorId',
      'userId',
      'user_id',
    ]) {
      expect(keys.has(forbidden)).toBe(false)
    }
  })
})
