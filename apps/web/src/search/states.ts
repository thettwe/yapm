import { SERVER_RESULT_LIMIT } from '@yapm/schema'
import type { ServerSearchPhase } from '@/search/use-server-search'

// Design D17's state table, verbatim and in ONE place. The palette and the `/search` route both
// read these strings, so the two surfaces cannot drift into saying different things about the same
// situation — and a reviewer checking the table against the product only has one file to check.
//
// Every rule below is a property of the QUERY and of the connection, never of whether a row
// existed. A state that appeared only when something matched would be an oracle over rows the
// caller may not read, which is the failure mode this whole change is organised around.

export const SEARCH_GROUP_LOCAL = 'On this device'
export const SEARCH_GROUP_SERVER = 'From the server'

export const SEARCH_TOO_SHORT = 'Keep typing to search everything'
export const SEARCH_IN_FLIGHT = 'Searching…'
export const SEARCH_NO_FURTHER = 'No further matches'
export const SEARCH_OFFLINE = 'Offline — on-device results only'
export const SEARCH_CAPPED = `Showing the first ${SERVER_RESULT_LIMIT} — refine your query`
export const SEARCH_EMPTY_REFINE = 'Try fewer or different words.'
export const SEARCH_EMPTY_STALE = 'Recently edited items can take a few seconds to appear.'

export function searchEmptyHeadline(query: string): string {
  return `No matches for "${query}".`
}

export function searchEverythingLabel(query: string): string {
  return `Search everything for "${query}" →`
}

export interface ServerGroupState {
  readonly phase: ServerSearchPhase
  readonly resultCount: number
  readonly truncated: boolean
}

/**
 * The one line the server group carries under its heading, or `undefined` when the group is
 * showing results and has nothing to add.
 *
 * `No further matches` is deliberately NOT conditioned on the on-device group having hits here:
 * the surface decides whether to show the group at all (both-empty collapses into the single
 * empty state), and this function stays a pure map from the phase.
 */
export function serverGroupLine(state: ServerGroupState): string | undefined {
  switch (state.phase) {
    case 'too-short':
      return SEARCH_TOO_SHORT
    case 'offline':
      return SEARCH_OFFLINE
    case 'searching':
      return SEARCH_IN_FLIGHT
    case 'ready':
      if (state.resultCount === 0) return SEARCH_NO_FURTHER
      return state.truncated ? SEARCH_CAPPED : undefined
  }
}

function countPhrase(count: number, suffix: string): string {
  return `${count} ${count === 1 ? 'result' : 'results'} ${suffix}`
}

/**
 * What the single polite live region says. ONE region and ONE sentence for the whole surface: two
 * regions, or a region per group, would let a late-arriving server group interrupt somebody who is
 * mid-arrow, which is the same defect as reflowing the list — just in the audio channel.
 */
export function searchAnnouncement(localCount: number, state: ServerGroupState): string {
  const local = countPhrase(localCount, 'on this device')
  if (state.phase === 'ready') {
    return `${local}, ${countPhrase(state.resultCount, 'from the server')}.`
  }
  return `${local}. ${serverGroupLine(state) ?? ''}`.trimEnd()
}
