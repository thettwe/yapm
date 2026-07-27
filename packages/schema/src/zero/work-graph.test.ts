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

  return { tx, calls, runQueue }
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
    updatedAt: 1_699_500_000_000,
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
    const { tx, calls } = fakeTx([
      { id: 'pr-existing', teamId: 'team-1', state: 'open', mergedAt: null, updatedAt: 1_000 },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'pull_request', verb: 'update' })
    expect(calls[0]?.value).toMatchObject({ id: 'pr-existing', state: 'merged', mergedAt: CTX.now })
  })

  it('never regresses a terminal merged PR back to open, preserving the merge time', async () => {
    const mutation = prMutation({ state: 'open', mergedAt: null, updatedAt: 5_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-existing', teamId: 'team-1', state: 'merged', mergedAt: 2_222, updatedAt: 1_000 },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'pull_request', verb: 'update' })
    expect(calls[0]?.value).toMatchObject({ id: 'pr-existing', state: 'merged', mergedAt: 2_222 })
  })

  it('skips a stale (out-of-order/redelivered older) event instead of overwriting', async () => {
    const mutation = prMutation({ state: 'open', title: 'stale', updatedAt: 1_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-existing', teamId: 'team-1', state: 'merged', mergedAt: 2_222, updatedAt: 9_000 },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls.some((c) => c.table === 'pull_request')).toBe(false)
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
      sourceUpdatedAt: CTX.now,
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
      sourceUpdatedAt: CTX.now,
    }
    const { tx, calls } = fakeTx([undefined]) // findPr -> none
    await applyWorkGraphMutation(tx, CTX, mutation)
    expect(calls).toHaveLength(0)
  })

  it('skips a stale (out-of-order/redelivered older) CI check instead of regressing it', async () => {
    const mutation: WorkGraphMutation = {
      kind: 'upsertCiCheck',
      id: newId(),
      installationId: INSTALL,
      provider: 'github',
      prExternalId: 'PR_1',
      externalId: 'CHECK_1',
      name: 'build',
      conclusion: 'failure',
      headSha: 'abc123',
      sourceUpdatedAt: 1_000,
    }
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1' }, // findPr
      { id: 'check-existing', updatedAt: 9_000 }, // fresher existing check
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)
    expect(calls.some((c) => c.table === 'ci_check')).toBe(false)
  })

  it('skips a stale (out-of-order/redelivered older) deployment instead of regressing it', async () => {
    const mutation: WorkGraphMutation = {
      kind: 'upsertDeployment',
      id: newId(),
      installationId: INSTALL,
      provider: 'github',
      repo: 'acme/app',
      externalId: 'DEPLOY_1',
      ref: 'main',
      environment: 'production',
      state: 'pending',
      sourceUpdatedAt: 1_000,
    }
    const { tx, calls } = fakeTx([{ id: 'deploy-existing', updatedAt: 9_000 }]) // fresher existing
    await applyWorkGraphMutation(tx, CTX, mutation)
    expect(calls.some((c) => c.table === 'deployment')).toBe(false)
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
      sourceUpdatedAt: CTX.now,
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

// Status automation hangs off the `upsertPullRequest` case rather than off anything GitHub-shaped,
// so these run through the same union every connector emits. The queued reads below are the
// ingest path's own sequence: findPr, then (when there are refs) the link resolution, then
// auto-status' team + issue_link + issue reads, then the shared status mutator's own issue read.
describe('applyWorkGraphMutation — status automation behind the union', () => {
  const OPT_IN = 1_000
  const issueRow = (over: Record<string, unknown> = {}) => ({
    id: 'issue-7',
    status: 'todo',
    needsTriage: false,
    lastHumanStatusAt: null,
    ...over,
  })

  function issueWrites(calls: readonly RecordedCall[]): Record<string, unknown>[] {
    return calls.filter((call) => call.table === 'issue').map((call) => call.value)
  }

  it('writes in_review exactly once when a pull request first appears open', async () => {
    const mutation = prMutation({ state: 'open', updatedAt: 5_000 })
    const { tx, calls } = fakeTx([
      undefined, // findPr -> insert
      { autoStatusSince: OPT_IN }, // team setting
      [{ issueId: 'issue-7' }], // issue_link rows
      issueRow(), // the linked issue
      { id: 'issue-7', teamId: 'team-1' }, // issue.setStatus' own load
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([{ id: 'issue-7', status: 'in_review', updatedAt: CTX.now }])
  })

  it('writes done exactly once on the merge edge', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 6_000, updatedAt: 6_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'open', mergedAt: null, updatedAt: 5_000 },
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-7' }],
      issueRow({ status: 'in_progress' }),
      { id: 'issue-7', teamId: 'team-1' },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([{ id: 'issue-7', status: 'done', updatedAt: CTX.now }])
  })

  // Idempotence under webhook redelivery, and the reason the ladder keys off an EDGE: the second
  // copy of a merge is not a second merge. The untouched read queue is the sharper half of the
  // assertion — the early return happens before the team is even read.
  it('is inert on a verbatim redelivery, without so much as reading the team', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 6_000, updatedAt: 6_000 })
    const { tx, calls, runQueue } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'merged', mergedAt: 6_000, updatedAt: 6_000 },
      { autoStatusSince: OPT_IN },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([])
    expect(calls.map((call) => call.table)).toEqual(['pull_request'])
    expect(runQueue).toHaveLength(1)
  })

  // `updated_at` bumps for a comment or a label months after the merge, so an already-merged pull
  // request keeps emitting fresh mutations forever. Firing on the STATE rather than the edge would
  // re-close an issue somebody deliberately reopened, every time anyone commented.
  it('ignores an activity bump on an already-merged pull request', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 6_000, updatedAt: 90_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'merged', mergedAt: 6_000, updatedAt: 6_000 },
      { autoStatusSince: OPT_IN },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([])
  })

  // The EFFECTIVE state is what the ladder sees. GitHub reports a merged PR as `closed` on later
  // events; the ingest path pins it terminal-merged, and passing `mutation.state` instead would
  // make this a merged -> closed edge and drive a transition off a state change that never happened.
  it('sees no edge when a merged pull request is reported closed', async () => {
    const mutation = prMutation({ state: 'closed', updatedAt: 90_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'merged', mergedAt: 6_000, updatedAt: 6_000 },
      { autoStatusSince: OPT_IN },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([])
    expect(calls[0]?.value).toMatchObject({ state: 'merged' })
  })

  // A stale event may still carry a ref yapm has not seen, so linking stays additive — but it
  // describes an older world than the stored row and must never drive state from it.
  it('still links a stale out-of-order event but drives no status from it', async () => {
    const mutation = prMutation({
      state: 'open',
      updatedAt: 1_000,
      issueRefs: [{ teamKey: 'ENG', number: 7, source: 'branch' }],
    })
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'merged', mergedAt: 6_000, updatedAt: 9_000 },
      { key: 'ENG' }, // linkIssues team lookup
      { id: 'issue-7' }, // linkIssues issue lookup
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls.map((call) => call.table)).toEqual(['issue_link'])
    expect(issueWrites(calls)).toEqual([])
  })

  // The default, and every existing instance: the team read answers `null` and the delivery costs
  // exactly one extra query and writes nothing. The untouched queue proves no per-issue read
  // happens either, which is what keeps the off path from paying for a feature it does not use.
  it('writes nothing and reads no issue when the team has not opted in', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 6_000, updatedAt: 6_000 })
    const { tx, calls, runQueue } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'open', mergedAt: null, updatedAt: 5_000 },
      { autoStatusSince: null },
      [{ issueId: 'issue-7' }],
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([])
    expect(runQueue).toHaveLength(1)
  })

  it('drives nothing from an event older than the team opt-in', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 500, updatedAt: 500 })
    const { tx, calls, runQueue } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'open', mergedAt: null, updatedAt: 400 },
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-7' }],
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([])
    expect(runQueue).toHaveLength(1)
  })

  // The epoch is compared against the instant of the STATE, not against the pull request's
  // last-activity time. `updated_at` bumps on a comment, so a pull request that merged long before a
  // team opted in keeps emitting mutations with a fresh `updated_at` forever; comparing THAT would
  // hand the backfill the board the epoch exists to protect.
  it('drives nothing from a merge that predates the opt-in but was commented on after', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 500, updatedAt: 90_000 })
    const { tx, calls, runQueue } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'open', mergedAt: null, updatedAt: 400 },
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-7' }],
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([])
    expect(runQueue).toHaveLength(1)
  })

  // The same trap on the other transition, and the reason the insert branch uses `openedAt`: a
  // months-old still-open pull request first ingested by the backfill sweep is a real edge (the row
  // is new) describing an instant from before the switch.
  it('drives nothing when a long-open pull request is first seen after the opt-in', async () => {
    const mutation = prMutation({ state: 'open', openedAt: 500, updatedAt: 90_000 })
    const { tx, calls, runQueue } = fakeTx([
      undefined, // findPr -> insert
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-7' }],
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([])
    expect(runQueue).toHaveLength(1)
  })

  // But a draft marked ready for review is an `open` edge that happens NOW, not when the pull
  // request was created — so the update branch keeps using the activity time and the transition
  // still fires for a pull request opened as a draft before the team opted in.
  it('fires when a pre-opt-in draft is marked ready for review after it', async () => {
    const mutation = prMutation({ state: 'open', openedAt: 500, updatedAt: 90_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'draft', mergedAt: null, updatedAt: 600 },
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-7' }],
      issueRow(),
      { id: 'issue-7', teamId: 'team-1' },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([{ id: 'issue-7', status: 'in_review', updatedAt: CTX.now }])
  })

  // One delivery that both links and transitions must do both, which is only true because the
  // auto-status call sits AFTER `linkIssues` — a fresh branch push carries the ref and the open
  // state in the same event.
  it('links and transitions in the same delivery', async () => {
    const mutation = prMutation({
      state: 'open',
      updatedAt: 5_000,
      issueRefs: [{ teamKey: 'ENG', number: 7, source: 'branch' }],
    })
    const { tx, calls } = fakeTx([
      undefined, // findPr -> insert
      { key: 'ENG' }, // linkIssues team lookup
      { id: 'issue-7' }, // linkIssues issue lookup
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-7' }],
      issueRow(),
      { id: 'issue-7', teamId: 'team-1' },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(calls.map((call) => call.table)).toEqual(['pull_request', 'issue_link', 'issue'])
    expect(issueWrites(calls)).toEqual([{ id: 'issue-7', status: 'in_review', updatedAt: CTX.now }])
  })

  it('advances every linked issue the edge names, and only those the ladder allows', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 6_000, updatedAt: 6_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'open', mergedAt: null, updatedAt: 5_000 },
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-a' }, { issueId: 'issue-b' }, { issueId: 'issue-c' }],
      issueRow({ id: 'issue-a', status: 'todo' }),
      { id: 'issue-a', teamId: 'team-1' },
      issueRow({ id: 'issue-b', status: 'canceled' }),
      issueRow({ id: 'issue-c', needsTriage: true }),
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([{ id: 'issue-a', status: 'done', updatedAt: CTX.now }])
  })

  // A row that vanished between the link read and the issue read must not abort the batch: the
  // remaining linked issues still transition.
  it('skips a linked issue whose row is gone and keeps going', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 6_000, updatedAt: 6_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'open', mergedAt: null, updatedAt: 5_000 },
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-gone' }, { issueId: 'issue-b' }],
      undefined,
      issueRow({ id: 'issue-b' }),
      { id: 'issue-b', teamId: 'team-1' },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([{ id: 'issue-b', status: 'done', updatedAt: CTX.now }])
  })

  // The audit statement from the other side: the automated write leaves `last_human_status_at`
  // absent, so the next delivery can still tell that no person has decided this status.
  it('leaves last_human_status_at off the automated write', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 6_000, updatedAt: 6_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'open', mergedAt: null, updatedAt: 5_000 },
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-7' }],
      issueRow(),
      { id: 'issue-7', teamId: 'team-1' },
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)[0]).not.toHaveProperty('lastHumanStatusAt')
  })

  it('does not advance an issue whose human stamp is newer than the event', async () => {
    const mutation = prMutation({ state: 'merged', mergedAt: 6_000, updatedAt: 6_000 })
    const { tx, calls } = fakeTx([
      { id: 'pr-1', teamId: 'team-1', state: 'open', mergedAt: null, updatedAt: 5_000 },
      { autoStatusSince: OPT_IN },
      [{ issueId: 'issue-7' }],
      issueRow({ status: 'in_progress', lastHumanStatusAt: 6_001 }),
    ])
    await applyWorkGraphMutation(tx, CTX, mutation)

    expect(issueWrites(calls)).toEqual([])
  })
})
