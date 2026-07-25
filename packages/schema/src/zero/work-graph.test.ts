import type { Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import {
  applyWorkGraphMutation,
  type IssueRef,
  parseIssueRefs,
  type WorkGraphMutation,
} from './work-graph.js'

interface RecordedCall {
  table: string
  verb: 'insert' | 'update' | 'upsert' | 'delete'
  value: Record<string, unknown>
}

// Same fake-transaction shape as mutators.issue.test.ts: `run` shifts a queue of canned query
// results (in call order), `mutate.<table>.<verb>` records the write.
function fakeTx(runResults: unknown[] = []) {
  const calls: RecordedCall[] = []
  const runQueue = [...runResults]

  const tableMutator = (table: string) => ({
    insert: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'insert', value })
      return Promise.resolve()
    },
    update: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'update', value })
      return Promise.resolve()
    },
    upsert: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'upsert', value })
      return Promise.resolve()
    },
    delete: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'delete', value })
      return Promise.resolve()
    },
  })

  const tx = {
    location: 'server',
    reason: 'authoritative',
    run: () => Promise.resolve(runQueue.shift()),
    mutate: new Proxy({}, { get: (_t, table: string) => tableMutator(table) }),
  } as unknown as Transaction

  return { tx, calls }
}

const CTX = { teamId: 'team-1', now: 1_700_000_000_000 }
const INSTALL = 'install-1'

const prMutation = (
  over: Partial<Extract<WorkGraphMutation, { kind: 'upsertPullRequest' }>> = {},
) =>
  ({
    kind: 'upsertPullRequest',
    id: newId(),
    installationId: INSTALL,
    provider: 'github',
    repo: 'acme/app',
    number: 12,
    externalId: 'PR_1',
    title: 'Fix the thing',
    state: 'open',
    url: 'https://github.com/acme/app/pull/12',
    headSha: 'abc123',
    openedAt: 1_699_000_000_000,
    mergedAt: null,
    issueRefs: [],
    ...over,
  }) satisfies WorkGraphMutation

describe('parseIssueRefs', () => {
  it('extracts refs from a branch name, uppercasing the key', () => {
    expect(parseIssueRefs({ branch: 'eng-142-fix-thing' })).toEqual([
      { teamKey: 'ENG', number: 142, source: 'branch' },
    ])
  })

  it('extracts multiple refs from a body, matched case-insensitively', () => {
    expect(parseIssueRefs({ body: 'Closes eng-1 and OPS-27' })).toEqual([
      { teamKey: 'ENG', number: 1, source: 'body' },
      { teamKey: 'OPS', number: 27, source: 'body' },
    ])
  })

  it('dedupes within a source but keeps branch vs body distinct', () => {
    expect(parseIssueRefs({ branch: 'ENG-5', body: 'Closes ENG-5, ENG-5' })).toEqual([
      { teamKey: 'ENG', number: 5, source: 'branch' },
      { teamKey: 'ENG', number: 5, source: 'body' },
    ])
  })

  it('strips leading zeros and respects word boundaries', () => {
    expect(parseIssueRefs({ body: 'ENG-007' })).toEqual([
      { teamKey: 'ENG', number: 7, source: 'body' },
    ])
    // A bare number range like a version is not a ref (must start with a letter).
    expect(parseIssueRefs({ body: 'v1.2.3 and 12-34' })).toEqual([])
  })

  it('returns nothing for empty/absent input', () => {
    expect(parseIssueRefs({})).toEqual([])
    expect(parseIssueRefs({ branch: null, body: '' })).toEqual([])
  })
})

describe('applyWorkGraphMutation — pull request', () => {
  it('inserts a new PR into the resolved team with the client-minted id', async () => {
    const mutation = prMutation()
    const { tx, calls } = fakeTx([undefined]) // findPr -> none
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'pull_request', verb: 'insert' })
    expect(calls[0]?.value).toMatchObject({
      id: mutation.id,
      teamId: 'team-1',
      installationId: INSTALL,
      externalId: 'PR_1',
      state: 'open',
      openedAt: 1_699_000_000_000,
      createdAt: CTX.now,
    })
  })

  it('updates an existing PR (dedupe on external id) instead of inserting', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: CTX.now })
    const { tx, calls } = fakeTx([{ id: 'pr-existing', teamId: 'team-1' }])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'pull_request', verb: 'update' })
    expect(calls[0]?.value).toMatchObject({ id: 'pr-existing', state: 'merged', mergedAt: CTX.now })
  })

  it('links an issue whose key+number resolve inside the PR team', async () => {
    const refs: IssueRef[] = [{ teamKey: 'ENG', number: 7, source: 'branch' }]
    const mutation = prMutation({ issueRefs: refs })
    const { tx, calls } = fakeTx([
      undefined, // findPr -> none (insert)
      { key: 'ENG' }, // team lookup
      { id: 'issue-7' }, // issue lookup
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    const link = calls.find((c) => c.table === 'issue_link')
    expect(link).toMatchObject({ verb: 'upsert' })
    expect(link?.value).toMatchObject({
      issueId: 'issue-7',
      pullRequestId: mutation.id,
      teamId: 'team-1',
      source: 'branch',
    })
  })

  it('drops a ref whose team key does not match the PR team (no cross-team link)', async () => {
    const mutation = prMutation({ issueRefs: [{ teamKey: 'OPS', number: 7, source: 'body' }] })
    const { tx, calls } = fakeTx([
      undefined, // findPr
      { key: 'ENG' }, // team lookup — key mismatch, ref skipped before any issue query
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls.some((c) => c.table === 'issue_link')).toBe(false)
  })

  it('drops a ref that resolves to no issue in the team', async () => {
    const mutation = prMutation({ issueRefs: [{ teamKey: 'ENG', number: 999, source: 'body' }] })
    const { tx, calls } = fakeTx([
      undefined, // findPr
      { key: 'ENG' }, // team lookup
      undefined, // issue lookup -> none
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls.some((c) => c.table === 'issue_link')).toBe(false)
  })
})

describe('applyWorkGraphMutation — checks, reviews, deploys', () => {
  it('inserts a CI check under its parent PR, inheriting the PR team', async () => {
    const mutation: WorkGraphMutation = {
      kind: 'upsertCiCheck',
      id: newId(),
      installationId: INSTALL,
      provider: 'github',
      prExternalId: 'PR_1',
      externalId: 'CHECK_1',
      name: 'build',
      conclusion: 'success',
      headSha: 'abc123',
    }
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-9' }, // findPr
      undefined, // existing check -> none
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'ci_check', verb: 'insert' })
    expect(calls[0]?.value).toMatchObject({
      id: mutation.id,
      teamId: 'team-9',
      pullRequestId: 'pr-1',
      conclusion: 'success',
    })
  })

  it('drops an orphan check whose parent PR is not yet stored', async () => {
    const mutation: WorkGraphMutation = {
      kind: 'upsertCiCheck',
      id: newId(),
      installationId: INSTALL,
      provider: 'github',
      prExternalId: 'PR_missing',
      externalId: 'CHECK_1',
      name: null,
      conclusion: 'failure',
      headSha: null,
    }
    const { tx, calls } = fakeTx([undefined]) // findPr -> none
    await applyWorkGraphMutation(tx, CTX, mutation)
    expect(calls).toHaveLength(0)
  })

  it('is idempotent: a redelivered review updates rather than inserts', async () => {
    const mutation: WorkGraphMutation = {
      kind: 'upsertReview',
      id: newId(),
      installationId: INSTALL,
      provider: 'github',
      prExternalId: 'PR_1',
      externalId: 'REVIEW_1',
      author: 'octocat',
      state: 'approved',
      submittedAt: CTX.now,
    }
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1' }, // findPr
      { id: 'review-existing' }, // existing review
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'review', verb: 'update' })
    expect(calls[0]?.value).toMatchObject({ id: 'review-existing', state: 'approved' })
  })

  it('inserts a deployment into the resolved team', async () => {
    const mutation: WorkGraphMutation = {
      kind: 'upsertDeployment',
      id: newId(),
      installationId: INSTALL,
      provider: 'github',
      repo: 'acme/app',
      externalId: 'DEPLOY_1',
      ref: 'main',
      environment: 'production',
      state: 'success',
    }
    const { tx, calls } = fakeTx([undefined]) // existing -> none
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'deployment', verb: 'insert' })
    expect(calls[0]?.value).toMatchObject({
      id: mutation.id,
      teamId: 'team-1',
      state: 'success',
      environment: 'production',
    })
  })
})
