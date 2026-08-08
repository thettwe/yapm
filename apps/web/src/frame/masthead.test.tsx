import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Masthead } from './masthead'

afterEach(cleanup)

test('the kicker is the row above the title', () => {
  render(<Masthead kicker={<span>ENG-116</span>} title="Saved cards behind a flag" />)

  const kicker = screen.getByTestId('masthead-kicker')
  expect(kicker).toHaveTextContent('ENG-116')

  const heading = screen.getByRole('heading', { name: 'Saved cards behind a flag' })
  // `DOCUMENT_POSITION_FOLLOWING` — the title comes after the kicker in the document, which is what
  // "above" means to a screen reader as well as to a sighted reader.
  expect(kicker.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('a caller that passes no kicker gets no extra row', () => {
  render(<Masthead title="Issues" count={12} />)

  expect(screen.queryByTestId('masthead-kicker')).toBeNull()
  expect(screen.getByTestId('masthead-count')).toHaveTextContent('12')
})
