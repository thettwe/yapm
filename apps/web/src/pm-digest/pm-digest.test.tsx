import { render, screen } from '@testing-library/react'
import type { StoredPmDigestContent } from '@yapm/schema'
import type { ReactNode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

// What this file proves is mostly a NEGATIVE, and it is the whole point of the surface: a caller the
// disclosure policy has not named gets no surface, no empty state and — the part a screenshot cannot
// show — no query. The positive half proves the render is self-sufficient: baked plain-text evidence,
// never a link, because the reader can open none of the targets.

const zero = vi.hoisted(() => ({ rows: [] as unknown[], calls: 0 }))
const sync = vi.hoisted(() => ({ audience: [] as string[] }))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (query: unknown) => {
    zero.calls += 1
    void query
    return [zero.rows, { type: 'complete' }]
  },
}))

vi.mock('@/zero/provider', () => ({
  useSyncSession: () => ({
    status: 'ready',
    userID: 'user-pm',
    role: 'viewer',
    pmAudienceTeamIds: sync.audience,
    unavailable: false,
  }),
  useSyncControl: () => ({ refresh: vi.fn(), retry: vi.fn() }),
}))

// The shell is the workspace chrome and reads its own queries; stubbing it keeps the call count in
// this file a measurement of the DISCLOSURE query alone.
vi.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

import { PmDigestsEntry } from './digests-entry'
import { PmDigestsGate } from './digests-gate'
import { pmEvidenceLabels, pmSubjectLine, sharedReadersLabel } from './model'

const CONTENT: StoredPmDigestContent = {
  headline: 'Guest checkout shipped; billing migration carried into the next cycle.',
  sections: [
    {
      title: 'Shipped',
      items: [
        {
          kind: 'shipped',
          summary: 'Guest checkout is live for every customer.',
          evidenceRefs: [
            { kind: 'issue', id: 'ev-issue' },
            { kind: 'pull_request', id: 'ev-pr' },
          ],
          confidence: 'high',
        },
      ],
    },
  ],
  subject: {
    teamName: 'Platform',
    cycleName: 'Cycle 12',
    startDate: Date.UTC(2026, 6, 1),
    endDate: Date.UTC(2026, 6, 14),
  },
  evidenceLabels: { 'ev-issue': 'ENG-142', 'ev-pr': 'ENG-142 · PR #331' },
}

const ROW = {
  id: 'pm-1',
  teamId: 'team-platform',
  cycleId: 'cycle-12',
  status: 'ready',
  content: CONTENT,
  model: 'claude-test-1',
  generatedAt: Date.UTC(2026, 6, 15),
  publishedAt: Date.UTC(2026, 6, 16),
  audienceSizeAtPublish: 3,
}

beforeEach(() => {
  zero.calls = 0
  zero.rows = [ROW]
  sync.audience = []
})

// The falsifiable check, at the surface tier: with the default policy nobody is named, so the reader
// is not "empty" — it does not exist, and nothing was asked of the server to establish that.
test('an unnamed caller gets no surface and issues no query', () => {
  const { container } = render(<PmDigestsGate />)

  expect(container.innerHTML).toBe('')
  expect(screen.queryByTestId('shell')).toBeNull()
  expect(screen.queryByTestId('pm-digest-card')).toBeNull()
  expect(zero.calls).toBe(0)
})

test('a named reader reads the subject, the narrative and the framing', () => {
  sync.audience = ['team-platform']
  render(<PmDigestsGate />)

  expect(zero.calls).toBeGreaterThan(0)
  expect(screen.getByTestId('pm-digest-subject')).toHaveTextContent('Platform · Cycle 12')
  expect(screen.getByTestId('pm-digest-headline')).toHaveTextContent('Guest checkout shipped')
  expect(screen.getByTestId('pm-digest-item')).toHaveTextContent(
    'Guest checkout is live for every customer.',
  )
  expect(screen.getByTestId('pm-digest-framing')).toHaveTextContent('AI-generated · claude-test-1')
})

// A PM outside the producing team can open none of these targets, so a link would dead-end — and
// making one work means widening reads on issues and pull requests, a far larger disclosure than the
// prose the link was meant to make verifiable.
test('evidence renders as baked plain text, and nothing on the surface links or loads out', () => {
  sync.audience = ['team-platform']
  const { container } = render(<PmDigestsGate />)

  const labels = screen.getAllByTestId('pm-digest-evidence')
  expect(labels.map((label) => label.textContent)).toEqual(['ENG-142', 'ENG-142 · PR #331'])
  for (const label of labels) expect(label.tagName).toBe('SPAN')

  expect(container.querySelectorAll('a')).toHaveLength(0)
  expect(container.querySelectorAll('img')).toHaveLength(0)
  expect(container.querySelectorAll('iframe')).toHaveLength(0)
})

// A blob this render cannot walk has nothing to say, and an empty card would still be saying
// something to somebody who was never meant to know the row exists.
test('a row whose content cannot be walked renders as absent, not as an empty card', () => {
  sync.audience = ['team-platform']
  zero.rows = [{ ...ROW, content: { headline: 'no sections' } }]
  const { container } = render(<PmDigestsGate />)

  expect(screen.queryByTestId('pm-digest-card')).toBeNull()
  expect(container.innerHTML).toBe('')
})

// BEING NAMED IS NOT THE SAME AS BEING TOLD SOMETHING, and the absence covers both. "Nothing has
// been shared with you yet" would tell this reader that the channel exists and that the team on the
// other side has chosen not to use it — a fact about another team's decision that nobody published.
test('a named reader with nothing released yet gets no surface either', () => {
  sync.audience = ['team-platform']
  zero.rows = []
  const { container } = render(<PmDigestsGate />)

  expect(container.innerHTML).toBe('')
  expect(screen.queryByTestId('shell')).toBeNull()
  expect(screen.queryByTestId('pm-digests-empty')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Product digests' })).toBeNull()
  // The query still runs: whether anything was ever released lives in a row, not in the credential,
  // so a named reader has to ask. What must not happen is a surface built on the answer "nothing".
  expect(zero.calls).toBeGreaterThan(0)
})

// The way in has to answer the same question the surface does, or the shell offers a door onto an
// empty room — which is itself a disclosure that a channel exists.
test('the shell entry appears only for a named reader with something released', () => {
  const { rerender } = render(<PmDigestsEntry />)
  expect(screen.queryByTestId('pm-digests-entry')).toBeNull()
  expect(zero.calls).toBe(0)

  sync.audience = ['team-platform']
  zero.rows = []
  rerender(<PmDigestsEntry />)
  expect(screen.queryByTestId('pm-digests-entry')).toBeNull()

  zero.rows = [ROW]
  rerender(<PmDigestsEntry />)
  expect(screen.getByTestId('pm-digests-entry')).toBeInTheDocument()
})

test('the subject line and the evidence labels come only from what yapm baked into the row', () => {
  expect(pmSubjectLine(CONTENT)).toContain('Platform · Cycle 12 · ')
  expect(pmSubjectLine({ headline: '', sections: [] })).toBeNull()

  // An id with no baked label renders as nothing rather than as a bare uuid, and a repeated label
  // is shown once.
  expect(pmEvidenceLabels([{ id: 'ev-issue' }, { id: 'unknown' }], CONTENT.evidenceLabels)).toEqual(
    ['ENG-142'],
  )
  expect(pmEvidenceLabels([{ id: 'ev-issue' }], undefined)).toEqual([])
})

// The snapshot the producing team is shown. Never a name — there is no reader list anywhere.
test('the reader count reads as a count and never as a roster', () => {
  expect(sharedReadersLabel(1)).toBe('Shared with 1 reader outside this team.')
  expect(sharedReadersLabel(3)).toBe('Shared with 3 readers outside this team.')
  expect(sharedReadersLabel(null)).toBe('Shared outside this team.')
})
