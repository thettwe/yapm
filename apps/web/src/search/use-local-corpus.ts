import { useQuery } from '@rocicorp/zero/react'
import {
  issueKeyOf,
  LOCAL_RESULT_LIMIT,
  type LocalSearchCandidate,
  mergeLocalCandidates,
  queries,
  richTextToPlainText,
  SEARCH_BODY_MAX_LENGTH,
  type SearchTier,
} from '@yapm/schema'
import { useCallback, useMemo, useRef } from 'react'

// Structural row shapes, narrow on purpose: this hook reads seven synced queries and needs six
// fields from them. Declaring what it reads keeps the corpus builder honest about its inputs and
// keeps a schema change that adds a column from silently widening what search walks.
export interface CorpusIssueRow {
  readonly id: string
  readonly teamId: string
  readonly number?: number | null
  readonly title: string
  readonly description?: unknown
  readonly status: string
  readonly needsTriage: boolean
  readonly updatedAt: number
}

export interface CorpusNamedRow {
  readonly id: string
  readonly name: string
  readonly updatedAt: number
}

export interface CorpusTeamRow extends CorpusNamedRow {
  readonly key: string
}

// A candidate plus the display values a result row needs. The design-system row is data-agnostic,
// so resolving `issueKey` and the two state labels is this layer's job, not the component's.
export interface LocalCorpusEntry extends LocalSearchCandidate {
  readonly teamId: string | null
  readonly issueKey: string | null
  readonly status: string | null
  readonly needsTriage: boolean
}

export interface LocalSearchHit {
  readonly tier: SearchTier
  readonly entry: LocalCorpusEntry
}

export interface LocalSearchCorpus {
  /** Rank and cap the corpus for one query. Pure, synchronous, and free of network. */
  readonly search: (query: string, limit?: number) => LocalSearchHit[]
  readonly size: number
  readonly loaded: boolean
}

interface PlaintextCacheEntry {
  readonly updatedAt: number
  readonly text: string
}

function identity(kind: LocalSearchCandidate['kind'], id: string): string {
  return `${kind}:${id}`
}

function namedEntries(
  kind: 'project' | 'cycle' | 'label' | 'team',
  rows: readonly CorpusNamedRow[],
): LocalCorpusEntry[] {
  return rows.map((row) => ({
    kind,
    id: row.id,
    title: row.name,
    updatedAt: row.updatedAt,
    teamId: null,
    issueKey: null,
    status: null,
    needsTriage: false,
  }))
}

/**
 * The on-device pass's corpus: every row the sync engine has already replicated that search can
 * reach, projected into the shared core's candidate shape.
 *
 * `triage.inbox` is subscribed alongside `issues.byTeam` because `issues.byTeam` filters
 * `needsTriage` rows OUT — without it, an issue you filed and that is still awaiting triage would
 * be unfindable, which is exactly what H11 refused. The two sources overlap by construction, which
 * is why dedupe is a requirement of the merge rather than a nicety.
 *
 * PERMISSIONS ARE NOT THIS HOOK'S BUSINESS, and that is the point: every row it reads arrived
 * through an already-permissioned synced query, so the on-device pass cannot widen what the caller
 * may see. The server pass carries its own predicate.
 *
 * THE PLAINTEXT CACHE is built as rows are first seen — in the corpus memo, which re-runs when a
 * synced query delivers — and never on the keystroke. It is keyed by `id` and invalidated by
 * `updatedAt`, so editing one description re-walks one document. `search()` does no walking at all.
 */
export function useLocalSearchCorpus(teamId?: string): LocalSearchCorpus {
  const scoped = teamId !== undefined && teamId.length > 0 ? teamId : undefined

  const [teamIssuesRaw, teamIssuesResult] = useQuery(
    scoped === undefined ? false : queries.issues.byTeam({ teamId: scoped }),
  )
  const [triageRaw, triageResult] = useQuery(
    scoped === undefined ? false : queries.triage.inbox({ teamId: scoped }),
  )
  const [cyclesRaw] = useQuery(
    scoped === undefined ? false : queries.cycles.byTeam({ teamId: scoped }),
  )
  const [labelsRaw] = useQuery(
    scoped === undefined ? false : queries.labels.byTeam({ teamId: scoped }),
  )
  const [mineRaw, mineResult] = useQuery(queries.issues.mine())
  const [projectsRaw] = useQuery(queries.projects.all())
  const [teamsRaw] = useQuery(queries.teams.all())

  const cache = useRef<Map<string, PlaintextCacheEntry>>(new Map())

  const { sources, byIdentity } = useMemo(() => {
    const teams = (teamsRaw ?? []) as readonly CorpusTeamRow[]
    const teamKeys = new Map(teams.map((team) => [team.id, team.key]))

    // Rebuilt rather than mutated so a row that has left every synced query stops costing memory.
    // Reusing the cached text by reference means a rebuild copies pointers, never re-walks.
    const nextCache = new Map<string, PlaintextCacheEntry>()
    const plaintextOf = (issue: CorpusIssueRow): string => {
      const hit = cache.current.get(issue.id)
      if (hit !== undefined && hit.updatedAt === issue.updatedAt) {
        nextCache.set(issue.id, hit)
        return hit.text
      }
      const text = richTextToPlainText(issue.description, {
        // `'label'` and not `'strip'`: a mention has to be findable by the person's name, which is
        // what it renders as. The names map is deliberately absent — resolving it would mean a
        // subscription to every user for a rename the server pass already indexes correctly, so
        // the on-device pass reads the stored label and the server pass is what stays current.
        mentions: 'label',
        maxLength: SEARCH_BODY_MAX_LENGTH,
      })
      nextCache.set(issue.id, { updatedAt: issue.updatedAt, text })
      return text
    }

    const issueEntries = (rows: readonly CorpusIssueRow[]): LocalCorpusEntry[] =>
      rows.map((issue) => {
        const teamKey = teamKeys.get(issue.teamId) ?? null
        return {
          kind: 'issue' as const,
          id: issue.id,
          title: issue.title,
          body: plaintextOf(issue),
          number: issue.number ?? null,
          teamKey,
          updatedAt: issue.updatedAt,
          teamId: issue.teamId,
          issueKey: issueKeyOf(issue.number, teamKey) ?? null,
          status: issue.status,
          needsTriage: issue.needsTriage,
        }
      })

    // Declaration order IS the dedupe order — the merge keeps the first occurrence of an identity,
    // so an issue reachable through both the team list and the triage inbox always resolves from
    // the same source and the same query twice produces the same list.
    const built: LocalCorpusEntry[][] = [
      issueEntries((teamIssuesRaw ?? []) as readonly CorpusIssueRow[]),
      issueEntries((triageRaw ?? []) as readonly CorpusIssueRow[]),
      issueEntries((mineRaw ?? []) as readonly CorpusIssueRow[]),
      namedEntries('project', (projectsRaw ?? []) as readonly CorpusNamedRow[]),
      namedEntries('cycle', (cyclesRaw ?? []) as readonly CorpusNamedRow[]),
      namedEntries('label', (labelsRaw ?? []) as readonly CorpusNamedRow[]),
      namedEntries('team', teams),
    ]

    cache.current = nextCache

    const index = new Map<string, LocalCorpusEntry>()
    for (const source of built) {
      for (const entry of source) {
        const key = identity(entry.kind, entry.id)
        if (!index.has(key)) index.set(key, entry)
      }
    }
    return { sources: built, byIdentity: index }
  }, [teamIssuesRaw, triageRaw, mineRaw, projectsRaw, cyclesRaw, labelsRaw, teamsRaw])

  const search = useCallback(
    (query: string, limit: number = LOCAL_RESULT_LIMIT): LocalSearchHit[] => {
      const hits: LocalSearchHit[] = []
      for (const result of mergeLocalCandidates(sources, query, limit)) {
        const entry = byIdentity.get(identity(result.candidate.kind, result.candidate.id))
        if (entry !== undefined) hits.push({ tier: result.tier, entry })
      }
      return hits
    },
    [sources, byIdentity],
  )

  const loaded =
    mineResult.type === 'complete' &&
    (scoped === undefined ||
      (teamIssuesResult.type === 'complete' && triageResult.type === 'complete'))

  return { search, size: byIdentity.size, loaded }
}
