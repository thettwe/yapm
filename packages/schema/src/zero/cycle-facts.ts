import type { CiConclusion, IssueStatus, PullRequestState } from './context.js'
import { FINISHED_ISSUE_STATUSES } from './cycles.js'
import { type CiHealth, ciHealthFromConclusion } from './delivery.js'
import type { DigestEvidenceRef } from './digest.js'

// The team-scoped narrowed read that feeds the model, computed by yapm — NOT the model. This is
// where the blameless guarantee is structural: the input rows and every output field are
// team-level, with NO `assignee`/`creator`/`author`/`reviewer`/`user_id` dimension anywhere, so
// even a fully injected model has no identity data in its context and cannot name a person. Every
// consequential NUMBER (shipped/carried/failing counts) is computed here so the model only narrates
// verified facts. Pure and deterministic — the DB read that assembles the input lives in
// `db/cycle-facts.ts`.

// A linked pull request as reached off an issue — identity-free (no author/reviewer). `ciChecks`
// carry only their conclusion, never who ran or authored them.
export interface CycleFactsPr {
  readonly id: string
  readonly number: number
  readonly title: string | null
  readonly state: PullRequestState
  readonly ciChecks?: readonly { readonly id: string; readonly conclusion: CiConclusion }[]
}

export interface CycleFactsIssueInput {
  readonly id: string
  readonly number: number | null
  readonly title: string
  readonly status: IssueStatus
  readonly pullRequests: readonly CycleFactsPr[]
}

export interface CycleFactsInput {
  readonly cycle: { readonly id: string; readonly teamId: string; readonly name: string }
  // The team's key (e.g. `ENG`), used only to build human evidence labels like `ENG-142`.
  readonly teamKey?: string | null
  readonly issues: readonly CycleFactsIssueInput[]
}

// A per-issue evidence bundle: the human-authored intent (title/status) plus its linked delivery
// signal, each entity carried as an evidence ref the reader can open. Identity-free by construction.
export interface CycleIssueFacts {
  readonly issueId: string
  readonly number: number | null
  readonly title: string
  readonly status: IssueStatus
  readonly shipped: boolean
  readonly carried: boolean
  readonly ciHealth: CiHealth | null
  readonly evidenceRefs: readonly DigestEvidenceRef[]
}

export interface CycleFactsCounts {
  readonly total: number
  readonly shipped: number
  readonly carried: number
  readonly canceled: number
  readonly withLinkedPr: number
  readonly withFailingCi: number
}

export interface CycleFacts {
  readonly cycleId: string
  readonly teamId: string
  readonly cycleName: string
  readonly counts: CycleFactsCounts
  readonly issues: readonly CycleIssueFacts[]
  // Every evidence id yapm computed for this cycle — the cite-or-omit validator's known-id set.
  readonly evidenceIds: readonly string[]
}

function aggregateCiHealth(prs: readonly CycleFactsPr[]): CiHealth | null {
  const healths = prs.flatMap((pr) =>
    (pr.ciChecks ?? []).map((check) => ciHealthFromConclusion(check.conclusion)),
  )
  if (healths.length === 0) return null
  if (healths.some((health) => health === 'failing')) return 'failing'
  if (healths.some((health) => health === 'pending')) return 'pending'
  return 'passing'
}

// Assemble the team-level facts from an issue-first read of the closed cycle. Anchoring on issues
// (the human intent + the "why") rather than commits is what makes the narrative accurate — the
// graph already says which PR implements which issue, so the model reads the mapping, never guesses.
export function buildCycleFacts(input: CycleFactsInput): CycleFacts {
  const teamKey = input.teamKey?.trim().toUpperCase() || null
  const issueLabel = (issue: CycleFactsIssueInput): string | undefined => {
    if (issue.number === null) return undefined
    return teamKey ? `${teamKey}-${issue.number}` : `#${issue.number}`
  }

  const issues = input.issues.map<CycleIssueFacts>((issue) => {
    const shipped = issue.status === 'done'
    const finished = FINISHED_ISSUE_STATUSES.includes(issue.status)
    const ciHealth = aggregateCiHealth(issue.pullRequests)

    const evidenceRefs: DigestEvidenceRef[] = [
      { kind: 'issue', id: issue.id, ...(issueLabel(issue) ? { label: issueLabel(issue) } : {}) },
    ]
    for (const pr of issue.pullRequests) {
      evidenceRefs.push({
        kind: 'pull_request',
        id: pr.id,
        label: `#${pr.number}`,
      })
      for (const check of pr.ciChecks ?? []) {
        evidenceRefs.push({ kind: 'ci_check', id: check.id })
      }
    }

    return {
      issueId: issue.id,
      number: issue.number,
      title: issue.title,
      status: issue.status,
      shipped,
      carried: !finished,
      ciHealth,
      evidenceRefs,
    }
  })

  const counts: CycleFactsCounts = {
    total: issues.length,
    shipped: issues.filter((issue) => issue.shipped).length,
    carried: issues.filter((issue) => issue.carried).length,
    canceled: issues.filter((issue) => issue.status === 'canceled').length,
    withLinkedPr: input.issues.filter((issue) => issue.pullRequests.length > 0).length,
    withFailingCi: issues.filter((issue) => issue.ciHealth === 'failing').length,
  }

  const evidenceIds = [
    ...new Set(issues.flatMap((issue) => issue.evidenceRefs.map((ref) => ref.id))),
  ]

  return {
    cycleId: input.cycle.id,
    teamId: input.cycle.teamId,
    cycleName: input.cycle.name,
    counts,
    issues,
    evidenceIds,
  }
}
