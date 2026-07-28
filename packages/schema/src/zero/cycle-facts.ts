import { type AreaDefinition, type ChangeSizeBand, changeSizeBand, UNMAPPED_AREA } from './areas.js'
import type { CiConclusion, IssueStatus, PullRequestState } from './context.js'
import { FINISHED_ISSUE_STATUSES } from './cycles.js'
import { type CiHealth, ciHealthFromConclusion } from './delivery.js'
import type { DigestAreaCoverage, DigestEvidenceRef } from './digest.js'

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
  // The yapm-computed area labels this PR's changed files fell into. Never a path — the substitution
  // happens at the enrichment step, before anything reaches this file.
  readonly areas?: readonly string[]
  readonly changedLines?: number
  // True when the area set above was read from a TRUNCATED file list — a prefix of what the pull
  // request actually touched, so absent labels prove nothing.
  readonly truncated?: boolean
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
  // The admin-authored label→flags catalog the area aggregates are computed against. Absent ⇒ no
  // area layer is produced at all and every new field below stays undefined.
  readonly areaCatalog?: readonly AreaDefinition[]
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
  readonly areas?: readonly string[]
  readonly sizeBand?: ChangeSizeBand
}

// A cycle's work grouped by product area. Team-level by construction: counts of issues and pull
// requests, never a person.
export interface CycleAreaFacts {
  readonly area: string
  readonly issueCount: number
  readonly prCount: number
  readonly sensitive: boolean
}

// How much of the cycle the enrichment step actually covered, so a truncated run is visible rather
// than silently indistinguishable from a cycle whose work touched nothing. One definition, shared
// with the stored digest blob, so the facts and what a reader is shown cannot drift.
export type CycleAreaCoverage = DigestAreaCoverage

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
  // The optional area layer. Every field is absent unless area data was supplied, so a caller that
  // does not enrich observes an object identical to one built before this layer existed.
  readonly areas?: readonly CycleAreaFacts[]
  readonly touchedSensitiveAreas?: readonly string[]
  readonly internalImprovements?: number
  readonly areaCoverage?: CycleAreaCoverage
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

  const derived = deriveAreaFacts(
    input.issues.map((issue) => ({
      issueId: issue.id,
      prs: issue.pullRequests.map((pr) => ({
        id: pr.id,
        ...(pr.areas === undefined ? {} : { areas: pr.areas }),
        ...(pr.changedLines === undefined ? {} : { changedLines: pr.changedLines }),
        ...(pr.truncated === undefined ? {} : { truncated: pr.truncated }),
      })),
    })),
    input.areaCatalog,
  )

  return {
    cycleId: input.cycle.id,
    teamId: input.cycle.teamId,
    cycleName: input.cycle.name,
    counts,
    issues: derived ? applyIssueAreas(issues, derived) : issues,
    evidenceIds,
    ...(derived
      ? {
          areas: derived.areas,
          touchedSensitiveAreas: derived.touchedSensitiveAreas,
          internalImprovements: derived.internalImprovements,
        }
      : {}),
  }
}

interface AreaPrInput {
  readonly id: string
  readonly areas?: readonly string[]
  readonly changedLines?: number
  readonly truncated?: boolean
}

interface AreaIssueInput {
  readonly issueId: string
  readonly prs: readonly AreaPrInput[]
}

interface DerivedAreaFacts {
  readonly perIssue: ReadonlyMap<string, { areas: readonly string[]; sizeBand?: ChangeSizeBand }>
  readonly areas: readonly CycleAreaFacts[]
  readonly touchedSensitiveAreas: readonly string[]
  readonly internalImprovements: number
}

// The ONE place the area layer is computed. Both entry points (`buildCycleFacts` when its input
// carries area data, `withCycleAreas` when the caller already holds built facts) delegate here, so
// the two cannot drift. Returns null when no pull request carries area data at all, which is what
// keeps every new field `undefined` for an un-enriched caller.
function deriveAreaFacts(
  issues: readonly AreaIssueInput[],
  catalog: readonly AreaDefinition[] | undefined,
): DerivedAreaFacts | null {
  if (!issues.some((issue) => issue.prs.some((pr) => pr.areas !== undefined))) return null

  const flags = new Map<string, AreaDefinition>()
  for (const definition of catalog ?? []) flags.set(definition.area, definition)

  const perIssue = new Map<string, { areas: readonly string[]; sizeBand?: ChangeSizeBand }>()
  const issueCounts = new Map<string, number>()
  // Label → the DISTINCT pull requests that touched it. A set, not a counter: one pull request that
  // closes three issues is one pull request, and the prompt asks the model to restate this number
  // verbatim, so counting it three times would put a wrong number in the digest.
  const prIdsByLabel = new Map<string, Set<string>>()
  let internalImprovements = 0

  for (const issue of issues) {
    const labels = new Set<string>()
    let changedLines = 0
    let sawChangedLines = false
    let sawTruncated = false
    for (const pr of issue.prs) {
      if (pr.areas === undefined) continue
      if (pr.truncated) sawTruncated = true
      for (const label of new Set(pr.areas)) {
        labels.add(label)
        const ids = prIdsByLabel.get(label) ?? new Set<string>()
        ids.add(pr.id)
        prIdsByLabel.set(label, ids)
      }
      if (pr.changedLines !== undefined) {
        changedLines += pr.changedLines
        sawChangedLines = true
      }
    }
    if (labels.size === 0) continue
    const sorted = [...labels].sort()
    for (const label of sorted) issueCounts.set(label, (issueCounts.get(label) ?? 0) + 1)
    perIssue.set(issue.issueId, {
      areas: sorted,
      ...(sawChangedLines ? { sizeBand: changeSizeBand(changedLines) } : {}),
    })
    // An internal improvement is work whose every label is an admin-marked internal area. An
    // unmapped label disqualifies it — yapm does not know where that work landed, so it is not
    // entitled to collapse it. A TRUNCATED file list disqualifies it for the identical reason: the
    // labels are a prefix of what the pull request touched, so "every area it touched is internal"
    // is a claim about files yapm never read.
    const internal =
      !sawTruncated &&
      sorted.every((label) => label !== UNMAPPED_AREA && flags.get(label)?.internal === true)
    if (internal) internalImprovements += 1
  }

  const areas = [...issueCounts.keys()].sort().map<CycleAreaFacts>((area) => ({
    area,
    issueCount: issueCounts.get(area) ?? 0,
    prCount: prIdsByLabel.get(area)?.size ?? 0,
    sensitive: flags.get(area)?.sensitive === true,
  }))

  return {
    perIssue,
    areas,
    touchedSensitiveAreas: areas.filter((area) => area.sensitive).map((area) => area.area),
    internalImprovements,
  }
}

function applyIssueAreas(
  issues: readonly CycleIssueFacts[],
  derived: DerivedAreaFacts,
): CycleIssueFacts[] {
  return issues.map((issue) => {
    const extra = derived.perIssue.get(issue.issueId)
    return extra ? { ...issue, ...extra } : issue
  })
}

export interface WithCycleAreasInput {
  // PR id → the labels its changed files fell into, plus the summed per-file change count. Keyed by
  // the same pull-request evidence ids `buildCycleFacts` already computed.
  readonly prAreas: ReadonlyMap<
    string,
    {
      readonly areas: readonly string[]
      readonly changedLines?: number
      // Set when the file list was a full page — the labels are a prefix, not the whole set.
      readonly truncated?: boolean
    }
  >
  readonly catalog?: readonly AreaDefinition[]
  readonly coverage?: CycleAreaCoverage
}

// The worker's entry point: it holds a built `CycleFacts` (the facts are computed BEFORE rollover
// and serialized into the job), not a `CycleFactsInput`, so the area layer is applied afterwards.
// Pure — the same derivation as `buildCycleFacts`, reading the issue→PR mapping back out of the
// evidence refs yapm already computed. Internal-improvement issues STAY in `issues`; the collapse is
// a count the narration acts on, never a removal from the team's own facts.
export function withCycleAreas(facts: CycleFacts, input: WithCycleAreasInput): CycleFacts {
  const derived = deriveAreaFacts(
    facts.issues.map((issue) => ({
      issueId: issue.issueId,
      prs: issue.evidenceRefs
        .filter((ref) => ref.kind === 'pull_request')
        .map((ref) => ({ id: ref.id, ...(input.prAreas.get(ref.id) ?? {}) })),
    })),
    input.catalog,
  )

  if (!derived) {
    return input.coverage ? { ...facts, areaCoverage: input.coverage } : facts
  }

  return {
    ...facts,
    issues: applyIssueAreas(facts.issues, derived),
    areas: derived.areas,
    touchedSensitiveAreas: derived.touchedSensitiveAreas,
    internalImprovements: derived.internalImprovements,
    ...(input.coverage ? { areaCoverage: input.coverage } : {}),
  }
}
