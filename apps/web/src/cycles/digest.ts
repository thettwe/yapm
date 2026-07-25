import {
  type CiConclusion,
  type CiHealth,
  type CycleDigestStatus,
  ciHealthFromConclusion,
  type DigestContent,
  type DigestEvidenceRef,
  type IssueStatus,
  isUnfinished,
  type PullRequestState,
} from '@yapm/schema'

// The cycle-view digest model: pure helpers that turn the synced work-graph rows into (1) the
// evidence-link resolution the narrative uses and (2) the AI-off raw-evidence fallback. No SDK, no
// network — the narrative is an enhancement layer on a surface (the fallback) that stands alone.

export interface DigestCiCheckRow {
  readonly id: string
  readonly conclusion: string
}

export interface DigestPrRow {
  readonly id: string
  readonly number: number
  readonly title?: string | null
  readonly state: PullRequestState
  readonly url?: string | null
  readonly repo: string
  readonly ciChecks?: readonly DigestCiCheckRow[]
}

export interface DigestIssueLinkRow {
  readonly pullRequest?: DigestPrRow | null
}

export interface DigestIssueRow {
  readonly id: string
  readonly number: number | null
  readonly title: string
  readonly status: IssueStatus
  readonly issueLinks?: readonly DigestIssueLinkRow[]
}

export interface DigestDeploymentRow {
  readonly id: string
  readonly repo: string
  readonly environment?: string | null
  readonly state: string
}

// A digest is "ready to narrate" only when the server wrote `ready` AND validators left at least one
// evidence-linked item. Every other state (absent, pending, ai_off, failed, or an emptied content)
// resolves to the raw-evidence fallback.
export function hasNarrative(
  status: CycleDigestStatus | undefined,
  content: DigestContent | null | undefined,
): content is DigestContent {
  if (status !== 'ready' || !content) return false
  return content.sections.some((section) => section.items.length > 0)
}

// The resolved target for one evidence ref: an in-app issue to open, an external entity URL (PR or
// its CI check's PR), or a plain non-navigable label (a deploy, or an entity not in the client's
// synced slice). Render-safe by construction — only text + explicit hrefs, never remote media.
export type EvidenceTarget =
  | { readonly kind: 'issue'; readonly issueId: string; readonly label: string }
  | { readonly kind: 'external'; readonly href: string; readonly label: string }
  | { readonly kind: 'plain'; readonly label: string }

export interface EvidenceIndex {
  readonly issues: ReadonlyMap<string, DigestIssueRow>
  readonly prs: ReadonlyMap<string, DigestPrRow>
  readonly ciParentPr: ReadonlyMap<string, DigestPrRow>
  readonly deployments: ReadonlyMap<string, DigestDeploymentRow>
}

function issueLinkedPrs(issue: DigestIssueRow): DigestPrRow[] {
  return (issue.issueLinks ?? [])
    .map((link) => link.pullRequest)
    .filter((pr): pr is DigestPrRow => pr != null)
}

export function buildEvidenceIndex(
  issues: readonly DigestIssueRow[],
  deployments: readonly DigestDeploymentRow[],
): EvidenceIndex {
  const issueMap = new Map<string, DigestIssueRow>()
  const prMap = new Map<string, DigestPrRow>()
  const ciParent = new Map<string, DigestPrRow>()
  for (const issue of issues) {
    issueMap.set(issue.id, issue)
    for (const pr of issueLinkedPrs(issue)) {
      prMap.set(pr.id, pr)
      for (const check of pr.ciChecks ?? []) ciParent.set(check.id, pr)
    }
  }
  const deployMap = new Map<string, DigestDeploymentRow>()
  for (const deploy of deployments) deployMap.set(deploy.id, deploy)
  return { issues: issueMap, prs: prMap, ciParentPr: ciParent, deployments: deployMap }
}

function prLabel(pr: DigestPrRow, fallback?: string): string {
  return fallback ?? `${pr.repo}#${pr.number}`
}

// Resolve one evidence ref against the synced slice. A PR (or a CI check, via its parent PR) links
// out to the external entity; an issue opens in-app; anything else renders as a plain label.
export function resolveEvidence(ref: DigestEvidenceRef, index: EvidenceIndex): EvidenceTarget {
  switch (ref.kind) {
    case 'issue': {
      const issue = index.issues.get(ref.id)
      const label = ref.label ?? (issue?.number != null ? `#${issue.number}` : 'issue')
      if (issue) return { kind: 'issue', issueId: issue.id, label }
      return { kind: 'plain', label }
    }
    case 'pull_request': {
      const pr = index.prs.get(ref.id)
      if (pr?.url) return { kind: 'external', href: pr.url, label: prLabel(pr, ref.label) }
      return { kind: 'plain', label: ref.label ?? (pr ? prLabel(pr) : 'PR') }
    }
    case 'ci_check': {
      const pr = index.ciParentPr.get(ref.id)
      if (pr?.url) return { kind: 'external', href: pr.url, label: ref.label ?? 'CI check' }
      return { kind: 'plain', label: ref.label ?? 'CI check' }
    }
    case 'deployment': {
      const deploy = index.deployments.get(ref.id)
      const label =
        ref.label ?? (deploy ? `${deploy.environment ?? 'deploy'} · ${deploy.state}` : 'deploy')
      return { kind: 'plain', label }
    }
  }
}

// The AI-off raw-evidence fallback model: the completed/carried issues with their linked PRs and CI
// health, the scope delta, and the deploys touching the cycle's repos — strictly more than the
// reader had before, and it never blocks opening the cycle.
export interface FallbackPr {
  readonly id: string
  readonly repo: string
  readonly number: number
  readonly state: PullRequestState
  readonly url: string | null
  readonly ciHealth: CiHealth | null
}

export interface FallbackIssue {
  readonly id: string
  readonly number: number | null
  readonly title: string
  readonly status: IssueStatus
  readonly prs: readonly FallbackPr[]
}

export interface CycleScopeDelta {
  readonly total: number
  readonly shipped: number
  readonly carried: number
  readonly canceled: number
}

export interface CycleFallback {
  readonly shipped: readonly FallbackIssue[]
  readonly carried: readonly FallbackIssue[]
  readonly scope: CycleScopeDelta
  readonly deployments: readonly DigestDeploymentRow[]
}

function aggregateCiHealth(pr: DigestPrRow): CiHealth | null {
  const healths = (pr.ciChecks ?? []).map((check) =>
    ciHealthFromConclusion(check.conclusion as CiConclusion),
  )
  if (healths.length === 0) return null
  if (healths.some((h) => h === 'failing')) return 'failing'
  if (healths.some((h) => h === 'pending')) return 'pending'
  return 'passing'
}

function toFallbackIssue(issue: DigestIssueRow): FallbackIssue {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    status: issue.status,
    prs: issueLinkedPrs(issue).map((pr) => ({
      id: pr.id,
      repo: pr.repo,
      number: pr.number,
      state: pr.state,
      url: pr.url ?? null,
      ciHealth: aggregateCiHealth(pr),
    })),
  }
}

export function buildCycleFallback(
  issues: readonly DigestIssueRow[],
  deployments: readonly DigestDeploymentRow[],
): CycleFallback {
  const shipped = issues.filter((issue) => issue.status === 'done').map(toFallbackIssue)
  const carried = issues.filter((issue) => isUnfinished(issue.status)).map(toFallbackIssue)
  const scope: CycleScopeDelta = {
    total: issues.length,
    shipped: shipped.length,
    carried: carried.length,
    canceled: issues.filter((issue) => issue.status === 'canceled').length,
  }
  const repos = new Set(issues.flatMap((issue) => issueLinkedPrs(issue).map((pr) => pr.repo)))
  const related = deployments.filter((deploy) => repos.has(deploy.repo))
  return { shipped, carried, scope, deployments: related }
}
