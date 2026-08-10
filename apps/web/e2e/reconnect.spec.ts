import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { ADMIN, ensureAccount } from './support'

const NAME = '[data-testid="workspace-name"]'
const INPUT = '[data-testid="workspace-name-input"]'
const STATUS = '[data-testid="connection-status"]'
const TOKEN_URL = '**/api/zero/token'

const ZERO_CACHE_HOST = new URL(process.env.E2E_ZERO_CACHE_URL ?? 'http://localhost:4848').host

// Zero reports `connected` when the socket opens, *before* zero-cache runs the `/query`
// round trip that validates the credential, so a refused connection flaps through
// `connected` every cycle. Only a connection that holds this long is a recovery.
const HELD_MS = 5_000

// Long enough for the backoff to have stretched over several attempts.
const OUTAGE_WINDOW_MS = 15_000

interface ReconnectProbe {
  ticks: number
  transitions: string[]
}

declare global {
  interface Window {
    __yapmReconnectProbe?: ReconnectProbe
  }
}

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`
}

async function openWorkspace(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator(NAME)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected')
}

async function renameWithKeyboard(page: Page, next: string): Promise<void> {
  await page.locator(NAME).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator(INPUT)).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(next)
  await page.keyboard.press('Enter')
}

// Planted once, before the outage, and never re-planted: everything it holds is lost to a
// reload, so its survival is what proves recovery did not go through one. Its heartbeat is
// what proves the main thread kept servicing timers instead of being pinned by a retry loop.
async function plantProbe(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const probe: ReconnectProbe = { ticks: 0, transitions: [] }
    window.__yapmReconnectProbe = probe
    window.setInterval(() => {
      probe.ticks += 1
    }, 250)

    const record = () => {
      const pill = document.querySelector(selector)
      if (pill === null) return
      const seen = `${pill.getAttribute('data-connection')}/${pill.getAttribute('data-recovery')}`
      if (probe.transitions.at(-1) !== seen) probe.transitions.push(seen)
    }
    record()
    new MutationObserver(record).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-connection', 'data-recovery'],
    })
  }, STATUS)
}

async function readProbe(page: Page): Promise<ReconnectProbe> {
  const probe = await page.evaluate(() => window.__yapmReconnectProbe ?? null)
  expect(probe, 'the page-lifetime probe is gone — the page reloaded').not.toBeNull()
  return probe as ReconnectProbe
}

async function expectTransition(page: Page, pattern: RegExp, timeout = 60_000): Promise<void> {
  await expect
    .poll(async () => (await readProbe(page)).transitions.join(' '), { timeout })
    .toMatch(pattern)
}

async function expectHeldConnected(page: Page, timeout: number): Promise<void> {
  const pill = page.locator(STATUS)
  await expect
    .poll(
      async () => {
        if ((await pill.getAttribute('data-connection')) !== 'connected') return false
        await page.waitForTimeout(HELD_MS)
        return (await pill.getAttribute('data-connection')) === 'connected'
      },
      { timeout, message: 'sync never held a connection' },
    )
    .toBe(true)
}

// `refuse` is zero-cache being unreachable — a restart, a crash, a dropped tunnel. A `fail`
// mode stands in for zero-cache accepting the socket and then killing the connection with
// one of the protocol errors it really sends.
type SocketMode = 'pass-through' | 'refuse' | { fail: string }

interface SyncSocket {
  set: (mode: SocketMode) => void
  intercepted: () => number
}

// Must be installed before the first navigation: Playwright intercepts WebSockets by
// patching the constructor from an init script, so a route added to an already-loaded page
// never sees the socket. It starts in `pass-through` for the same reason — the app has to
// sign in and sync normally through it before an outage means anything.
async function interceptSyncSocket(page: Page): Promise<SyncSocket> {
  let mode: SocketMode = 'pass-through'
  let intercepted = 0

  await page.routeWebSocket(
    (url) => url.host === ZERO_CACHE_HOST,
    async (ws) => {
      const current = mode
      if (current === 'pass-through') {
        ws.connectToServer()
        return
      }
      intercepted += 1
      if (current === 'refuse') {
        await ws.close({ code: 1012, reason: 'zero-cache restarting' })
        return
      }
      // Zero 1.8 carries `initConnection` in the socket URL, so nothing arrives from the
      // page to answer: the error has to be pushed as soon as the socket is up.
      ws.send(current.fail)
      ws.onMessage(() => ws.send(current.fail))
    },
  )

  return {
    set: (next) => {
      mode = next
    },
    intercepted: () => intercepted,
  }
}

// The escape hatch the recovery spec is actually about: by this point the backoff has
// stretched to tens of seconds, so a token request arriving within a second of pressing
// Enter can only have come from the button. Reached by Tab alone — the pill lives in the
// statusline now (band 3, at the end of the document rather than the start of it), and nothing
// here may need a pointer.
//
// The walk's length is DERIVED from the page, never guessed. That move put the retry LAST in the
// tab ring, and the ring on `/` is as long as the shared e2e workspace has grown: every earlier
// spec that creates a team, a member or an invite adds stops in front of it, so a constant here
// measures how much fixture data happened to accumulate rather than whether the control is
// reachable. "Reachable by Tab alone" means "landed on within one pass of the ring", so one pass
// of the ring is the honest bound — and the assertion below is unchanged by it. A retry that is
// `inert`, out of the tab order, unmounted, or sealed inside a focus trap is never focused however
// many stops the walk is given.
async function retryFromTheKeyboard(page: Page): Promise<void> {
  const retry = page.getByTestId('connection-retry')
  await expect(retry).toBeVisible()

  // `auto-status.spec.ts`'s `tabTo` bounds its walk the same way. Overcounting is the safe
  // direction — radio groups, disabled controls and `tabindex="-1"` nodes all inflate this and only
  // make the bound generous, while UNDERcounting would fail a button that is genuinely reachable.
  // So the two stops a selector cannot see are added rather than hoped away: Chromium gives an
  // overflow container with no keyboard-focusable descendant a stop of its own (measured), and a
  // media element's shadow controls take more than the one its tag suggests. The app renders no
  // shadow root and no iframe, so nothing else tabbable sits outside this count.
  const ring = await page.evaluate(() => {
    const focusable =
      'a[href], area[href], button, input, select, textarea, summary, [contenteditable], [tabindex]'
    const scrollers = [...document.querySelectorAll<HTMLElement>('*')].filter((node) => {
      if (node.querySelector(focusable) !== null) return false
      const style = getComputedStyle(node)
      const scrollsDown =
        node.scrollHeight > node.clientHeight && /auto|scroll/.test(style.overflowY)
      const scrollsAcross =
        node.scrollWidth > node.clientWidth && /auto|scroll/.test(style.overflowX)
      return scrollsDown || scrollsAcross
    }).length
    return document.querySelectorAll(focusable).length + scrollers + 8
  })

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (let stop = 0; stop <= ring; stop += 1) {
    if (await retry.evaluate((node) => node === document.activeElement)) break
    await page.keyboard.press('Tab')
  }
  await expect(
    retry,
    `Retry now must be reachable by Tab alone (walked ${ring} stops, one full pass of this page)`,
  ).toBeFocused()

  const minted = page.waitForRequest((request) => request.url().includes('/api/zero/token'), {
    timeout: 2_000,
  })
  await page.keyboard.press('Enter')
  await minted
}

// A route only takes effect on the *next* socket, so the live one has to drop first. This is
// also how the outage starts for real: an idle machine's network goes away underneath an
// open connection. The redial itself is served by the route, which is why the interception
// count — not the connection state — is what says the outage has begun.
async function startOutage(context: BrowserContext, socket: SyncSocket): Promise<void> {
  await context.setOffline(true)
  await expect.poll(socket.intercepted, { timeout: 60_000 }).toBeGreaterThan(0)
  await context.setOffline(false)
}

test('a refused sync socket reports reconnecting and recovers without a reload', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000)
  const socket = await interceptSyncSocket(page)
  await openWorkspace(page)
  await plantProbe(page)

  socket.set('refuse')
  await startOutage(context, socket)

  await expectTransition(page, /disconnected\/(waiting|retrying)/)
  await expect(page.getByRole('status').filter({ hasText: 'Offline — retrying' })).toBeVisible()
  await expect(page.locator(NAME)).toBeVisible()

  socket.set('pass-through')
  await expectHeldConnected(page, 90_000)

  const next = unique('Recovered from a refused socket')
  await renameWithKeyboard(page, next)
  await expect(page.locator(NAME)).toHaveText(next)

  const probe = await readProbe(page)
  expect(probe.ticks, 'the main thread kept running').toBeGreaterThan(20)

  await page.reload()
  await expect(page.locator(NAME)).toHaveText(next)
})

// Both are states Zero parks in — it does not retry out of `error` or `needs-auth` by itself
// (reference/zero.md §13) — and both are what the production freeze was made of: the
// view-syncer's fatal `InvalidConnectionRequest`, and the `Unauthorized` an expired
// credential produces now that the endpoints answer 401. The rest of the stack is healthy
// here, so the credential the client re-mints is byte-identical to the one it already holds:
// the case where an unchanged `auth` prop cannot resume the connection on its own.
const PROTOCOL_FAILURES = [
  {
    title: 'a fatal sync protocol error',
    kind: 'InvalidConnectionRequest',
    message: 'No validated connection is available for shared query work.',
    connection: 'error',
    label: 'Sync error — retrying',
  },
  {
    title: 'a rejected sync credential',
    kind: 'Unauthorized',
    message: 'Failed to validate connection: HTTP 401',
    connection: 'needs-auth',
    label: 'Sign-in expired — reconnecting',
  },
] as const

for (const failure of PROTOCOL_FAILURES) {
  test(`${failure.title} recovers on its own, calmly, without a reload`, async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000)
    const socket = await interceptSyncSocket(page)
    await openWorkspace(page)
    await plantProbe(page)

    let mints = 0
    page.on('request', (request) => {
      if (request.url().includes('/api/zero/token')) mints += 1
    })

    // `origin` is load-bearing, not decoration: the client only classifies an error body as
    // a server error — and only then routes `Unauthorized` to `needs-auth` — when the origin
    // says it came from zero-cache. Without it every kind collapses into a generic `error`.
    const body = { kind: failure.kind, message: failure.message, origin: 'zeroCache' }
    socket.set({ fail: JSON.stringify(['error', body]) })
    await startOutage(context, socket)

    await expectTransition(page, new RegExp(`${failure.connection}/`))
    await expect(page.getByRole('status').filter({ hasText: failure.label })).toBeVisible()
    expect(new URL(page.url()).pathname, 'broken sync is not a sign-out').not.toBe('/login')
    await expect(page.locator(NAME)).toBeVisible()

    const before = await readProbe(page)
    const mintsBefore = mints
    await page.waitForTimeout(OUTAGE_WINDOW_MS)
    const during = await readProbe(page)

    expect(mints - mintsBefore, 'a persistent fault must back off, not hot-loop').toBeLessThan(12)
    expect(mints - mintsBefore, 'the client must keep trying').toBeGreaterThan(0)
    expect(during.ticks - before.ticks, 'the main thread stayed responsive').toBeGreaterThan(20)
    await expect(page.locator(NAME)).toBeVisible()

    await retryFromTheKeyboard(page)

    socket.set('pass-through')
    await expectHeldConnected(page, 120_000)

    const next = unique(`Recovered from ${failure.kind}`)
    await renameWithKeyboard(page, next)
    await expect(page.locator(NAME)).toHaveText(next)

    const probe = await readProbe(page)
    expect(probe.transitions.join(' ')).toMatch(/connected\/idle/)

    await page.reload()
    await expect(page.locator(NAME)).toHaveText(next)
  })
}

test('a failing sync-token request keeps the user signed in and retries from the keyboard', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openWorkspace(page)

  let failing = true
  await page.route(TOKEN_URL, async (route) => {
    if (failing) {
      await route.abort('connectionfailed')
      return
    }
    await route.continue()
  })

  await page.reload()

  const retry = page.getByTestId('sync-unavailable-retry')
  await expect(page.getByTestId('sync-unavailable')).toBeVisible({ timeout: 30_000 })
  expect(new URL(page.url()).pathname, 'a failed request is not a sign-out').not.toBe('/login')

  await page.keyboard.press('Tab')
  await expect(retry).toBeFocused()

  failing = false
  await page.keyboard.press('Enter')

  await expect(page.locator(NAME)).toBeVisible({ timeout: 30_000 })
  await expectHeldConnected(page, 90_000)
})

test('a hung sync-token request is abandoned for an actionable retry', async ({ page }) => {
  test.setTimeout(120_000)
  await openWorkspace(page)

  let hanging = true
  await page.route(TOKEN_URL, async (route) => {
    if (hanging) {
      // Outlives the client's 10s request timeout: the app must abandon the request rather
      // than sit at "Loading…" for as long as the socket stays open.
      await new Promise((resolve) => setTimeout(resolve, 20_000))
    }
    await route.continue()
  })

  await page.reload()
  await expect(page.getByTestId('sync-unavailable')).toBeVisible({ timeout: 20_000 })

  hanging = false
  await page.getByTestId('sync-unavailable-retry').click()
  await expect(page.locator(NAME)).toBeVisible({ timeout: 30_000 })
})
