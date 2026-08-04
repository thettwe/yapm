import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// The review half of the review-and-publish gate. What this file holds true: the producing team sees
// the FULL product-facing text before anybody outside can, the release is an explicit act, and after
// it the team is told how many people it went to — a snapshot, never a roster — beside copy that says
// plainly what retraction can and cannot do.

const zero = vi.hoisted(() => ({
  row: undefined as Record<string, unknown> | undefined,
  result: { type: 'success' } as { type: string; error?: { type: string; message: string } },
  mutate: vi.fn((mutation: { mutator: { mutatorName: string }; args: Record<string, unknown> }) => {
    void mutation
    return { client: Promise.resolve(zero.result), server: Promise.resolve(zero.result) }
  }),
}))

const membership = vi.hoisted(() => ({ canWrite: true }))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [zero.row, { type: 'complete' }],
  useZero: () => ({ mutate: zero.mutate }),
}))

vi.mock('@/auth/use-membership', () => ({
  useMembership: () => ({ canWrite: membership.canWrite }),
}))

import { PmDigestShareCard } from './pm-digest-card'

const NOW = Date.UTC(2026, 6, 20, 9, 0, 0)

const CONTENT = {
  headline: 'Guest checkout shipped.',
  sections: [
    {
      title: 'Shipped',
      items: [
        {
          kind: 'shipped',
          summary: 'Guest checkout is live for every customer.',
          evidenceRefs: [{ kind: 'issue', id: 'ev-issue' }],
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
  evidenceLabels: { 'ev-issue': 'ENG-142 · PR #331' },
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pm-1',
    teamId: 'team-platform',
    cycleId: 'cycle-12',
    status: 'ready',
    content: CONTENT,
    model: 'claude-test-1',
    generatedAt: NOW,
    publishedAt: null,
    audienceSizeAtPublish: null,
    ...overrides,
  }
}

beforeEach(() => {
  zero.mutate.mockClear()
  zero.result = { type: 'success' }
  membership.canWrite = true
  zero.row = row()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

// Nothing generated means nothing to review, and an empty card would be a standing invitation to
// wonder what it would have said.
test('no row renders no card at all', () => {
  zero.row = undefined
  const { container } = render(<PmDigestShareCard cycleId="cycle-12" />)

  expect(container.innerHTML).toBe('')
})

test('the team reads the whole product-facing text before anyone outside can', () => {
  render(<PmDigestShareCard cycleId="cycle-12" />)

  expect(screen.getByTestId('pm-digest-share')).toHaveAttribute('data-published', 'false')
  expect(screen.getByTestId('pm-digest-subject')).toHaveTextContent('Platform · Cycle 12')
  expect(screen.getByTestId('pm-digest-headline')).toHaveTextContent('Guest checkout shipped.')
  expect(screen.getByTestId('pm-digest-evidence')).toHaveTextContent('ENG-142 · PR #331')
  expect(screen.getByTestId('pm-digest-share')).toHaveTextContent(
    'Nobody outside your team can read it until you share it',
  )
  expect(screen.queryByTestId('pm-digest-share-readers')).toBeNull()
})

test('sharing is an explicit act with a call-site timestamp', async () => {
  render(<PmDigestShareCard cycleId="cycle-12" />)

  const publish = screen.getByTestId('pm-digest-publish')
  expect(publish.tagName).toBe('BUTTON')
  publish.focus()
  expect(publish).toHaveFocus()

  fireEvent.click(publish)
  expect(zero.mutate.mock.calls.map((call) => call[0].mutator.mutatorName)).toEqual([
    'pmDigest.publish',
  ])
  expect(zero.mutate.mock.calls[0]?.[0].args).toEqual({ id: 'pm-1', updatedAt: NOW })

  await waitFor(() => {
    expect(screen.getByTestId('pm-digest-share-announcement').textContent).toBe(
      'Shared with product.',
    )
  })
})

// The count is `audience_size_at_publish` — stamped server-side when the team released it. A live
// count would silently change under the team when an admin edits the list.
test('after sharing the team is told how many people, never which people', () => {
  zero.row = row({ publishedAt: NOW, audienceSizeAtPublish: 3 })
  render(<PmDigestShareCard cycleId="cycle-12" />)

  expect(screen.getByTestId('pm-digest-share')).toHaveAttribute('data-published', 'true')
  expect(screen.getByTestId('pm-digest-share-readers')).toHaveTextContent(
    'Shared with 3 readers outside this team.',
  )
  expect(screen.getByTestId('pm-digest-share-readers')).toHaveTextContent('not a running count')
  expect(screen.queryByTestId('pm-digest-publish')).toBeNull()
})

// The honest limit, in words rather than implied by a button label. It is the entire argument for the
// gate being default-on.
test('retraction says what it cannot do, and writes the unpublish mutator', async () => {
  zero.row = row({ publishedAt: NOW, audienceSizeAtPublish: 1 })
  render(<PmDigestShareCard cycleId="cycle-12" />)

  expect(screen.getByTestId('pm-digest-share')).toHaveTextContent(
    'Retracting stops further reads. It does not un-read what has already been read.',
  )

  fireEvent.click(screen.getByTestId('pm-digest-retract'))
  expect(zero.mutate.mock.calls.map((call) => call[0].mutator.mutatorName)).toEqual([
    'pmDigest.unpublish',
  ])
  await waitFor(() => {
    expect(screen.getByTestId('pm-digest-share-announcement').textContent).toContain('Retracted')
  })
})

test.each([
  ['pending', 'is being written'],
  ['failed', 'could not be written'],
  ['ai_off', 'AI is off for this workspace'],
])('a %s row says what happened and offers no control', (status, needle) => {
  zero.row = row({ status, content: null })
  render(<PmDigestShareCard cycleId="cycle-12" />)

  const note = screen.getByTestId('pm-digest-share-note')
  expect(note).toHaveTextContent(needle)
  expect(note).toHaveTextContent('Nothing has left this team')
  expect(screen.queryByTestId('pm-digest-publish')).toBeNull()
  expect(screen.queryByTestId('pm-digest-retract')).toBeNull()
  expect(zero.mutate).not.toHaveBeenCalled()
})

// A viewer reads their own team's work, and releasing it across a permission boundary is a write.
test('a viewer reads the text and cannot release it', () => {
  membership.canWrite = false
  render(<PmDigestShareCard cycleId="cycle-12" />)

  expect(screen.getByTestId('pm-digest-headline')).toBeInTheDocument()
  expect(screen.queryByTestId('pm-digest-publish')).toBeNull()
  expect(zero.mutate).not.toHaveBeenCalled()
})

test('a rejected release surfaces the reason and announces nothing', async () => {
  zero.result = { type: 'error', error: { type: 'app', message: 'Not authorized' } }
  render(<PmDigestShareCard cycleId="cycle-12" />)

  fireEvent.click(screen.getByTestId('pm-digest-publish'))

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not authorized'))
  expect(screen.getByTestId('pm-digest-share-announcement').textContent).toBe('')
})
