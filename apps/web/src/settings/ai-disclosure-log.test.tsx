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
        teamsChangedNames: [],
        detail: { audienceSize: 4 },
      },
      {
        id: 'audit-2',
        createdAt: Date.UTC(2026, 6, 29, 17, 2),
        event: 'policy_changed',
        teamId: null,
        teamName: null,
        actorName: 'Grace',
        teamsChangedNames: ['Payments', 'Platform'],
        detail: { enabled: true, killed: false, teamsChanged: ['team-1', 'team-2'] },
      },
      {
        id: 'audit-3',
        createdAt: Date.UTC(2026, 6, 28, 11, 40),
        event: 'generated',
        teamId: 'team-1',
        teamName: 'Platform',
        actorName: null,
        teamsChangedNames: [],
        detail: { status: 'ai_off' },
      },
      {
        id: 'audit-4',
        createdAt: Date.UTC(2026, 6, 27, 8, 5),
        event: 'unpublished',
        teamId: 'team-1',
        teamName: 'Platform',
        actorName: 'Ada',
        teamsChangedNames: [],
        detail: { audienceSize: 0 },
      },
    ],
  }

  render(<AiSettingsView />)

  const totals = await screen.findByTestId('ai-disclosure-totals')
  expect(totals).toHaveTextContent('Platform')
  expect(totals).toHaveTextContent('3 generated')
  expect(totals).toHaveTextContent('2 shared')
  expect(totals).toHaveTextContent('1 retracted')
  // A policy write is workspace-scoped, so it is NOT totalled under a team — a "0 policy changes"
  // against every team was a number no policy write could ever move.
  expect(totals.textContent ?? '').not.toContain('policy change')

  const recent = screen.getByTestId('ai-disclosure-recent')
  expect(recent).toHaveTextContent('Shared')
  expect(recent).toHaveTextContent('4 readers')
  expect(recent).toHaveTextContent('Ada')
  // The teams a policy write touched, by NAME, where the count used to be.
  expect(recent).toHaveTextContent('Policy changed · Payments, Platform')
  expect(recent.textContent ?? '').not.toContain('teams edited')

  // The stored status is a database token; what an admin reads is a sentence.
  expect(recent).toHaveTextContent('AI was off')
  expect(recent.textContent ?? '').not.toContain('ai_off')

  // A retraction's recorded audience size is zero BY DEFINITION, so it is not reported as a count of
  // readers on the retraction row.
  const retracted = recent.querySelector('[data-event="unpublished"]')
  expect(retracted?.textContent ?? '').toContain('Retracted')
  expect(retracted?.textContent ?? '').not.toContain('0 readers')

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
  api.disclosures = oneDisclosure()

  render(<AiSettingsView />)

  const section = await screen.findByTestId('ai-disclosure-log')
  expect(section.textContent ?? '').not.toContain(READER)
  expect(section.textContent ?? '').not.toMatch(/\bopened\b|\bviewed\b|\bread by\b/i)
  // The count of readers is a NUMBER. There is no list, and nothing to expand into one.
  expect(section.querySelectorAll('[data-reader-id]')).toHaveLength(0)
})

function oneDisclosure(): DisclosureAuditLog {
  return {
    totals: [
      { teamId: 'team-1', teamName: 'Platform', generated: 1, published: 1, unpublished: 0 },
    ],
    recent: [
      {
        id: 'audit-1',
        createdAt: Date.UTC(2026, 6, 30, 9, 15),
        event: 'published',
        teamId: 'team-1',
        teamName: 'Platform',
        actorName: 'Ada',
        teamsChangedNames: [],
        detail: { audienceSize: 4 },
      },
    ],
  }
}

// THE THIRD SETTINGS SURFACE THIS FEATURE FAMILY ADDS, held to the same two rules as the other two.
// The e2e sweep collects this section's paint in all six preset × mode dressings against the running
// stack; what is checkable here, on every run rather than only in CI, is that nothing in it paints
// from a literal and that it puts nothing in the tab order — it is a log, not a control, so a
// keyboard user passes straight over it rather than through a row-shaped stop that does nothing.
test('paints from tokens only and adds no keyboard stop', async () => {
  api.disclosures = oneDisclosure()

  render(<AiSettingsView />)

  const section = await screen.findByTestId('ai-disclosure-log')
  for (const element of [section, ...section.querySelectorAll('*')]) {
    const className = element.getAttribute('class') ?? ''
    expect(className, `${className} paints from a literal rather than a token`).not.toMatch(
      /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i,
    )
    expect(element.getAttribute('style') ?? '').toBe('')
  }
  // Nothing focusable, and nothing pretending to be: no tabindex, no control, no handler-bearing row.
  expect(section.querySelectorAll('[tabindex], a, button, input, select, textarea')).toHaveLength(0)
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
