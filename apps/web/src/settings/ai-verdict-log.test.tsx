import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// The log the server returns. Every field on it is team-level: there is no user column on either
// shape, because the read behind it never touches the reaction table. The reactor id below is
// therefore something no response could carry — it is here so "no individual is rendered" is asserted
// against a real string rather than against a shape.
const REACTOR = 'user-a1b2c3'

const api = vi.hoisted(() => ({
  log: {
    totals: [] as {
      teamId: string
      teamName: string
      teamKey: string
      agreed: number
      contested: number
      rejected: number
      unrated: number
      undecided: number
    }[],
    recent: [] as {
      id: string
      teamId: string
      teamName: string
      summary: string
      category: 'win' | 'loss' | 'improvement'
      verdict: 'agreed' | 'contested' | 'rejected' | 'unrated'
      agreeCount: number
      disagreeCount: number
      cycleName: string | null
    }[],
  },
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [[], { type: 'complete' }],
  useZero: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/auth/use-membership', () => ({ useMembership: () => ({ canManage: true }) }))

vi.mock('@/settings/ai', () => ({
  fetchAiConfig: () =>
    Promise.resolve({ canStoreKeys: false, missingEnv: [], envProviders: [], status: null }),
  fetchAiDisclosureLog: () => Promise.resolve({ totals: [], recent: [] }),
  fetchAiVerdictLog: () => Promise.resolve(api.log),
  removeAiProviderKey: () => Promise.resolve(),
  setAiProviderKey: () => Promise.resolve(),
  updateAiConfig: () => Promise.resolve(),
}))

import { AiSettingsView } from './ai-view'

beforeEach(() => {
  api.log = { totals: [], recent: [] }
})

test('reports each team’s verdicts and what it rejected or split over, in the product’s own words', async () => {
  api.log = {
    totals: [
      {
        teamId: 'team-1',
        teamName: 'Platform',
        teamKey: 'PLT',
        agreed: 4,
        contested: 1,
        rejected: 2,
        unrated: 1,
        undecided: 3,
      },
    ],
    recent: [
      {
        id: 'proposal-1',
        teamId: 'team-1',
        teamName: 'Platform',
        summary: 'Add a second reviewer to every pull request.',
        category: 'improvement',
        verdict: 'rejected',
        agreeCount: 0,
        disagreeCount: 2,
        cycleName: 'Cycle 6',
      },
      // CONTESTED IS REPORTED TOO. A team splitting down the middle is as much a signal about the
      // draft as a team throwing it out, and the heading has to say so.
      {
        id: 'proposal-2',
        teamId: 'team-1',
        teamName: 'Platform',
        summary: 'Two issues carried a second time.',
        category: 'loss',
        verdict: 'contested',
        agreeCount: 2,
        disagreeCount: 1,
        cycleName: null,
      },
    ],
  }

  render(<AiSettingsView />)

  const totals = await screen.findByTestId('ai-verdict-totals')
  expect(totals).toHaveTextContent('Platform')
  expect(totals).toHaveTextContent(
    '4 agreed · 1 contested · 2 rejected · 1 nobody responded · 3 not yet decided',
  )

  expect(screen.getByText('Most recently rejected or contested')).toBeInTheDocument()
  const recent = screen.getByTestId('ai-verdict-recent')
  expect(recent).toHaveTextContent('Improvement · Rejected · 0 agreed, 2 disagreed')
  expect(recent).toHaveTextContent('Loss · Contested · 2 agreed, 1 disagreed')
  expect(recent).toHaveTextContent('Cycle 6')

  // No stored token reaches the reader: a row prints the product's word for an enum, never the value
  // the column holds.
  for (const token of ['· improvement ·', '· loss ·', '· rejected ·', '· contested ·']) {
    expect(recent.textContent, token).not.toContain(token)
  }

  // And no individual does either — not the reactor, not any user id, for any role including this
  // one. There is no user field on the response to render, which is the point.
  const section = screen.getByTestId('ai-verdict-log')
  expect(section.textContent).not.toContain(REACTOR)
  expect(section.textContent).not.toContain('user-')
})

test('says nothing has been decided yet rather than drawing an empty table', async () => {
  render(<AiSettingsView />)

  expect(await screen.findByTestId('ai-verdict-log-empty')).toHaveTextContent(
    'A verdict is stamped when a team advances a retro out of voting.',
  )
  expect(screen.queryByTestId('ai-verdict-totals')).toBeNull()
  expect(screen.queryByTestId('ai-verdict-recent')).toBeNull()
})
