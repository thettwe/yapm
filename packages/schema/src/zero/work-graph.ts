import type { Transaction } from '@rocicorp/zero'
import { applyAutoStatusForPullRequest } from './auto-status.js'
import type {
  CiConclusion,
  ConnectorLinkSource,
  DeploymentState,
  PullRequestState,
  ReviewState,
} from './context.js'
import { zql } from './schema.js'

// The provider firewall: the ONLY shape feature code sees. A GitHub `pull_request` payload and
// a future GitLab merge-request event both normalize to this discriminated union, so the
// reality strip and the write path are written once. Each variant carries a client-minted
// UUIDv7 `id` (used only if the upsert inserts) per the client-minted-id rule; upserts dedupe
// on the provider's external id, never on that fresh id.
export type WorkGraphMutation =
  | {
      readonly kind: 'upsertPullRequest'
      readonly id: string
      readonly installationId: string
      readonly provider: string
      readonly repo: string
      readonly number: number
      readonly externalId: string
      readonly title: string | null
      readonly state: PullRequestState
      readonly url: string | null
      readonly headSha: string | null
      readonly openedAt: number
      readonly mergedAt: number | null
      // The source event's own modification time (GitHub `updated_at`), NOT wall clock. Carried
      // so the write path can skip an out-of-order/redelivered older event instead of regressing.
      readonly updatedAt: number
      readonly issueRefs: readonly IssueRef[]
    }
  | {
      readonly kind: 'upsertCiCheck'
      readonly id: string
      readonly installationId: string
      readonly provider: string
      readonly prExternalId: string
      readonly externalId: string
      readonly name: string | null
      readonly conclusion: CiConclusion
      readonly headSha: string | null
      // The source event's own modification time (check_run completed/started, or the reconcile
      // poll time), NOT wall clock. Persisted on the row's `updatedAt` so an out-of-order or
      // redelivered older check cannot regress fresher terminal CI state — mirroring the
      // pull_request guard below.
      readonly sourceUpdatedAt: number
    }
  | {
      readonly kind: 'upsertReview'
      readonly id: string
      readonly installationId: string
      readonly provider: string
      readonly prExternalId: string
      readonly externalId: string
      readonly author: string | null
      readonly state: ReviewState
      readonly submittedAt: number
    }
  | {
      readonly kind: 'upsertDeployment'
      readonly id: string
      readonly installationId: string
      readonly provider: string
      readonly repo: string
      readonly externalId: string
      readonly ref: string | null
      readonly environment: string | null
      readonly state: DeploymentState
      // The source event's own modification time (deployment_status created/updated, or the
      // reconcile poll time), NOT wall clock. Persisted on the row's `updatedAt` so an
      // out-of-order or redelivered older deployment event cannot regress fresher deploy state.
      readonly sourceUpdatedAt: number
    }

// Resolution context supplied by the ingest worker: the team the repo maps to (from the
// admin repo->team mapping) and the wall clock. A PR/deployment is written into `teamId`; a
// check/review inherits its parent PR's team. `now` keeps the write deterministic under retry.
export interface WorkGraphContext {
  readonly teamId: string
  readonly now: number
}

// A parsed issue reference (`ENG-142`) plus which rule found it.
export interface IssueRef {
  readonly teamKey: string
  readonly number: number
  readonly source: ConnectorLinkSource
}

const ISSUE_REF_PATTERN = /\b([A-Za-z][A-Za-z0-9]*)-(\d+)\b/gu

// Pure magic-word linker: extract every `<TEAM_KEY>-<NUMBER>` from a branch name and/or PR
// body, case-insensitively with a word boundary, uppercasing the key. Branch matches carry
// source `branch`, body matches `body`; duplicates (same key+number+source) are collapsed.
// The candidate is only a *reference* — `applyWorkGraphMutation` resolves it against the
// mapped team's key + issue number and drops a ref that matches no real issue.
export function parseIssueRefs(input: {
  readonly branch?: string | null
  readonly body?: string | null
}): IssueRef[] {
  const seen = new Set<string>()
  const refs: IssueRef[] = []

  const scan = (text: string | null | undefined, source: ConnectorLinkSource): void => {
    if (!text) return
    for (const match of text.matchAll(ISSUE_REF_PATTERN)) {
      const rawKey = match[1]
      const rawNumber = match[2]
      if (rawKey === undefined || rawNumber === undefined) continue
      const teamKey = rawKey.toUpperCase()
      const number = Number.parseInt(rawNumber, 10)
      if (!Number.isSafeInteger(number)) continue
      const key = `${teamKey}-${number}-${source}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({ teamKey, number, source })
    }
  }

  scan(input.branch, 'branch')
  scan(input.body, 'body')
  return refs
}

interface PrRow {
  id: string
  teamId: string
  state: PullRequestState
  mergedAt: number | null
  updatedAt: number
}

async function findPr(
  tx: Transaction,
  installationId: string,
  externalId: string,
): Promise<PrRow | undefined> {
  return (await tx.run(
    zql.pull_request.where('installationId', installationId).where('externalId', externalId).one(),
  )) as PrRow | undefined
}

async function linkIssues(
  tx: Transaction,
  pr: { id: string; teamId: string },
  refs: readonly IssueRef[],
  now: number,
): Promise<void> {
  if (refs.length === 0) return
  const team = (await tx.run(zql.team.where('id', pr.teamId).one())) as { key: string } | undefined
  if (!team) return
  const teamKey = team.key.toUpperCase()

  for (const ref of refs) {
    // A PR only links issues in its own mapped team, so a cross-team ref is ignored and the
    // edge never widens past the team-scoped boundary.
    if (ref.teamKey !== teamKey) continue
    const issue = (await tx.run(
      zql.issue.where('teamId', pr.teamId).where('number', ref.number).one(),
    )) as { id: string } | undefined
    if (!issue) continue
    await tx.mutate.issue_link.upsert({
      issueId: issue.id,
      pullRequestId: pr.id,
      teamId: pr.teamId,
      source: ref.source,
      createdAt: now,
    })
  }
}

// Applies one normalized mutation through the shared Zero write path (`tx.mutate`), the same
// path human edits use, so ingested rows obey the same team-scoped model. Server-only — never
// registered in the client `mutators` map, so a client can never forge a work-graph write.
// Upserts dedupe on the provider external id; a check/review whose parent PR is not yet stored
// is dropped (the reconcile sweep backfills it). Idempotent under webhook redelivery/retry.
export async function applyWorkGraphMutation(
  tx: Transaction,
  ctx: WorkGraphContext,
  mutation: WorkGraphMutation,
): Promise<void> {
  const { now } = ctx

  switch (mutation.kind) {
    case 'upsertPullRequest': {
      const existing = await findPr(tx, mutation.installationId, mutation.externalId)
      if (existing) {
        // Ordering safety net: an out-of-order or redelivered older event must never overwrite
        // fresher state. Links are still reconciled (upsert is additive) so a late-arriving ref
        // is not lost. Equal timestamps proceed — the write is idempotent.
        if (mutation.updatedAt < existing.updatedAt) {
          await linkIssues(tx, existing, mutation.issueRefs, now)
          return
        }
        // `merged` is terminal on GitHub: never regress away from it, and preserve the recorded
        // merge time. A closed PR may still reopen, so only merged is pinned.
        const terminalMerged = existing.state === 'merged'
        const effectiveState = terminalMerged ? 'merged' : mutation.state
        await tx.mutate.pull_request.update({
          id: existing.id,
          repo: mutation.repo,
          number: mutation.number,
          title: mutation.title,
          state: effectiveState,
          url: mutation.url,
          headSha: mutation.headSha,
          mergedAt: terminalMerged ? existing.mergedAt : mutation.mergedAt,
          updatedAt: mutation.updatedAt,
        })
        await linkIssues(tx, existing, mutation.issueRefs, now)
        // After linking, so a delivery that both links and transitions does both. The EFFECTIVE
        // state is passed, not `mutation.state`: `updated_at` bumps on any activity, so an
        // already-merged pull request emits fresh mutations for months and only the edge
        // `existing.state -> effectiveState` distinguishes the merge from the comment on it.
        await applyAutoStatusForPullRequest(
          tx,
          { teamId: existing.teamId, now },
          {
            pullRequestId: existing.id,
            previousState: existing.state,
            state: effectiveState,
            eventAt: mutation.updatedAt,
          },
        )
        return
      }
      await tx.mutate.pull_request.insert({
        id: mutation.id,
        teamId: ctx.teamId,
        installationId: mutation.installationId,
        provider: mutation.provider,
        repo: mutation.repo,
        number: mutation.number,
        externalId: mutation.externalId,
        title: mutation.title,
        state: mutation.state,
        url: mutation.url,
        headSha: mutation.headSha,
        openedAt: mutation.openedAt,
        mergedAt: mutation.mergedAt,
        createdAt: now,
        updatedAt: mutation.updatedAt,
      })
      await linkIssues(tx, { id: mutation.id, teamId: ctx.teamId }, mutation.issueRefs, now)
      // A pull request yapm has not seen before: `null` previous state, so the insert is always an
      // edge and a PR that arrives already merged (backfill, reconcile) is one merge edge, not none.
      // The since-epoch, not this branch, is what keeps that backfill from rewriting a board.
      await applyAutoStatusForPullRequest(
        tx,
        { teamId: ctx.teamId, now },
        {
          pullRequestId: mutation.id,
          previousState: null,
          state: mutation.state,
          eventAt: mutation.updatedAt,
        },
      )
      return
    }

    case 'upsertCiCheck': {
      const pr = await findPr(tx, mutation.installationId, mutation.prExternalId)
      if (!pr) return
      const existing = (await tx.run(
        zql.ci_check.where('pullRequestId', pr.id).where('externalId', mutation.externalId).one(),
      )) as { id: string; updatedAt: number } | undefined
      if (existing) {
        // Ordering safety net: an out-of-order or redelivered older check must never overwrite
        // fresher state. Equal timestamps proceed — the write is idempotent.
        if (mutation.sourceUpdatedAt < existing.updatedAt) return
        await tx.mutate.ci_check.update({
          id: existing.id,
          name: mutation.name,
          conclusion: mutation.conclusion,
          headSha: mutation.headSha,
          updatedAt: mutation.sourceUpdatedAt,
        })
        return
      }
      await tx.mutate.ci_check.insert({
        id: mutation.id,
        teamId: pr.teamId,
        pullRequestId: pr.id,
        provider: mutation.provider,
        externalId: mutation.externalId,
        name: mutation.name,
        conclusion: mutation.conclusion,
        headSha: mutation.headSha,
        createdAt: now,
        updatedAt: mutation.sourceUpdatedAt,
      })
      return
    }

    case 'upsertReview': {
      const pr = await findPr(tx, mutation.installationId, mutation.prExternalId)
      if (!pr) return
      const existing = (await tx.run(
        zql.review.where('pullRequestId', pr.id).where('externalId', mutation.externalId).one(),
      )) as { id: string } | undefined
      if (existing) {
        await tx.mutate.review.update({
          id: existing.id,
          author: mutation.author,
          state: mutation.state,
          submittedAt: mutation.submittedAt,
          updatedAt: now,
        })
        return
      }
      await tx.mutate.review.insert({
        id: mutation.id,
        teamId: pr.teamId,
        pullRequestId: pr.id,
        provider: mutation.provider,
        externalId: mutation.externalId,
        author: mutation.author,
        state: mutation.state,
        submittedAt: mutation.submittedAt,
        createdAt: now,
        updatedAt: now,
      })
      return
    }

    case 'upsertDeployment': {
      const existing = (await tx.run(
        zql.deployment
          .where('installationId', mutation.installationId)
          .where('externalId', mutation.externalId)
          .one(),
      )) as { id: string; updatedAt: number } | undefined
      if (existing) {
        // Ordering safety net: an out-of-order or redelivered older deployment event must never
        // overwrite fresher state. Equal timestamps proceed — the write is idempotent.
        if (mutation.sourceUpdatedAt < existing.updatedAt) return
        await tx.mutate.deployment.update({
          id: existing.id,
          repo: mutation.repo,
          ref: mutation.ref,
          environment: mutation.environment,
          state: mutation.state,
          updatedAt: mutation.sourceUpdatedAt,
        })
        return
      }
      await tx.mutate.deployment.insert({
        id: mutation.id,
        teamId: ctx.teamId,
        installationId: mutation.installationId,
        provider: mutation.provider,
        repo: mutation.repo,
        externalId: mutation.externalId,
        ref: mutation.ref,
        environment: mutation.environment,
        state: mutation.state,
        createdAt: now,
        updatedAt: mutation.sourceUpdatedAt,
      })
      return
    }
  }
}

// Applies a batch in order (opened -> synchronize -> closed sequencing is preserved by the
// caller's FIFO queue; within a batch, array order is the sequence).
export async function applyWorkGraphMutations(
  tx: Transaction,
  ctx: WorkGraphContext,
  mutations: readonly WorkGraphMutation[],
): Promise<void> {
  for (const mutation of mutations) {
    await applyWorkGraphMutation(tx, ctx, mutation)
  }
}
