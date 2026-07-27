import { matchesSearchText, normalizeQuery } from '@yapm/schema'
import type { ReactNode } from 'react'

// The palette's own filter, replacing `cmdk`'s.
//
// `cmdk` scores every item and then RE-SORTS items within a group and groups by their best item's
// score. Appending a "From the server" group 150 ms after the keystroke would therefore re-order
// every group above it — the exact reflow the two-group seam exists to prevent. So the palette
// runs `shouldFilter={false}` and filters here instead.
//
// The predicate is the shared core's, so "matches" means the same thing in the palette, in the
// issue list's text filter and in the on-device pass. It carries the `abbreviation` tier for this
// call site's sake: `cmdk` scored a fuzzy subsequence, so `gti` reached "Go to inbox", and a
// launcher that quietly stops answering the abbreviations people have learned is a regression
// nobody would report as one. The ORDER is declaration order, untouched:
// ranking action rows by tier would put "Assign…" above "Accept from triage" for one query and
// below it for the next, and a launcher whose rows move for reasons the user cannot see is worse
// than one that never moves at all.

export interface PaletteRow {
  /** Row identity: the cursor's key and the `cmdk` item value. Must be stable across renders. */
  readonly id: string
  /** The text this row is matched against. */
  readonly search: string
  readonly content: ReactNode
  readonly onSelect: () => void
  readonly shortcut?: string
}

export interface PaletteGroup {
  readonly id: string
  readonly heading: string
  readonly rows: readonly PaletteRow[]
}

/** An empty query shows everything, which is what a launcher opened with no input should do. */
export function paletteRowMatches(row: PaletteRow, query: string): boolean {
  if (normalizeQuery(query).length === 0) return true
  return matchesSearchText({ title: row.search }, query)
}

export function filterPaletteRows(
  rows: readonly PaletteRow[],
  query: string,
): readonly PaletteRow[] {
  if (normalizeQuery(query).length === 0) return rows
  return rows.filter((row) => paletteRowMatches(row, query))
}

/** Groups keep their declaration order and empty ones are dropped — a `cmdk` group with
 *  `shouldFilter={false}` renders its heading even with no items, so the surface must not
 *  hand it one. */
export function filterPaletteGroups(
  groups: readonly PaletteGroup[],
  query: string,
): PaletteGroup[] {
  const kept: PaletteGroup[] = []
  for (const group of groups) {
    const rows = filterPaletteRows(group.rows, query)
    if (rows.length > 0) kept.push({ ...group, rows })
  }
  return kept
}
