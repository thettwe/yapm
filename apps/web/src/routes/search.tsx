import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Authenticated } from '@/components/authenticated'
import { useDebouncedValue } from '@/lib/debounce'
import { SearchView } from '@/search/search-view'

interface SearchParams {
  q?: string
}

export const Route = createFileRoute('/search')({
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === 'string' && search.q.length > 0 ? search.q : undefined,
  }),
})

// Workspace-wide, like the inbox: search spans every team the caller may read, so it sits outside
// the `/teams/$teamId` tree.
function SearchPage() {
  return (
    <Authenticated>
      <AppShell current="Search">
        <SearchQuery />
      </AppShell>
    </Authenticated>
  )
}

// The URL settles a beat behind the keystroke. Writing it on every character would either fill the
// history with one entry per letter (breaking the back button) or fight the input for control of
// the caret; writing it late and with `replace` keeps the URL shareable and leaves the entry the
// caller arrived on as the one Back returns to.
const URL_SETTLE_MS = 400

function SearchQuery() {
  const { q } = Route.useSearch()
  const navigate = useNavigate()
  const urlQuery = q ?? ''
  const [text, setText] = useState(urlQuery)
  // What this component last wrote to the URL. Anything else arriving in `q` came from outside —
  // a shared link, a Back, the palette's escalation row — and must win over local state.
  const written = useRef(urlQuery)
  const settled = useDebouncedValue(text, URL_SETTLE_MS)

  useEffect(() => {
    if (urlQuery === written.current) return
    written.current = urlQuery
    setText(urlQuery)
  }, [urlQuery])

  useEffect(() => {
    if (settled === written.current) return
    written.current = settled
    void navigate({
      to: '/search',
      search: settled.length > 0 ? { q: settled } : {},
      replace: true,
    })
  }, [settled, navigate])

  return <SearchView query={text} onQueryChange={setText} />
}
