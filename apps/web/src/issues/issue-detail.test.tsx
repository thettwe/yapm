import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

// THE FALSIFIABLE CHECK for the issue detail: one reality said in two registers, with the vertical
// rail mounted over the same timeline the feed reads. Against the shipped page this file fails on
// the mono subline and on the rail immediately — neither existed, and the rail had no product
// consumer at all.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  // Query names whose result has NOT arrived yet. `{}` and "no row" are the same value and must not
  // be the same state, so the harness models the difference the app has to render.
  pending: new Set<string>(),
  mutate: vi.fn((_mutation: unknown) => ({
    client: Promise.resolve({ type: 'ok' }),
    server: Promise.resolve({ type: 'ok' }),
  })),
  canWrite: true,
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    if (request === false || request === undefined || request === null) {
      return [undefined, { type: 'unknown' }]
    }
    const name = (request as { query: { queryName: string } }).query.queryName
    if (harness.pending.has(name)) return [undefined, { type: 'unknown' }]
    return [name in harness.rows ? harness.rows[name] : [], { type: 'complete' }]
  },
  useZero: () => ({ mutate: harness.mutate }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children?: React.ReactNode }) => <a {...props}>{children}</a>,
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

import { CommandRegistryProvider } from '@/frame/command-registry'
import { IssueDetail, type IssueDetailLayout } from './issue-detail'

interface StatusMutation {
  mutator: { mutatorName: string }
  args: { id: string; status: string }
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.now()

const TEAM = { id: 'team-1', key: 'ENG', name: 'Engineering', members: [{ userId: 'user-1' }] }
const CYCLE = {
  id: 'cycle-2',
  name: 'Cycle 2',
  number: 2,
  startDate: NOW - 9 * DAY,
  endDate: NOW + 5 * DAY,
}

const MERGE_SHA = '8f21c4a9b7d3e15f0a2c4d6e8f0a2c4d6e8f0a2c'

// The mock's ENG-116: planned into Cycle 2, linked by BRANCH to PR #188, two review rounds ending
// in an approval, merged with fourteen green checks, and no deployment carrying that merge commit.
function eng116(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'issue-1',
    teamId: 'team-1',
    number: 116,
    title: 'Apple Pay in the payment sheet',
    description: null,
    status: 'in_progress',
    priority: 'high',
    assigneeId: 'user-1',
    cycleId: 'cycle-2',
    creatorId: 'user-1',
    createdAt: NOW - 12 * DAY,
    updatedAt: NOW - 3 * DAY,
    cycleAssignedAt: NOW - 9 * DAY,
    carryoverCount: 0,
    lastHumanStatusAt: NOW - 3 * DAY,
    assignee: { id: 'user-1', name: 'Dana', email: 'dana@example.com', image: null },
    creator: { id: 'user-1', name: 'Dana', email: 'dana@example.com' },
    labels: [{ id: 'label-1', name: 'feature', color: '#6a62c2' }],
    comments: [],
    issueLinks: [
      {
        source: 'branch',
        createdAt: NOW - 3 * DAY,
        pullRequest: {
          id: 'pr-1',
          number: 188,
          title: 'Apple Pay in the payment sheet',
          state: 'merged',
          url: 'https://github.com/acme/web/pull/188',
          repo: 'acme/web',
          headSha: 'aaaaaaabbbbbbbccccccc',
          mergeCommitSha: MERGE_SHA,
          openedAt: NOW - 3 * DAY,
          mergedAt: NOW - 22 * HOUR,
          ciChecks: Array.from({ length: 14 }, (_, index) => ({
            id: `check-${index}`,
            name: `check ${index}`,
            conclusion: 'success',
          })),
          reviews: [
            { id: 'rev-1', author: 'sam', state: 'changes_requested', submittedAt: NOW - 2 * DAY },
            { id: 'rev-2', author: 'sam', state: 'approved', submittedAt: NOW - 26 * HOUR },
          ],
        },
      },
    ],
    ...overrides,
  }
}

function baseRows(issue: unknown = eng116()): Record<string, unknown> {
  return {
    'teams.all': [TEAM],
    'users.all': [{ id: 'user-1', name: 'Dana', email: 'dana@example.com', image: null }],
    'members.all': [],
    'labels.byTeam': [{ id: 'label-1', name: 'feature', color: '#6a62c2' }],
    'cycles.byTeam': [CYCLE],
    'deployments.byTeam': [],
    'attachments.byIssue': [],
    'issues.detail': issue,
  }
}

// `prosemirror-view` measures its selection on every transaction, and jsdom implements none of the
// three geometry methods it reaches for. Stubbed explicitly rather than asserted around: the
// premise "this environment lacks X" is not something a test may depend on.
beforeAll(() => {
  Range.prototype.getClientRects = () =>
    Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.scrollIntoView = () => undefined
})

beforeEach(() => {
  harness.rows = baseRows()
  harness.pending = new Set()
  harness.canWrite = true
  harness.mutate.mockClear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(cleanup)

function mount(layout: IssueDetailLayout = 'page') {
  return render(<IssueDetail issueId="issue-1" teamId="team-1" layout={layout} />)
}

function railItems(): HTMLElement[] {
  const rail = document.querySelector('[data-slot="reality-rail"]')
  if (rail === null) throw new Error('no reality rail')
  return [...rail.querySelectorAll('li')] as HTMLElement[]
}

test('one reality, two registers, and the rail', () => {
  mount('page')

  // (a) The masthead's pill carries the shared dictionary's string verbatim — text, never colour
  // alone, and never a second vocabulary for the same predicate.
  const pill = screen.getByTestId('divergence-pill')
  expect(pill).toHaveTextContent('Done in git, not on the board')
  expect(within(screen.getByTestId('masthead-kicker')).getByTestId('divergence-pill')).toBe(pill)

  // (b) Two registers over the same facts: the plain line, and directly beneath it the mono line
  // stating the merge and the change by number.
  const subline = screen.getByTestId('issue-subline')
  const say = within(subline).getByTestId('subline-say')
  const git = within(subline).getByTestId('subline-git')
  expect(say).toHaveTextContent('In Progress')
  expect(say).toHaveTextContent('Cycle 2')
  expect(say).toHaveTextContent('feature')
  expect(say).toHaveTextContent('Done in git, not on the board')
  expect(git).toHaveTextContent('8f21c4a')
  expect(git).toHaveTextContent('#188')
  // Directly beneath: the mono line is the say line's next sibling, not a stray node elsewhere.
  expect(say.nextElementSibling).toBe(git)
  expect(git.querySelector('[data-slot="provenance-mark"]')).not.toBeNull()

  // (c) The vertical rail is mounted, with one station per moment that happened — and NO designed
  // station, because no entity backs one.
  const items = railItems()
  const labels = items.map((item) => item.textContent ?? '')
  expect(labels[0]).toMatch(/Idea/)
  expect(labels[0]).toMatch(/Cycle 2/)
  expect(labels[1]).toMatch(/Change opened/)
  expect(labels[2]).toMatch(/Reviewed/)
  expect(labels[3]).toMatch(/Merged/)
  expect(labels[4]).toMatch(/Not live yet/)
  expect(items).toHaveLength(5)
  for (const label of labels) {
    expect(label).not.toMatch(/design/i)
  }
  // The header states only the chain the rail can draw.
  expect(screen.getByText('idea → built → live')).toBeInTheDocument()
  // Every station carries its fact line, and the merge station states its checks without ever
  // stating a duration.
  expect(labels[1]).toMatch(/PR #188/)
  expect(labels[2]).toMatch(/changes requested, then approved/)
  expect(labels[3]).toMatch(/14\/14 checks passed/)
  expect(labels.join(' ')).not.toMatch(/took/)

  // The rail's accessible description names the stations drawn and nothing else.
  const rail = document.querySelector('[data-slot="reality-rail"]')
  const railLabel = rail?.getAttribute('aria-label') ?? ''
  expect(railLabel).toMatch(/Idea/)
  expect(railLabel).toMatch(/Not live yet/)
  expect(railLabel).not.toMatch(/design/i)

  // (d) The activity feed states only what a durable timestamp supports. There is no status
  // history in this product, so no transition may render.
  const activity = screen.getByTestId('issue-activity')
  expect(activity.textContent ?? '').not.toMatch(/todo\s*→/i)
  expect(activity.textContent ?? '').not.toMatch(/→\s*in.progress/i)
  expect(activity.textContent ?? '').not.toMatch(/Work started/i)
  expect(activity).toHaveTextContent('Linked to a change')
  expect(activity).toHaveTextContent('matched by branch')
  expect(activity).toHaveTextContent('Merged')
})

test('the callout confirms through the existing mutator', () => {
  mount('page')

  const callout = screen.getByTestId('divergence-callout')
  fireEvent.click(within(callout).getByTestId('callout-confirm'))

  const call = harness.mutate.mock.calls[0]?.[0] as StatusMutation | undefined
  expect(call?.mutator.mutatorName).toBe('issue.setStatus')
  expect(call?.args.status).toBe('done')
  expect(call?.args.id).toBe('issue-1')
  // Confirming resolves the divergence and removes the callout under the reader's focus, so the
  // same landing place catches it here as on dismissal.
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Delivery' }))
})

test('⏎ inside the callout confirms, and nothing outside it is listened to', () => {
  mount('page')

  const confirm = screen.getByTestId('callout-confirm')
  confirm.focus()
  // A real button, in the tab order, that the browser itself activates on Enter.
  expect(confirm.tagName).toBe('BUTTON')
  expect(confirm).not.toBeDisabled()
  expect(confirm).toHaveFocus()

  // And the callout's own key scope answers ⏎ from anywhere inside it that is not already a
  // button — bound on the callout, never on `document`, because the frame owns that layer.
  fireEvent.keyDown(screen.getByTestId('divergence-callout'), { key: 'Enter' })
  const call = harness.mutate.mock.calls[0]?.[0] as StatusMutation | undefined
  expect(call?.mutator.mutatorName).toBe('issue.setStatus')
  expect(call?.args.status).toBe('done')

  // The same key pressed on the page outside the callout does nothing at all.
  harness.mutate.mockClear()
  fireEvent.keyDown(document.body, { key: 'Enter' })
  expect(harness.mutate).not.toHaveBeenCalled()
})

test('keep as is writes nothing, and the divergence it dismissed is still stated', () => {
  mount('page')

  const dismiss = screen.getByTestId('callout-dismiss')
  dismiss.focus()
  fireEvent.keyDown(dismiss, { key: 'Escape' })

  expect(screen.queryByTestId('divergence-callout')).toBeNull()
  expect(harness.mutate).not.toHaveBeenCalled()
  // The element holding focus was just removed from the document. A keyboard reader may not be
  // dropped to `<body>` in the middle of a keyboard-only flow, so focus lands on the section the
  // callout was talking about.
  expect(document.activeElement).not.toBe(document.body)
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Delivery' }))
  // Nothing about the fact changed, so nothing that STATES the fact may disappear with the callout.
  expect(screen.getByTestId('divergence-pill')).toHaveTextContent('Done in git, not on the board')
  expect(document.querySelector('[data-slot="reality-rail-break"]')).not.toBeNull()
  expect(screen.getByTestId('subline-say')).toHaveTextContent('Done in git, not on the board')
})

// The masthead's Mark Done removes itself the moment it succeeds — a done issue offers no Mark
// Done — so it unmounts under the keyboard user exactly as the callout's actions do, and lands the
// same place rather than dropping focus to `<body>`.
test('the masthead action writes the same mutation and lands the keyboard somewhere', () => {
  mount('page')

  const markDone = screen.getByTestId('masthead-mark-done')
  markDone.focus()
  expect(markDone).toHaveFocus()
  fireEvent.click(markDone)

  const call = harness.mutate.mock.calls[0]?.[0] as StatusMutation | undefined
  expect(call?.mutator.mutatorName).toBe('issue.setStatus')
  expect(call?.args.status).toBe('done')
  expect(call?.args.id).toBe('issue-1')
  expect(document.activeElement).not.toBe(document.body)
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Delivery' }))
})

test('a viewer is offered no action that writes', () => {
  harness.canWrite = false
  mount('page')

  const callout = screen.getByTestId('divergence-callout')
  expect(within(callout).queryByTestId('callout-confirm')).toBeNull()
  expect(within(callout).getByTestId('callout-dismiss')).toBeInTheDocument()
  expect(screen.queryByTestId('masthead-mark-done')).toBeNull()
  expect(screen.getByRole('button', { name: /^Status:/ })).toBeDisabled()
})

test('an unlinked issue folds every block nothing backs', () => {
  harness.rows = baseRows(eng116({ issueLinks: [], status: 'todo', lastHumanStatusAt: null }))
  mount('page')

  expect(screen.queryByTestId('divergence-callout')).toBeNull()
  expect(screen.queryByTestId('divergence-pill')).toBeNull()
  expect(screen.queryByTestId('referenced-in')).toBeNull()
  // The rail stays, because the idea happened; the chain promises only what it draws.
  expect(railItems()).toHaveLength(1)
  expect(screen.getByText('idea')).toBeInTheDocument()
  // No mono register with nothing to say in it.
  expect(screen.queryByTestId('subline-git')).toBeNull()
})

test.each<IssueDetailLayout>(['page', 'sheet'])(
  'every capability the page had survives in the %s layout',
  (layout) => {
    mount(layout)

    expect(screen.getByRole('textbox', { name: 'Issue title' })).toHaveValue(
      'Apple Pay in the payment sheet',
    )
    expect(screen.getByRole('textbox', { name: 'Issue description' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument()
    expect(screen.getByText('⌘↵ to send')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Status: In Progress' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Priority: High' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assignee: Dana' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cycle: Cycle 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add label' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument()
    // The rail states delivery at full measure, so the properties block no longer draws it twice.
    expect(screen.queryByText('Delivery', { selector: 'span' })).toBeNull()
    // And both layouts draw exactly one rail, one callout and one feed.
    expect(document.querySelectorAll('[data-slot="reality-rail"]')).toHaveLength(1)
    expect(screen.getAllByTestId('divergence-callout')).toHaveLength(1)
    expect(screen.getAllByTestId('issue-activity')).toHaveLength(1)
  },
)

// An unhydrated query is not an answer. A row that has not arrived and a row that does not exist
// look identical in the data and must not look identical on screen — collapsing the two is how a
// correct deep link flashes "this issue does not exist" on a cold client.
test('a row that has not arrived is not a row that does not exist', () => {
  harness.pending = new Set(['issues.detail'])
  const view = render(<IssueDetail issueId="issue-1" teamId="team-1" layout="page" />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading issue…')
  view.unmount()

  harness.pending = new Set()
  harness.rows = { ...baseRows(), 'issues.detail': undefined }
  render(<IssueDetail issueId="issue-1" teamId="team-1" layout="page" />)
  expect(screen.getByRole('status')).toHaveTextContent('does not exist')
})

test('referenced in states the linked change and how it was linked', () => {
  mount('page')

  const referenced = screen.getByTestId('referenced-in')
  expect(referenced).toHaveTextContent('acme/web#188')
  expect(referenced).toHaveTextContent('matched by branch')
  expect(within(referenced).getByRole('link', { name: /acme\/web#188/ })).toHaveAttribute(
    'href',
    'https://github.com/acme/web/pull/188',
  )
})

test('the divergence evidence contrasts the human status with the merge', () => {
  mount('page')

  const evidence = screen.getByTestId('divergence-evidence')
  expect(evidence).toHaveTextContent('in-progress set 3d ago')
  expect(evidence).toHaveTextContent('8f21c4a')
  expect(evidence).toHaveTextContent('22h ago')
})

// ⌘K has ONE owner, and it is the frame. What this surface may do is REGISTER — so the binding the
// deck advertises on every page reaches this page's actions without a second listener existing to
// swallow it.
test('the palette is registered with rather than bound, and only offers what can be done', async () => {
  render(
    <CommandRegistryProvider>
      <IssueDetail issueId="issue-1" teamId="team-1" layout="page" />
    </CommandRegistryProvider>,
  )

  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })

  expect(await screen.findByPlaceholderText('Type a command or search…')).toBeInTheDocument()
  expect(screen.getByText('Mark done')).toBeInTheDocument()
  expect(screen.getByText('Open the change')).toBeInTheDocument()

  fireEvent.click(screen.getByText('Mark done'))
  const call = harness.mutate.mock.calls[0]?.[0] as StatusMutation | undefined
  expect(call?.mutator.mutatorName).toBe('issue.setStatus')
  expect(call?.args.status).toBe('done')
})

test('the palette offers a viewer nothing that writes, and no change it does not have', async () => {
  harness.canWrite = false
  harness.rows = baseRows(eng116({ issueLinks: [] }))
  render(
    <CommandRegistryProvider>
      <IssueDetail issueId="issue-1" teamId="team-1" layout="page" />
    </CommandRegistryProvider>,
  )

  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })

  expect(await screen.findByPlaceholderText('Type a command or search…')).toBeInTheDocument()
  expect(screen.queryByText('Mark done')).toBeNull()
  expect(screen.queryByText('Open the change')).toBeNull()
})

test('an issue with no recorded status time says which clock it is reading', () => {
  harness.rows = baseRows(eng116({ lastHumanStatusAt: null }))
  mount('page')

  const evidence = screen.getByTestId('divergence-evidence')
  expect(evidence).toHaveTextContent('issue updated 3d ago')
  expect(evidence.textContent ?? '').not.toMatch(/set \d/)
})
