// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { restPhrase } from '@yapm/schema'
import { expect, test } from 'vitest'
import { RestPhraseText } from './rest-phrase'

test('an urgent phrase carries its urgency in the text, never in the brand mark', () => {
  render(<RestPhraseText phrase={restPhrase('checks_failing', 'neutral')} />)

  const phrase = document.querySelector('[data-slot="rest-phrase"]')
  expect(phrase).toHaveTextContent('Checks failing')
  expect(phrase?.className).toContain('text-status-urgent-ink')

  // The mark keeps its own neutral ink. Inheriting the urgent state ink would recolour a brand
  // glyph with a colour that carries meaning in our vocabulary — the one thing a provenance mark
  // may never do.
  const mark = document.querySelector('[data-slot="provenance-mark"][data-provider="github"]')
  expect(mark?.className).toContain('text-text-2')
  expect(mark?.className).not.toContain('text-current')
})

test('the mark names its source, because no phrase in either register names it', () => {
  render(<RestPhraseText phrase={restPhrase('merged_not_deployed', 'neutral')} />)

  expect(screen.getByRole('img', { name: 'GitHub' })).toBeInTheDocument()
})

test('a derived phrase carries no mark, and a silent entry renders nothing at all', () => {
  const { unmount } = render(
    <RestPhraseText phrase={restPhrase('diverged_behind_merge', 'neutral')} />,
  )
  expect(document.querySelector('[data-slot="provenance-mark"]')).toBeNull()
  unmount()

  render(<RestPhraseText phrase={restPhrase('in_progress', 'neutral')} />)
  expect(document.querySelector('[data-slot="rest-phrase"]')).toBeNull()
})
