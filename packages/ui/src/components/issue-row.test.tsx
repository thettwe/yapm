// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { IssueRow, RealityStrip, RealityStripPlaceholder } from './issue-row'

const BASE = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 600_000,
} as const

test('names the deployment in the strip label and carries its own glyph', () => {
  const { container } = render(<RealityStrip {...BASE} deployedAt={1_759_000_000_000} />)
  const strip = screen.getByRole('img')

  expect(strip.getAttribute('aria-label')).toContain('Deployed to production')
  // Glyph, not hue alone: one more icon than the same strip without a deployment.
  const deployed = container.querySelectorAll('svg').length

  const { container: undeployedContainer } = render(<RealityStrip {...BASE} deployedAt={null} />)
  expect(undeployedContainer.querySelectorAll('svg').length).toBe(deployed - 1)
})

test('says nothing about deployment when nothing carried the commit', () => {
  render(<RealityStrip {...BASE} deployedAt={null} />)
  expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain('Deployed')
})

test('a populated strip, an unpopulated one and the placeholder reserve the same width', () => {
  const widthOf = (node: Element | null) =>
    [...(node?.classList ?? [])].find((name) => name.startsWith('w-'))

  const deployed = render(<RealityStrip {...BASE} deployedAt={1_759_000_000_000} />)
  const undeployed = render(<RealityStrip {...BASE} deployedAt={null} />)
  const placeholder = render(<RealityStripPlaceholder />)

  const width = widthOf(deployed.container.firstElementChild)
  expect(width).toBeDefined()
  expect(widthOf(undeployed.container.firstElementChild)).toBe(width)
  expect(widthOf(placeholder.container.firstElementChild)).toBe(width)
})

test('falls back to the placeholder when a row has no delivery signal', () => {
  render(<IssueRow issueKey="ENG-1" title="Unlinked" status="todo" priority="medium" />)
  expect(screen.getByLabelText('No delivery signal yet')).toBeDefined()
})
