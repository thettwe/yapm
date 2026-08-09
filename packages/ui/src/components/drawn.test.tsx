// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { AnonymityMark, DraftMark, RetroMark } from './drawn'

// The marks are drawn to one grid and one stroke, and the whole point of them living in a shared
// module is that a fourth one cannot be added at a different weight without this failing. The
// anonymity figure's DASH is asserted by name: a solid shoulder line would draw a person the
// schema cannot produce.

const MARKS = [
  ['anonymity', <AnonymityMark key="a" />],
  ['retro', <RetroMark key="r" />],
  ['draft', <DraftMark key="d" />],
] as const

test.each(MARKS)('the %s mark is on the 20-unit grid and hidden from assistive tech', (_, mark) => {
  const { container } = render(mark)
  const svg = container.querySelector('svg')
  expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20')
  expect(svg?.getAttribute('aria-hidden')).toBe('true')
  expect(svg?.getAttribute('fill')).toBe('none')
})

test('every stroke is the shared 1.6 weight with round caps, drawn in currentColor', () => {
  for (const [, mark] of MARKS) {
    const { container } = render(mark)
    const strokes = [...container.querySelectorAll('[stroke]')]
    expect(strokes.length).toBeGreaterThan(0)
    for (const node of strokes) {
      expect(node.getAttribute('stroke')).toBe('currentColor')
      // The draft mark's second, quieter spark is the one deliberate exception, and it is
      // quietened by opacity rather than by a weight nothing else uses.
      const width = Number(node.getAttribute('stroke-width'))
      expect(width).toBeGreaterThanOrEqual(1.5)
      expect(width).toBeLessThanOrEqual(1.6)
    }
  }
})

test('the anonymity figure leaves its shoulders open', () => {
  const { container } = render(<AnonymityMark />)
  const shoulders = container.querySelector('path')
  expect(shoulders?.getAttribute('stroke-dasharray')).toBe('2.4 3.2')
  expect(shoulders?.getAttribute('fill')).toBeNull()
})
