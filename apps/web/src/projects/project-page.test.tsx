import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// What only a rendered project page can prove: that both vitals read from the issues rather than
// from anything typed, that the ONE left edge in this whole change is labelled `created` and never
// `started`, that the page speaks the shared reality vocabulary rather than a second one — and
// that a project with nothing to say draws a label instead of an empty frame.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  incomplete: new Set<string>(),
  canWrite: true,
  navigate: vi.fn(),
}))

// `?? []` hands back a FRESH array on every render, which is the harsher of the two things a
// subscription may do — and this page lifts one subscription per contributing team into state, so
// an identity-only publish guard renders, publishes, renders again, forever. That is not a
// hypothetical: this suite spun a worker at 100% CPU until `sameRows` replaced the `===`. Leave the
// fresh array here; it is what makes the loop a test failure instead of a field report.
vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    const name = (request as { query: { queryName: string } }).query.queryName
    return [
      harness.rows[name] ?? [],
      { type: harness.incomplete.has(name) ? 'unknown' : 'complete' },
    ]
  },
  useZero: () => ({ mutate: vi.fn() }),
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

import { formatTargetDay } from './model'
import { ProjectPage } from './project-page'

const HOUR = 3_600_000
const DAY = 24 * HOUR
// A fixed instant, so the target reading and the strip's overrun are decidable rather than
// whatever the clock says when CI runs.
const NOW = Date.UTC(2026, 7, 7, 12)
const CREATED = Date.UTC(2026, 5, 1)

const ENG = { id: 'team-eng', key: 'ENG' }
const DES = { id: 'team-des', key: 'DES' }

interface PrFixture {
  state: 'draft' | 'open' | 'approved' | 'merged' | 'closed'
  openedAt: number
  ciChecks?: { conclusion: string }[]
}

function issue(
  over: { id: string; status: string } & Record<string, unknown> & { pr?: PrFixture | null },
) {
  const { pr, ...rest } = over
  return {
    number: 1,
    title: 'An issue',
    priority: 'medium',
    assigneeId: null,
    cycleId: null,
    teamId: ENG.id,
    team: ENG,
    labels: [],
    assignee: null,
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - HOUR,
    issueLinks: pr == null ? [] : [{ pullRequest: pr }],
    ...rest,
  }
}

function seed(over: Record<string, unknown> = {}) {
  harness.rows = {
    'users.all': [{ id: 'user-1', name: 'Dana Asare' }],
    'workspace.current': { id: 'ws-1', name: 'Acme' },
    'projects.get': {
      id: 'p-1',
      name: 'Checkout rebuild',
      status: 'active',
      leadId: 'user-1',
      lead: { id: 'user-1', name: 'Dana Asare' },
      targetDate: Date.UTC(2026, 7, 1),
      createdAt: CREATED,
      issues: [],
      ...over,
    },
  }
}

function mount() {
  return render(<ProjectPage teamId={ENG.id} projectId="p-1" />)
}

// One of the strip's two mono end labels, found by the word that IS its disclosure.
function stripLabel(strip: HTMLElement, word: 'created' | 'target'): SVGTextElement | undefined {
  return [...strip.querySelectorAll('text')].find((node) => node.textContent?.includes(word))
}

// jsdom measures no text, so the drawn extent is computed the same way the drawing places it: a
// fixed-format 10px mono string at ~6px a character, resolved against its own anchor.
function extent(node: SVGTextElement | undefined): { left: number; right: number; y: number } {
  if (node === undefined) throw new Error('no such strip label')
  const width = (node.textContent ?? '').length * 6
  const x = Number(node.getAttribute('x'))
  const anchor = node.getAttribute('text-anchor') ?? 'start'
  const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
  return { left, right: left + width, y: Number(node.getAttribute('y')) }
}

function rowFor(title: string): HTMLElement {
  const found = screen
    .getAllByTestId('project-issue-row')
    .find((row) => within(row).queryByText(title) !== null)
  if (found === undefined) throw new Error(`no issue row for ${title}`)
  return found
}

beforeEach(() => {
  harness.incomplete.clear()
  harness.canWrite = true
  harness.navigate.mockReset()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('the issues vital reads done over total, and names every segment of its bar in text', () => {
  seed({
    issues: [
      issue({ id: 'i1', status: 'done' }),
      issue({ id: 'i2', status: 'done' }),
      issue({ id: 'i3', status: 'in_progress' }),
      issue({ id: 'i4', status: 'todo', teamId: DES.id, team: DES }),
    ],
  })
  mount()

  expect(screen.getByTestId('project-done-count').textContent).toBe('2')
  expect(screen.getByText('/4 done')).toBeTruthy()

  // The bar is a composition over facts stated in words — which is the whole premise of the
  // contrast exemption `packages/ui/src/styles/contrast.test.ts` records for its quiet hues, so it
  // is asserted here rather than left to a comment there.
  const bar = screen.getByTestId('project-state-bar')
  expect(bar.getAttribute('role')).toBe('img')
  expect(bar.getAttribute('aria-label')).toBe('1 todo, 1 in progress, 2 done')
  const legend = bar.nextElementSibling as HTMLElement
  for (const segment of ['todo', 'in progress', 'done']) {
    expect(within(legend).getByText(segment)).toBeTruthy()
  }

  // The team split is a partition of the same rows, so it sums to the total by construction.
  expect(screen.getByText('ENG 3 · DES 1')).toBeTruthy()

  // No percent: over a project nobody has broken down a percent reads 0%, which is a lie.
  expect(document.body.textContent).not.toMatch(/\d%/)
})

test('the target vital states the delta and labels its left end `created`, never `started`', () => {
  seed({ issues: [issue({ id: 'i1', status: 'todo' })] })
  mount()

  expect(screen.getByText(formatTargetDay(Date.UTC(2026, 7, 1)))).toBeTruthy()
  expect(screen.getByText('6 days past')).toBeTruthy()

  const strip = screen.getByTestId('project-target-strip')
  expect(strip.getAttribute('role')).toBe('img')
  expect(strip.getAttribute('aria-label')).toContain(`Created ${formatTargetDay(CREATED)}`)
  expect(strip.getAttribute('aria-label')).toContain('6 days past target')
  // The one left edge in this change, and the label IS the disclosure.
  expect(strip.textContent).toContain(`${formatTargetDay(CREATED)} · created`)
  expect(strip.textContent).not.toMatch(/start/i)
  // A target late in the run hangs its label to the LEFT of the mark, away from the right edge.
  expect(stripLabel(strip, 'target')?.getAttribute('text-anchor')).toBe('end')
})

// The two mono strings never share a line. Where along the run the target sits decides HOW they are
// kept apart — left of the mark, right of it, or on a second baseline — but never whether they are.
// A placement rule written as a fraction of the run cannot promise this: the run knows nothing about
// how wide `Jun 1 · created` is, and at ~0.13 and ~0.28 an anchor picked that way draws one label
// straight through the other.
test.each([
  ['a target crowded against `created`', Date.UTC(2026, 5, 10)],
  ['a target just past it', Date.UTC(2026, 5, 20)],
  ['a target late in the run', Date.UTC(2026, 6, 31)],
])('%s keeps both strip labels legible', (_name, targetDate) => {
  seed({ targetDate, issues: [issue({ id: 'i1', status: 'todo' })] })
  mount()

  const strip = screen.getByTestId('project-target-strip')
  const created = stripLabel(strip, 'created')
  const target = stripLabel(strip, 'target')
  expect(created?.textContent).toContain(formatTargetDay(CREATED))
  expect(target?.textContent).toContain(formatTargetDay(targetDate))

  const a = extent(created)
  const b = extent(target)
  const separated = a.y !== b.y || b.left >= a.right || a.left >= b.right
  expect(separated).toBe(true)
  // Nothing is drawn off the left edge of the 400px viewBox either.
  expect(b.left).toBeGreaterThanOrEqual(0)
})

test('opening the done fold lands focus on the first newly revealed row', () => {
  seed({
    issues: [
      issue({ id: 'i1', title: 'Still open', status: 'todo' }),
      issue({ id: 'i2', title: 'Shipped one', status: 'done' }),
      issue({ id: 'i3', title: 'Shipped two', status: 'done' }),
    ],
  })
  mount()

  const fold = screen.getByTestId('project-done-fold')
  fold.focus()
  fireEvent.click(fold)

  // The fold unmounts itself, so focus has to land somewhere deliberate: the first row that was
  // not already on screen. Dropping to <body> is what the shipped issue-list fold avoids.
  expect(document.activeElement).not.toBe(document.body)
  const landed = (document.activeElement as HTMLElement).closest(
    '[data-testid="project-issue-row"]',
  )
  expect(landed).not.toBeNull()
  expect(within(landed as HTMLElement).getByText('Shipped one')).toBeTruthy()
})

test('an undated project draws no strip and no delta', () => {
  seed({ targetDate: null, issues: [issue({ id: 'i1', status: 'todo' })] })
  mount()

  expect(screen.getByTestId('project-no-target').textContent).toBe('No target date')
  expect(screen.queryByTestId('project-target-strip')).toBeNull()
  expect(screen.queryByText(/days past/)).toBeNull()
})

test('a completed project never reads as past its target however old the date is', () => {
  seed({ status: 'completed', issues: [issue({ id: 'i1', status: 'done' })] })
  mount()

  expect(screen.queryByText(/days past/)).toBeNull()
  expect(screen.getByTestId('project-target-strip')).toBeTruthy()
})

test('the issue rows speak the shared reality vocabulary, inkless where there is nothing to say', () => {
  seed({
    issues: [
      issue({
        id: 'i1',
        title: 'Address autocomplete',
        status: 'in_progress',
        pr: { state: 'open', openedAt: NOW - 16 * HOUR, ciChecks: [{ conclusion: 'failure' }] },
      }),
      issue({ id: 'i2', title: 'Focus lost after closing the palette', status: 'todo' }),
    ],
  })
  mount()

  const linked = rowFor('Address autocomplete')
  expect(linked.querySelector('[data-slot="rest-phrase"]')?.textContent).toContain('Checks failing')
  const inkedTrack = linked.querySelector('[data-slot="reality-track"]')
  expect(inkedTrack?.getAttribute('role')).toBe('img')
  expect(inkedTrack?.getAttribute('data-quiet')).toBeNull()

  // The unlinked row reserves the same measure and states nothing — to an eye or to a screen
  // reader. Nothing shifts the day its first pull request arrives.
  const quiet = rowFor('Focus lost after closing the palette')
  expect(quiet.querySelector('[data-slot="rest-phrase"]')).toBeNull()
  const quietTrack = quiet.querySelector('[data-slot="reality-track"]')
  expect(quietTrack?.getAttribute('data-quiet')).toBe('true')
  expect(quietTrack?.getAttribute('aria-hidden')).toBe('true')
  expect(quietTrack?.getAttribute('role')).toBeNull()
})

test('done issues sit behind a fold that states the true remaining count', () => {
  seed({
    issues: [
      issue({ id: 'i1', title: 'Still open', status: 'todo' }),
      issue({ id: 'i2', title: 'Shipped one', status: 'done' }),
      issue({ id: 'i3', title: 'Shipped two', status: 'done' }),
    ],
  })
  mount()

  expect(screen.queryByText('Shipped one')).toBeNull()
  const fold = screen.getByTestId('project-done-fold')
  expect(fold.textContent).toContain('2 done')
  fireEvent.click(fold)
  expect(screen.getByText('Shipped one')).toBeTruthy()
  expect(screen.queryByTestId('project-done-fold')).toBeNull()
})

test('a project with no issues states it and draws no empty frame', () => {
  seed({ issues: [] })
  const { container } = mount()

  expect(screen.getByTestId('project-no-issues').textContent).toBe('No issues yet')
  // No state bar over nothing, no zero-width segment, no reserved list.
  expect(screen.queryByTestId('project-state-bar')).toBeNull()
  expect(screen.queryByTestId('project-done-count')).toBeNull()
  expect(container.querySelectorAll('[data-testid="project-issue-row"]')).toHaveLength(0)
  // The target vital still draws: a project with no issues is not a project with no target.
  expect(screen.getByTestId('project-target-strip')).toBeTruthy()
})

test('an issue opens in its OWN team’s list, not the deck team’s', () => {
  seed({
    issues: [
      issue({ id: 'i1', title: 'A design task', status: 'todo', teamId: DES.id, team: DES }),
    ],
  })
  mount()

  fireEvent.click(rowFor('A design task'))
  expect(harness.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ params: { teamId: DES.id }, search: { open: 'i1' } }),
  )
})

test('the page is leaveable from the keyboard, and says what it is scoped to', () => {
  seed({ issues: [] })
  mount()

  expect(screen.getByTestId('project-scope').textContent).toContain('Acme workspace')
  // The counting rule is a query definition: it folds. The chip beside it is a label and stays.
  expect(screen.queryByText(/counted over the issues in your teams/)).toBeNull()

  const how = screen.getByRole('button', { name: 'How the counting rule is derived' })
  fireEvent.keyDown(how, { key: ' ' })
  fireEvent.click(how)
  const panel = screen.getByRole('dialog')
  expect(panel.textContent).toContain('A project belongs to the workspace')
  expect(panel.textContent).toContain('only the ones in teams you belong to')

  fireEvent.keyDown(panel, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(how)
  expect(harness.navigate).not.toHaveBeenCalled()

  fireEvent.keyDown(document, { key: 'Escape' })
  expect(harness.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ params: { teamId: ENG.id }, search: {} }),
  )
})

test('a viewer reads the project and is offered no edit control', () => {
  harness.canWrite = false
  seed({ issues: [issue({ id: 'i1', status: 'todo' })] })
  mount()

  expect(screen.getByText('Checkout rebuild')).toBeTruthy()
  expect(screen.queryByTestId('edit-project')).toBeNull()
})
