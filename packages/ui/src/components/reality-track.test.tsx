// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type {
  CiHealth as SchemaCiHealth,
  DayBandSegment as SchemaDayBandSegment,
  DeliveryStrip as SchemaDeliveryStrip,
  DivergenceKind as SchemaDivergenceKind,
  PrState as SchemaPrState,
} from '@yapm/schema'
import { expect, test } from 'vitest'
import type { DayBandSegment, ScopeBlockKind } from './drawn'
import { IssueRow } from './issue-row'
import {
  buildRealityShape,
  type CiHealth,
  type DeliveryStrip,
  type DivergenceKind,
  type PrState,
  RealityTrack,
  realityTrackLabel,
} from './reality-track'

const MERGED_NOT_LIVE: DeliveryStrip = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 86_400_000,
  deployedAt: null,
}

function breakIndices(divergence: DivergenceKind): number[] {
  const shape = buildRealityShape(MERGED_NOT_LIVE, { divergence })
  return shape.segments.flatMap((segment, index) => (segment === 'broken' ? [index] : []))
}

test('the break lands on a different segment for each divergence kind, from one builder', () => {
  const segments = buildRealityShape(MERGED_NOT_LIVE, {}).segments.length

  expect(breakIndices('status_behind_merge')).toEqual([segments - 1])
  expect(breakIndices('done_but_ci_failing')).toEqual([1])
  expect(breakIndices('status_ahead_of_pr')).toEqual([0])
})

test('an undiverged shape draws no break at all', () => {
  expect(buildRealityShape(MERGED_NOT_LIVE, {}).segments).not.toContain('broken')
  expect(buildRealityShape(null).segments).not.toContain('broken')
})

test('the four facts map to the documented node kinds, and no fifth station is drawn', () => {
  const shape = buildRealityShape({
    pr: 'open',
    ci: 'failing',
    reviewAgeMs: 3_600_000,
    deployedAt: null,
  })
  expect(shape.stations.map((station) => station.id)).toEqual([
    'change',
    'checks',
    'review',
    'live',
  ])
  expect(shape.stations.map((station) => station.node)).toEqual([
    'open',
    'fail',
    'rev-wait',
    'empty',
  ])
  expect(shape.segments).toHaveLength(shape.stations.length - 1)
})

test('a diverged row draws the // break and not one lucide glyph', () => {
  const { container } = render(
    <IssueRow
      issueKey="ENG-144"
      title="Merged a day ago, the board never followed"
      status="in-progress"
      priority="high"
      realityTrack={
        <RealityTrack
          shape={buildRealityShape(MERGED_NOT_LIVE, { divergence: 'status_behind_merge' })}
          label={realityTrackLabel(MERGED_NOT_LIVE, 'PR merged but this issue is not marked done')}
        />
      }
    />,
  )

  expect(container.querySelector('[data-slot="reality-track-break"]')?.textContent).toBe('//')
  expect(container.querySelectorAll('[class*="lucide"]')).toHaveLength(0)
  expect(container.querySelectorAll('svg.lucide-triangle-alert')).toHaveLength(0)
})

test('the empty track and a populated one reserve the same width', () => {
  const width = (node: Element | null) => (node as HTMLElement | null)?.style.width

  const empty = render(<RealityTrack shape={buildRealityShape(null)} label="No delivery signal" />)
  const populated = render(
    <RealityTrack
      shape={buildRealityShape({ ...MERGED_NOT_LIVE, deployedAt: 1_759_000_000_000 })}
      label="Shipped"
    />,
  )

  const reserved = width(empty.container.firstElementChild)
  expect(reserved).toBeTruthy()
  expect(width(populated.container.firstElementChild)).toBe(reserved)
})

test('the label states the facts drawn, the divergence sentence included', () => {
  render(
    <RealityTrack
      shape={buildRealityShape(MERGED_NOT_LIVE, { divergence: 'status_behind_merge' })}
      label={realityTrackLabel(MERGED_NOT_LIVE, 'PR merged but this issue is not marked done')}
    />,
  )
  const label = screen.getByRole('img').getAttribute('aria-label') ?? ''

  expect(label).toContain('PR merged')
  expect(label).toContain('CI passing')
  expect(label).toContain('reviewed 1d ago')
  expect(label).toContain('PR merged but this issue is not marked done')
  // Nothing carried the merge commit, so nothing may claim a deployment.
  expect(label).not.toContain('Deployed')
  // There is no review-requested event, so no drawn label may name a waiting reviewer.
  expect(label).not.toContain('waiting')
})

test('the vertical rail reads its stations rather than summarising them', () => {
  render(
    <RealityTrack
      orientation="vertical"
      label="Delivery for ENG-188"
      shape={{
        stations: [
          { id: 'opened', node: 'done', label: 'Change opened', fact: 'PR #188 → main' },
          { id: 'merged', node: 'done', label: 'Merged, checks green', fact: '8f21c4a on main' },
          { id: 'live', node: 'empty-urgent', label: 'Not live yet' },
        ],
        segments: ['solid', 'broken'],
      }}
    />,
  )

  expect(screen.getAllByRole('listitem')).toHaveLength(3)
  expect(screen.getByText('Merged, checks green')).toBeDefined()
  expect(screen.getByText('8f21c4a on main')).toBeDefined()
  expect(screen.getByText('//')).toBeDefined()
})

// The UI package mirrors the schema seam's unions as plain string unions so these design-system
// primitives stay schema-free. These assignments are the guard: a schema-side addition that is
// not mirrored here stops compiling, rather than silently drawing one fact fewer.
test('the mirrored unions and the schema seam stay assignable both ways', () => {
  const prToSchema: SchemaPrState = 'approved' as PrState
  const prFromSchema: PrState = 'approved' as SchemaPrState
  const ciToSchema: SchemaCiHealth = 'pending' as CiHealth
  const ciFromSchema: CiHealth = 'pending' as SchemaCiHealth
  const kindToSchema: SchemaDivergenceKind = 'status_behind_merge' as DivergenceKind
  const kindFromSchema: DivergenceKind = 'status_behind_merge' as SchemaDivergenceKind
  const stripToSchema: SchemaDeliveryStrip = MERGED_NOT_LIVE
  const stripFromSchema: DeliveryStrip = stripToSchema
  const bandToSchema: SchemaDayBandSegment = 'today' as DayBandSegment
  const bandFromSchema: DayBandSegment = 'today' as SchemaDayBandSegment
  const scope: ScopeBlockKind = 'landed'

  expect([
    prToSchema,
    prFromSchema,
    ciToSchema,
    ciFromSchema,
    kindToSchema,
    kindFromSchema,
    stripFromSchema.pr,
    bandToSchema,
    bandFromSchema,
    scope,
  ]).toBeDefined()
})
