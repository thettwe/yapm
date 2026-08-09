// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { RetroCard, RetroVotePips } from './retro-card'

// The quiet-slot rule, pinned in the primitive. `reality-vocabulary` §"a slot with no fact draws no
// ink" is a shipped requirement, and the board is not the only caller that could forget it.

test('a zero tally draws no vote node at all', () => {
  render(<RetroVotePips count={0} mine={0} />)
  expect(screen.queryByTestId('retro-vote-pips')).toBeNull()
})

test('a tally above zero states its count as text beside the pips', () => {
  render(<RetroVotePips count={3} mine={1} />)
  const pips = screen.getByTestId('retro-vote-pips')
  expect(pips.textContent).toBe('3')
})

test('a vote target keeps its reserved measure while the tally is zero', () => {
  render(
    <RetroCard
      accent="positive"
      body="Nothing to babysit"
      votes={<RetroVotePips count={0} mine={0} />}
    />,
  )
  const slot = document.querySelector('[data-slot="retro-vote-slot"]')
  expect(slot).not.toBeNull()
  expect(slot?.textContent).toBe('')
})

test('a card that is not a vote target draws no slot', () => {
  render(<RetroCard accent="positive" body="Inside a cluster" />)
  expect(document.querySelector('[data-slot="retro-vote-slot"]')).toBeNull()
})
