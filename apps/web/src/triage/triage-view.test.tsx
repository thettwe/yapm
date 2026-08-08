import { render, screen, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'

// What only a rendered Triage can prove: that band 2 says the page's own name and not the team's,
// that the head of the queue carries a decision panel made of the issue's own facts, that the
// three verdicts are words with keys rather than borrowed icons, and that an inbox which has not
// finished syncing never announces an all-clear.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, readonly unknown[]>,
  incomplete: new Set<string>(),
  navigate: vi.fn(),
  mutate: vi.fn((_mutation: unknown) => ({
    client: Promise.resolve({ type: 'ok' }),
    server: Promise.resolve({ type: 'ok' }),
  })),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    const name = (request as { query: { queryName: string } }).query.queryName
    return [
      harness.rows[name] ?? [],
      { type: harness.incomplete.has(name) ? 'unknown' : 'complete' },
    ]
  },
  useZero: () => ({ mutate: harness.mutate }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => harness.navigate,
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}))

vi.mock('@/auth/use-membership', () => ({
  useMembership: () => ({
    userId: 'user-1',
    memberId: 'member-1',
    role: 'member',
    isMember: true,
    canWrite: true,
    canManage: false,
  }),
}))

import { formatStamp, TriageView } from './triage-view'

// `prosemirror-view` measures the selection jsdom cannot measure; the read-only renderer still
// mounts a real editor to draw the description.
beforeAll(() => {
  Range.prototype.getClientRects = () =>
    Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.scrollIntoView = () => undefined
})

const HOUR = 60 * 60 * 1000
const NOW = Date.now()
const TEAM = { id: 'team-1', key: 'ENG', name: 'Engineering', members: [{ userId: 'user-1' }] }
const HEAD_CREATED_AT = NOW - 48 * HOUR
const DESCRIPTION_TEXT = 'Two coupons on the same order and the page stops responding.'

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function issue(
  overrides: { id: string; number: number; title: string; createdAt: number } & Record<
    string,
    unknown
  >,
) {
  return {
    status: 'backlog',
    priority: 'medium',
    assigneeId: null,
    cycleId: null,
    projectId: null,
    updatedAt: NOW,
    description: null,
    creator: null,
    labels: [],
    ...overrides,
  }
}

function seedQueue() {
  harness.rows = {
    'teams.all': [TEAM],
    'users.all': [{ id: 'user-1', name: 'Dana Asare' }],
    'labels.byTeam': [{ id: 'label-1', name: 'bug', color: '#cc5a40' }],
    'cycles.byTeam': [{ id: 'cycle-1', name: 'Cycle 2', number: 2 }],
    'projects.all': [{ id: 'project-1', name: 'Checkout revamp' }],
    'attachments.byIssue': [{ id: 'att-1', filename: 'checkout-hang.png' }],
    'triage.inbox': [
      issue({
        id: 'issue-1',
        number: 125,
        title: 'Checkout hangs when two coupons are applied',
        createdAt: HEAD_CREATED_AT,
        priority: 'urgent',
        description: doc(DESCRIPTION_TEXT),
        creator: { name: 'Priya Raman' },
        labels: [{ id: 'label-1', name: 'bug', color: '#cc5a40' }],
      }),
      issue({
        id: 'issue-2',
        number: 126,
        title: 'Export order history as CSV',
        createdAt: NOW - 24 * HOUR,
        creator: { name: 'Marcus Bell' },
      }),
      issue({
        id: 'issue-3',
        number: 127,
        title: 'Apple Pay button missing on iPad',
        createdAt: NOW - 6 * HOUR,
        creator: { name: 'Dana Okoro' },
      }),
      issue({
        id: 'issue-4',
        number: 128,
        title: 'Rename Saved cards to Payment methods',
        createdAt: NOW - 41 * 60_000,
        creator: { name: 'Priya Raman' },
      }),
    ],
  }
  harness.incomplete = new Set()
}

test('band 2 states the page, the count, and never repeats the team the deck already carries', () => {
  seedQueue()
  render(<TriageView teamId="team-1" />)

  const masthead = screen.getByTestId('masthead')
  expect(within(masthead).getByRole('heading', { name: 'Triage' })).toBeInTheDocument()
  expect(within(masthead).getByTestId('masthead-count')).toHaveTextContent('4')
  expect(masthead).not.toHaveTextContent('Engineering')
  expect(within(masthead).getByText('oldest first')).toBeInTheDocument()
})

test('the head of the queue unfolds into the facts the next decision needs', async () => {
  seedQueue()
  render(<TriageView teamId="team-1" />)

  const rows = screen.getAllByTestId('triage-row')
  expect(rows).toHaveLength(4)

  const panel = screen.getByTestId('triage-decision')
  expect(rows[0]?.nextElementSibling).toBe(panel)
  expect(await within(panel).findByText(DESCRIPTION_TEXT)).toBeInTheDocument()
  expect(within(panel).getByTestId('triage-provenance')).toHaveTextContent(
    `Priya Raman · ${formatStamp(HEAD_CREATED_AT)}`,
  )
  expect(within(panel).getByTestId('triage-attachment')).toHaveTextContent('checkout-hang.png')

  // Exactly one row is under decision at a time.
  expect(screen.getAllByTestId('triage-decision')).toHaveLength(1)
})

test('the three verdicts are words with their keys, not icon buttons', () => {
  seedQueue()
  render(<TriageView teamId="team-1" />)

  for (const [word, cap] of [
    ['Accept', 'A'],
    ['Route', 'R'],
    ['Decline', 'D'],
  ]) {
    const button = screen.getByRole('button', { name: word })
    expect(within(button).getByText(cap as string)).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-keyshortcuts', (cap as string).toLowerCase())
  }
  expect(screen.getByTestId('triage-accept')).toHaveAccessibleName('Accept')
  expect(screen.getByTestId('triage-route')).toHaveAccessibleName('Route')
  expect(screen.getByTestId('triage-decline')).toHaveAccessibleName('Decline')
})

test('an empty inbox says two words, and only once the result is complete', () => {
  seedQueue()
  harness.rows['triage.inbox'] = []
  const view = render(<TriageView teamId="team-1" />)

  const cleared = screen.getByRole('status')
  expect(within(cleared).getByText('Nothing waiting.')).toBeInTheDocument()
  // Two words and three doorways: the only full stop on the cleared page is the one in them.
  expect(cleared.textContent?.match(/\./g) ?? []).toHaveLength(1)
  expect(screen.queryByText('oldest first')).not.toBeInTheDocument()

  view.unmount()
  harness.incomplete = new Set(['triage.inbox'])
  render(<TriageView teamId="team-1" />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  expect(screen.queryByText('Nothing waiting.')).not.toBeInTheDocument()
})
