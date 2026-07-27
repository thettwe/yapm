// How much of one rich-text document either pass will ever look at.
//
// Both consumers need a BOUND and they need the SAME bound: the indexer writes the projection into
// a row, the on-device cache holds one per synced issue, and a token past the cut must be missing
// from both or the two passes disagree about what a document contains — which is the one thing the
// shared core exists to prevent. `richTextToPlainText`'s `maxLength` short-circuits the walk, so a
// pathological document costs a known amount of work rather than however much its author pasted.
export const SEARCH_BODY_MAX_LENGTH = 20_000
