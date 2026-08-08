// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { IssueRow } from './issue-row'
import { buildRealityShape, RealityTrack, realityTrackLabel } from './reality-track'

const BASE = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 600_000,
} as const

function track(deployedAt: number | null) {
  const strip = { ...BASE, deployedAt }
  return <RealityTrack shape={buildRealityShape(strip)} label={realityTrackLabel(strip)} />
}

test('names the deployment in the track label and gives it its own station', () => {
  const { container } = render(track(1_759_000_000_000))

  // "Deployed" and no environment: the join does not consult one, so the label may not claim one.
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Deployed')
  // The live station is drawn, not merely tinted: a filled node rather than the hollow one.
  const live = container.querySelectorAll('span')
  expect([...live].some((node) => node.className.includes('bg-status-done'))).toBe(true)
})

test('says nothing about deployment when nothing carried the commit', () => {
  render(track(null))
  expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain('Deployed')
})

test('a populated row and an unpopulated one reserve the same track width', () => {
  const widthOf = (node: Element | null) => (node as HTMLElement | null)?.style.width

  const deployed = render(track(1_759_000_000_000))
  const undeployed = render(track(null))
  const unlinked = render(
    <RealityTrack shape={buildRealityShape(null)} label={realityTrackLabel(null)} />,
  )

  const width = widthOf(deployed.container.firstElementChild)
  expect(width).toBeTruthy()
  expect(widthOf(undeployed.container.firstElementChild)).toBe(width)
  expect(widthOf(unlinked.container.firstElementChild)).toBe(width)
})

// A row with no delivery signal still lays the slot out — that is the alignment guarantee, asserted
// above — but it draws nothing in it and announces nothing from it.
test('falls back to a reserved, inkless track when a row has no delivery signal', () => {
  const { container } = render(
    <IssueRow issueKey="ENG-1" title="Unlinked" status="todo" priority="medium" />,
  )
  const slot = container.querySelector('[data-slot="reality-track"]')

  expect(slot?.getAttribute('data-quiet')).toBe('true')
  expect(screen.queryByLabelText('No delivery signal yet')).toBeNull()
})
