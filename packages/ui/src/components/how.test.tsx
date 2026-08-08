// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { How } from './how'

function Metric() {
  return (
    <How label="open to merged" constraint="linear scale · giants included · team-level only">
      Median of the last 26 merged changes, opened → merged, drawn where it falls — not quoted from
      a summary.
    </How>
  )
}

test('the derivation is folded at rest — only the quiet mono `how ·` is drawn', () => {
  render(<Metric />)

  expect(screen.getByRole('button', { name: /how open to merged is derived/i })).toHaveTextContent(
    'how ·',
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText(/median of the last 26/i)).not.toBeInTheDocument()
})

test('activating the trigger unfolds the derivation, named by its kicker', () => {
  render(<Metric />)
  const trigger = screen.getByRole('button')

  fireEvent.click(trigger)

  const panel = screen.getByRole('dialog', { name: /how · open to merged/i })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(panel).toHaveTextContent(/median of the last 26 merged changes/i)
  expect(panel).toHaveTextContent('linear scale · giants included · team-level only')
  // `aria-controls` alone is followed by almost no screen reader, so the derivation is also the
  // trigger's description — the same pairing the peek uses, for the same reason.
  expect(trigger).toHaveAttribute('aria-controls', panel.id)
  expect(trigger).toHaveAttribute('aria-describedby', panel.id)
})

test('the trigger is a real button, so Enter and Space open it natively', () => {
  render(<Metric />)
  const trigger = screen.getByRole('button')

  expect(trigger.tagName).toBe('BUTTON')
  expect(trigger).toHaveAttribute('type', 'button')
})

test('escape folds it again and hands focus back to the trigger', () => {
  render(<Metric />)
  const trigger = screen.getByRole('button')
  trigger.focus()
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog')).toBeInTheDocument()

  fireEvent.keyDown(trigger, { key: 'Escape' })

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(document.activeElement).toBe(trigger)
})

test('tabbing away folds it — the surface returns to quiet on its own', () => {
  render(
    <>
      <Metric />
      <button type="button">elsewhere</button>
    </>,
  )
  const trigger = screen.getByRole('button', { name: /how open to merged is derived/i })
  const elsewhere = screen.getByRole('button', { name: 'elsewhere' })

  fireEvent.click(trigger)
  expect(screen.getByRole('dialog')).toBeInTheDocument()

  fireEvent.blur(trigger, { relatedTarget: elsewhere })

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
