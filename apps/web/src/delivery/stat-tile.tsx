import type { DeliveryStatKey, DeliveryStatReading } from '@yapm/schema'
import { How } from '@yapm/ui/components/how'
import { ProvenanceMark } from '@yapm/ui/components/provenance-mark'
import { cn } from '@yapm/ui/lib/utils'
import { sparklineGeometry } from './metric-format'

// The journalism cut's stat reading (`delivery.html` §statrow): a label, a 28px number with its
// unit, a delta pill whose direction is in WORDS, a small drawn mini flush right, and the shipped
// `how ·` under it. Four of them across the full measure, hairline-separated — no card, no border,
// no caption sentence.
//
// This is a different object from `metric-tiles.tsx`, which stays exactly as it is for the retro's
// data panel (design §D8). Two tiles that share only their input type would meet in a component
// whose every branch is one caller's, and the retro's markup would be one careless default away
// from moving.

const MINI_W = 64
const MINI_H = 18

// Which readings come from a connector rather than from yapm's own rows. Keyed off the stat key,
// which is a closed union, so a fifth reading cannot quietly arrive without a decision here.
const PROVIDER_SOURCED: Record<DeliveryStatKey, boolean> = {
  shipped: false,
  pr_cycle_time: true,
  ci_failing_rate: true,
  issues_without_pr: false,
}

const DELTA_GLYPH: Record<'up' | 'down' | 'flat', string> = { up: '▲', down: '▼', flat: '·' }

// The sense is carried by the GROUND and stated in words; the ink stays `--text-1` on every one of
// them. A sense-coloured ink at 11px is the pair that misses AA in three presets, and a pill a
// sighted reader has to squint at is the same bug as one a screen reader cannot hear.
const DELTA_TONE: Record<'better' | 'worse' | 'neither', string> = {
  better: 'bg-status-done/10 text-text-1',
  worse: 'bg-urgent-soft text-text-1',
  neither: 'bg-bg-hover text-text-1',
}

export function StatRow({ readings }: { readings: readonly DeliveryStatReading[] }) {
  if (readings.length === 0) return null
  return (
    <div
      data-testid="delivery-stat-row"
      className="flex flex-wrap border-t border-b border-row-hairline"
    >
      {readings.map((reading, index) => (
        <StatTile key={reading.key} reading={reading} first={index === 0} />
      ))}
    </div>
  )
}

export function StatTile({
  reading,
  first = true,
}: {
  reading: DeliveryStatReading
  first?: boolean
}) {
  const delta = reading.delta

  return (
    <div
      data-testid="delivery-stat"
      data-metric={reading.key}
      className={cn(
        'flex-1 basis-52 py-4 pb-3',
        first ? null : 'border-l border-row-hairline pl-[30px]',
      )}
    >
      <div className="mb-1.5 flex items-center gap-1 text-[12px] text-text-2">
        {reading.label}
        {PROVIDER_SOURCED[reading.key] ? <ProvenanceMark provider="github" size={12} /> : null}
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-[28px] font-bold leading-none tracking-[-0.02em] text-text-1">
          {reading.value}
          {reading.unitSuffix === '' ? null : (
            <span className="text-[15px] font-semibold text-text-2">{reading.unitSuffix}</span>
          )}
        </span>
        {delta === null ? null : (
          <span
            data-testid="delivery-stat-delta"
            className={cn(
              'rounded-pill px-[7px] py-[2px] text-[11px] font-semibold',
              DELTA_TONE[delta.sense],
            )}
          >
            <span aria-hidden="true">{`${DELTA_GLYPH[delta.direction]} ${delta.magnitude}${reading.unitSuffix}`}</span>
            {/* Direction and sense in words. A glyph and a hue are reinforcement; they are never
                the carrier of a fact (WCAG 1.4.1). */}
            <span className="sr-only">{delta.spoken}</span>
          </span>
        )}
        <StatMini reading={reading} />
      </div>
      <span className="mt-[7px] inline-block">
        <How label={reading.how.label} constraint={reading.how.constraint}>
          {reading.how.body}
        </How>
      </span>
    </div>
  )
}

// The mini is drawn from the reading's own per-cycle series and nothing else. A series with fewer
// than two measured cycles draws nothing at all rather than a line through one point, which would
// be a shape claiming a trend that is not there.
function StatMini({ reading }: { reading: DeliveryStatReading }) {
  const description = `${reading.label} across ${reading.series.length} cycles: ${reading.series
    .map((entry) => (entry === undefined ? 'no data' : entry))
    .join(', ')}`

  if (reading.mini === 'ticks') {
    const measured = reading.series.filter((entry): entry is number => entry !== undefined)
    if (measured.length === 0) return null
    const max = Math.max(...measured, 1)
    const step = MINI_W / reading.series.length
    return (
      <svg
        role="img"
        aria-label={description}
        width={MINI_W}
        height={MINI_H}
        viewBox={`0 0 ${MINI_W} ${MINI_H}`}
        className="ml-auto mr-[26px] block overflow-visible"
      >
        {reading.series.map((value, index) =>
          value === undefined ? null : (
            <line
              // The index IS the cycle's slot: a gap keeps its place so the survivors are never
              // re-spaced.
              key={`tick-${index}`}
              x1={index * step + step / 2}
              x2={index * step + step / 2}
              y1={MINI_H - 2 - (value / max) * (MINI_H - 6)}
              y2={MINI_H - 2}
              stroke="var(--border-strong)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          ),
        )}
      </svg>
    )
  }

  const geometry = sparklineGeometry(reading.series, MINI_W, MINI_H)
  if (geometry === null) return null
  return (
    <svg
      role="img"
      aria-label={description}
      width={MINI_W}
      height={MINI_H}
      viewBox={`0 0 ${MINI_W} ${MINI_H}`}
      className="ml-auto mr-[26px] block overflow-visible text-text-2"
    >
      {geometry.segments.map((points) => (
        <polyline
          key={points}
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      <circle cx={geometry.last.x} cy={geometry.last.y} r={2.6} className="fill-accent" />
    </svg>
  )
}
