import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { routeTree } from './routeTree.gen'

vi.mock('@/auth/client', () => ({
  authClient: {},
  signIn: { email: vi.fn(), social: vi.fn(), sso: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => ({ data: null, isPending: false }),
}))

vi.mock('@/auth/use-auth-methods', () => ({
  useAuthMethods: () => ({ emailPassword: true, github: false, sso: true }),
}))

// Every `/teams/$teamId/*` route reads the connection pill in its own body, above `Authenticated`,
// so the hook runs even for a caller who is about to be redirected to login. It talks to the live
// Zero client; the routing facts this file asserts do not.
vi.mock('@/zero/connection', () => ({
  useConnectionSummary: () => ({
    state: 'connected',
    recovery: 'idle',
    label: 'Live',
    writable: true,
    retryOffered: false,
  }),
}))

vi.mock('@/zero/provider', () => ({
  useSyncSession: () => ({
    status: 'logged-out',
    userID: null,
    role: null,
    pmAudienceTeamIds: [],
    unavailable: false,
  }),
  useSyncControl: () => ({ retry: vi.fn(), refresh: vi.fn() }),
}))

test('the login route presents the sign-in surface to unauthenticated users', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /sign in to yapm/i })).toBeInTheDocument()
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  expect(screen.getByTestId('login-submit')).toBeInTheDocument()

  // The frame is for people who are in. A deck naming a workspace, or a statusline reporting a
  // team's day, to somebody who has not signed in would be chrome asserting facts it cannot have.
  expect(screen.queryByTestId('deck')).toBeNull()
  expect(screen.queryByTestId('statusline')).toBeNull()
})

// `/search` carries its query in the URL so a search is shareable and the back button behaves.
// The route is registered, it parses `q`, and — like every other in-app surface — it is behind
// `Authenticated`, so an unauthenticated caller lands on the sign-in surface instead of it.
test('the search route is registered, parses its query and is gated behind authentication', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/search?q=qzt-alpha'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /sign in to yapm/i })).toBeInTheDocument()

  const match = router.matchRoutes('/search', { q: 'qzt-alpha' })
  expect(match.at(-1)?.routeId).toBe('/search')
  expect(match.at(-1)?.search).toEqual({ q: 'qzt-alpha' })
})

// `/digests` is registered like any other route and is behind `Authenticated` first — whether the
// caller has an audience is decided AFTER that, inside the route, and never by the router. A route
// that existed only for named readers would be a permission fact encoded in the URL table, which
// every client downloads. `pm-digest.test.tsx` owns the audience gate itself.
test('the digests route is registered and gated behind authentication', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/digests'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /sign in to yapm/i })).toBeInTheDocument()
  expect(router.matchRoutes('/digests', {}).at(-1)?.routeId).toBe('/digests')
})

// The team Delivery view carries its window in the URL, so a reading is shareable and the back
// button behaves — the same reason `/search` carries `q`. `validateSearch` narrows to the three
// offered sizes, so a hand-typed window cannot ask for an unbounded one.
test('the delivery route is registered, narrows its window and is gated behind authentication', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/teams/team-1/delivery?window=6'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /sign in to yapm/i })).toBeInTheDocument()

  const match = router.matchRoutes('/teams/$teamId/delivery', { window: 6 })
  expect(match.at(-1)?.routeId).toBe('/teams/$teamId/delivery')
  expect(match.at(-1)?.search).toEqual({ window: 6 })

  // Anything outside 3 / 6 / 12 falls back to the default rather than reaching the builder.
  expect(
    router.matchRoutes('/teams/$teamId/delivery', { window: 999 } as never).at(-1)?.search,
  ).toEqual({ window: 6 })
})

// The route inventory (design §D8). Losing a route is a regression, and the way a route gets lost
// is not deletion — it is a page that no surface points at any more. Every registered route names
// the ONE place in the frame a reader reaches it from; a new route with no home fails this test,
// which is the only moment anyone is guaranteed to be thinking about where it belongs.
//
//   stop        one of the deck's six bar stops
//   more        the `more▾` transient
//   switcher    the workspace/team chevron's menu
//   user-menu   the user chip's menu
//   deck-right  the deck's right cluster (⌘K, the attention badge, Inbox)
//   doorway     reached from a row or control on a page that itself has a home
//   dev-only    stripped from production builds; reachable from the account menu in dev
//   open        unauthenticated, deliberately outside the frame
const ROUTE_HOMES = {
  '/': 'switcher',
  '/inbox': 'deck-right',
  '/search': 'deck-right',
  '/digests': 'user-menu',
  // Dev-only, and deliberately outside the frame: the app's chrome would fight the theme blocks
  // the gallery renders. It is not a production destination, so it is not an authenticated one.
  '/showcase': 'dev-only',
  '/settings/ai': 'user-menu',
  '/settings/connectors': 'user-menu',
  '/settings/sso': 'user-menu',
  '/teams/$teamId/': 'stop',
  '/teams/$teamId/issues/': 'stop',
  '/teams/$teamId/triage': 'stop',
  '/teams/$teamId/cycles': 'stop',
  '/teams/$teamId/delivery': 'stop',
  '/teams/$teamId/retros/': 'more',
  '/teams/$teamId/projects': 'more',
  '/teams/$teamId/roadmap': 'more',
  // Board is a LENS in the Issues masthead, not a destination — which is why the Issues stop stays
  // current on it and `ViewSwitch`'s eight-item pill nav is gone.
  '/teams/$teamId/board': 'doorway',
  '/teams/$teamId/issues/$issueKey': 'doorway',
  '/teams/$teamId/retros/$retroId': 'doorway',
  '/teams/$teamId/members': 'switcher',
  '/login': 'open',
  '/invite': 'open',
} as const

test('every registered route has an honest home in the frame', () => {
  const router = createRouter({ routeTree, history: createMemoryHistory() })

  const registered = Object.keys(router.routesById)
    .filter((id) => id !== '__root__')
    // The router registers both the layout id and its index child for a nested route; the index is
    // the one a reader lands on, and the bare prefix is not separately reachable.
    .filter((id) => !Object.keys(router.routesById).includes(`${id}/`))
    .sort()

  expect(registered).toEqual(Object.keys(ROUTE_HOMES).sort())
})

// A route id maps to its file by TanStack's own flat-file convention: `/teams/$teamId/issues/` is
// `teams.$teamId.issues.index.tsx`.
function routeFile(id: string): string {
  const path = id === '/' ? 'index' : id.replace(/^\//u, '').replace(/\/$/u, '/index')
  return `routes/${path.replaceAll('/', '.')}.tsx`
}

// Where each route's frame actually lives. Almost always the route file; `/digests` is the one
// exception and a named one — `PmDigestView` renders NOTHING when the reader has nothing to read,
// so the frame sits inside it rather than around it, or an unaddressed reader would get a deck over
// an empty page.
const FRAME_FILE: Partial<Record<keyof typeof ROUTE_HOMES, string>> = {
  '/digests': 'pm-digest/pm-digest-view.tsx',
}

// The table above says where a reader finds each route. This says whether the route is actually
// IN the frame — the property the table only names. It fails on a new authenticated route that
// forgets `AppFrame`, and on a frame-free surface that grows one.
test('every route with a home in the frame renders inside it, and the frame-free ones do not', () => {
  // `process.cwd()` is `apps/web` under vitest — `runtime-config.test.tsx`'s precedent.
  const src = join(process.cwd(), 'src')

  const framed = (Object.keys(ROUTE_HOMES) as (keyof typeof ROUTE_HOMES)[]).filter((id) =>
    readFileSync(join(src, FRAME_FILE[id] ?? routeFile(id)), 'utf8').includes('<AppFrame'),
  )

  // Everything except the two signed-out surfaces and the dev-only gallery, whose three theme
  // blocks the app's own chrome would fight.
  const expected = Object.entries(ROUTE_HOMES)
    .filter(([, home]) => home !== 'open' && home !== 'dev-only')
    .map(([id]) => id)

  expect(framed.sort()).toEqual(expected.sort())
})
