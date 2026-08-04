import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { DisclosureAuditLog } from '@/settings/ai'

// A reader's id. No response could carry one — there is no audience field and no read event on
// either shape — so it is here to assert "no individual reader is rendered" against a real string.
const READER = 'user-a1b2c3'

const api = vi.hoisted(() => ({
  disclosures: { totals: [], recent: [] } as DisclosureAuditLog,
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [[], { type: 'complete' }],
  useZero: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/auth/use-membership', () => ({ useMembership: () => ({ canManage: true }) }))

vi.mock('@/settings/ai', () => ({
  fetchAiConfig: () =>
    Promise.resolve({ canStoreKeys: false, missingEnv: [], envProviders: [], status: null }),
  fetchAiVerdictLog: () => Promise.resolve({ totals: [], recent: [] }),
  fetchAiDisclosureLog: () => Promise.resolve(api.disclosures),
  removeAiProviderKey: () => Promise.resolve(),
  setAiProviderKey: () => Promise.resolve(),
  updateAiConfig: () => Promise.resolve(),
}))

import { AiSettingsView } from './ai-view'

beforeEach(() => {
  api.disclosures = { totals: [], recent: [] }
})

test('reports what was disclosed and to how many readers, in the product’s own words', async () => {
  api.disclosures = {
    totals: [
      {
        teamId: 'team-1',
        teamName: 'Platform',
        policyChanged: 2,
        generated: 3,
        published: 2,
        unpublished: 1,
      },
    ],
    recent: [
      {
        id: 'audit-1',
        createdAt: Date.UTC(2026, 6, 30, 9, 15),
        event: 'published',
        teamId: 'team-1',
        teamName: 'Platform',
        actorName: 'Ada',
        detail: { audienceSize: 4 },
      },
      {
        id: 'audit-2',
        createdAt: Date.UTC(2026, 6, 29, 17, 2),
        event: 'policy_changed',
        teamId: null,
        teamName: null,
        actorName: 'Grace',
        detail: { enabled: true, killed: false, teamsChanged: ['team-1'] },
      },
    ],
  }

  render(<AiSettingsView />)

  const totals = await screen.findByTestId('ai-disclosure-totals')
  expect(totals).toHaveTextContent('Platform')
  expect(totals).toHaveTextContent('2 policy changes')
  expect(totals).toHaveTextContent('2 shared')
  expect(totals).toHaveTextContent('1 retracted')

  const recent = screen.getByTestId('ai-disclosure-recent')
  expect(recent).toHaveTextContent('Shared')
  expect(recent).toHaveTextContent('4 readers')
  expect(recent).toHaveTextContent('Ada')
  expect(recent).toHaveTextContent('Policy changed')
  expect(recent).toHaveTextContent('1 team edited')

  // The section says what it is AND what it is not, rather than leaving it to the docs. Retraction
  // keeps change 20's exact formulation rather than a second wording invented here.
  const section = screen.getByTestId('ai-disclosure-log')
  expect(section).toHaveTextContent('what was disclosed and to how many readers')
  expect(section).toHaveTextContent('never who read it')
  expect(section).toHaveTextContent('stops further reads; it does not un-read')
})

// VISION #8. The guardrail is structural — the totals are keyed by team and neither shape has an
// actor-keyed field — so this asserts the absence rather than trusting the component to omit one.
test('surfaces no per-person reading data', async () => {
  api.disclosures = {
    totals: [
      {
        teamId: 'team-1',
        teamName: 'Platform',
        policyChanged: 1,
        generated: 1,
        published: 1,
        unpublished: 0,
      },
    ],
    recent: [
      {
        id: 'audit-1',
        createdAt: Date.UTC(2026, 6, 30, 9, 15),
        event: 'published',
        teamId: 'team-1',
        teamName: 'Platform',
        actorName: 'Ada',
        detail: { audienceSize: 4 },
      },
    ],
  }

  render(<AiSettingsView />)

  const section = await screen.findByTestId('ai-disclosure-log')
  expect(section.textContent ?? '').not.toContain(READER)
  expect(section.textContent ?? '').not.toMatch(/\bopened\b|\bviewed\b|\bread by\b/i)
  // The count of readers is a NUMBER. There is no list, and nothing to expand into one.
  expect(section.querySelectorAll('[data-reader-id]')).toHaveLength(0)
})

// D9: absence is driven by the LOG BEING EMPTY, not by the disclosure switch. Hiding it when
// disclosure is turned off would hide the history at the exact moment an admin wants it.
test('renders nothing at all when nothing has ever been disclosed', async () => {
  render(<AiSettingsView />)

  // The verdict log below it still renders, so this waits on a real settled surface rather than a
  // bare timeout before asserting the disclosure section is absent.
  await screen.findByTestId('ai-verdict-log')
  expect(screen.queryByTestId('ai-disclosure-log')).toBeNull()
  expect(screen.queryByTestId('ai-disclosure-totals')).toBeNull()
  expect(screen.queryByTestId('ai-disclosure-recent')).toBeNull()
})
