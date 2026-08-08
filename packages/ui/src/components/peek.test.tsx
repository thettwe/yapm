// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PeekFact, PeekPanel, PeekProvider, PeekTitle, usePeek } from './peek'

function PeekLink({ id, name }: { id: string; name: string }) {
  const { open, triggerProps, peekProps } = usePeek<HTMLAnchorElement>(id, {
    label: `${name} — preview`,
  })
  return (
    <span className="relative inline-flex">
      <a href={`/issues/${id}`} {...triggerProps}>
        {name}
      </a>
      {open ? (
        <PeekPanel {...peekProps}>
          <PeekTitle>{name}</PeekTitle>
          <PeekFact phrase="Built — not live yet" detail="merged 8f21c4a · 14/14 checks" />
        </PeekPanel>
      ) : null}
    </span>
  )
}

function Page() {
  return (
    <PeekProvider>
      <PeekLink id="ENG-116" name="ENG-116" />
      <PeekLink id="ENG-188" name="ENG-188" />
    </PeekProvider>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

test('a second peek opening closes the first — the state cannot hold two', () => {
  render(<Page />)

  fireEvent.pointerOver(screen.getByRole('link', { name: 'ENG-116' }))
  expect(screen.getByRole('dialog', { name: 'ENG-116 — preview' })).toBeInTheDocument()

  fireEvent.pointerOver(screen.getByRole('link', { name: 'ENG-188' }))
  expect(screen.getByRole('dialog', { name: 'ENG-188 — preview' })).toBeInTheDocument()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
})

test('keyboard focus opens the peek, and the trigger says so', () => {
  render(<Page />)
  const trigger = screen.getByRole('link', { name: 'ENG-116' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')

  fireEvent.focus(trigger)

  const panel = screen.getByRole('dialog', { name: 'ENG-116 — preview' })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(trigger).toHaveAttribute('aria-describedby', panel.id)
  // A transient, not a trap: the page keeps its focus order.
  expect(panel).toHaveAttribute('aria-modal', 'false')
})

test('escape closes the peek, stays on the page, and hands focus back to the trigger', () => {
  render(<Page />)
  const trigger = screen.getByRole('link', { name: 'ENG-116' })
  trigger.focus()
  fireEvent.focus(trigger)
  expect(screen.getByRole('dialog')).toBeInTheDocument()

  fireEvent.keyDown(trigger, { key: 'Escape' })

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.activeElement).toBe(trigger)
})

test('the pointer crosses the gap from trigger into panel without the peek closing', () => {
  vi.useFakeTimers()
  render(<Page />)
  const trigger = screen.getByRole('link', { name: 'ENG-116' })

  fireEvent.pointerOver(trigger)
  const panel = screen.getByRole('dialog')

  fireEvent.pointerOut(trigger, { relatedTarget: panel })
  fireEvent.pointerOver(panel, { relatedTarget: trigger })
  act(() => {
    vi.advanceTimersByTime(1_000)
  })

  expect(screen.getByRole('dialog')).toBeInTheDocument()

  fireEvent.pointerOut(panel, { relatedTarget: document.body })
  act(() => {
    vi.advanceTimersByTime(1_000)
  })

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

// The minimal peek anybody could build: a trigger, a panel, and nothing spread onto it beyond
// `peekProps`. Its dialog still resolves BY NAME, because the name is required by `usePeek`'s
// options rather than left to the panel — an unnamed peek is not a peek somebody can ship.
function BarePeek() {
  const { open, triggerProps, peekProps } = usePeek<HTMLButtonElement>('bare', {
    label: 'Delivery for ENG-204',
  })
  return (
    <span className="relative inline-flex">
      <button type="button" {...triggerProps}>
        ENG-204
      </button>
      {open ? <PeekPanel {...peekProps}>Built — not live yet</PeekPanel> : null}
    </span>
  )
}

test('a minimally-constructed peek still has an accessible name', () => {
  render(
    <PeekProvider>
      <BarePeek />
    </PeekProvider>,
  )

  fireEvent.focus(screen.getByRole('button', { name: 'ENG-204' }))

  expect(screen.getByRole('dialog', { name: 'Delivery for ENG-204' })).toBeInTheDocument()
})

test('usePeek refuses to work outside a provider, so the one-open rule cannot be bypassed', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(() => render(<PeekLink id="ENG-116" name="ENG-116" />)).toThrow(/PeekProvider/)
  quiet.mockRestore()
})
