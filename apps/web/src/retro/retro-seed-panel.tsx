import type { RetroSeed, RetroSeedMetric, RetroSeedRef } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import { MetricSection } from '@/delivery/metric-tiles'

// The panel that makes this a yapm retro rather than a whiteboard: the "gather data" step, already
// done, from the team's own work graph. Delivered is computed from cycles alone and is therefore
// populated on an instance with no connectors at all; Flow appears only when linked delivery data
// exists and otherwise says exactly what would light it up, rather than drawing hollow zeros.
//
// There is no per-person anything to render here — `RetroSeed` has no identity dimension at any
// depth — so the guarantee is a property of the model, not of this file's restraint.
//
// The tiles themselves are `@/delivery`'s, shared with the team Delivery view. This file owns the
// retro's framing, its `retro-seed-*` selectors and the one affordance that is retro-only.

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
        {/* The binding rule itself lives once in the product, on Delivery (`BINDING_TEAM_LEVEL_RULE`).
            This line states the panel's scope in the label register and does not repeat it. */}
        <p className="ml-auto text-[11.5px] text-text-2">
          Team-level trends from this cycle's own work
        </p>
      </div>

      {open ? (
        <div id="retro-seed-sections" className="mt-3 flex flex-col gap-3">
          {seed.sections.map((section) => (
            <MetricSection
              key={section.key}
              section={section}
              sectionTestId="retro-seed-section"
              emptyTestId="retro-seed-empty"
              testId="retro-seed-widget"
              sparklineTestId="retro-seed-sparkline"
              noTrendTestId="retro-seed-no-trend"
              {...(canDraft
                ? {
                    action: (metric: RetroSeedMetric) => (
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
                    ),
                  }
                : {})}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
