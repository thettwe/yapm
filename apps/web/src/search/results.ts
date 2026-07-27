import type { SearchResultKind, SearchResultState } from '@yapm/ui/components/search-result-row'
import type { ServerSearchResult } from '@/search/api'
import type { LocalSearchHit } from '@/search/use-local-corpus'

// The bridge between the two passes and the data-agnostic `SearchResultRow`. Both surfaces read
// it, so the palette and `/search` render a hit identically and a row's identity means the same
// thing in both — which is what lets the keyboard cursor be keyed to that identity.

/** Where activating a row goes. A discriminated union rather than a router options object so the
 *  mapping stays pure and testable and the typed `navigate` call sites stay in one hook. */
export type SearchTarget =
  | { readonly kind: 'issue'; readonly teamId: string; readonly issueId: string }
  | { readonly kind: 'project'; readonly teamId: string; readonly projectId: string }
  | { readonly kind: 'cycles'; readonly teamId: string }
  | { readonly kind: 'team'; readonly teamId: string }

export interface SearchRow {
  /** Stable across a re-render and across the server group arriving. The cursor is keyed to it. */
  readonly id: string
  readonly kind: SearchResultKind
  readonly issueKey: string | null
  readonly title: string
  readonly snippet: string | null
  readonly states: readonly SearchResultState[]
  readonly target: SearchTarget
}

function issueStates(status: string | null, needsTriage: boolean): SearchResultState[] {
  const states: SearchResultState[] = []
  // Triage first: it is the state that explains why every list is holding the row out, which is
  // the question somebody who just found it here is asking.
  if (needsTriage) states.push('triage')
  if (status === 'canceled') states.push('canceled')
  return states
}

/**
 * An on-device hit as a row, or `undefined` when the surface cannot open it.
 *
 * `fallbackTeamId` is the team whose surface is open. Projects are workspace-level and cycles and
 * labels reach the corpus only through a team-scoped subscription, so the team they are rendered
 * under is the surface's, not the row's. A row with no resolvable destination is DROPPED rather
 * than rendered inert: every result must be openable, or Enter becomes a key that sometimes does
 * nothing.
 */
export function localSearchRow(
  hit: LocalSearchHit,
  fallbackTeamId?: string,
): SearchRow | undefined {
  const { entry } = hit
  const id = `local:${entry.kind}:${entry.id}`
  const base = { id, issueKey: entry.issueKey, title: entry.title, snippet: null }

  switch (entry.kind) {
    case 'issue':
      if (entry.teamId === null) return undefined
      return {
        ...base,
        kind: 'issue',
        states: issueStates(entry.status, entry.needsTriage),
        target: { kind: 'issue', teamId: entry.teamId, issueId: entry.id },
      }
    case 'team':
      return { ...base, kind: 'team', states: [], target: { kind: 'team', teamId: entry.id } }
    case 'project':
      if (fallbackTeamId === undefined) return undefined
      return {
        ...base,
        kind: 'project',
        states: [],
        target: { kind: 'project', teamId: fallbackTeamId, projectId: entry.id },
      }
    case 'cycle':
      if (fallbackTeamId === undefined) return undefined
      return {
        ...base,
        kind: 'cycle',
        states: [],
        target: { kind: 'cycles', teamId: fallbackTeamId },
      }
    case 'label':
      // A label has no URL of its own — the issue list's filters are component state, not search
      // params — so its row opens the team whose labels it came from. Stated here rather than
      // silently: if a label-scoped URL ever exists, this is the one line that changes.
      if (fallbackTeamId === undefined) return undefined
      return {
        ...base,
        kind: 'label',
        states: [],
        target: { kind: 'team', teamId: fallbackTeamId },
      }
  }
}

/**
 * A server hit as a row. A comment result is attributed to its ISSUE — key, title and destination
 * all the issue's — with the comment's own text as the snippet, because a comment has no surface
 * of its own to open.
 */
export function serverSearchRow(result: ServerSearchResult): SearchRow {
  return {
    id: `server:${result.type}:${result.id}`,
    kind: result.type,
    issueKey: result.issueKey,
    title: result.issueTitle,
    snippet: result.snippet.length > 0 ? result.snippet : null,
    states: issueStates(result.status, result.needsTriage),
    target: { kind: 'issue', teamId: result.teamId, issueId: result.issueId },
  }
}

export function localSearchRows(
  hits: readonly LocalSearchHit[],
  fallbackTeamId?: string,
): SearchRow[] {
  const rows: SearchRow[] = []
  for (const hit of hits) {
    const row = localSearchRow(hit, fallbackTeamId)
    if (row !== undefined) rows.push(row)
  }
  return rows
}

export function serverSearchRows(results: readonly ServerSearchResult[]): SearchRow[] {
  return results.map(serverSearchRow)
}
