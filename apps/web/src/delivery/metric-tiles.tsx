import type { DeliveryMetric, DeliverySection } from '@yapm/schema'
import type { ReactNode } from 'react'
import { formatSeedDelta, formatSeedValue, seedTrendTone, sparklineGeometry } from './metric-format'

// One tile = one signal. ITS ONE REMAINING CONSUMER is the retrospective's data panel
// (`retro/retro-seed-panel.tsx`) — the Delivery page's journalism cut draws a different object
// (`delivery/stat-tile.tsx`, design §D8): a 28px number with a unit, a delta pill, a drawn mini and
// a `how ·`, with no card, no border and no caption sentence. Generalising this component with a
// variant would have put the retro's markup one careless default away from moving.
//
// It stays HERE rather than moving beside its consumer because what it renders is the
// `DeliveryMetric` model that lives in `metrics/`, and `metric-format.ts` beside it is shared by
// both tiles.
//
// There is no per-person anything to render here: `DeliveryMetric` has no identity dimension at any
// depth, so the guarantee is a property of the model rather than of this file's restraint.
//
// The `data-testid` values arrive as props because the retro's are load-bearing in shipped e2e
// specs; the component owns the markup, the caller owns the selector.

const SPARK_WIDTH = 64
const SPARK_HEIGHT = 18

export interface MetricTestIds {
  readonly testId: string
  readonly sparklineTestId: string
  readonly noTrendTestId: string
}

export interface MetricTileProps extends MetricTestIds {
  readonly metric: DeliveryMetric
  // What the delta is measured against, in words. The retro compares against the cycle before, the
  // team view against the window before.
  readonly deltaBasis?: string
  // The retro's "Add a card from this" affordance. Absent here means absent from the DOM: the team
  // view's tiles are non-interactive.
  readonly action?: (metric: DeliveryMetric) => ReactNode
}

export function MetricTile({
  metric,
  testId,
  sparklineTestId,
  noTrendTestId,
  deltaBasis,
  action,
}: MetricTileProps) {
  const delta = formatSeedDelta(metric, deltaBasis)
  const tone = seedTrendTone(metric)

  return (
    <article
      // `tabIndex={-1}` keeps the tile out of the tab order (its button carries that) while making
      // it a programmatic focus target, so a card's evidence chip can bring the reader back to the
      // number it came from.
      tabIndex={-1}
      aria-label={`${metric.label}: ${formatSeedValue(metric)}`}
      data-testid={testId}
      data-metric={metric.key}
      className="flex w-56 flex-col gap-1 rounded-card border border-border bg-bg-elevated px-3 py-2.5 outline-none transition-colors focus-within:border-accent focus-within:bg-accent-soft/40 focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-medium text-text-2">{metric.label}</p>
          <p className="font-mono text-lg leading-tight tabular-nums text-text-1">
            {formatSeedValue(metric)}
          </p>
        </div>
        <Sparkline metric={metric} testId={sparklineTestId} noTrendTestId={noTrendTestId} />
      </div>
      {delta === null ? null : (
        <p className="text-[11.5px] text-text-2">
          <span aria-hidden="true">{tone === null ? '·' : TONE_GLYPH[tone]} </span>
          {delta}
        </p>
      )}
      <p className="text-[11.5px] leading-relaxed text-text-2">{metric.caption}</p>
      {action?.(metric) ?? null}
    </article>
  )
}

// Direction is stated in words by the delta line; the glyph is reinforcement, never the carrier.
const TONE_GLYPH: Record<'better' | 'worse' | 'neutral', string> = {
  better: '↗',
  worse: '↘',
  neutral: '→',
}

function Sparkline({
  metric,
  testId,
  noTrendTestId,
}: {
  metric: DeliveryMetric
  testId: string
  noTrendTestId: string
}) {
  const geometry = sparklineGeometry(metric.trend, SPARK_WIDTH, SPARK_HEIGHT)
  // The count is the series' own length, gaps included, so the label never claims a cycle count the
  // window does not have.
  const description = `Trend across ${metric.trend.length} cycles: ${metric.trend
    .map((entry) => (entry === undefined ? 'no data' : entry))
    .join(', ')}`

  if (geometry === null) {
    return (
      <span className="shrink-0 text-[11px] text-text-3" data-testid={noTrendTestId}>
        no history
      </span>
    )
  }

  return (
    <span className="shrink-0" data-testid={testId}>
      <svg
        role="img"
        aria-label={description}
        width={SPARK_WIDTH}
        height={SPARK_HEIGHT}
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        className="overflow-visible text-text-3"
      >
        {geometry.segments.map((points) => (
          <polyline
            key={points}
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <circle cx={geometry.last.x} cy={geometry.last.y} r={2} className="fill-accent" />
      </svg>
    </span>
  )
}

export interface MetricSectionProps extends MetricTestIds {
  readonly section: DeliverySection
  readonly sectionTestId: string
  readonly emptyTestId: string
  readonly deltaBasis?: string
  // Where the section sits in the HOST page's outline, which the component cannot know. The retro
  // nests these under its panel's own `<h2>`; the Delivery page puts them directly under its `<h1>`,
  // and an `<h3>` there would skip a level. Default 3 so the retro's DOM is untouched.
  readonly headingLevel?: 2 | 3
  readonly action?: (metric: DeliveryMetric) => ReactNode
}

// Never zeros, never a hollow chart: a section with nothing behind it renders the one quiet state
// the model already carries, naming what would light it up.
export function MetricSection({
  section,
  sectionTestId,
  emptyTestId,
  deltaBasis,
  headingLevel = 3,
  action,
  ...tileIds
}: MetricSectionProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'

  return (
    <section aria-label={section.title} data-testid={sectionTestId} data-section={section.key}>
      <Heading className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-2">
        {section.title}
      </Heading>
      {section.state === 'empty' ? (
        <div
          className="rounded-card border border-dashed border-border px-3 py-2.5"
          data-testid={emptyTestId}
        >
          <p className="text-xs font-medium text-text-2">
            {section.emptyState?.title ?? 'Nothing to show yet'}
          </p>
          <p className="mt-0.5 max-w-2xl text-[11.5px] leading-relaxed text-text-3">
            {section.emptyState?.detail ?? ''}
          </p>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {section.metrics.map((metric) => (
            <li key={metric.key}>
              <MetricTile
                metric={metric}
                {...tileIds}
                {...(deltaBasis === undefined ? {} : { deltaBasis })}
                {...(action === undefined ? {} : { action })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
