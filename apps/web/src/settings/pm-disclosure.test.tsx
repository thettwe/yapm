import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { PmDisclosurePolicy } from '@/settings/ai'

// The admin block: four switches that all have to agree, and the only place in the product where
// somebody chooses who reads another team's work. What this file holds true is that every write is
// a MERGE (editing one team never clears another), that the caller's own credential is re-minted
// afterwards, and that the kill switch says in words what it cannot do.

const zero = vi.hoisted(() => ({
  calls: 0,
  teams: [{ id: 'team-platform', name: 'Platform', key: 'PLT' }],
  members: [
    { id: 'wm-1', userId: 'user-pm', user: { name: 'Priya', email: 'priya@example.com' } },
    { id: 'wm-2', userId: 'user-eng', user: { name: 'Sam', email: 'sam@example.com' } },
  ],
}))

const refresh = vi.hoisted(() => vi.fn())

// Two subscriptions per render, always in the same order: teams, then members.
vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => {
    const value = zero.calls % 2 === 0 ? zero.teams : zero.members
    zero.calls += 1
    return [value, { type: 'complete' }]
  },
}))

vi.mock('@/zero/provider', () => ({
  useSyncControl: () => ({ refresh, retry: vi.fn() }),
  useSyncSession: () => ({
    status: 'ready',
    userID: 'user-admin',
    role: 'admin',
    pmAudienceTeamIds: [],
    unavailable: false,
  }),
}))

import { PmDisclosureSection } from './pm-disclosure'

const ALL_OFF: PmDisclosurePolicy = { enabled: false, killed: false, teams: {} }

interface Recorded {
  url: string
  method: string
  body: Record<string, unknown> | undefined
}

const requests: Recorded[] = []

function writes(): Recorded[] {
  return requests.filter((request) => request.method === 'POST')
}

beforeEach(() => {
  requests.length = 0
  zero.calls = 0
  refresh.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
    }),
  )
})

function renderSection(policy: PmDisclosurePolicy = ALL_OFF) {
  const onChanged = vi.fn(() => Promise.resolve())
  const view = render(<PmDisclosureSection policy={policy} onChanged={onChanged} />)
  return { ...view, onChanged }
}

test('everything is off by default and rendering asks the server for nothing', () => {
  renderSection()

  const section = screen.getByTestId('pm-disclosure-settings')
  expect(section).toHaveAttribute('data-enabled', 'false')
  expect(section).toHaveAttribute('data-killed', 'false')
  expect(screen.getByTestId('pm-disclosure-team-row')).toHaveAttribute('data-visible', 'false')
  expect(screen.getByTestId('pm-disclosure-team-row')).toHaveTextContent('0 readers')
  expect(requests).toHaveLength(0)
})

// A control that names an element which does not exist is a broken promise to a screen reader, and
// the collapsed state is the one everybody starts in.
test('the readers disclosure always points at an element that exists', () => {
  renderSection({ ...ALL_OFF, enabled: true })

  const toggle = screen.getByTestId('pm-disclosure-readers-toggle')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const controlled = toggle.getAttribute('aria-controls') ?? ''
  const fieldset = document.getElementById(controlled)
  expect(fieldset).not.toBeNull()
  expect(fieldset).toHaveAttribute('hidden')

  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(document.getElementById(controlled)).not.toHaveAttribute('hidden')
})

// The one control in the product that used to be painted by the user agent rather than by the
// theme: a native checkbox stays light in all three dark presets whatever the tokens say.
test('every reader is a tokenized toggle, never a native checkbox', () => {
  renderSection({
    enabled: true,
    killed: false,
    teams: { 'team-platform': { pmVisible: true, audience: ['user-pm'] } },
  })

  fireEvent.click(screen.getByTestId('pm-disclosure-readers-toggle'))
  const controls = screen.getAllByTestId('pm-disclosure-reader')
  for (const control of controls) expect(control.tagName).toBe('BUTTON')
  expect(controls[0]).toHaveAttribute('aria-pressed', 'true')
  expect(controls[1]).toHaveAttribute('aria-pressed', 'false')
  expect(
    screen.getByTestId('pm-disclosure-settings').querySelectorAll('input[type="checkbox"]'),
  ).toHaveLength(0)
})

// An admin who names themselves needs a fresh credential before the reader surface exists for them:
// the audience is baked into the sync token, so without the re-mint the change appears not to work.
test('the workspace switch posts one field and re-mints the caller’s own credential', async () => {
  const { onChanged } = renderSection()

  fireEvent.click(screen.getByTestId('pm-disclosure-enabled'))

  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.url).toBe('/api/v1/ai/pm-disclosure')
  expect(writes()[0]?.body).toEqual({ enabled: true })
  expect(onChanged).toHaveBeenCalled()
  expect(refresh).toHaveBeenCalled()
})

test('the kill switch states plainly what it cannot do', async () => {
  renderSection({ ...ALL_OFF, enabled: true })

  expect(screen.getByTestId('pm-disclosure-settings')).toHaveTextContent(
    'This stops further reads. It does not un-read anything that has already been read.',
  )

  fireEvent.click(screen.getByTestId('pm-disclosure-killed'))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.body).toEqual({ killed: true })
})

// The per-team write carries ONLY that team, because the server merges: sending the whole map would
// make editing one team a rewrite of every other team's audience.
test('a per-team switch writes that team alone', async () => {
  renderSection({ ...ALL_OFF, enabled: true })

  fireEvent.click(screen.getByTestId('pm-disclosure-team-toggle'))

  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.body).toEqual({ teams: { 'team-platform': { pmVisible: true } } })
})

test('naming and unnaming a reader writes the whole audience for that team only', async () => {
  const { rerender } = renderSection({
    enabled: true,
    killed: false,
    teams: { 'team-platform': { pmVisible: true, audience: [] } },
  })

  fireEvent.click(screen.getByTestId('pm-disclosure-readers-toggle'))
  const boxes = screen.getAllByTestId('pm-disclosure-reader')
  expect(boxes.map((box) => box.getAttribute('data-user-id'))).toEqual(['user-pm', 'user-eng'])

  fireEvent.click(boxes[0] as HTMLElement)
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.body).toEqual({
    teams: { 'team-platform': { audience: ['user-pm'] } },
  })

  rerender(
    <PmDisclosureSection
      policy={{
        enabled: true,
        killed: false,
        teams: { 'team-platform': { pmVisible: true, audience: ['user-pm'] } },
      }}
      onChanged={() => Promise.resolve()}
    />,
  )
  // The picker stays open across the re-render, so the control below is the same one, now pressed.
  expect(screen.getAllByTestId('pm-disclosure-reader')[0]).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getAllByTestId('pm-disclosure-reader')[0] as HTMLElement)
  await waitFor(() => expect(writes()).toHaveLength(2))
  expect(writes()[1]?.body).toEqual({ teams: { 'team-platform': { audience: [] } } })
})

test('every control is a real focusable element and the change is announced politely', async () => {
  renderSection({
    enabled: true,
    killed: false,
    teams: { 'team-platform': { pmVisible: true, audience: [] } },
  })

  fireEvent.click(screen.getByTestId('pm-disclosure-readers-toggle'))
  const controls = [
    screen.getByTestId('pm-disclosure-enabled'),
    screen.getByTestId('pm-disclosure-killed'),
    screen.getByTestId('pm-disclosure-team-toggle'),
    screen.getByTestId('pm-disclosure-readers-toggle'),
    screen.getAllByTestId('pm-disclosure-reader')[0] as HTMLElement,
  ]
  for (const control of controls) {
    expect(control).not.toHaveAttribute('tabindex', '-1')
    expect(control).not.toBeDisabled()
    control.focus()
    expect(control).toHaveFocus()
  }

  const live = screen.getByTestId('pm-disclosure-announcement')
  expect(live).toHaveAttribute('aria-live', 'polite')
  fireEvent.click(screen.getByTestId('pm-disclosure-team-toggle'))
  await waitFor(() => expect(live.textContent).toBe('Product digests turned off for Platform.'))
})

// This was a blocklist on the words "auditable" and "retention-bounded", which ROADMAP row 23
// reserved until the surfaces that earn them existed. They do now — the audit view a few
// centimetres below this block states both, accurately — so the blocklist is retired rather than
// left to fail a future copy edit in the name of a prohibition that has been lifted.
//
// What replaces it is the claim that stays false however governed this feature gets: these switches
// decide who MAY read, and yapm records no read anywhere. Copy offering an admin who opened a digest
// would be a surveillance surface wearing a governance surface's clothes — and it would have sailed
// through the word blocklist untouched, which is the argument for asserting the meaning instead.
test('the switch copy claims a governance surface, never a reading one', () => {
  renderSection({ ...ALL_OFF, enabled: true })

  const copy = screen.getByTestId('pm-disclosure-settings').textContent ?? ''
  for (const claim of [/who read it/i, /who opened/i, /read log/i, /reading log/i, /viewed by/i]) {
    expect(copy).not.toMatch(claim)
  }
})

test('a failed write surfaces a reason and re-reads what is actually stored', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, status: 403 } as Response)),
  )
  const { onChanged } = renderSection()

  fireEvent.click(screen.getByTestId('pm-disclosure-enabled'))

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Could not update product sharing.'),
  )
  expect(onChanged).toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
})
