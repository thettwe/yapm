// The shared search core: tokenizing, the on-device tier ladder, and the merge.
//
// THIS DIRECTORY IMPORTS NOTHING OUTSIDE ITSELF. That is not tidiness — it is what lets the same
// functions run inside the browser's keystroke handler and inside the server's index writer, so the
// two passes can never disagree about what a document contains or what "matches" means. Adding an
// import here (a database client, a Zero type, a UI helper) is what would end that.
//
// What is NOT here: the SQL and its scoping predicate, which live in `db/search.ts` beside the
// other Kysely modules, and the route, which lives in `apps/server`. See design D1.

export type {
  LocalSearchCandidate,
  LocalSearchKind,
  LocalSearchResult,
} from './merge.js'
export {
  compareLocalResults,
  LOCAL_RESULT_LIMIT,
  LOCAL_SEARCH_KINDS,
  mergeLocalCandidates,
  SERVER_RESULT_LIMIT,
} from './merge.js'
export type { SearchTextFields, SearchTier } from './score.js'
export {
  issueKeyOf,
  matchesSearchText,
  SEARCH_TIERS,
  scoreSearchText,
  searchTierRank,
} from './score.js'
export type { SnippetSegment } from './snippet.js'
export {
  SNIPPET_START_DELIMITER,
  SNIPPET_STOP_DELIMITER,
  splitSnippet,
} from './snippet.js'
export {
  isServerSearchable,
  MIN_SERVER_QUERY_LENGTH,
  normalizeQuery,
  queryLength,
  tokenizeQuery,
} from './tokenize.js'
