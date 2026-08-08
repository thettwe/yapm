import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'

// What only a rendered Triage can prove: that band 2 says the page's own name and not the team's,
// that the head of the queue carries a decision panel made of the issue's own facts, that the
// panel and the verdict keys can never name different issues, that a triage row is the issue
// list's row with its reality slot reserved and silent, that the route transient writes exactly
// the five facts it lists, and that an inbox which has not finished syncing never announces an
// all-clear.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, readonly unknown[]>,
  incomplete: new Set<string>(),
  canWrite: true,
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
    role: harness.canWrite ? 'member' : 'viewer',
    isMember: true,
    canWrite: harness.canWrite,
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
    'labels.byTeam': [
      { id: 'label-1', name: 'bug', color: '#cc5a40' },
      { id: 'label-2', name: 'regression', color: '#3b6ea5' },
    ],
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
  harness.canWrite = true
}

beforeEach(() => {
  harness.mutate.mockClear()
})

interface Mutation {
  readonly mutator: { readonly mutatorName: string }
  readonly args: Record<string, unknown>
}

function lastMutation(): Mutation | undefined {
  return harness.mutate.mock.calls.at(-1)?.[0] as Mutation | undefined
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

  const cleared = screen.getByTestId('triage-cleared')
  expect(within(cleared).getByTitle('Done')).toBeInTheDocument()
  expect(within(cleared).getByText('Nothing waiting.')).toBeInTheDocument()
  // Two words and three doorways: the only full stop on the cleared page is the one in them.
  expect(cleared.textContent?.match(/\./g) ?? []).toHaveLength(1)
  expect(screen.queryByText('oldest first')).not.toBeInTheDocument()

  view.unmount()
  harness.incomplete = new Set(['triage.inbox'])
  render(<TriageView teamId="team-1" />)
  expect(screen.getByTestId('triage-announcement')).toHaveTextContent('Loading…')
  expect(screen.getByText('Loading…', { selector: 'p:not(.sr-only)' })).toBeInTheDocument()
  expect(screen.queryByText('Nothing waiting.')).not.toBeInTheDocument()
  // A count of 0 beside `Loading…` would be band 2 contradicting the body underneath it.
  expect(screen.queryByTestId('masthead-count')).not.toBeInTheDocument()
})

// A live region announces a CHANGE to its contents. A `role="status"` node inserted with its
// message already inside it is not reliably spoken, so the node that carries the syncing→cleared
// transition has to be the same node on both sides of it.
test('the announcement is one region that survives the transition it announces', () => {
  seedQueue()
  harness.rows['triage.inbox'] = []
  harness.incomplete = new Set(['triage.inbox'])
  const view = render(<TriageView teamId="team-1" />)

  const region = screen.getByRole('status')
  expect(region).toBe(screen.getByTestId('triage-announcement'))
  expect(region).toHaveTextContent('Loading…')

  harness.incomplete = new Set()
  view.rerender(<TriageView teamId="team-1" />)

  expect(screen.getByTestId('triage-announcement')).toBe(region)
  expect(region).toHaveTextContent('Nothing waiting.')
  // Exactly one live region: the drawn states no longer each carry their own.
  expect(screen.getAllByRole('status')).toHaveLength(1)
})

// The routed issue can leave the inbox by a path this view never sees — another client, the
// palette, a rebase. When it does, the id it left behind must not latch the whole queue shut.
test('an issue leaving the inbox under an open transient does not deaden the queue', () => {
  seedQueue()
  const view = render(<TriageView teamId="team-1" />)

  fireEvent.click(screen.getByTestId('triage-route'))
  expect(screen.getByRole('dialog', { name: 'Route ENG-125' })).toBeInTheDocument()

  harness.rows['triage.inbox'] = (harness.rows['triage.inbox'] as readonly { id: string }[]).filter(
    (row) => row.id !== 'issue-1',
  )
  view.rerender(<TriageView teamId="team-1" />)

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  harness.mutate.mockClear()
  fireEvent.keyDown(screen.getAllByTestId('triage-row')[0] as HTMLElement, { key: 'a' })
  expect(lastMutation()?.mutator.mutatorName).toBe('issue.acceptTriage')
  expect(lastMutation()?.args.id).toBe('issue-2')
})

// The queue owns the keys pressed ON a row and nothing else. A section-wide `Enter` that
// preventDefaults everything reaching it leaves the attachment chip — a plain download link —
// with no keyboard activation at all.
test('the queue’s keys stop at the row: the panel’s own controls keep Enter', () => {
  seedQueue()
  render(<TriageView teamId="team-1" />)

  harness.navigate.mockClear()
  for (const testId of ['triage-attachment', 'triage-accept', 'triage-open']) {
    fireEvent.keyDown(screen.getByTestId(testId), { key: 'Enter', bubbles: true })
  }
  expect(harness.navigate).not.toHaveBeenCalled()

  fireEvent.keyDown(screen.getAllByTestId('triage-row')[0] as HTMLElement, { key: 'Enter' })
  expect(harness.navigate).toHaveBeenCalledTimes(1)
})

// A pointer-only reader must be able to bring any row under decision, not only the head. A click
// SELECTS; opening the issue is `⏎` or the panel's own Open control.
test('clicking a row brings it under decision rather than navigating away', () => {
  seedQueue()
  render(<TriageView teamId="team-1" />)

  harness.navigate.mockClear()
  const third = screen.getAllByTestId('triage-row')[2] as HTMLElement
  fireEvent.click(third)

  expect(harness.navigate).not.toHaveBeenCalled()
  const panel = screen.getByTestId('triage-decision')
  expect(third.nextElementSibling).toBe(panel)
  expect(within(panel).getByTestId('triage-provenance')).toHaveTextContent('Dana Okoro')

  // …and the panel's Open control is the pointer path onto the issue itself.
  fireEvent.click(within(panel).getByTestId('triage-open'))
  expect(harness.navigate).toHaveBeenCalledTimes(1)
})

test('the panel follows the decision, and the verdict acts on the issue the panel names', () => {
  seedQueue()
  render(<TriageView teamId="team-1" />)

  const rows = screen.getAllByTestId('triage-row')
  fireEvent.keyDown(rows[0] as HTMLElement, { key: 'j' })

  const panel = screen.getByTestId('triage-decision')
  expect(screen.getAllByTestId('triage-decision')).toHaveLength(1)
  expect(rows[1]?.nextElementSibling).toBe(panel)
  expect(within(panel).getByTestId('triage-provenance')).toHaveTextContent('Marcus Bell')

  // The keys act on the row the panel is attached to, never on the head it arrived at.
  fireEvent.keyDown(rows[1] as HTMLElement, { key: 'a' })
  expect(lastMutation()?.mutator.mutatorName).toBe('issue.acceptTriage')
  expect(lastMutation()?.args.id).toBe('issue-2')
})

test('a triage row is the issue list’s row: reality slot reserved and silent, age from created_at', () => {
  seedQueue()
  render(<TriageView teamId="team-1" />)

  for (const row of screen.getAllByTestId('triage-row')) {
    expect(row).toHaveAttribute('data-slot', 'issue-row')

    // Reserved measure, no ink, nothing announced — a triage issue has no linked change.
    const track = row.querySelector('[data-slot="reality-track"]')
    expect(track).not.toBeNull()
    expect(track).toHaveAttribute('data-quiet', 'true')
    expect(track).toHaveAttribute('aria-hidden', 'true')
    expect(track?.textContent).toBe('')

    expect(row.querySelector('[data-slot="issue-row-phrase"]')?.textContent).toBe('')

    // Every control lives in the panel below the row, never bolted onto the row's anatomy.
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
  }

  const head = screen.getAllByTestId('triage-row')[0] as HTMLElement
  // Arrival time, not the last edit: the head was created two days ago and touched just now.
  expect(within(head).getByText('2d')).toBeInTheDocument()
  expect(within(head).queryByText('now')).not.toBeInTheDocument()
  expect(within(head).getByLabelText('Reported by Priya Raman')).toBeInTheDocument()
})

function openRouteTransient(): HTMLElement {
  fireEvent.click(screen.getByTestId('triage-route'))
  return screen.getByRole('dialog', { name: 'Route ENG-125' })
}

test('the route transient writes exactly the five facts it lists, in one mutation', async () => {
  seedQueue()
  render(<TriageView teamId="team-1" />)

  const dialog = openRouteTransient()
  for (const field of ['Status', 'Assignee', 'Cycle', 'Project']) {
    expect(within(dialog).getByLabelText(field), field).toBeInTheDocument()
  }
  expect(within(dialog).getByText('Labels')).toBeInTheDocument()

  fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'todo' } })
  fireEvent.change(within(dialog).getByLabelText('Assignee'), { target: { value: 'user-1' } })
  fireEvent.change(within(dialog).getByLabelText('Cycle'), { target: { value: 'cycle-1' } })
  fireEvent.change(within(dialog).getByLabelText('Project'), { target: { value: 'project-1' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'regression' }))

  fireEvent.keyDown(dialog, { key: 'Enter' })
  await waitFor(() => expect(harness.mutate).toHaveBeenCalledTimes(1))

  const call = lastMutation()
  expect(call?.mutator.mutatorName).toBe('issue.routeIssue')
  expect(call?.args.id).toBe('issue-1')
  expect(call?.args.status).toBe('todo')
  expect(call?.args.assigneeId).toBe('user-1')
  expect(call?.args.cycleId).toBe('cycle-1')
  expect(call?.args.projectId).toBe('project-1')
  expect(call?.args.addLabelIds).toEqual(['label-2'])

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('esc closes the route transient writing nothing, and hands focus back to the row', () => {
  seedQueue()
  render(<TriageView teamId="team-1" />)

  const dialog = openRouteTransient()
  fireEvent.change(within(dialog).getByLabelText('Project'), { target: { value: 'project-1' } })
  fireEvent.keyDown(dialog, { key: 'Escape' })

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(harness.mutate).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getAllByTestId('triage-row')[0])
})

test('a viewer reads the facts and is offered no verdict and no transient', () => {
  seedQueue()
  harness.canWrite = false
  render(<TriageView teamId="team-1" />)

  const panel = screen.getByTestId('triage-decision')
  expect(within(panel).getByTestId('triage-provenance')).toHaveTextContent('Priya Raman')
  for (const testId of ['triage-accept', 'triage-route', 'triage-decline']) {
    expect(screen.queryByTestId(testId), testId).not.toBeInTheDocument()
  }

  fireEvent.keyDown(screen.getAllByTestId('triage-row')[0] as HTMLElement, { key: 'r' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(harness.mutate).not.toHaveBeenCalled()
})
