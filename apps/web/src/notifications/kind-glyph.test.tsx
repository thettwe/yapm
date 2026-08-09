import { render } from '@testing-library/react'
import { NOTIFICATION_KINDS } from '@yapm/schema'
import { expect, test } from 'vitest'
import { KindGlyph, SettledLoop } from './kind-glyph'

// Every other assertion about the kind reads the row's `sr-only` word, so a `MARK` map that
// resolved two kinds — or all four — to the same drawing would pass the whole suite while the
// sighted reader lost the only channel that tells the rows apart at a glance.
test('each kind draws a distinct mark', () => {
  const marks = NOTIFICATION_KINDS.map((kind) => {
    const { container, unmount } = render(<KindGlyph kind={kind} className="size-3.5" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const html = (svg as SVGSVGElement).innerHTML
    unmount()
    return html
  })

  expect(new Set(marks).size).toBe(NOTIFICATION_KINDS.length)
  expect(marks.every((mark) => mark.length > 0)).toBe(true)
})

// A drawing is not a name: the kind reaches assistive technology as the word `KIND_LABEL` holds,
// on the row itself, and never through the glyph.
test('every drawing is hidden from assistive technology', () => {
  for (const kind of NOTIFICATION_KINDS) {
    const { container, unmount } = render(<KindGlyph kind={kind} />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    unmount()
  }

  const { container } = render(<SettledLoop />)
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
})
