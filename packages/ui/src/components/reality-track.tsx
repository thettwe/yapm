import { cn } from '@yapm/ui/lib/utils'
import { Fragment } from 'react'

// The one reality vocabulary: nodes and segments, with `//` where the board and git disagree.
// Mirrored from the schema delivery seam as plain string unions so this design-system primitive
// stays free of a schema dependency (the app layer computes the signal and hands over these
// primitives); `reality-track.test.tsx` asserts the two sides stay assignable both ways.
export type PrState = 'draft' | 'open' | 'approved' | 'merged' | 'closed'
export type CiHealth = 'passing' | 'failing' | 'pending'
export type DivergenceKind = 'status_behind_merge' | 'status_ahead_of_pr' | 'done_but_ci_failing'

export interface DeliveryStrip {
  readonly pr: PrState | null
  readonly ci: CiHealth | null
  readonly reviewAgeMs: number | null
  readonly deployedAt: number | null
}

export type TrackNodeKind = 'done' | 'open' | 'rev-wait' | 'fail' | 'empty' | 'empty-urgent'
export type TrackSegmentKind = 'solid' | 'review' | 'dotted' | 'broken'

export interface TrackStation {
  readonly id: string
  readonly node: TrackNodeKind
  // Drawn only by the vertical rail: the station's sentence and its mono fact line.
  readonly label?: string
  readonly fact?: string
}

export interface TrackShape {
  readonly stations: readonly TrackStation[]
  // `segments[i]` joins station `i` to station `i + 1`, so the `//` break is a segment kind and
  // can fall anywhere in a rail of any length rather than at one hardcoded index.
  readonly segments: readonly TrackSegmentKind[]
}

// The four synced facts, in the order reality runs them. The CI segment is the one LEAVING the
// checks station: a board that claims done past a red check breaks there, not before it.
const CI_SEGMENT_INDEX = 1

function prNode(strip: DeliveryStrip | null): TrackNodeKind {
  if (strip?.pr === 'merged' || strip?.pr === 'approved') return 'done'
  if (strip?.pr === 'open') return 'open'
  if (strip?.pr === 'draft') return 'rev-wait'
  return 'empty'
}

function ciNode(strip: DeliveryStrip | null): TrackNodeKind {
  if (strip?.ci === 'passing') return 'done'
  if (strip?.ci === 'failing') return 'fail'
  if (strip?.ci === 'pending') return 'rev-wait'
  return 'empty'
}

function reviewNode(strip: DeliveryStrip | null): TrackNodeKind {
  if (strip?.pr === 'merged' || strip?.pr === 'approved') return 'done'
  if (strip?.pr === 'open') return 'rev-wait'
  return 'empty'
}

function segmentInto(node: TrackNodeKind): TrackSegmentKind {
  if (node === 'empty' || node === 'empty-urgent') return 'dotted'
  if (node === 'open' || node === 'rev-wait' || node === 'fail') return 'review'
  return 'solid'
}

// Which segment the break falls on is derived from WHICH divergence fired, not from a boolean:
// the board ran ahead of git (first), claimed done past a red check (the CI segment), or never
// followed a merge that already happened (the last).
function breakIndex(kind: DivergenceKind, segments: number): number {
  switch (kind) {
    case 'status_ahead_of_pr':
      return 0
    case 'done_but_ci_failing':
      return Math.min(CI_SEGMENT_INDEX, segments - 1)
    case 'status_behind_merge':
      return segments - 1
  }
}

export interface BuildRealityShapeOptions {
  readonly divergence?: DivergenceKind | null
}

// The horizontal track's four stations — change, checks, review, live — over the four facts in
// `DeliveryStrip` and no others.
export function buildRealityShape(
  strip: DeliveryStrip | null,
  options: BuildRealityShapeOptions = {},
): TrackShape {
  const nodes: TrackNodeKind[] = [
    prNode(strip),
    ciNode(strip),
    reviewNode(strip),
    strip?.deployedAt != null ? 'done' : 'empty',
  ]
  const segments: TrackSegmentKind[] = nodes.slice(1).map((node) => segmentInto(node))
  const divergence = options.divergence ?? null
  if (divergence !== null && segments.length > 0) {
    const at = breakIndex(divergence, segments.length)
    segments[at] = 'broken'
    // The station the break lands in front of is the one reality has not reached; it wears the
    // urgent ring so the break reads as a stop, not a gap.
    const after = nodes[at + 1]
    if (after === 'empty') nodes[at + 1] = 'empty-urgent'
  }
  const ids = ['change', 'checks', 'review', 'live'] as const
  return {
    stations: nodes.map((node, index) => ({ id: ids[index] as string, node })),
    segments,
  }
}

const PR_PHRASE: Record<PrState, string> = {
  draft: 'Draft PR',
  open: 'PR open, awaiting review',
  approved: 'PR approved',
  merged: 'PR merged',
  closed: 'PR closed',
}

const CI_PHRASE: Record<CiHealth, string> = {
  passing: 'CI passing',
  failing: 'CI failing',
  pending: 'CI running',
}

// Compact review-age label ("3d", "2h", "now"), rendered from the ms since the newest review —
// or, before any review, how long the PR has been open. There is no review-requested event, so
// this may never be phrased as a reviewer waiting.
export function formatReviewAge(ms: number): string {
  if (ms < 60_000) return 'now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

// The truthful label the horizontal track announces: the facts actually drawn, in the order they
// are drawn, plus the divergence sentence when the break is drawn.
export function realityTrackLabel(
  strip: DeliveryStrip | null,
  divergenceSentence?: string | null,
): string {
  const parts = [
    strip?.pr ? PR_PHRASE[strip.pr] : null,
    strip?.ci ? CI_PHRASE[strip.ci] : null,
    strip?.deployedAt != null ? 'Deployed' : null,
    strip?.reviewAgeMs != null ? `reviewed ${formatReviewAge(strip.reviewAgeMs)} ago` : null,
    divergenceSentence ?? null,
  ].filter((part): part is string => part != null && part !== '')
  return parts.length > 0 ? parts.join(', ') : 'No delivery signal yet'
}

const NODE_CLASS: Record<TrackNodeKind, string> = {
  done: 'size-[7px] rounded-full bg-status-done',
  open: 'size-[7px] rounded-full bg-status-in-review',
  'rev-wait': 'size-2 rounded-full border-[1.6px] border-status-in-review bg-transparent',
  fail: 'size-[7px] rounded-[1.5px] bg-status-urgent',
  empty: 'size-[7px] rounded-full border-[1.4px] border-border-strong bg-transparent',
  'empty-urgent': 'size-[7px] rounded-full border-[1.6px] border-status-urgent bg-transparent',
}

const SEGMENT_CLASS: Record<Exclude<TrackSegmentKind, 'broken'>, string> = {
  solid: 'h-[2px] flex-1 bg-status-done',
  review: 'h-[2px] flex-1 bg-status-in-review',
  dotted:
    'h-[1.5px] flex-1 bg-[repeating-linear-gradient(90deg,var(--border-strong)_0_3px,transparent_3px_6px)]',
}

const BREAK_MARK = '//'

// One node of the track, standing alone beside a sentence that names the same fact. The three CI
// kinds differ by SHAPE — filled disc, square, hollow ring — so passing / failing / running reads
// without hue (WCAG 1.4.1); the token reinforces the shape.
export function ciNodeKind(ci: CiHealth): TrackNodeKind {
  return ci === 'passing' ? 'done' : ci === 'failing' ? 'fail' : 'rev-wait'
}

export function ciPhrase(ci: CiHealth): string {
  return CI_PHRASE[ci]
}

export function TrackNodeMark({
  kind,
  label,
  className,
}: {
  kind: TrackNodeKind
  label: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('inline-block flex-none', NODE_CLASS[kind], className)}
    />
  )
}

const RAIL_NODE_CLASS: Record<TrackNodeKind, string> = {
  done: 'size-[13px] rounded-full border-[2.5px] border-bg bg-status-done',
  open: 'size-[13px] rounded-full border-[2.5px] border-bg bg-status-in-review',
  'rev-wait': 'size-[13px] rounded-full border-[2.5px] border-status-in-review bg-bg',
  fail: 'size-[13px] rounded-[3px] border-[2.5px] border-bg bg-status-urgent',
  empty: 'size-[13px] rounded-full border-[2.5px] border-border-strong bg-bg',
  'empty-urgent': 'size-[13px] rounded-full border-[2.5px] border-status-urgent bg-bg',
}

const RAIL_CONNECTOR_CLASS: Record<TrackSegmentKind, string> = {
  solid: 'bg-status-done',
  review: 'bg-status-in-review',
  dotted: 'bg-[repeating-linear-gradient(180deg,var(--border-strong)_0_3px,transparent_3px_6px)]',
  broken:
    'bg-[repeating-linear-gradient(180deg,var(--status-urgent)_0_4px,transparent_4px_8px)] opacity-65',
}

// The dense track's default measure. Layout, not a design value — a caller places the same shape
// at a wider measure without forking the component.
export const REALITY_TRACK_WIDTH = 118

export interface RealityTrackProps {
  shape: TrackShape
  label: string
  orientation?: 'horizontal' | 'vertical'
  // Horizontal only, in px: the reserved measure. Every track at the same measure occupies the
  // same width whether it is empty or fully populated, so populating a signal cannot shift a row.
  width?: number
  className?: string
}

function HorizontalTrack({
  shape,
  label,
  width = REALITY_TRACK_WIDTH,
  className,
}: Omit<RealityTrackProps, 'orientation'>) {
  return (
    <span
      data-slot="reality-track"
      role="img"
      aria-label={label}
      style={{ width: `${width}px` }}
      className={cn('flex flex-none items-center', className)}
    >
      {shape.stations.map((station, index) => {
        const segment = index > 0 ? shape.segments[index - 1] : undefined
        return (
          <Fragment key={station.id}>
            {segment === undefined ? null : segment === 'broken' ? (
              <span
                data-slot="reality-track-break"
                className="px-[3px] font-mono text-[11px] font-medium leading-none tracking-[-0.05em] text-status-urgent-ink"
              >
                {BREAK_MARK}
              </span>
            ) : (
              <span className={SEGMENT_CLASS[segment]} />
            )}
            <span className={cn('flex-none', NODE_CLASS[station.node])} />
          </Fragment>
        )
      })}
    </span>
  )
}

function VerticalRail({ shape, label, className }: Omit<RealityTrackProps, 'orientation'>) {
  return (
    <ol
      data-slot="reality-rail"
      aria-label={label}
      className={cn('relative flex flex-col', className)}
    >
      {shape.stations.map((station, index) => {
        const connector = shape.segments[index]
        const broken = connector === 'broken'
        return (
          <li key={station.id} className="relative pb-3.5 pl-[30px] last:pb-0">
            <span
              aria-hidden="true"
              className={cn('absolute left-0 top-[3px]', RAIL_NODE_CLASS[station.node])}
            />
            {connector === undefined ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-[5.5px] top-[14px] bottom-[-2px] w-[2px]',
                  RAIL_CONNECTOR_CLASS[connector],
                )}
              />
            )}
            {broken ? (
              <span
                data-slot="reality-rail-break"
                className="absolute left-0 bottom-0 w-[13px] bg-bg py-[2px] text-center font-mono text-[12px] font-medium leading-none tracking-[-0.08em] text-status-urgent-ink"
              >
                {BREAK_MARK}
              </span>
            ) : null}
            {station.label === undefined ? null : (
              <span className="block text-[13.5px] font-semibold leading-[1.25] text-text-1">
                {station.label}
              </span>
            )}
            {/* `text-2`, not the mock's `text-3`: this line carries a fact the reader must read at
                11px, and `--text-3` measures 2.80–3.70 against the surfaces the rail sits on. */}
            {station.fact === undefined ? null : (
              <span className="mt-[3px] block font-mono text-[11px] leading-[1.5] text-text-2">
                {station.fact}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// One implementation, three shapes: the dense list row's compact track, the same track at a wider
// measure on a home row, and the issue detail's vertical rail with a sentence and a mono fact per
// station. Horizontal is one `role="img"` with a composed truthful label; vertical is a list, so a
// screen reader reads the stations rather than a summary of them.
function RealityTrack({ orientation = 'horizontal', ...props }: RealityTrackProps) {
  return orientation === 'vertical' ? <VerticalRail {...props} /> : <HorizontalTrack {...props} />
}

export { RealityTrack }
