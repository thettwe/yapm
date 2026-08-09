import { cn } from '@yapm/ui/lib/utils'

// The drawn band vocabulary: static inline drawings, no motion, every color a theme token. These
// took plain structural props from the day they were written, and now have three consumers rather
// than one, so they live here beside the row primitives instead of inside a page. The unions are
// mirrored from the schema seam as plain string unions (the `issue-row` precedent) and guarded
// both ways by `reality-track.test.tsx`.

export type DayBandSegment = 'past' | 'today' | 'future'
export type ScopeBlockKind = 'landed' | 'open' | 'added'

export function DayBand({ segments }: { segments: readonly DayBandSegment[] }) {
  const days = segments.map((kind, index) => ({ id: `day-${index + 1}`, kind }))
  return (
    <div aria-hidden="true" className="flex h-3 items-center gap-[5px]">
      {days.map((day) => (
        <span
          key={day.id}
          className={cn(
            'h-[6px] flex-1 rounded-[2.5px] bg-row-hairline',
            day.kind === 'past' && 'bg-accent-line',
            day.kind === 'today' && 'h-3 bg-accent',
          )}
        />
      ))}
    </div>
  )
}

// `hero` is Home's measure and the default — the register reuses this drawing at `row` scale
// rather than redrawing it, so the two surfaces cannot encode the same three facts two ways.
// The treatment does not change with the scale: still `aria-hidden`, still three channels (fill,
// hollow outline, outline-plus-`+`), with the numbers always stated in text beside it.
export type ScopeBandSize = 'hero' | 'row'

export function ScopeBand({
  band,
  size = 'hero',
}: {
  band: readonly ScopeBlockKind[]
  size?: ScopeBandSize
}) {
  const blocks = band.map((kind, index) => ({ id: `block-${index + 1}`, kind }))
  const row = size === 'row'
  return (
    <div aria-hidden="true" className={cn('flex', row ? 'w-full gap-[2px]' : 'mt-[9px] gap-[3px]')}>
      {blocks.map((block) => (
        <span
          key={block.id}
          className={cn(
            'flex flex-1 items-center justify-center',
            row ? 'h-[9px] rounded-[2px]' : 'h-[11px] rounded-[2.5px]',
            block.kind === 'landed' && 'bg-status-done',
            block.kind === 'open' && 'border-border-strong bg-transparent',
            block.kind === 'added' && 'border-status-in-progress bg-transparent',
            block.kind !== 'landed' && (row ? 'border-[1.3px]' : 'border-[1.4px]'),
          )}
        >
          {/* 9px type, so the `+` takes the TEXT ink rather than the drawn hue its outline carries:
              one amber cannot clear both 3:1 as a mark and 4.5:1 as type and stay an amber. */}
          {block.kind === 'added' ? (
            <span
              className={cn(
                'font-bold leading-none text-status-in-progress-ink',
                row ? 'text-[8px]' : 'text-[9px]',
              )}
            >
              +
            </span>
          ) : null}
        </span>
      ))}
    </div>
  )
}

export type CarryNodeKind = 'unnamed' | 'origin' | 'now'

const CHAIN_GAP = 58
const CHAIN_PAD = 10
const CHAIN_LEAD = 36
const CHAIN_CY = 13
const CHAIN_HEIGHT = 24
// The drawing is BOUNDED. Its intrinsic width grows 58px per hop, and the deepest row — the exact
// one the carry band exists to surface — would push its track past the container. Past four nodes
// a fifth dot adds no notation the row does not already state: the dotted lead-in already means
// "the part of the chain before the drawing begins", and `carried N×` states the true depth in
// text beside it at any length.
const CHAIN_MAX_NODES = 4

// The carry chain: one node per cycle boundary the issue crossed, drawn from its carry COUNT and
// nothing else. Two constraints the drawing cannot state for itself — it is `aria-hidden` and the
// row states `carried N×` in text beside it, because a private notation may never be the only
// carrier of a fact; and only ONE node can be named, because `rolled_over_from_cycle_id` holds the
// last origin alone and every earlier one was overwritten. The dotted lead-in is that gap. The
// origin's NAME is row text, not a label under the drawing: a label the drawing carried would be
// legible on one row only and squint-sized on all of them.
export function CarryChain({
  nodes,
  leadIn,
}: {
  nodes: readonly CarryNodeKind[]
  leadIn: boolean
}) {
  // The TAIL is what is kept: the named origin is the hop immediately before now, so bounding the
  // drawing never drops the one node the schema can still name.
  const shown = nodes.slice(-CHAIN_MAX_NODES)
  const lead = leadIn || shown.length < nodes.length
  const count = Math.max(1, shown.length)
  const span = (count - 1) * CHAIN_GAP
  const width = CHAIN_PAD * 2 + span + (lead ? CHAIN_LEAD : 0)
  const first = width - CHAIN_PAD - span
  const marks = shown.map((kind, index) => ({
    id: `node-${index + 1}`,
    kind,
    x: first + index * CHAIN_GAP,
  }))

  return (
    <svg
      aria-hidden="true"
      width={width}
      height={CHAIN_HEIGHT}
      viewBox={`0 0 ${width} ${CHAIN_HEIGHT}`}
      className="block overflow-visible"
    >
      {lead ? (
        <line
          x1={first - CHAIN_LEAD}
          y1={CHAIN_CY}
          x2={first}
          y2={CHAIN_CY}
          stroke="var(--border-strong)"
          strokeWidth={1.5}
          strokeDasharray="2.5 3.5"
          strokeLinecap="round"
        />
      ) : null}
      {count > 1 ? (
        <line
          x1={first}
          y1={CHAIN_CY}
          x2={width - CHAIN_PAD}
          y2={CHAIN_CY}
          stroke="var(--border-strong)"
          strokeWidth={1.5}
        />
      ) : null}
      {marks.map((mark) =>
        mark.kind === 'now' ? (
          <circle key={mark.id} cx={mark.x} cy={CHAIN_CY} r={4} fill="var(--accent)" />
        ) : mark.kind === 'origin' ? (
          <circle key={mark.id} cx={mark.x} cy={CHAIN_CY} r={3.6} fill="var(--text-2)" />
        ) : (
          <circle
            key={mark.id}
            cx={mark.x}
            cy={CHAIN_CY}
            r={3.4}
            fill="var(--bg)"
            stroke="var(--border-strong)"
            strokeWidth={1.5}
          />
        ),
      )}
    </svg>
  )
}

const TICK_HEIGHTS = [7, 10, 6, 11, 13, 9] as const
const TICK_CAP = 8

// One tick per CI check, `true` = failing; heights cycle a fixed pattern (they carry no data).
export function TickBar({ ticks }: { ticks: readonly boolean[] }) {
  const shown = ticks.slice(-TICK_CAP).map((bad, index) => ({
    id: `tick-${index + 1}`,
    bad,
    height: TICK_HEIGHTS[index % TICK_HEIGHTS.length] as number,
  }))
  return (
    <span aria-hidden="true" className="flex h-3.5 items-end gap-[2.5px]">
      {shown.map((tick) => (
        <span
          key={tick.id}
          style={{ height: `${tick.height}px` }}
          className={cn(
            'w-[3px] rounded-[1px]',
            tick.bad ? 'bg-status-urgent' : 'bg-border-strong',
          )}
        />
      ))}
    </span>
  )
}

// Hollow dots for the triage class, capped visually — the true number lives in the row text.
export function TriageDots({ count }: { count: number }) {
  const dots = Array.from({ length: Math.max(0, Math.min(count, TICK_CAP)) }, (_, index) => ({
    id: `dot-${index + 1}`,
  }))
  return (
    <span aria-hidden="true" className="flex gap-1">
      {dots.map((dot) => (
        <span
          key={dot.id}
          className="size-[7px] rounded-full border-[1.5px] border-border-strong"
        />
      ))}
    </span>
  )
}
