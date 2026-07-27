import { useQuery } from '@rocicorp/zero/react'
import { queries } from '@yapm/schema'
import { SearchResultRow } from '@yapm/ui/components/search-result-row'
import { SearchIcon } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef } from 'react'
import { ownsKeyboard } from '@/lib/keyboard'
import { useSearchCursor } from '@/search/cursor'
import { localSearchRows, type SearchRow } from '@/search/results'
import {
  SEARCH_EMPTY_REFINE,
  SEARCH_EMPTY_STALE,
  SEARCH_GROUP_LOCAL,
  SEARCH_GROUP_SERVER,
  searchAnnouncement,
  searchEmptyHeadline,
  serverGroupLine,
} from '@/search/states'
import { useLocalSearchCorpus } from '@/search/use-local-corpus'
import { useOpenSearchResult } from '@/search/use-open-result'
import { useDedupedServerRows } from '@/search/use-server-rows'
import { useServerSearch } from '@/search/use-server-search'

export interface SearchViewProps {
  query: string
  onQueryChange: (query: string) => void
}

/**
 * The full search surface. Workspace-wide: it sends NO `teamId`, so the server pass covers every
 * team the caller may read and the on-device group is the thin one (`issues.mine`, `projects.all`,
 * `teams.all`) — which is design D15's thesis working rather than a gap.
 *
 * The surface is a combobox over a single listbox with two groups. One list, two headings: the
 * arrow keys cross the group boundary without the user having to know it is there, while the
 * headings still expose the seam structurally so assistive tech conveys which pass answered.
 */
export function SearchView({ query, onQueryChange }: SearchViewProps) {
  const [teams] = useQuery(queries.teams.all())
  const corpus = useLocalSearchCorpus()
  const server = useServerSearch(query)
  const openResult = useOpenSearchResult()

  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const localHeadingId = useId()
  const serverHeadingId = useId()
  const rowIdPrefix = useId()

  // Projects are workspace-level and their view is only mounted under a team route, so a project
  // row needs SOME team to render under. Off the full route there is no open team, so the first
  // team in the workspace's stable ordering is used; the view it opens is workspace-level either
  // way, so the choice affects the header and nothing else.
  const fallbackTeamId = teams[0]?.id

  const localRows = useMemo(
    () => localSearchRows(corpus.search(query), fallbackTeamId),
    [corpus, query, fallbackTeamId],
  )
  const serverRows = useDedupedServerRows(query, localRows, server.results)

  const rowIds = useMemo(
    () => [...localRows, ...serverRows].map((row) => row.id),
    [localRows, serverRows],
  )
  const { active, setActive } = useSearchCursor(rowIds)

  const domId = useCallback((rowId: string) => `${rowIdPrefix}-${rowId}`, [rowIdPrefix])

  useEffect(() => {
    if (active === '') return
    document.getElementById(domId(active))?.scrollIntoView({ block: 'nearest' })
  }, [active, domId])

  // Type-to-search from anywhere on the page, and the ONLY window-level key handler this surface
  // installs. It asks `ownsKeyboard` first, so a printable character typed into another field —
  // or into an open dialog — is never stolen to focus this input. No shortcut is added: Cmd-K
  // remains the product's single global keybinding.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.length !== 1) return
      if (ownsKeyboard(event.target)) return
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const move = useCallback(
    (delta: number) => {
      if (rowIds.length === 0) return
      const index = rowIds.indexOf(active)
      const next = Math.min(rowIds.length - 1, Math.max(0, index + delta))
      setActive(rowIds[next] ?? rowIds[0] ?? '')
    },
    [rowIds, active, setActive],
  )

  const openActive = useCallback(() => {
    const row = [...localRows, ...serverRows].find((candidate) => candidate.id === active)
    if (row !== undefined) openResult(row.target)
  }, [localRows, serverRows, active, openResult])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          move(1)
          return
        case 'ArrowUp':
          event.preventDefault()
          move(-1)
          return
        case 'Home':
          if (rowIds.length === 0) return
          event.preventDefault()
          setActive(rowIds[0] ?? '')
          return
        case 'End':
          if (rowIds.length === 0) return
          event.preventDefault()
          setActive(rowIds[rowIds.length - 1] ?? '')
          return
        case 'Enter':
          event.preventDefault()
          openActive()
          return
        case 'Escape':
          // There is no dialog here to dismiss, and the cursor rule guarantees an active row
          // whenever rows exist, so Escape cannot "release" it. What it does instead is return:
          // the caret goes back to the input and the cursor back to the top of the list, leaving
          // the query intact. Destroying somebody's query on Escape would be the surprising read.
          event.preventDefault()
          setActive(rowIds[0] ?? '')
          inputRef.current?.focus()
      }
    },
    [move, openActive, rowIds, setActive],
  )

  const state = {
    phase: server.phase,
    resultCount: serverRows.length,
    truncated: server.truncated,
  }
  const bothEmpty =
    query.trim().length > 0 &&
    localRows.length === 0 &&
    serverRows.length === 0 &&
    server.phase === 'ready'
  const serverLine = bothEmpty ? undefined : serverGroupLine(state)

  return (
    <div className="flex flex-col gap-4">
      {/* Every sibling primary surface renders one, and a shared `/search?q=` URL opens straight
          onto this view — with no heading, heading navigation has nothing to land on. */}
      <h1 className="text-sm font-semibold tracking-tight text-text-1">Search</h1>

      <div className="flex h-11 items-center gap-3 rounded-control border border-border bg-bg-elevated px-3 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-text-3" />
        <input
          ref={inputRef}
          // biome-ignore lint/a11y/noAutofocus: a search route whose caret starts anywhere but the query field costs every keyboard caller a Tab before they can type
          autoFocus
          type="text"
          role="combobox"
          aria-label="Search"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          {...(active === '' ? {} : { 'aria-activedescendant': domId(active) })}
          placeholder="Search issues and comments…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          data-testid="search-input"
          className="flex-1 bg-transparent font-ui text-base text-text-1 placeholder:text-text-3 outline-none"
        />
      </div>

      <p className="sr-only" role="status" aria-live="polite" data-testid="search-announcement">
        {searchAnnouncement(localRows.length, state)}
      </p>

      <div id={listId} role="listbox" aria-label="Search results" className="flex flex-col gap-4">
        {localRows.length > 0 ? (
          // biome-ignore lint/a11y/useSemanticElements: a `fieldset` inside a `listbox` is not a listbox child ARIA allows; `group` is the role that carries a labelled section of options
          <div role="group" aria-labelledby={localHeadingId}>
            <GroupHeading id={localHeadingId}>{SEARCH_GROUP_LOCAL}</GroupHeading>
            {localRows.map((row) => (
              <ResultOption
                key={row.id}
                row={row}
                domId={domId(row.id)}
                active={row.id === active}
                onActivate={() => {
                  setActive(row.id)
                  openResult(row.target)
                }}
              />
            ))}
          </div>
        ) : null}

        {/* biome-ignore lint/a11y/useSemanticElements: see the on-device group above */}
        <div role="group" aria-labelledby={serverHeadingId}>
          <GroupHeading id={serverHeadingId}>{SEARCH_GROUP_SERVER}</GroupHeading>
          {serverRows.map((row) => (
            <ResultOption
              key={row.id}
              row={row}
              domId={domId(row.id)}
              active={row.id === active}
              onActivate={() => {
                setActive(row.id)
                openResult(row.target)
              }}
            />
          ))}
        </div>
      </div>

      {/* Outside the listbox on purpose: a `<p>` among the options is a non-option child of a role
          that only allows options and groups, so assistive tech may drop it or mis-count the list.
          It is the group's caption, and the live region above carries the same fact in the audio
          channel. */}
      {serverLine === undefined ? null : (
        <p className="px-3 font-ui text-[13px] text-text-3" data-testid="search-server-state">
          {serverLine}
        </p>
      )}

      {bothEmpty ? (
        <div className="flex flex-col gap-1 px-3 py-6" data-testid="search-empty">
          <p className="font-ui text-sm text-text-1">{searchEmptyHeadline(query)}</p>
          <p className="font-ui text-[13px] text-text-3">{SEARCH_EMPTY_REFINE}</p>
          <p className="font-ui text-[13px] text-text-3">{SEARCH_EMPTY_STALE}</p>
        </div>
      ) : null}
    </div>
  )
}

function GroupHeading({ id, children }: { id: string; children: string }) {
  return (
    <div
      id={id}
      className="px-3 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.07em] text-text-3"
    >
      {children}
    </div>
  )
}

function ResultOption({
  row,
  domId,
  active,
  onActivate,
}: {
  row: SearchRow
  domId: string
  active: boolean
  onActivate: () => void
}) {
  return (
    <SearchResultRow
      id={domId}
      role="option"
      aria-selected={active}
      kind={row.kind}
      issueKey={row.issueKey}
      title={row.title}
      snippet={row.snippet}
      states={row.states}
      active={active}
      onClick={onActivate}
      className="cursor-default rounded-control"
    />
  )
}
