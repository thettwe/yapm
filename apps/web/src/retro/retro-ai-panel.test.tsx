import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  RETRO_AI_DRAFTS_BY_RETRO_QUERY_NAME,
  RETRO_AI_PROPOSALS_BY_RETRO_QUERY_NAME,
  RETRO_AI_REACTIONS_MINE_QUERY_NAME,
  type RetroPhase,
  type RetroReactionValue,
  type RetroSeed,
} from '@yapm/schema'
import { beforeEach, expect, test, vi } from 'vitest'
import type {
  RetroAiDraftRow,
  RetroAiProposalRow,
  RetroAiReactionRow,
} from '@/retro/retro-ai-panel'

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
    phase?: RetroPhase
    canWrite?: boolean
    reactions?: readonly RetroAiReactionRow[]
    onReact?: (proposalId: string, value: RetroReactionValue) => void
    onClearReaction?: (proposalId: string) => void
    onAddAction?: (proposal: { id: string; summary: string }) => void
    onFocusProposal?: (focus: unknown) => void
  } = {},
) {
  harness.rows = {
    [RETRO_AI_DRAFTS_BY_RETRO_QUERY_NAME]: draft,
    [RETRO_AI_PROPOSALS_BY_RETRO_QUERY_NAME]: proposals,
    [RETRO_AI_REACTIONS_MINE_QUERY_NAME]: handlers.reactions ?? [],
    [ISSUES_QUERY]: [ISSUE],
  }
  return render(
    <RetroAiPanel
      retroId="retro-1"
      teamId="team-1"
      aiRetroDraftSince={handlers.aiRetroDraftSince === undefined ? 1 : handlers.aiRetroDraftSince}
      seed={SEED}
      phase={handlers.phase ?? 'vote'}
      canWrite={handlers.canWrite ?? true}
      onOpenIssue={handlers.onOpenIssue ?? (() => {})}
      onOpenMetric={handlers.onOpenMetric ?? (() => {})}
      onReact={handlers.onReact ?? (() => {})}
      onClearReaction={handlers.onClearReaction ?? (() => {})}
      onAddAction={handlers.onAddAction ?? (() => {})}
      onFocusProposal={handlers.onFocusProposal ?? (() => {})}
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

// Nothing renders AND nothing is asked for. The reaction query lives one level below the draft
// state, in the component the proposals are drawn by, so a draft that produced no surface issues no
// reaction subscription either — the absence is of the query as well as of the DOM.
test.each(['ai_off', 'failed'] as const)(
  'nothing renders or subscribes for a %s draft',
  (status) => {
    mount(draftRow(status), [proposal()])
    expect(screen.queryByTestId('retro-ai-panel')).toBeNull()
    expect(subscribed()).not.toContain(RETRO_AI_REACTIONS_MINE_QUERY_NAME)
  },
)

test('nothing renders or subscribes for a ready draft whose proposals were all dropped', () => {
  mount(draftRow('ready'), [])
  expect(screen.queryByTestId('retro-ai-panel')).toBeNull()
  expect(subscribed()).not.toContain(RETRO_AI_REACTIONS_MINE_QUERY_NAME)
})

// The same claim for the state a live retro passes through on its way to a draft: while the tail is
// still running there is nothing to react to, so nothing asks who reacted.
test('a pending draft subscribes to no reactions', () => {
  mount(draftRow('pending'), [])
  expect(subscribed()).not.toContain(RETRO_AI_REACTIONS_MINE_QUERY_NAME)
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
      phase="vote"
      canWrite
      onOpenIssue={() => {}}
      onOpenMetric={() => {}}
      onReact={() => {}}
      onClearReaction={() => {}}
      onAddAction={() => {}}
      onFocusProposal={() => {}}
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

// As a VIEWER, so the row's only controls are the evidence chips: a member in `group`/`vote` also
// gets the two reaction toggles, and this test is about citation order rather than about ratification.
test('every evidence chip is a focusable control, in the order the proposal cites them', () => {
  mount(
    draftRow('ready'),
    [
      proposal({
        refs: [
          { kind: 'issue', id: 'issue-1' },
          { kind: 'widget', id: 'time_to_first_review' },
          { kind: 'pull_request', id: 'pr-1' },
        ],
      }),
    ],
    { canWrite: false },
  )

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
  mount(
    draftRow('ready'),
    [
      proposal({
        refs: [
          { kind: 'issue', id: 'issue-not-synced', label: 'trust me' },
          { kind: 'widget', id: 'metric-that-does-not-exist' },
          { kind: 'issue', id: 'issue-1' },
        ],
      }),
    ],
    { canWrite: false },
  )

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

// ---------------------------------------------------------------------------------------------
// Ratification: the team disposes.
// ---------------------------------------------------------------------------------------------

// The affordance is driven by the SAME predicate the mutator enforces, so the window the server
// keeps and the window the surface offers cannot drift. `discuss` is the interesting negative: the
// verdict is stamped on entry to it, so a control there would offer a write that is already too
// late to count.
test.each(['group', 'vote'] as const)('the reaction toggles render during %s', (phase) => {
  mount(draftRow('ready'), [proposal()], { phase })

  expect(screen.getByTestId('retro-ai-agree')).toBeInTheDocument()
  expect(screen.getByTestId('retro-ai-disagree')).toBeInTheDocument()
})

test.each(['brainstorm', 'discuss', 'actions', 'closed'] as const)(
  'the reaction toggles are absent during %s',
  (phase) => {
    mount(draftRow('ready'), [proposal()], { phase })
    expect(screen.queryByTestId('retro-ai-reactions')).toBeNull()
  },
)

test('a viewer gets no reaction control at all', () => {
  mount(draftRow('ready'), [proposal()], { phase: 'vote', canWrite: false })
  expect(screen.queryByTestId('retro-ai-reactions')).toBeNull()
})

// The direct consequence of the query's shape: no query exists that could return another member's
// reaction, so there is nothing else to render. Not a UI simplification — an absence of data.
test('only the caller’s own reaction is shown, with no count and no total before the stamp', () => {
  mount(
    draftRow('ready'),
    [proposal({ id: 'p-1' }), proposal({ id: 'p-2', rank: 1, summary: 'Untouched.' })],
    { phase: 'vote', reactions: [{ proposalId: 'p-1', value: 'agree' }] },
  )

  const rows = screen.getAllByTestId('retro-ai-proposal')
  const [mine, theirs] = rows as [HTMLElement, HTMLElement]
  expect(mine.querySelector('[data-testid="retro-ai-agree"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(mine.querySelector('[data-testid="retro-ai-disagree"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  // The second proposal carries no reaction of the caller's, and nothing about anyone else's.
  expect(theirs.querySelector('[data-testid="retro-ai-agree"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  // No verdict, no counts, and no digit anywhere that could read as a running total.
  expect(screen.queryByTestId('retro-ai-verdict')).toBeNull()
  expect(screen.queryByTestId('retro-ai-verdict-counts')).toBeNull()
  expect(screen.getByTestId('retro-ai-unratified')).toBeInTheDocument()
})

test('the toggles are real buttons in the tab order, told apart by aria-pressed', () => {
  mount(draftRow('ready'), [proposal()], {
    phase: 'vote',
    reactions: [{ proposalId: 'proposal-1', value: 'disagree' }],
  })

  for (const testId of ['retro-ai-agree', 'retro-ai-disagree']) {
    const button = screen.getByTestId(testId)
    expect(button.tagName).toBe('BUTTON')
    expect(button).not.toBeDisabled()
    expect(button).not.toHaveAttribute('tabindex', '-1')
    button.focus()
    expect(button).toHaveFocus()
  }
  // The pressed state is carried by `aria-pressed` and not by hue alone — the same discipline the
  // rest of the retro surface holds, and the reason this is assertable at all.
  expect(screen.getByTestId('retro-ai-disagree')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('retro-ai-agree')).toHaveAttribute('aria-pressed', 'false')
})

// Every per-item control in the retro names its item — the board's dots are `Vote for ${label}` —
// and a section of nine proposals otherwise hands a screen-reader user eighteen controls called
// "Agree" and "Disagree", told apart by visual adjacency alone.
test('each reaction toggle is named by the proposal it acts on', () => {
  mount(
    draftRow('ready'),
    [
      proposal({ id: 'w-1', summary: 'Everything in scope shipped.' }),
      proposal({ id: 'w-2', rank: 1, summary: 'Two issues carried a second time.' }),
    ],
    { phase: 'vote' },
  )

  expect(
    screen.getAllByTestId('retro-ai-agree').map((node) => node.getAttribute('aria-label')),
  ).toEqual([
    'Agree with: Everything in scope shipped.',
    'Agree with: Two issues carried a second time.',
  ])
  expect(
    screen.getAllByTestId('retro-ai-disagree').map((node) => node.getAttribute('aria-label')),
  ).toEqual([
    'Disagree with: Everything in scope shipped.',
    'Disagree with: Two issues carried a second time.',
  ])
  // Named, and reachable by that name — the accessible name is what a screen-reader user calls it.
  expect(screen.getByRole('button', { name: 'Agree with: Everything in scope shipped.' })).toBe(
    screen.getAllByTestId('retro-ai-agree')[0],
  )
})

test('the action control is named by the improvement it would create', () => {
  mount(
    draftRow('ready'),
    [
      proposal({
        id: 'i-1',
        category: 'improvement',
        summary: 'Hold scope where it was.',
        verdict: 'agreed',
      }),
    ],
    { phase: 'discuss' },
  )

  expect(screen.getByTestId('retro-ai-add-action')).toHaveAttribute(
    'aria-label',
    'Add as an action: Hold scope where it was.',
  )
})

// A mis-click must not become a permanent opinion: pressing the pressed value withdraws it, which
// is a different mutator from disagreeing.
test('pressing the pressed value clears it, and the other value replaces it', () => {
  const onReact = vi.fn()
  const onClearReaction = vi.fn()
  mount(draftRow('ready'), [proposal()], {
    phase: 'vote',
    reactions: [{ proposalId: 'proposal-1', value: 'agree' }],
    onReact,
    onClearReaction,
  })

  fireEvent.click(screen.getByTestId('retro-ai-agree'))
  expect(onClearReaction).toHaveBeenCalledWith('proposal-1')
  expect(onReact).not.toHaveBeenCalled()

  fireEvent.click(screen.getByTestId('retro-ai-disagree'))
  expect(onReact).toHaveBeenCalledWith('proposal-1', 'disagree')
})

// D9, and the rendering consequence recorded as §G2: once there is a verdict the section becomes one
// flat contested-first list, because a per-category sort would bury a contested Improvement under a
// column of agreed Wins — which is exactly the routing failure the ordering exists to prevent.
test('contested proposals lead, across categories, once the verdict is stamped', () => {
  mount(
    draftRow('ready'),
    [
      proposal({ id: 'w-1', category: 'win', summary: 'Agreed win.', verdict: 'agreed' }),
      proposal({ id: 'w-2', category: 'win', rank: 1, summary: 'Second win.', verdict: 'agreed' }),
      proposal({
        id: 'i-1',
        category: 'improvement',
        summary: 'Contested improvement.',
        verdict: 'contested',
      }),
      proposal({ id: 'l-1', category: 'loss', summary: 'Unrated loss.', verdict: 'unrated' }),
    ],
    { phase: 'discuss' },
  )

  expect(screen.getAllByTestId('retro-ai-proposal').map((row) => row.dataset.verdict)).toEqual([
    'contested',
    'agreed',
    'agreed',
    'unrated',
  ])
  // The non-contested tail keeps the (category, rank) order it already had — the comparator is
  // stable, so nothing reshuffles under a reader.
  expect(
    screen
      .getAllByTestId('retro-ai-proposal')
      .slice(1)
      .map((row) => row.textContent),
  ).toEqual([
    expect.stringContaining('Agreed win.'),
    expect.stringContaining('Second win.'),
    expect.stringContaining('Unrated loss.'),
  ])
  // The headings gave way to per-row category chips, so nothing was lost with them.
  expect(screen.queryAllByTestId('retro-ai-category')).toHaveLength(0)
  expect(screen.getAllByTestId('retro-ai-category-chip')).toHaveLength(4)
  // And the section stops disclaiming what the team has now decided.
  expect(screen.queryByTestId('retro-ai-unratified')).toBeNull()
})

// A TEAM-LEVEL AGGREGATE, ASSERTED AS ONE. The counts are two numbers and two words; there is no
// name, no avatar and no per-person dimension available to render even if somebody wanted to.
test('the verdict counts name nobody', () => {
  mount(draftRow('ready'), [proposal({ verdict: 'contested', agreeCount: 3, disagreeCount: 1 })], {
    phase: 'discuss',
  })

  expect(screen.getByTestId('retro-ai-verdict-counts').textContent).toBe('3 agreed, 1 disagreed')
  expect(screen.getByTestId('retro-ai-verdict').textContent).toContain('Contested')
  const panel = screen.getByTestId('retro-ai-panel')
  expect(panel.querySelector('img')).toBeNull()
  expect(panel.textContent).not.toMatch(/@/)
})

// Silence is not consent. `unrated` says so in words and shows no count, because "0 agreed, 0
// disagreed" reads as a result rather than as nobody having spoken.
test('a proposal nobody reacted to reads as unrated, with no counts', () => {
  mount(draftRow('ready'), [proposal({ verdict: 'unrated', agreeCount: 0, disagreeCount: 0 })], {
    phase: 'discuss',
  })

  expect(screen.getByTestId('retro-ai-verdict').textContent).toContain('Nobody responded')
  expect(screen.queryByTestId('retro-ai-verdict-counts')).toBeNull()
  expect(screen.getByTestId('retro-ai-verdict').textContent).not.toContain('Agreed')
})

// The one-keystroke path, and the hard line under it: the callback carries an id and a body and
// there is no assignee to pass, here or anywhere downstream.
test('an agreed improvement offers the action path, carrying no owner', () => {
  const onAddAction = vi.fn()
  mount(
    draftRow('ready'),
    [
      proposal({
        id: 'i-1',
        category: 'improvement',
        summary: 'Hold scope where it was.',
        verdict: 'agreed',
      }),
    ],
    { phase: 'discuss', onAddAction },
  )

  const control = screen.getByTestId('retro-ai-add-action')
  expect(control.tagName).toBe('BUTTON')
  control.focus()
  expect(control).toHaveFocus()

  fireEvent.click(control)
  expect(onAddAction).toHaveBeenCalledTimes(1)
  const [payload] = onAddAction.mock.calls[0] as [Record<string, unknown>]
  expect(payload).toEqual({ id: 'i-1', summary: 'Hold scope where it was.' })
  expect(Object.keys(payload)).not.toContain('assigneeId')
})

test.each([
  ['contested', 'improvement'],
  ['rejected', 'improvement'],
  ['unrated', 'improvement'],
  ['agreed', 'win'],
  ['agreed', 'loss'],
] as const)('no action path on a %s %s', (verdict, category) => {
  mount(draftRow('ready'), [proposal({ id: 'x-1', category, verdict })], { phase: 'discuss' })
  expect(screen.queryByTestId('retro-ai-add-action')).toBeNull()
})

test('the action path is absent in a phase where actions cannot be written', () => {
  mount(draftRow('ready'), [proposal({ id: 'i-1', category: 'improvement', verdict: 'agreed' })], {
    phase: 'vote',
  })
  expect(screen.queryByTestId('retro-ai-add-action')).toBeNull()
})

// The palette acts on whatever the keyboard last held, and it must never query the AI tables itself
// (§G5) — so the panel hands it a snapshot built from rows it already has.
test('focusing a proposal hands the palette a snapshot of that row', () => {
  const onFocusProposal = vi.fn()
  mount(
    draftRow('ready'),
    [
      proposal({
        id: 'i-1',
        category: 'improvement',
        summary: 'Hold scope.',
        verdict: 'contested',
      }),
    ],
    {
      phase: 'vote',
      reactions: [{ proposalId: 'i-1', value: 'disagree' }],
      onFocusProposal,
    },
  )

  fireEvent.focus(screen.getByTestId('retro-ai-agree'))
  expect(onFocusProposal).toHaveBeenCalledWith({
    id: 'i-1',
    body: 'Hold scope.',
    category: 'improvement',
    verdict: 'contested',
    mine: 'disagree',
  })
})

// THE REGRESSION GUARD. AI off is not "the section is hidden" — it is the retro that ships without
// this capability, in every phase including the one that ratifies. No query, no element, no error.
test.each(['vote', 'discuss'] as const)(
  'with AI off the ratification surface is absent in %s, and nothing is asked or logged',
  (phase) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mount(
        draftRow('ready'),
        [proposal({ verdict: 'contested', agreeCount: 2, disagreeCount: 1 })],
        { aiRetroDraftSince: null, phase },
      )

      expect(subscribed()).toEqual([])
      expect(subscribed()).not.toContain(RETRO_AI_REACTIONS_MINE_QUERY_NAME)
      expect(screen.queryByTestId('retro-ai-panel')).toBeNull()
      expect(screen.queryByTestId('retro-ai-reactions')).toBeNull()
      expect(screen.queryByTestId('retro-ai-verdict')).toBeNull()
      expect(screen.queryByTestId('retro-ai-add-action')).toBeNull()
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  },
)

// And the opted-in mirror of the same claim: the reaction query is one of exactly three the panel
// asks for, so it cannot have been added to a surface that is supposed to be silent.
test('an opted-in panel asks for the reaction query, and only its own three plus the issues it cites', () => {
  mount(draftRow('ready'), [proposal()], { phase: 'vote' })
  expect(subscribed().sort()).toEqual(
    [
      RETRO_AI_DRAFTS_BY_RETRO_QUERY_NAME,
      RETRO_AI_PROPOSALS_BY_RETRO_QUERY_NAME,
      RETRO_AI_REACTIONS_MINE_QUERY_NAME,
      ISSUES_QUERY,
    ].sort(),
  )
})
