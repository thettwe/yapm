import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  RETRO_AI_DRAFTS_BY_RETRO_QUERY_NAME,
  RETRO_AI_PROPOSALS_BY_RETRO_QUERY_NAME,
  type RetroSeed,
} from '@yapm/schema'
import { beforeEach, expect, test, vi } from 'vitest'
import type { RetroAiDraftRow, RetroAiProposalRow } from '@/retro/retro-ai-panel'

// The two artifact queries plus the issue query the panel resolves entity chips against, keyed by
// wire name — a `.one()` query hands back a row, the others an array, exactly as zero-cache does.
const harness = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  // Every query the render actually asked zero-cache for. An opted-out team must ask for none.
  requested: [] as string[],
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    const name = (request as { query: { queryName: string } }).query.queryName
    harness.requested.push(name)
    // A missing `.one()` row is `undefined`, not `[]` — the absence case has to be the real absence.
    return [name in harness.rows ? harness.rows[name] : [], { type: 'complete' }]
  },
}))

import { RETRO_AI_PENDING_VISIBLE_MS, RetroAiPanel } from '@/retro/retro-ai-panel'

function subscribed(): string[] {
  return [...new Set(harness.requested)]
}

const ISSUES_QUERY = 'issues.byTeam'

// One metric, with a value and a delta yapm computed. `999` never appears here — it appears only on
// the proposal row's ref label, which is model-authored text this surface must not display.
const SEED: RetroSeed = {
  cycleId: 'cycle-1',
  cycleName: 'Sprint 7',
  sections: [
    {
      key: 'flow',
      title: 'Flow',
      state: 'ready',
      metrics: [
        {
          key: 'time_to_first_review',
          label: 'Time to first review',
          value: 9,
          unit: 'hours',
          trend: [7, 9],
          delta: 2,
          betterWhen: 'lower',
          caption: 'Reviews started later than last cycle.',
        },
      ],
    },
  ],
}

const ISSUE = {
  id: 'issue-1',
  number: 12,
  title: 'Fix the reconnect loop',
  status: 'done',
  issueLinks: [
    {
      pullRequest: {
        id: 'pr-1',
        number: 7,
        state: 'merged',
        url: 'https://github.com/acme/app/pull/7',
        repo: 'acme/app',
        ciChecks: [],
      },
    },
  ],
}

function proposal(overrides: Partial<RetroAiProposalRow> = {}): RetroAiProposalRow {
  return {
    id: 'proposal-1',
    category: 'win',
    summary: 'Work merged faster once reviews started sooner.',
    confidence: 'high',
    refs: [{ kind: 'issue', id: 'issue-1' }],
    rank: 0,
    ...overrides,
  }
}

// A draft row as the reveal writes one: `createdAt` is the stamp the in-progress line is bounded by,
// so a test that wants "in progress" has to hand back a row that really is fresh.
function draftRow(status: RetroAiDraftRow['status'], createdAt = Date.now()): RetroAiDraftRow {
  return { status, createdAt }
}

function mount(
  draft: RetroAiDraftRow | undefined,
  proposals: readonly RetroAiProposalRow[],
  handlers: {
    onOpenIssue?: (id: string) => void
    onOpenMetric?: (ref: unknown) => void
    aiRetroDraftSince?: number | null
  } = {},
) {
  harness.rows = {
    [RETRO_AI_DRAFTS_BY_RETRO_QUERY_NAME]: draft,
    [RETRO_AI_PROPOSALS_BY_RETRO_QUERY_NAME]: proposals,
    [ISSUES_QUERY]: [ISSUE],
  }
  return render(
    <RetroAiPanel
      retroId="retro-1"
      teamId="team-1"
      aiRetroDraftSince={handlers.aiRetroDraftSince === undefined ? 1 : handlers.aiRetroDraftSince}
      seed={SEED}
      onOpenIssue={handlers.onOpenIssue ?? (() => {})}
      onOpenMetric={handlers.onOpenMetric ?? (() => {})}
    />,
  )
}

beforeEach(() => {
  harness.rows = {}
  harness.requested = []
})

// The absence cases are the substrate's requirement, not a nicety: the change-10 seed panel is the
// raw-evidence fallback and it is already on screen, so a banner about a failed run would be noise
// about a feature the team may not know it has.
test('nothing renders when there is no draft row at all', () => {
  mount(undefined, [])
  expect(screen.queryByTestId('retro-ai-panel')).toBeNull()
})

test.each(['ai_off', 'failed'] as const)('nothing renders for a %s draft', (status) => {
  mount(draftRow(status), [proposal()])
  expect(screen.queryByTestId('retro-ai-panel')).toBeNull()
})

test('nothing renders for a ready draft whose proposals were all dropped', () => {
  mount(draftRow('ready'), [])
  expect(screen.queryByTestId('retro-ai-panel')).toBeNull()
})

// The team's own consent, read off the synced `team` row: with it null the component that holds the
// two artifact queries is never mounted, so an opted-out team subscribes to nothing extra.
test('a team that never opted in renders nothing and subscribes to nothing', () => {
  mount(draftRow('ready'), [proposal()], { aiRetroDraftSince: null })

  expect(screen.queryByTestId('retro-ai-panel')).toBeNull()
  // Not even the live region: an opted-out team's retro is the retro that ships without this feature.
  expect(screen.queryByTestId('retro-ai-announcement')).toBeNull()
  expect(subscribed()).toEqual([])
})

test('pending renders one quiet line and claims nothing', () => {
  mount(draftRow('pending'), [])

  const pending = screen.getByTestId('retro-ai-pending')
  expect(pending.textContent).toContain('Drafting')
  expect(screen.queryAllByTestId('retro-ai-proposal')).toHaveLength(0)
  // Nothing is drafted yet, so there is nothing to disclaim yet.
  expect(screen.queryByTestId('retro-ai-unratified')).toBeNull()
})

// With the tail switched off instance-wide (`AI_RETRO_DRAFT=false`) the reveal still stamps a row and
// nothing ever completes it. A "drafting…" line that never resolves is the one state the docs promise
// cannot happen; past the window the section stands down and leaves the seed panel as the fallback.
test('a pending row nothing ever completes stops claiming to be in progress', () => {
  mount(draftRow('pending', Date.now() - RETRO_AI_PENDING_VISIBLE_MS - 1_000), [])

  expect(screen.queryByTestId('retro-ai-pending')).toBeNull()
  expect(screen.queryByTestId('retro-ai-panel')).toBeNull()
})

// The live region is one node for the whole life of the retro, and it is EMPTY when it mounts: a
// `role="status"` element inserted together with its own text announces nothing at all, and in the live
// path the first state to appear is `pending`. So the region has to predate even the drafting notice —
// which is why it is rendered outside the branching and its text arrives a tick later.
test('the live region exists, empty, before there is anything to announce', () => {
  mount(undefined, [])

  const region = screen.getByTestId('retro-ai-announcement')
  expect(region).toHaveAttribute('aria-live', 'polite')
  expect(region.textContent).toBe('')
  // And the section itself is still absent: an empty live region is not a surface.
  expect(screen.queryByTestId('retro-ai-panel')).toBeNull()
})

test('the drafting state and its resolution are both announced', async () => {
  const { rerender } = mount(draftRow('pending'), [])
  // Empty on the mount that inserts it, then spoken — the transition a screen reader can hear.
  expect(screen.getByTestId('retro-ai-announcement').textContent).toBe('')
  await waitFor(() =>
    expect(screen.getByTestId('retro-ai-announcement').textContent).toContain('Drafting'),
  )

  harness.rows = {
    [RETRO_AI_DRAFTS_BY_RETRO_QUERY_NAME]: draftRow('ready'),
    [RETRO_AI_PROPOSALS_BY_RETRO_QUERY_NAME]: [
      proposal({ id: 'w-1' }),
      proposal({ id: 'l-1', category: 'loss' }),
      proposal({ id: 'l-2', category: 'loss', rank: 1 }),
    ],
    [ISSUES_QUERY]: [ISSUE],
  }
  rerender(
    <RetroAiPanel
      retroId="retro-1"
      teamId="team-1"
      aiRetroDraftSince={1}
      seed={SEED}
      onOpenIssue={() => {}}
      onOpenMetric={() => {}}
    />,
  )

  const region = screen.getByTestId('retro-ai-announcement')
  expect(region).toHaveAttribute('aria-live', 'polite')
  await waitFor(() => expect(region.textContent).toBe('AI draft ready: 1 win, 2 losses.'))
  // The SAME node throughout: a region replaced on the transition would announce nothing.
  expect(screen.getByTestId('retro-ai-announcement')).toBe(region)
})

// The stored order is `category` (alphabetical) then `rank`; the reader wants Wins, Losses,
// Improvements. The panel imposes that order rather than inheriting the query's.
test('a ready draft renders its categories in canonical order, labelled as unratified', () => {
  mount(draftRow('ready'), [
    proposal({ id: 'i-1', category: 'improvement', summary: 'Start reviews earlier.' }),
    proposal({ id: 'l-1', category: 'loss', summary: 'Two issues carried a second time.' }),
    proposal({ id: 'w-1', category: 'win', summary: 'Everything in scope shipped.' }),
  ])

  const groups = screen.getAllByTestId('retro-ai-category')
  expect(groups.map((group) => group.dataset.category)).toEqual(['win', 'loss', 'improvement'])
  expect(groups.map((group) => group.querySelector('h3')?.textContent)).toEqual([
    'Wins',
    'Losses',
    'Improvements',
  ])

  const label = screen.getByTestId('retro-ai-unratified')
  expect(label.textContent).toContain('AI-drafted, not agreed')
})

test('proposals within a category follow rank, not insertion order', () => {
  mount(draftRow('ready'), [
    proposal({ id: 'w-2', rank: 1, summary: 'Second win.' }),
    proposal({ id: 'w-1', rank: 0, summary: 'First win.' }),
  ])

  expect(screen.getAllByTestId('retro-ai-proposal').map((row) => row.textContent)).toEqual([
    expect.stringContaining('First win.'),
    expect.stringContaining('Second win.'),
  ])
})

// The load-bearing one. The model points at a metric KEY; the number and the delta come from the
// client seed. A number the model typed into the ref label is never displayed.
test('a metric chip renders the seed value and delta, never the number on the row', () => {
  mount(draftRow('ready'), [
    proposal({
      refs: [
        { kind: 'widget', id: 'time_to_first_review', label: 'review wait 999h, up 500h' },
        { kind: 'issue', id: 'issue-1', label: 'Dana was slow' },
      ],
    }),
  ])

  const chip = screen.getByTestId('retro-ai-evidence-metric')
  expect(chip.textContent).toContain('Time to first review')
  expect(chip.textContent).toContain('9h')
  expect(chip.textContent).toContain('+2h vs. last cycle')

  const panel = screen.getByTestId('retro-ai-panel')
  expect(panel.textContent).not.toContain('999')
  expect(panel.textContent).not.toContain('500')
  // The other half of the same rule: an entity chip is named from the synced row, so a model-authored
  // label — which no validator scrubs — cannot reach the reader either.
  expect(panel.textContent).not.toContain('Dana')
  expect(screen.getByTestId('retro-ai-evidence-issue').textContent).toBe('#12')
})

test('every evidence chip is a focusable control, in the order the proposal cites them', () => {
  mount(draftRow('ready'), [
    proposal({
      refs: [
        { kind: 'issue', id: 'issue-1' },
        { kind: 'widget', id: 'time_to_first_review' },
        { kind: 'pull_request', id: 'pr-1' },
      ],
    }),
  ])

  const row = screen.getByTestId('retro-ai-proposal')
  const chips = [...row.querySelectorAll('button, a')]
  expect(chips.map((chip) => chip.getAttribute('data-testid'))).toEqual([
    'retro-ai-evidence-issue',
    'retro-ai-evidence-metric',
    'retro-ai-evidence-external',
  ])
  for (const chip of chips) expect(chip).not.toHaveAttribute('tabindex', '-1')

  const first = chips[0] as HTMLElement
  first.focus()
  expect(first).toHaveFocus()
})

test('a reference the client cannot name from its own rows renders no chip', () => {
  mount(draftRow('ready'), [
    proposal({
      refs: [
        { kind: 'issue', id: 'issue-not-synced', label: 'trust me' },
        { kind: 'widget', id: 'metric-that-does-not-exist' },
        { kind: 'issue', id: 'issue-1' },
      ],
    }),
  ])

  const row = screen.getByTestId('retro-ai-proposal')
  expect([...row.querySelectorAll('button, a')]).toHaveLength(1)
  expect(row.textContent).not.toContain('trust me')
})

test('activating a chip opens the entity or reveals the metric tile', () => {
  const onOpenIssue = vi.fn()
  const onOpenMetric = vi.fn()
  mount(
    draftRow('ready'),
    [
      proposal({
        refs: [
          { kind: 'issue', id: 'issue-1' },
          { kind: 'widget', id: 'time_to_first_review' },
        ],
      }),
    ],
    { onOpenIssue, onOpenMetric },
  )

  fireEvent.click(screen.getByTestId('retro-ai-evidence-issue'))
  expect(onOpenIssue).toHaveBeenCalledWith('issue-1')

  fireEvent.click(screen.getByTestId('retro-ai-evidence-metric'))
  expect(onOpenMetric).toHaveBeenCalledWith({
    kind: 'widget',
    id: 'time_to_first_review',
    label: 'Time to first review',
  })
})

// Team-level only, all the way to the DOM: there is no identity dimension on a proposal row, so
// there is nothing per-person to render — asserted rather than assumed.
test('no avatar, no image and no per-person attribution anywhere in the section', () => {
  mount(draftRow('ready'), [proposal(), proposal({ id: 'w-2', rank: 1, category: 'loss' })])

  const panel = screen.getByTestId('retro-ai-panel')
  expect(panel.querySelector('img')).toBeNull()
  expect(panel.textContent).not.toMatch(/\bby\s+\w+@/i)
})
