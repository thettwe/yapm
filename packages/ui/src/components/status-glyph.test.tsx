// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { STATUS, StatusGlyph, type StatusKind } from './status-glyph'

const KINDS = Object.keys(STATUS) as StatusKind[]

// The correction PR #32 undid: status is cycle position AND `done` is the product's own mark for
// finished. A plain disc is one of five ring states; a disc with a check says the work is over.
test('done draws a filled disc carrying a check', () => {
  const { container } = render(<StatusGlyph status="done" />)
  const svg = container.querySelector('svg')

  expect(svg?.querySelector('circle[fill="currentColor"]')).not.toBeNull()
  const check = svg?.querySelector('path')
  expect(check).not.toBeNull()
  expect(check?.getAttribute('stroke-linecap')).toBe('round')
})

// The check has to stay in the same family as the arcs beside it: one stroke weight, round caps,
// endpoints on the 20-unit grid, and — the constraint a geometry test exists to hold — an ink that
// is a THEME TOKEN, never a literal colour, so it is correct in six presets rather than one.
test('the check keeps the shared geometry and takes its ink from a token', () => {
  const { container } = render(<StatusGlyph status="done" />)
  const svg = container.querySelector('svg') as SVGSVGElement
  const check = svg.querySelector('path') as SVGPathElement
  const arc = render(<StatusGlyph status="in-progress" />).container.querySelector(
    'path',
  ) as SVGPathElement

  expect(svg.getAttribute('viewBox')).toBe('0 0 20 20')
  expect(check.getAttribute('stroke-width')).toBe(arc.getAttribute('stroke-width'))
  expect(check.getAttribute('stroke')).toMatch(/^var\(--[\w-]+\)$/)
  // Every vertex sits inside the disc it is knocked out of, which is what keeps it a check rather
  // than a cross bleeding over the edge at the 14px a dense row draws.
  const points = (check.getAttribute('d') ?? '').match(/[\d.]+/g)?.map(Number) ?? []
  expect(points.length).toBe(6)
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i] as number
    const y = points[i + 1] as number
    expect(Math.hypot(x - 10, y - 10)).toBeLessThan(7.6)
  }
})

// The dense row renders the glyph at its default `size-3.5`, and the check may not degrade to a
// plain disc there — a surface that needs another size scales this one component.
test('done still draws its check at the size a dense row renders', () => {
  const { container } = render(<StatusGlyph status="done" />)
  const svg = container.querySelector('svg') as SVGSVGElement

  expect(svg.getAttribute('class')).toContain('size-3.5')
  expect(svg.querySelectorAll('path')).toHaveLength(1)
})

test('the other five statuses are unchanged: no disc, and only their own drawing', () => {
  for (const status of KINDS.filter((kind) => kind !== 'done')) {
    const { container } = render(<StatusGlyph status={status} />)
    expect(container.querySelectorAll('circle[fill="currentColor"]'), status).toHaveLength(0)
  }
})

test('every status glyph carries an accessible label naming its state', () => {
  for (const status of KINDS) {
    render(<StatusGlyph status={status} />)
    expect(screen.getAllByLabelText(STATUS[status].label).length, status).toBeGreaterThan(0)
  }
})
