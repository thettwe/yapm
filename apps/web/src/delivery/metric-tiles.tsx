import type { DeliveryMetric, DeliverySection } from '@yapm/schema'
import type { ReactNode } from 'react'
import { formatSeedDelta, formatSeedValue, seedTrendTone, sparklineGeometry } from './metric-format'

// One tile = one signal, rendered identically wherever it appears. The retro's cycle panel and the
// team's rolling window are the same markup, the same classes and the same formatters — a metric
// cannot look like one thing inside a retro and another on the team view.
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
  const description = `Trend across ${metric.trend.length} cycles: ${metric.trend.join(', ')}`

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
        <polyline
          points={geometry.points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
  readonly action?: (metric: DeliveryMetric) => ReactNode
}

// Never zeros, never a hollow chart: a section with nothing behind it renders the one quiet state
// the model already carries, naming what would light it up.
export function MetricSection({
  section,
  sectionTestId,
  emptyTestId,
  deltaBasis,
  action,
  ...tileIds
}: MetricSectionProps) {
  return (
    <section aria-label={section.title} data-testid={sectionTestId} data-section={section.key}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-2">
        {section.title}
      </h3>
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
