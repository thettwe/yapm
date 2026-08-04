import { act, fireEvent, render, screen } from '@testing-library/react'
import type { RetroReactionValue } from '@yapm/schema'
import { useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { RetroApi } from '@/retro/api'
import type { RetroRowData } from '@/retro/model'
import { type RetroAiFocus, RetroCommandProvider, useRetroCommand } from '@/retro/retro-command'

// The palette half of the ratification surface. Everything here is the keyboard path: the four AI
// entries act on whatever the keyboard LAST HELD, recorded as a snapshot rather than as an id
// (§G5 — the always-mounted palette must never query the AI tables), and the snapshot is refreshed
// by a DOM focus event and by nothing else. That last fact is what this file exists to pin.

function api(): RetroApi {
  const stub = () => vi.fn(() => Promise.resolve())
  return {
    createDraft: stub(),
    updateDraft: stub(),
    deleteDraft: stub(),
    moveCard: stub(),
    groupCards: stub(),
    labelGroup: stub(),
    dissolveGroup: stub(),
    deleteCard: stub(),
    castVote: stub(),
    retractVote: stub(),
    setPhase: stub(),
    setAnonymous: stub(),
    setFormat: stub(),
    setVoteBudget: stub(),
    claimFacilitator: stub(),
    setFacilitator: stub(),
    startTimer: stub(),
    stopTimer: stub(),
    heartbeat: stub(),
    createAction: stub(),
    setAiReaction: stub(),
    clearAiReaction: stub(),
    updateAction: stub(),
    deleteAction: stub(),
    convertAction: stub(),
  } as unknown as RetroApi
}

const RETRO: RetroRowData = {
  id: 'retro-1',
  teamId: 'team-1',
  cycleId: 'cycle-1',
  nextCycleId: null,
  title: 'Sprint 7 retro',
  format: 'start_stop_continue',
  phase: 'vote',
  facilitatorId: 'user-1',
  isAnonymous: false,
  votesPerParticipant: 3,
  timerEndsAt: null,
  timerDurationS: null,
  closedAt: null,
  createdAt: 1,
}

const PROPOSAL = {
  id: 'proposal-1',
  body: 'Hold scope where it was this cycle rather than growing it mid-flight.',
  category: 'improvement',
} as const

// The panel's real sequence, reduced to the two events that matter: focus pushes a snapshot of the
// row AS IT STOOD, and reacting with the inline toggle changes the row WITHOUT moving focus — so the
// snapshot the provider still holds predates the reaction. That is why it carries body, category and
// verdict only: a "my reaction" field would be stale in exactly this sequence, and the entry that
// would have read it is offered unconditionally instead.
function ProposalRow({ verdict = null }: { verdict?: RetroAiFocus['verdict'] }) {
  const command = useRetroCommand()
  const [mine, setMine] = useState<RetroReactionValue | null>(null)

  return (
    <button
      type="button"
      data-testid="retro-ai-agree"
      aria-pressed={mine === 'agree'}
      onFocus={() =>
        command.setFocusedAiProposal({
          id: PROPOSAL.id,
          body: PROPOSAL.body,
          category: PROPOSAL.category,
          verdict,
        })
      }
      onClick={() => setMine('agree')}
    >
      Agree
    </button>
  )
}

function mount(
  options: {
    phase?: RetroRowData['phase']
    focused?: boolean
    verdict?: RetroAiFocus['verdict']
  } = {},
) {
  const retroApi = api()
  render(
    <RetroCommandProvider
      retro={{ ...RETRO, phase: options.phase ?? 'vote' }}
      columns={[]}
      cards={[]}
      groups={[]}
      votes={[]}
      actions={[]}
      members={[]}
      canWrite
      facilitator
      api={retroApi}
      seed={null}
      onNewCard={() => {}}
      onNewAction={() => {}}
      onSeedCard={() => {}}
    >
      {options.focused === false ? null : <ProposalRow verdict={options.verdict ?? null} />}
    </RetroCommandProvider>,
  )
  return retroApi
}

function openPalette() {
  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  // jsdom ships neither; `cmdk` observes its list and Base UI measures its popup.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// THE REGRESSION THIS FILE IS FOR. Reacting with the inline toggle moves no focus, so a "Clear my
// reaction" entry gated on the caller's own reaction would be missing for exactly the member who
// just reacted and wants it back. The mutator reads-then-returns on a missing row, so offering it
// unconditionally costs a no-op and gating it costs the command.
test('clear my reaction is offered after a reaction taken with the inline toggle', () => {
  const retroApi = mount()

  const toggle = screen.getByTestId('retro-ai-agree')
  fireEvent.focus(toggle)
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'true')

  openPalette()
  const clear = screen.getByText('Clear my reaction')
  fireEvent.click(clear)
  expect(retroApi.clearAiReaction).toHaveBeenCalledWith(PROPOSAL.id)
})

test('the reaction commands act on the proposal the keyboard last held', () => {
  const retroApi = mount()
  fireEvent.focus(screen.getByTestId('retro-ai-agree'))

  openPalette()
  fireEvent.click(screen.getByText('Agree with this AI proposal'))
  expect(retroApi.setAiReaction).toHaveBeenCalledWith(PROPOSAL.id, 'agree')

  openPalette()
  fireEvent.click(screen.getByText('Disagree with this AI proposal'))
  expect(retroApi.setAiReaction).toHaveBeenCalledWith(PROPOSAL.id, 'disagree')
})

// The palette offers only what the shared predicate allows, so it can never send a write the server
// will refuse: the reaction window is `group` and `vote`, and `discuss` is past it.
test('no reaction command exists once the window has shut', () => {
  mount({ phase: 'discuss', verdict: 'agreed' })
  fireEvent.focus(screen.getByTestId('retro-ai-agree'))

  openPalette()
  expect(screen.queryByText('Agree with this AI proposal')).toBeNull()
  expect(screen.queryByText('Disagree with this AI proposal')).toBeNull()
  expect(screen.queryByText('Clear my reaction')).toBeNull()
})

// The one-keystroke path, from the palette: an AGREED IMPROVEMENT only, and with provenance and no
// owner — the same hard line the mutator and the panel hold.
test('an agreed improvement can be added as an action from the palette, with no owner', () => {
  const retroApi = mount({ phase: 'discuss', verdict: 'agreed' })
  fireEvent.focus(screen.getByTestId('retro-ai-agree'))

  openPalette()
  fireEvent.click(screen.getByText('Add this improvement as an action'))
  expect(retroApi.createAction).toHaveBeenCalledWith(PROPOSAL.body, {
    aiProposalId: PROPOSAL.id,
  })
})

test('a proposal with no verdict offers no action path', () => {
  mount({ phase: 'discuss' })
  fireEvent.focus(screen.getByTestId('retro-ai-agree'))

  openPalette()
  expect(screen.queryByText('Add this improvement as an action')).toBeNull()
})

// A team that never opted in mounts no AI panel, so nothing ever sets the focus — and the palette
// carries no AI entry at all rather than one that would act on nothing.
test('a retro with no AI panel carries no AI entry in the palette', () => {
  mount({ focused: false })

  openPalette()
  expect(screen.queryByText('Agree with this AI proposal')).toBeNull()
  expect(screen.queryByText('Clear my reaction')).toBeNull()
  expect(screen.queryByText('Add this improvement as an action')).toBeNull()
  // …and the palette itself still opens: the AI group is absent, not the dialog.
  expect(screen.getByPlaceholderText('Type a retro command or search…')).toBeInTheDocument()
})
