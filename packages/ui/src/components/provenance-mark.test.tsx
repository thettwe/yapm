// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ProvenanceMark } from './provenance-mark'

test('the mark names its source, monochrome and no larger than the text it follows', () => {
  render(
    <span>
      14/14 checks passed
      <ProvenanceMark provider="github" />
    </span>,
  )

  const mark = screen.getByRole('img', { name: 'GitHub' })
  expect(mark).toHaveAttribute('width', '12')
  expect(mark).toHaveAttribute('height', '12')
  // `currentColor` everywhere: a brand mark is never one of our own coloured glyphs.
  expect(mark.innerHTML).toContain('currentColor')
  expect(mark.getAttribute('fill')).toBeNull()
})

test('a mark beside text that already names the source is decorative, not a second announcement', () => {
  render(
    <span>
      Merged on GitHub
      <ProvenanceMark provider="github" label={null} />
    </span>,
  )

  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(document.querySelector('[data-slot="provenance-mark"] svg')).toHaveAttribute(
    'aria-hidden',
    'true',
  )
})

test('Figma marks link-kind artifacts at the same measures', () => {
  render(<ProvenanceMark provider="figma" size={14} />)

  const mark = screen.getByRole('img', { name: 'Figma' })
  expect(mark).toHaveAttribute('width', '14')
  expect(document.querySelector('[data-slot="provenance-mark"]')).toHaveAttribute(
    'data-provider',
    'figma',
  )
})
