// @vitest-environment jsdom

// A test cannot prove the visual composition. It can prove that no two notes sharing a baseline
// are closer than the stated gap, and that the box holds every row it used — but whether the
// result READS as two sentences is a thing only a render shows. The render is the real check; this
// file exists so the arithmetic behind it stops being a property of one fixture.

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import {
  type DistributionNote,
  DistributionStrip,
  layoutDistributionNotes,
} from './distribution-strip'

const LABEL =
  '57 merged changes over the last 4 weeks, open to merged in hours; one mark is one merged pull request'

// Mirrors `NOTE_GAP` in the drawing. Stated here so the invariant is asserted against a number the
// test names rather than one it imports from the code under test.
const GAP = 18

function assertRowsClear(notes: readonly DistributionNote[]) {
  const layout = layoutDistributionNotes({ notes })
  expect(layout).toHaveLength(notes.length)
  for (const a of layout) {
    for (const b of layout) {
      if (a.id === b.id || a.row !== b.row) continue
      const clear = a.to + GAP <= b.from || b.to + GAP <= a.from
      expect(clear, `${a.id} and ${b.id} share row ${a.row} without ${GAP}px between them`).toBe(
        true,
      )
    }
  }
  return layout
}

// The shape that shipped: 57 pull requests, a median of 26h and giants out at 110h on a 240h axis.
const REPORTED: readonly DistributionNote[] = [
  { id: 'crowd', kind: 'crowd', position: 26 / 240, text: '29 of 57 merged inside 26h' },
  { id: 'outliers', kind: 'outlier', position: 110 / 240, text: '8 changes waited 110h or more' },
]

test('the reported shape puts the two notes on separate baselines', () => {
  const layout = assertRowsClear(REPORTED)

  expect(new Set(layout.map((entry) => entry.row)).size).toBe(2)
})

test('a population with no outliers draws one note on the drawing’s own baseline', () => {
  const layout = assertRowsClear([
    { id: 'crowd', kind: 'crowd', position: 0.3, text: '15 of 15 merged inside 14h' },
  ])

  expect(layout).toHaveLength(1)
  expect(layout[0]?.row).toBe(0)
})

test('a single merged change still places its one note', () => {
  const layout = assertRowsClear([
    { id: 'crowd', kind: 'crowd', position: 1, text: '1 of 1 merged inside 5h' },
  ])

  expect(layout[0]?.row).toBe(0)
  expect(layout[0]?.textAnchor).toBe('start')
})

test('a note that would read off the left edge turns around, and still clears the crowd', () => {
  const layout = assertRowsClear([
    { id: 'crowd', kind: 'crowd', position: 2 / 96, text: '3 of 5 merged inside 2h' },
    { id: 'outliers', kind: 'outlier', position: 9 / 96, text: '2 changes waited 9h or more' },
  ])

  const outlier = layout.find((entry) => entry.id === 'outliers')
  expect(outlier?.textAnchor).toBe('start')
  expect(outlier?.from).toBeGreaterThanOrEqual(0)
})

test('the invariant holds across a matrix of medians, outlier thresholds and axis maxima', () => {
  const axisMaxima = [12, 24, 48, 96, 240, 1000]
  const fractions = [0, 0.01, 0.05, 0.2, 0.5, 0.8, 0.97, 1]

  for (const axisMax of axisMaxima) {
    for (const medianFraction of fractions) {
      for (const outlierFraction of fractions) {
        const median = Math.round(axisMax * medianFraction)
        const slowest = Math.round(axisMax * outlierFraction)
        assertRowsClear([
          {
            id: 'crowd',
            kind: 'crowd',
            position: medianFraction,
            text: `29 of 57 merged inside ${median}h`,
          },
          {
            id: 'outliers',
            kind: 'outlier',
            position: outlierFraction,
            text: `8 changes waited ${slowest}h or more`,
          },
        ])
      }
    }
  }
})

test('more than two notes each take the lowest baseline that clears the ones already there', () => {
  const layout = assertRowsClear([
    { id: 'crowd', kind: 'crowd', position: 0.4, text: '29 of 57 merged inside 26h' },
    { id: 'a', kind: 'outlier', position: 0.42, text: '8 changes waited 110h or more' },
    { id: 'b', kind: 'outlier', position: 0.44, text: '2 changes waited 200h or more' },
  ])

  expect(new Set(layout.map((entry) => entry.row)).size).toBe(3)
})

test('the drawing grows its box for every baseline the layout used', () => {
  render(
    <DistributionStrip
      dots={[
        { id: 'pr-1', position: 26 / 240, outlier: false },
        { id: 'pr-2', position: 110 / 240, outlier: true },
      ]}
      ticks={[0, 120, 240]}
      axisMax={240}
      tickSuffix="h"
      medianPosition={26 / 240}
      medianLabel="median 26h"
      notes={REPORTED}
      label={LABEL}
    />,
  )

  const [minY, , height] = (screen.getByRole('img', { name: LABEL }).getAttribute('viewBox') ?? '')
    .split(/\s+/)
    .map(Number)
    .filter((_, index) => index !== 0)
  const top = minY ?? 0
  const bottom = top + (height ?? 0)

  for (const text of [REPORTED[0]?.text, REPORTED[1]?.text]) {
    const node = screen.getByText(text ?? '')
    // The baseline, less the ascent of 11px text, has to sit inside the drawn box.
    expect(Number(node.getAttribute('y')) - 9).toBeGreaterThanOrEqual(top)
    expect(Number(node.getAttribute('y'))).toBeLessThanOrEqual(bottom)
  }
  expect(screen.getByText(REPORTED[0]?.text ?? '').getAttribute('y')).not.toBe(
    screen.getByText(REPORTED[1]?.text ?? '').getAttribute('y'),
  )
})
