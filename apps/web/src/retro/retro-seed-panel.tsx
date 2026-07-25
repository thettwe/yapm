import type { RetroSeed, RetroSeedMetric, RetroSeedRef, RetroSeedSection } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import {
  formatSeedDelta,
  formatSeedValue,
  seedTrendTone,
  sparklineGeometry,
} from '@/retro/seed-model'

// The panel that makes this a yapm retro rather than a whiteboard: the "gather data" step, already
// done, from the team's own work graph. Delivered is computed from cycles alone and is therefore
// populated on an instance with no connectors at all; Flow appears only when linked delivery data
// exists and otherwise says exactly what would light it up, rather than drawing hollow zeros.
//
// There is no per-person anything to render here — `RetroSeed` has no identity dimension at any
// depth — so the guarantee is a property of the model, not of this file's restraint.

const SPARK_WIDTH = 64
const SPARK_HEIGHT = 18

export interface RetroSeedPanelProps {
  seed: RetroSeed | null
  canDraft: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSeedCard: (ref: RetroSeedRef) => void
}

export function seedRefForMetric(metric: RetroSeedMetric): RetroSeedRef {
  return { kind: 'widget', id: metric.key, label: metric.label }
}

// A card's chip points back here by metric key; the shell reveals the panel and focuses the tile.
export function seedWidgetSelector(metricKey: string): string {
  return `[data-metric="${CSS.escape(metricKey)}"]`
}

export function RetroSeedPanel({
  seed,
  canDraft,
  open,
  onOpenChange,
  onSeedCard,
}: RetroSeedPanelProps) {
  // A retro with no cycle behind it (or whose cycle is outside the caller's synced slice) gets no
  // panel at all, rather than a board of zeros pretending to be a finding.
  if (seed === null) return null

  return (
    <section
      className="border-b border-border bg-bg-sidebar/40 px-4 py-3"
      aria-labelledby="retro-seed-heading"
      data-testid="retro-seed-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-expanded={open}
          aria-controls="retro-seed-sections"
          aria-label={open ? 'Collapse the cycle data' : 'Expand the cycle data'}
          data-testid="retro-seed-toggle"
          onClick={() => onOpenChange(!open)}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Button>
        <h2 id="retro-seed-heading" className="text-[13px] font-semibold text-text-1">
          What actually happened
        </h2>
        <span className="text-xs text-text-2">{seed.cycleName}</span>
        <p className="ml-auto text-[11.5px] text-text-2">
          Team-level trends from this cycle's own work. Never a per-person number.
        </p>
      </div>

      {open ? (
        <div id="retro-seed-sections" className="mt-3 flex flex-col gap-3">
          {seed.sections.map((section) => (
            <SeedSection
              key={section.key}
              section={section}
              canDraft={canDraft}
              onSeedCard={onSeedCard}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function SeedSection({
  section,
  canDraft,
  onSeedCard,
}: {
  section: RetroSeedSection
  canDraft: boolean
  onSeedCard: (ref: RetroSeedRef) => void
}) {
  return (
    <section aria-label={section.title} data-testid="retro-seed-section" data-section={section.key}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-2">
        {section.title}
      </h3>
      {section.state === 'empty' ? (
        <div
          className="rounded-card border border-dashed border-border px-3 py-2.5"
          data-testid="retro-seed-empty"
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
              <SeedWidget metric={metric} canDraft={canDraft} onSeedCard={onSeedCard} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// One widget = one signal. The number is secondary to the movement and the sentence: trends lead,
// absolutes follow, and the caption narrates the system rather than anyone in it.
function SeedWidget({
  metric,
  canDraft,
  onSeedCard,
}: {
  metric: RetroSeedMetric
  canDraft: boolean
  onSeedCard: (ref: RetroSeedRef) => void
}) {
  const delta = formatSeedDelta(metric)
  const tone = seedTrendTone(metric)

  return (
    <article
      // `tabIndex={-1}` keeps the tile out of the tab order (its button carries that) while making
      // it a programmatic focus target, so a card's evidence chip can bring the reader back to the
      // number it came from.
      tabIndex={-1}
      aria-label={`${metric.label}: ${formatSeedValue(metric)}`}
      data-testid="retro-seed-widget"
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
        <Sparkline metric={metric} />
      </div>
      {delta === null ? null : (
        <p className="text-[11.5px] text-text-2">
          <span aria-hidden="true">{tone === null ? '·' : TONE_GLYPH[tone]} </span>
          {delta}
        </p>
      )}
      <p className="text-[11.5px] leading-relaxed text-text-2">{metric.caption}</p>
      {canDraft ? (
        <Button
          size="xs"
          variant="ghost"
          className="-ml-2 mt-0.5 self-start"
          data-testid="retro-seed-add-card"
          onClick={() => onSeedCard(seedRefForMetric(metric))}
        >
          <PlusIcon />
          Add a card from this
        </Button>
      ) : null}
    </article>
  )
}

// Direction is stated in words by the delta line; the glyph is reinforcement, never the carrier.
const TONE_GLYPH: Record<'better' | 'worse' | 'neutral', string> = {
  better: '↗',
  worse: '↘',
  neutral: '→',
}

function Sparkline({ metric }: { metric: RetroSeedMetric }) {
  const geometry = sparklineGeometry(metric.trend, SPARK_WIDTH, SPARK_HEIGHT)
  const description = `Trend across ${metric.trend.length} cycles: ${metric.trend.join(', ')}`

  if (geometry === null) {
    return (
      <span className="shrink-0 text-[11px] text-text-3" data-testid="retro-seed-no-trend">
        no history
      </span>
    )
  }

  return (
    <span className="shrink-0" data-testid="retro-seed-sparkline">
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
