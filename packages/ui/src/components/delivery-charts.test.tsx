// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { AnnotatedTimeline } from './annotated-timeline'
import { DistributionStrip } from './distribution-strip'
import { FlowBand } from './flow-band'
import { ReviewRhythm } from './review-rhythm'

// The four drawn forms of the Delivery page. What is asserted here is what a DRAWING can get wrong
// on its own: the count of marks it puts on the page, whether an absent fact draws a mark anyway,
// and whether the label a screen reader hears names the population and WHAT ONE MARK IS.
//
// The numbers themselves are the page model's, proven in `metrics/page.test.ts`. Nothing here
// re-derives one, and every bound below is read off the fixture handed in rather than written as a
// literal — the lesson from an e2e run in this series that hard-coded a fixture's size.

const TIMELINE_LABEL =
  'Cycle 2, Jul 30 to Aug 12: 3 deployments reached production and 1 retrospective closed; one dot is one deployment; today is day 9 of 14'

function timelineDeploys(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `deploy-${index + 1}`,
    position: (index + 1) / (count + 1),
  }))
}

test('the timeline draws one mark per deployment and names what one mark is', () => {
  const deploys = timelineDeploys(3)
  const { container } = render(
    <AnnotatedTimeline
      startLabel="Jul 30"
      endLabel="Aug 12"
      deploys={deploys}
      retros={[{ id: 'r1', position: 0, title: 'Cycle 1 retro', detail: '0 before · 3 after' }]}
      callout={{
        position: 0.5,
        headline: 'checkout-v2 went out here',
        subline: 'Aug 4 · first of 3 that week',
      }}
      todayPosition={0.6}
      todayLabel="today · day 9 of 14"
      daysLeftLabel="5 days left"
      label={TIMELINE_LABEL}
    />,
  )

  const chart = screen.getByRole('img', { name: TIMELINE_LABEL })
  expect(chart.getAttribute('aria-label')).toContain('one dot is one deployment')
  // Every deployment is a circle; the count is the fixture's own, never a literal.
  expect(container.querySelectorAll('circle')).toHaveLength(deploys.length + 1)
  expect(screen.getByText('checkout-v2 went out here')).toBeInTheDocument()
  expect(screen.getByText('Cycle 1 retro')).toBeInTheDocument()
  expect(screen.getByText('today · day 9 of 14')).toBeInTheDocument()
  expect(screen.getByText('5 days left')).toBeInTheDocument()
})

test('the timeline with nothing to draw still draws the cycle, and invents no mark', () => {
  const { container } = render(
    <AnnotatedTimeline
      startLabel="Aug 13"
      endLabel="Aug 26"
      deploys={[]}
      retros={[]}
      callout={null}
      todayPosition={0.1}
      todayLabel="today · day 2 of 14"
      daysLeftLabel="12 days left"
      label="Cycle 3, Aug 13 to Aug 26: 0 deployments reached production and 0 retrospectives closed; one dot is one deployment; today is day 2 of 14"
    />,
  )

  expect(container.querySelectorAll('circle')).toHaveLength(0)
  expect(container.querySelectorAll('path')).toHaveLength(0)
  expect(screen.getByText('today · day 2 of 14')).toBeInTheDocument()
})

const DISTRIBUTION_LABEL =
  '5 merged changes by hours from open to merged, on a linear axis to 240 hours; one dot is one merged pull request; median 12 hours'

test('the distribution draws exactly one dot per merged change and names the unit of one mark', () => {
  const dots = [4, 8, 12, 40, 220].map((hours, index) => ({
    id: `pr-${index + 1}`,
    position: hours / 240,
    outlier: hours >= 48,
  }))
  const { container } = render(
    <DistributionStrip
      dots={dots}
      ticks={[0, 48, 96, 144, 192, 240]}
      axisMax={240}
      tickSuffix="h"
      medianPosition={12 / 240}
      medianLabel="median 12h"
      notes={[
        { id: 'crowd', kind: 'crowd', position: 12 / 240, text: '3 of 5 merged inside 12h' },
        {
          id: 'outlier',
          kind: 'outlier',
          position: 220 / 240,
          text: '1 change waited 220h or more',
        },
      ]}
      label={DISTRIBUTION_LABEL}
    />,
  )

  const chart = screen.getByRole('img', { name: DISTRIBUTION_LABEL })
  expect(chart.getAttribute('aria-label')).toContain('one dot is one merged pull request')
  expect(container.querySelectorAll('circle')).toHaveLength(dots.length)
  // The outlier is a HOLLOW ring: shape carries the fact, colour reinforces it (WCAG 1.4.1) — and
  // the annotation states it in words as well.
  const hollow = [...container.querySelectorAll('circle')].filter(
    (circle) => circle.getAttribute('fill') === 'var(--bg)',
  )
  expect(hollow).toHaveLength(dots.filter((dot) => dot.outlier).length)
  expect(screen.getByText('median 12h')).toBeInTheDocument()
  expect(screen.getByText('1 change waited 220h or more')).toBeInTheDocument()
})

const FLOW_LABEL =
  'Shipped per cycle across the last 3 completed cycles: Cycle 1 4, Cycle 2 6, Cycle 3 5; one bar is one cycle, a ribbon is work carried into the next cycle, a cap is work added after that cycle started'

test('the flow band draws one bar per cycle, a ribbon only where work carried, and a cap only where work arrived late', () => {
  const bars = [
    { id: 'c1', label: '2 ago', shipped: 4, added: 0, addedLabel: null },
    { id: 'c2', label: '1 ago', shipped: 6, added: 2, addedLabel: '+2 added' },
    { id: 'c3', label: 'last', shipped: 5, added: 0, addedLabel: null },
  ]
  const carries = [{ id: 'k1', fromIndex: 1, toIndex: 2, count: 3, label: '3 carried' }]
  const { container } = render(<FlowBand bars={bars} carries={carries} label={FLOW_LABEL} />)

  const chart = screen.getByRole('img', { name: FLOW_LABEL })
  expect(chart.getAttribute('aria-label')).toContain('one bar is one cycle')
  // One rect per bar, plus one more for each cycle that carries an added cap.
  const capped = bars.filter((bar) => bar.added > 0).length
  expect(container.querySelectorAll('rect')).toHaveLength(bars.length + capped)
  // A zero carry draws no ribbon at all: an empty band would be a claim that nothing is something.
  expect(container.querySelectorAll('path')).toHaveLength(carries.length)
  expect(screen.getByText('3 carried')).toBeInTheDocument()
  expect(screen.getByText('+2 added')).toBeInTheDocument()
  for (const bar of bars) expect(screen.getByText(bar.label)).toBeInTheDocument()
})

test('the flow band with nothing carried and nothing added draws bars and nothing else', () => {
  const bars = [
    { id: 'c1', label: '1 ago', shipped: 4, added: 0, addedLabel: null },
    { id: 'c2', label: 'last', shipped: 6, added: 0, addedLabel: null },
  ]
  const { container } = render(<FlowBand bars={bars} carries={[]} label={FLOW_LABEL} />)

  expect(container.querySelectorAll('rect')).toHaveLength(bars.length)
  expect(container.querySelectorAll('path')).toHaveLength(0)
})

const RHYTHM_LABEL =
  'Review rhythm for 3 of 3 merged changes in the last 6 completed cycles; one row is one merged pull request from open to merge, with a mark for each review that came back'

test('the rhythm draws one row per change and states an over-axis duration in text', () => {
  const rows = [
    {
      id: 'a',
      spanHours: 9,
      firstReviewHours: 3,
      reviewOffsetsHours: [3],
      overAxis: false,
      spanLabel: '9h',
    },
    {
      id: 'b',
      spanHours: 30,
      firstReviewHours: null,
      reviewOffsetsHours: [],
      overAxis: false,
      spanLabel: '30h',
    },
    {
      id: 'c',
      spanHours: 208,
      firstReviewHours: 64,
      reviewOffsetsHours: [64, 150],
      overAxis: true,
      spanLabel: '208h',
    },
  ]
  const { container } = render(<ReviewRhythm rows={rows} axisMaxHours={96} label={RHYTHM_LABEL} />)

  const chart = screen.getByRole('img', { name: RHYTHM_LABEL })
  expect(chart.getAttribute('aria-label')).toContain('one row is one merged pull request')
  // Two segments per row — the wait, then the review stretch — and never a third.
  expect(container.querySelectorAll('line')).toHaveLength(rows.length * 2)
  // One open node per row, a merge node only for the rows that fit the axis, and one mark per
  // review that actually came back.
  const reviews = rows.reduce((sum, row) => sum + row.reviewOffsetsHours.length, 0)
  const merged = rows.filter((row) => !row.overAxis).length
  expect(container.querySelectorAll('circle')).toHaveLength(rows.length + merged + reviews)
  // A change that ran past the axis is not clipped into a shorter one: it says how long it took.
  expect(screen.getByText('208h')).toBeInTheDocument()
  expect(screen.queryByText('9h')).toBeNull()
})

test('the rhythm draws no review mark for a change that never got one', () => {
  const rows = [
    {
      id: 'a',
      spanHours: 30,
      firstReviewHours: null,
      reviewOffsetsHours: [],
      overAxis: false,
      spanLabel: '30h',
    },
  ]
  const { container } = render(<ReviewRhythm rows={rows} axisMaxHours={96} label={RHYTHM_LABEL} />)

  // The open node and the merge node, and nothing standing in for a first look that never happened.
  expect(container.querySelectorAll('circle')).toHaveLength(2)
})

// CLAUDE.md: every colour a token, in every theme. A literal here would be correct in exactly one
// of the six presets, which is the failure mode a review round in this series already paid for.
test('no chart paints a literal colour', () => {
  const { container } = render(
    <div>
      <AnnotatedTimeline
        startLabel="Jul 30"
        endLabel="Aug 12"
        deploys={timelineDeploys(2)}
        retros={[{ id: 'r1', position: 0.2, title: 'Retro', detail: '1 before · 1 after' }]}
        callout={{
          position: 0.4,
          headline: 'A deployment went out here',
          subline: 'Aug 4 · first of 2 that week',
        }}
        todayPosition={0.6}
        todayLabel="today · day 9 of 14"
        daysLeftLabel="5 days left"
        label={TIMELINE_LABEL}
      />
      <DistributionStrip
        dots={[{ id: 'pr-1', position: 0.2, outlier: false }]}
        ticks={[0, 24]}
        axisMax={24}
        tickSuffix="h"
        medianPosition={0.2}
        medianLabel="median 5h"
        notes={[{ id: 'crowd', kind: 'crowd', position: 0.2, text: '1 of 1 merged inside 5h' }]}
        label={DISTRIBUTION_LABEL}
      />
      <FlowBand
        bars={[{ id: 'c1', label: 'last', shipped: 3, added: 1, addedLabel: '+1 added' }]}
        carries={[]}
        label={FLOW_LABEL}
      />
      <ReviewRhythm
        rows={[
          {
            id: 'a',
            spanHours: 9,
            firstReviewHours: 3,
            reviewOffsetsHours: [3],
            overAxis: false,
            spanLabel: '9h',
          },
        ]}
        axisMaxHours={96}
        label={RHYTHM_LABEL}
      />
    </div>,
  )

  for (const attribute of ['fill', 'stroke']) {
    for (const node of container.querySelectorAll(`[${attribute}]`)) {
      const value = node.getAttribute(attribute) ?? ''
      if (value === 'none') continue
      expect(value, `${attribute}="${value}"`).toMatch(/^var\(--[\w-]+\)$/)
    }
  }
})
