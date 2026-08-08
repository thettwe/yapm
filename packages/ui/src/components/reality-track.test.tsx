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
  buildRailShape,
  buildRealityShape,
  type CiHealth,
  type DeliveryStrip,
  type DivergenceKind,
  formatReviewAge,
  isQuietTrack,
  type PrState,
  RealityTrack,
  realityTrackLabel,
} from './reality-track'

const MERGED_NOT_LIVE: DeliveryStrip = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 86_400_000,
  reviewAgeFrom: 'review',
  deployedAt: null,
}

// The change that ended without merging. Every one of the four stations draws `empty` for it — the
// node vocabulary has no closed kind — while the strip knows two facts and the label states both.
const CLOSED_UNREVIEWED: DeliveryStrip = {
  pr: 'closed',
  ci: null,
  reviewAgeMs: 5_000_000,
  reviewAgeFrom: 'pr-open',
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

// THE ALIGNMENT GUARANTEE. A quiet track draws nothing, and drawing nothing is only honest if the
// slot still measures exactly what a populated one does — otherwise the first PR to sync in shunts
// every row on the page. This is the assertion the quiet rule is most able to break, so it gained
// the age-column comparison rather than losing anything.
test('the quiet track and a populated one reserve the same width, age column included', () => {
  const width = (node: Element | null) => (node as HTMLElement | null)?.style.width

  const empty = render(
    <RealityTrack shape={buildRealityShape(null)} age={null} label="No delivery signal" />,
  )
  const populated = render(
    <RealityTrack
      shape={buildRealityShape({ ...MERGED_NOT_LIVE, deployedAt: 1_759_000_000_000 })}
      age="1d"
      label="Shipped"
    />,
  )

  const reserved = width(empty.container.firstElementChild)
  expect(reserved).toBeTruthy()
  expect(width(populated.container.firstElementChild)).toBe(reserved)
  // The column itself is reserved on BOTH, not only where there is an age to draw — that is what
  // stops a review age arriving from shifting a row.
  const ageColumn = (node: Element) => node.querySelector('[data-slot="reality-track-age"]')
  const emptyAge = ageColumn(empty.container)
  const populatedAge = ageColumn(populated.container)
  expect(emptyAge).not.toBeNull()
  expect(populatedAge).not.toBeNull()
  expect((emptyAge as HTMLElement).style.width).toBe((populatedAge as HTMLElement).style.width)
})

// The rule is a property of the SHAPE, so it is asserted over shapes rather than restated at three
// call sites. One fact — even a draft PR, the quietest fact the strip can carry — takes a track out
// of it, and so does a break.
test('a track is quiet only when it carries no fact and no break', () => {
  expect(isQuietTrack(buildRealityShape(null))).toBe(true)

  const draftOnly = buildRealityShape({
    pr: 'draft',
    ci: null,
    reviewAgeMs: null,
    deployedAt: null,
  })
  expect(isQuietTrack(draftOnly)).toBe(false)
  expect(isQuietTrack(buildRealityShape(MERGED_NOT_LIVE))).toBe(false)
  expect(isQuietTrack(buildRealityShape(null, { divergence: 'status_ahead_of_pr' }))).toBe(false)

  // The case the drawn nodes cannot witness: a pull request CLOSED without merging fills no
  // station, and neither does a review age with no open PR beside it — so a rule read off the node
  // kinds would call this row empty and throw both facts away. Quietness is read off the strip.
  expect(isQuietTrack(buildRealityShape(CLOSED_UNREVIEWED))).toBe(false)
})

// `issues.png` draws NOTHING in the slot of a row with no linked change, and on a real list that is
// most of the page. The slot keeps its measure (above) and lays down no ink at all.
test('a quiet track draws no node, no segment, no break and no age text', () => {
  const { container } = render(
    <RealityTrack shape={buildRealityShape(null)} age={null} label={realityTrackLabel(null)} />,
  )
  const slot = container.querySelector('[data-slot="reality-track"]')

  expect(slot?.getAttribute('data-quiet')).toBe('true')
  expect(
    container.querySelectorAll(
      '[class*="bg-status-"], [class*="border-status-"], [class*="border-border-strong"], [class*="repeating-linear-gradient"]',
    ),
  ).toHaveLength(0)
  expect(container.querySelector('[data-slot="reality-track-break"]')).toBeNull()
  expect(container.querySelector('[data-slot="reality-track-age"]')?.textContent).toBe('')
})

// Silent to the eye and silent to a screen reader: announcing "No delivery signal yet" on sixty of
// sixty-nine rows is the audible form of the ornament this removes. The phrase itself is unchanged
// and still available to surfaces that state the absence in words.
test('a quiet track is not exposed as an image and carries no label', () => {
  const { container } = render(
    <RealityTrack shape={buildRealityShape(null)} age={null} label={realityTrackLabel(null)} />,
  )

  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByLabelText('No delivery signal yet')).toBeNull()
  expect(container.querySelector('[data-slot="reality-track"]')?.getAttribute('aria-hidden')).toBe(
    'true',
  )
  expect(realityTrackLabel(null)).toBe('No delivery signal yet')
})

// The same row, rendered: it is the one a quiet rule derived from the drawn nodes would silence,
// so it is asserted end to end rather than only over the predicate. The facts are announced, the
// age is drawn, and the slot is not marked quiet.
test('a closed, unreviewed change keeps its label and draws its age', () => {
  const { container } = render(
    <RealityTrack
      shape={buildRealityShape(CLOSED_UNREVIEWED)}
      age={formatReviewAge(CLOSED_UNREVIEWED.reviewAgeMs ?? 0)}
      label={realityTrackLabel(CLOSED_UNREVIEWED)}
    />,
  )
  const slot = container.querySelector('[data-slot="reality-track"]')

  expect(slot?.hasAttribute('data-quiet')).toBe(false)
  expect(slot?.getAttribute('aria-hidden')).toBeNull()
  const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
  expect(label).toContain('PR closed')
  expect(label).toContain('unreviewed for 1h')
  expect(container.querySelector('[data-slot="reality-track-age"]')?.textContent).toBe('1h')
})

// The hollow ring is scaffolding BETWEEN facts, not a stand-in for their absence: one fact and the
// whole track draws, exactly as `issues.html` draws ENG-115 and ENG-119.
test('a partially populated track still draws its empty stations and dotted segments', () => {
  const { container } = render(
    <RealityTrack
      shape={buildRealityShape({ pr: 'open', ci: null, reviewAgeMs: null, deployedAt: null })}
      age={null}
      label="PR open"
    />,
  )

  expect(container.querySelector('[data-slot="reality-track"]')?.hasAttribute('data-quiet')).toBe(
    false,
  )
  expect(
    container.querySelectorAll('[class*="border-border-strong"]').length,
  ).toBeGreaterThanOrEqual(1)
  expect(
    container.querySelectorAll('[class*="repeating-linear-gradient"]').length,
  ).toBeGreaterThanOrEqual(1)
  expect(screen.getByRole('img')).toBeDefined()
})

// The rail is the ONE exception, and it is deliberate: the issue detail's subject IS the change, so
// a page that draws nothing where the change would be says less than one saying "not linked yet".
test('the vertical rail keeps its explicit unlinked station', () => {
  render(
    <RealityTrack
      orientation="vertical"
      label="Delivery for ENG-9"
      shape={{
        stations: [{ id: 'change', node: 'empty', label: 'No change linked yet' }],
        segments: [],
        factless: false,
      }}
    />,
  )

  expect(screen.getByText('No change linked yet')).toBeDefined()
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
})

test('the row draws the review age, not only announces it', () => {
  const { container } = render(
    <IssueRow
      issueKey="ENG-144"
      title="Merged a day ago, the board never followed"
      status="in-progress"
      priority="high"
      realityTrack={
        <RealityTrack
          shape={buildRealityShape(MERGED_NOT_LIVE)}
          age={formatReviewAge(MERGED_NOT_LIVE.reviewAgeMs ?? 0)}
          label={realityTrackLabel(MERGED_NOT_LIVE)}
        />
      }
    />,
  )

  expect(container.querySelector('[data-slot="reality-track-age"]')?.textContent).toBe('1d')
})

// An unlinked row's track carries the column with nothing in it, so a row that acquires a PR does
// not move. Rendered through `IssueRow` itself, because its own empty fallback is the one that has
// to reserve it.
test('an unlinked row reserves the age column it has nothing to put in', () => {
  const { container } = render(
    <IssueRow issueKey="ENG-9" title="No PR anywhere" status="todo" priority="no-priority" />,
  )
  const column = container.querySelector('[data-slot="reality-track-age"]')

  expect(column).not.toBeNull()
  expect(column?.textContent).toBe('')
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

// The same number, two different facts. A PR nobody has reviewed has an age measured from the
// moment it opened, and announcing that as "reviewed 3d ago" invents a review that never happened.
test('the label distinguishes a reviewed change from one nobody has looked at', () => {
  const reviewed = realityTrackLabel({
    pr: 'open',
    ci: 'passing',
    reviewAgeMs: 259_200_000,
    reviewAgeFrom: 'review',
    deployedAt: null,
  })
  const neverReviewed = realityTrackLabel({
    pr: 'open',
    ci: 'passing',
    reviewAgeMs: 259_200_000,
    reviewAgeFrom: 'pr-open',
    deployedAt: null,
  })
  // A strip built without the source states the age and claims nothing about who read it.
  const unattributed = realityTrackLabel({
    pr: 'open',
    ci: 'passing',
    reviewAgeMs: 259_200_000,
    deployedAt: null,
  })

  expect(reviewed).toContain('reviewed 3d ago')
  expect(neverReviewed).toContain('unreviewed for 3d')
  expect(neverReviewed).not.toContain('reviewed 3d ago')
  expect(unattributed).toContain('review age 3d')
  for (const label of [reviewed, neverReviewed, unattributed]) {
    expect(label).not.toContain('waiting')
    expect(label).not.toContain('awaiting')
  }
})

// The rail's shape comes from the SAME grammar the track's does — a surface names its stations and
// this decides their connectors and where the `//` falls. A surface deriving that for itself would
// be a second vocabulary with the first one's name on it.
test('a rail of any length breaks in the same grammar the four-station track does', () => {
  const stations = [
    { id: 'idea', node: 'done' as const },
    { id: 'opened', node: 'done' as const },
    { id: 'reviewed', node: 'done' as const },
    { id: 'merged', node: 'done' as const },
    { id: 'live', node: 'empty' as const },
  ]

  const behind = buildRailShape(stations, { divergence: 'status_behind_merge' })
  expect(behind.segments).toHaveLength(stations.length - 1)
  expect(behind.segments.at(-1)).toBe('broken')
  // The station reality has not reached wears the urgent ring, so the break reads as a stop.
  expect(behind.stations.at(-1)?.node).toBe('empty-urgent')
  // Labels and facts pass through untouched — the shape decides drawing, never words.
  expect(
    buildRailShape([{ id: 'idea', node: 'done', label: 'Idea', fact: 'created 9d ago' }]),
  ).toEqual({
    stations: [{ id: 'idea', node: 'done', label: 'Idea', fact: 'created 9d ago' }],
    segments: [],
    // A rail names its own stations, so it hands over no strip to be fact-free about, and it is
    // excluded from the quiet rule regardless.
    factless: false,
  })

  const ahead = buildRailShape(stations, { divergence: 'status_ahead_of_pr' })
  expect(ahead.segments[0]).toBe('broken')
  expect(buildRailShape(stations).segments).not.toContain('broken')
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
        factless: false,
      }}
    />,
  )

  expect(screen.getAllByRole('listitem')).toHaveLength(3)
  expect(screen.getByText('Merged, checks green')).toBeDefined()
  expect(screen.getByText('8f21c4a on main')).toBeDefined()
  expect(screen.getByText('//')).toBeDefined()
})

// The UI package mirrors the schema seam's UNIONS as plain string unions so a caller can name a
// node's state without importing the seam; the strip itself is the seam's own type, imported, not
// re-declared. These assignments are the guard: a schema-side addition that is not mirrored here
// stops compiling, rather than silently drawing one fact fewer.
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
