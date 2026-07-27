import { SERVER_RESULT_LIMIT } from '@yapm/schema'

// Mirrors the server's `SearchResponse` (`apps/server/src/search/routes.ts`). A mirror rather than
// an import because the web app may not import the server app — the same seam `settings/ai.ts`
// already sits on.
//
// The shape is INVARIANT across every non-401 outcome: a miss, an out-of-scope hit, a blank query,
// a sub-minimum query, an unparseable query and a statement timeout all arrive as exactly these
// bytes. Nothing here should ever grow a total, a count of withheld rows, or a partial flag —
// each of those would be a way for a caller to learn that a row they may not read exists.
export interface ServerSearchResult {
  readonly type: 'issue' | 'comment'
  readonly id: string
  readonly issueId: string
  readonly teamId: string
  readonly issueKey: string | null
  readonly issueTitle: string
  readonly status: string
  readonly needsTriage: boolean
  readonly snippet: string
  readonly updatedAt: string
}

export interface ServerSearchResponse {
  readonly results: readonly ServerSearchResult[]
  readonly truncated: boolean
}

export const SEARCH_API = '/api/v1/search'

export const EMPTY_SERVER_RESPONSE: ServerSearchResponse = { results: [], truncated: false }

export interface ServerSearchRequest {
  readonly query: string
  readonly teamId?: string | undefined
  readonly limit?: number | undefined
  readonly signal: AbortSignal
}

export function searchUrl({ query, teamId, limit }: Omit<ServerSearchRequest, 'signal'>): string {
  const params = new URLSearchParams({ q: query })
  if (teamId !== undefined) params.set('teamId', teamId)
  if (limit !== undefined && limit !== SERVER_RESULT_LIMIT) params.set('limit', String(limit))
  return `${SEARCH_API}?${params.toString()}`
}

export async function fetchServerSearch(
  request: ServerSearchRequest,
): Promise<ServerSearchResponse> {
  const response = await fetch(searchUrl(request), {
    credentials: 'include',
    signal: request.signal,
  })
  // The route's only non-200 is 401, and a session that expired mid-search is the sync layer's
  // problem to recover, not search's. Answering it as an empty server group keeps the surface in
  // one of its stated states instead of inventing an error state nobody designed.
  if (!response.ok) return EMPTY_SERVER_RESPONSE
  return (await response.json()) as ServerSearchResponse
}
