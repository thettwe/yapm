import type { DayBandSegment, TeamHomeStrip } from '@yapm/schema'
import { cn } from '@yapm/ui/lib/utils'

// The digest's drawn vocabulary (design §D12): static inline drawings, no motion, every color a
// theme token. App-local on purpose — none of these has a UI-dependency-free consumer outside the
// Home page today; promotion to packages/ui waits for a real second consumer. The issue list's
// StatusGlyph / PriorityMark / RealityStrip are reused as-is where the mock shows them; what this
// file adds is the track-and-node vocabulary those components do not draw: the day band, the scope
// band, the check tick-bar, the triage dots, and the reality track with its `//` break.

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

export function ScopeBand({ band }: { band: readonly ('landed' | 'open' | 'added')[] }) {
  const blocks = band.map((kind, index) => ({ id: `block-${index + 1}`, kind }))
  return (
    <div aria-hidden="true" className="mt-[9px] flex gap-[3px]">
      {blocks.map((block) => (
        <span
          key={block.id}
          className={cn(
            'flex h-[11px] flex-1 items-center justify-center rounded-[2.5px]',
            block.kind === 'landed' && 'bg-status-done',
            block.kind === 'open' && 'border-[1.4px] border-border-strong bg-transparent',
            block.kind === 'added' && 'border-[1.4px] border-status-in-progress bg-transparent',
          )}
        >
          {block.kind === 'added' ? (
            <span className="text-[9px] font-bold leading-none text-status-in-progress">+</span>
          ) : null}
        </span>
      ))}
    </div>
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

type TrackNode = 'done' | 'open' | 'rev-wait' | 'fail' | 'empty' | 'empty-urgent'
type TrackSegment = 'solid' | 'review' | 'dotted'

interface TrackShape {
  readonly nodes: readonly TrackNode[]
  readonly breakBefore: number | null
}

// The mock's four stations: PR, CI, review, deploy. The broken form (§D2's `//` mark) is the
// divergence evidence — reality ran ahead, the board never followed.
function trackShape(strip: TeamHomeStrip | null, broken: boolean): TrackShape {
  if (broken) return { nodes: ['done', 'done', 'done', 'empty-urgent'], breakBefore: 3 }
  const pr: TrackNode =
    strip?.pr === 'merged' || strip?.pr === 'approved'
      ? 'done'
      : strip?.pr === 'open'
        ? 'open'
        : strip?.pr === 'draft'
          ? 'rev-wait'
          : 'empty'
  const ci: TrackNode =
    strip?.ci === 'passing'
      ? 'done'
      : strip?.ci === 'failing'
        ? 'fail'
        : strip?.ci === 'pending'
          ? 'rev-wait'
          : 'empty'
  const review: TrackNode =
    strip?.pr === 'merged' || strip?.pr === 'approved'
      ? 'done'
      : strip?.pr === 'open'
        ? 'rev-wait'
        : 'empty'
  const deploy: TrackNode = strip?.deployedAt != null ? 'done' : 'empty'
  return { nodes: [pr, ci, review, deploy], breakBefore: null }
}

function segmentBefore(node: TrackNode): TrackSegment {
  if (node === 'empty' || node === 'empty-urgent') return 'dotted'
  if (node === 'open' || node === 'rev-wait' || node === 'fail') return 'review'
  return 'solid'
}

const NODE_CLASS: Record<TrackNode, string> = {
  done: 'size-[7px] rounded-full bg-status-done',
  open: 'size-[7px] rounded-full bg-status-in-review',
  'rev-wait': 'size-2 rounded-full border-[1.6px] border-status-in-review bg-transparent',
  fail: 'size-[7px] rounded-[1.5px] bg-status-urgent',
  empty: 'size-[7px] rounded-full border-[1.4px] border-border-strong bg-transparent',
  'empty-urgent': 'size-[7px] rounded-full border-[1.6px] border-status-urgent bg-transparent',
}

const SEGMENT_CLASS: Record<TrackSegment, string> = {
  solid: 'h-[2px] flex-1 bg-status-done',
  review: 'h-[2px] flex-1 bg-status-in-review',
  dotted:
    'h-[1.5px] flex-1 bg-[repeating-linear-gradient(90deg,var(--border-strong)_0_3px,transparent_3px_6px)]',
}

export interface RealityTrackProps {
  strip: TeamHomeStrip | null
  broken?: boolean
  label: string
  className?: string
}

export function RealityTrack({ strip, broken = false, label, className }: RealityTrackProps) {
  const shape = trackShape(strip, broken)
  const parts: { id: string; render: 'node' | 'segment' | 'break'; node?: TrackNode }[] = []
  shape.nodes.forEach((node, index) => {
    if (index > 0) {
      if (shape.breakBefore === index) parts.push({ id: `break-${index}`, render: 'break' })
      else parts.push({ id: `seg-${index}`, render: 'segment', node })
    }
    parts.push({ id: `node-${index}`, render: 'node', node })
  })
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('flex w-[118px] flex-none items-center', className)}
    >
      {parts.map((part) =>
        part.render === 'break' ? (
          <span
            key={part.id}
            className="px-[3px] font-mono text-[11px] font-medium leading-none tracking-[-0.05em] text-status-urgent-ink"
          >
            {'//'}
          </span>
        ) : part.render === 'segment' ? (
          <span key={part.id} className={SEGMENT_CLASS[segmentBefore(part.node as TrackNode)]} />
        ) : (
          <span key={part.id} className={cn('flex-none', NODE_CLASS[part.node as TrackNode])} />
        ),
      )}
    </span>
  )
}
