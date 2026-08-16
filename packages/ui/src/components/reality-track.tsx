import { type DeliveryStrip, formatReviewAge } from '@yapm/schema'
import { cn } from '@yapm/ui/lib/utils'
import { type CSSProperties, Fragment } from 'react'

// The one reality vocabulary: nodes and segments, with `//` where the board and git disagree.
// The UNION members are mirrored from the schema delivery seam as plain string unions so a caller
// can name a node's state without importing the seam; `reality-track.test.tsx` asserts the two
// sides stay assignable both ways. The strip itself is NOT mirrored — there is exactly one
// `DeliveryStrip`, owned by `packages/schema`, because two structurally identical declarations of
// the same four facts is the duplication this vocabulary exists to end.
export type PrState = 'draft' | 'open' | 'approved' | 'merged' | 'closed'
export type CiHealth = 'passing' | 'failing' | 'pending'
export type DivergenceKind = 'status_behind_merge' | 'status_ahead_of_pr' | 'done_but_ci_failing'

export type { DeliveryStrip }

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
  // Whether the shape was built over NO delivery fact at all. Recorded by the builder because the
  // builder is the only thing that sees the strip, and the drawn nodes are not a faithful witness
  // to it: a PR closed without merging, or a review age on a change nobody opened a station for,
  // fills no node and is still a fact the label states. Deciding quietness from the node kinds
  // would throw both away. A hand-built shape states `false` — see `isQuietTrack`.
  readonly factless: boolean
}

// The four synced facts, in the order reality runs them. The CI segment is the one LEAVING the
// checks station: a board that claims done past a red check breaks there, not before it.
const CI_SEGMENT_INDEX = 1

// `done` at the change station means the change LANDED. An approved pull request has not landed,
// so it draws `open` — reality is standing at this station. `reviewNode` still reads `done` for it,
// and that pair of stations is what tells an approved change from a merged one without a phrase.
function prNode(strip: DeliveryStrip | null): TrackNodeKind {
  if (strip?.pr === 'merged') return 'done'
  if (strip?.pr === 'open' || strip?.pr === 'approved') return 'open'
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

// Apply the break, and give the station it stops in front of the urgent ring. Shared by both
// shapes so a rail and a track over the same divergence break in the same grammar.
function applyBreak(
  nodes: TrackNodeKind[],
  segments: TrackSegmentKind[],
  divergence: DivergenceKind | null,
): void {
  if (divergence === null || segments.length === 0) return
  const at = breakIndex(divergence, segments.length)
  segments[at] = 'broken'
  const after = nodes[at + 1]
  if (after === 'empty') nodes[at + 1] = 'empty-urgent'
}

// The VERTICAL rail's shape, over stations a surface names for itself. The horizontal track is
// always the same four facts, so `buildRealityShape` can own its stations; a rail draws one station
// per moment that actually happened, and how many there are is a property of the issue. What stays
// here is the grammar — which connector a station's node earns, and where the `//` falls — because
// a surface deriving that for itself is how a second vocabulary starts.
export function buildRailShape(
  stations: readonly TrackStation[],
  options: BuildRealityShapeOptions = {},
): TrackShape {
  const nodes = stations.map((station) => station.node)
  const segments: TrackSegmentKind[] = nodes.slice(1).map((node) => segmentInto(node))
  applyBreak(nodes, segments, options.divergence ?? null)
  return {
    stations: stations.map((station, index) => ({
      ...station,
      node: nodes[index] as TrackNodeKind,
    })),
    segments,
    // A rail is excluded from the quiet rule by the surface that draws it, and a caller names its
    // own stations rather than handing over a strip, so there is no fact-ness here to record.
    factless: false,
  }
}

// A strip carries a fact when ANY of its four axes is populated — including the two the four
// stations never fill a node for: `pr: 'closed'` (a change that ended without merging) and a review
// age carried without an open pull request. Both are drawn in the age column and stated in the
// label, so both take a track out of the quiet rule.
function isFactless(strip: DeliveryStrip | null): boolean {
  return (
    strip === null ||
    (strip.pr == null && strip.ci == null && strip.reviewAgeMs == null && strip.deployedAt == null)
  )
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
  // The station the break lands in front of is the one reality has not reached; it wears the
  // urgent ring so the break reads as a stop, not a gap.
  applyBreak(nodes, segments, options.divergence ?? null)
  const ids = ['change', 'checks', 'review', 'live'] as const
  return {
    stations: nodes.map((node, index) => ({ id: ids[index] as string, node })),
    segments,
    factless: isFactless(strip),
  }
}

// No review-requested event is stored, so the open state may never be phrased as a reviewer being
// waited on: "PR open, awaiting review" and "PR open since Tuesday" are the same row to yapm.
const PR_PHRASE: Record<PrState, string> = {
  draft: 'Draft PR',
  open: 'PR open',
  approved: 'PR approved',
  merged: 'PR merged',
  closed: 'PR closed',
}

const CI_PHRASE: Record<CiHealth, string> = {
  passing: 'CI passing',
  failing: 'CI failing',
  pending: 'CI running',
}

// Re-exported, not redeclared: the phrase dictionary states the same age in words, and the two
// would eventually disagree if each owned a formatter. The implementation lives beside the seam
// that produces the milliseconds.
export { formatReviewAge }

// A PR that has never been reviewed and a PR reviewed three days ago both carry a review age, and
// the two are not the same sentence. `reviewAgeFrom` says which clock it is; a strip that predates
// the field states the age neutrally rather than inventing a review that did not happen.
function reviewAgePhrase(strip: DeliveryStrip): string | null {
  if (strip.reviewAgeMs == null) return null
  const age = formatReviewAge(strip.reviewAgeMs)
  if (strip.reviewAgeFrom === 'pr-open') return `unreviewed for ${age}`
  if (strip.reviewAgeFrom === 'review') return `reviewed ${age} ago`
  return `review age ${age}`
}

// The truthful label the horizontal track announces: the facts actually drawn, in the order they
// are drawn, plus the divergence sentence when the break is drawn. A track that draws no ink
// announces nothing (see `isQuietTrack`), but the fact-free phrase stays available to surfaces
// that state the absence in words rather than drawing it.
//
// `quietPhrase` is the words the surface's register holds for this row and DID NOT draw. They LEAD
// the label, so the first thing a screen reader hears is the sentence a sighted reader no longer
// sees, in exactly the text the register would have drawn. The contract runs the other way too and
// it belongs to the caller: words the register DREW are never passed here, or a reader hears them
// twice. The divergence sentence is a different sentence about a different aspect and keeps its
// place under either rule.
export function realityTrackLabel(
  strip: DeliveryStrip | null,
  divergenceSentence?: string | null,
  quietPhrase?: string | null,
): string {
  const parts = [
    strip?.pr ? PR_PHRASE[strip.pr] : null,
    strip?.ci ? CI_PHRASE[strip.ci] : null,
    strip?.deployedAt != null ? 'Deployed' : null,
    strip === null ? null : reviewAgePhrase(strip),
    divergenceSentence ?? null,
  ].filter((part): part is string => part != null && part !== '')
  const said = quietPhrase == null || quietPhrase === '' ? null : quietPhrase
  if (parts.length === 0) return said ?? 'No delivery signal yet'
  // A full stop, not a comma: the register's sentence and the track's facts are two statements,
  // and a screen reader pauses at the boundary rather than running them together.
  return said === null ? parts.join(', ') : `${said}. ${parts.join(', ')}`
}

// A track carrying NO fact and NO break has nothing to scaffold, so in a dense row it draws
// nothing at all. Stated once, over the shape, because three call sites deciding for themselves
// what "empty" means is how a second empty state starts. A shape with any fact, or with a break,
// is NOT quiet: its hollow stations and dotted segments join the facts it does draw.
//
// `factless` is what carries "no fact", and it comes from the STRIP rather than from the nodes:
// the drawn stations are a lossy view of the four facts, and a row whose PR was closed without
// merging draws four empty nodes while genuinely knowing something. The node and break tests stay
// beside it because they are what makes the slot safe to leave inkless.
export function isQuietTrack(shape: TrackShape): boolean {
  return (
    shape.factless &&
    shape.stations.every((station) => station.node === 'empty') &&
    !shape.segments.includes('broken')
  )
}

// The three NON-COLOUR channels a station's node is drawn in. Declared as a value, and the drawn
// classes below are composed FROM it, so "no two kinds are told apart by hue alone"
// (`DESIGN.md:12`, WCAG 1.4.1) is a property asserted over this vocabulary rather than over
// rendered pixels. A reader who cannot separate the status hues still reads six kinds here.
export type TrackNodeFill = 'filled' | 'half' | 'outline'
export type TrackNodeForm = 'disc' | 'square'
export type TrackNodeStroke = 'none' | 'ring' | 'dashed'

export interface TrackNodeDrawing {
  readonly fill: TrackNodeFill
  readonly form: TrackNodeForm
  readonly stroke: TrackNodeStroke
}

// `empty-urgent` borrows `fail`'s square deliberately: they are the only two kinds that mean
// something is WRONG here, and an outline square after a `//` break reads as the stop it is.
// `empty`'s dashed ring is the dotted segment's own grammar, at a node's scale.
export const TRACK_NODE_DRAWING: Record<TrackNodeKind, TrackNodeDrawing> = {
  done: { fill: 'filled', form: 'disc', stroke: 'none' },
  open: { fill: 'half', form: 'disc', stroke: 'ring' },
  'rev-wait': { fill: 'outline', form: 'disc', stroke: 'ring' },
  fail: { fill: 'filled', form: 'square', stroke: 'none' },
  empty: { fill: 'outline', form: 'disc', stroke: 'dashed' },
  'empty-urgent': { fill: 'outline', form: 'square', stroke: 'ring' },
}

const FORM_CLASS: Record<TrackNodeForm, string> = {
  disc: 'rounded-full',
  square: 'rounded-[1.5px]',
}

const STROKE_CLASS: Record<TrackNodeStroke, string> = {
  none: '',
  ring: 'border-solid',
  dashed: 'border-dashed',
}

// `half` is a hard-edged 50% gradient rather than a second element: the silhouette stays one node,
// its leading half is inked, and it is neither a solid disc nor a hollow ring at any hue. The
// gradient names the in-review token because `open` is the one kind that means "reality is standing
// here", and that is the hue the whole vocabulary gives that state; `filled` contributes nothing
// because the hue table below already carries the fill's paint.
const FILL_CLASS: Record<TrackNodeFill, string> = {
  filled: '',
  half: 'bg-[linear-gradient(90deg,var(--status-in-review)_0_50%,transparent_50%_100%)]',
  outline: 'bg-transparent',
}

// The hue and the measure — the only per-kind values the three channel tables do not decide.
const NODE_INK: Record<TrackNodeKind, string> = {
  done: 'size-[7px] bg-status-done',
  open: 'size-[7px] border-[1.25px] border-status-in-review',
  'rev-wait': 'size-2 border-[1.6px] border-status-in-review',
  fail: 'size-[7px] bg-status-urgent',
  empty: 'size-[7px] border-[1.4px] border-border-strong',
  'empty-urgent': 'size-[7px] border-[1.6px] border-status-urgent',
}

// All three declared channels are composed into the drawn class, `fill` included — a channel the
// drawing did not read would make the separability guard above an assertion about a table nothing
// obeys, and `fill` is the ONLY channel separating `open` from `rev-wait`.
function nodeClass(kind: TrackNodeKind): string {
  const drawing = TRACK_NODE_DRAWING[kind]
  return cn(
    NODE_INK[kind],
    FILL_CLASS[drawing.fill],
    FORM_CLASS[drawing.form],
    STROKE_CLASS[drawing.stroke],
  )
}

const NODE_CLASS: Record<TrackNodeKind, string> = {
  done: nodeClass('done'),
  open: nodeClass('open'),
  'rev-wait': nodeClass('rev-wait'),
  fail: nodeClass('fail'),
  empty: nodeClass('empty'),
  'empty-urgent': nodeClass('empty-urgent'),
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

// The rail's nodes and its `//` knockout patch are drawn OVER the connector, so one of the two —
// the node's halo or its fill — has to be the surface the rail sits on. That surface is the
// caller's, not this component's: a rail inside a peek or a sidebar panel painted `--bg` would
// knock a hole of page colour into the panel. `--rail-surface` carries it, set once on the list.
const RAIL_NODE_CLASS: Record<TrackNodeKind, string> = {
  done: 'size-[13px] rounded-full border-[2.5px] bg-status-done',
  open: 'size-[13px] rounded-full border-[2.5px] bg-status-in-review',
  'rev-wait': 'size-[13px] rounded-full border-[2.5px] border-status-in-review',
  fail: 'size-[13px] rounded-[3px] border-[2.5px] bg-status-urgent',
  empty: 'size-[13px] rounded-full border-[2.5px] border-border-strong',
  'empty-urgent': 'size-[13px] rounded-full border-[2.5px] border-status-urgent',
}

// Which of the two properties the surface fills for each node kind: a filled node wears the
// surface as its halo, a hollow one as its centre.
const RAIL_NODE_KNOCKOUT: Record<TrackNodeKind, 'border' | 'background'> = {
  done: 'border',
  open: 'border',
  'rev-wait': 'background',
  fail: 'border',
  empty: 'background',
  'empty-urgent': 'background',
}

// Token-only by construction: a caller names one of the theme's surfaces, never a colour. A
// knockout surface must be OPAQUE — the halo and the `//` patch paint over the rail line, and a
// translucent paint lets the line show through. That rules out `--bg-hover`, which several presets
// define as an rgba overlay: it is a tint laid on a surface, not a surface a rail is drawn on.
export type TrackSurface = 'bg' | 'bg-elevated' | 'bg-sidebar'

const SURFACE_VAR: Record<TrackSurface, string> = {
  bg: 'var(--bg)',
  'bg-elevated': 'var(--bg-elevated)',
  'bg-sidebar': 'var(--bg-sidebar)',
}

function knockoutStyle(kind: TrackNodeKind): CSSProperties {
  return RAIL_NODE_KNOCKOUT[kind] === 'border'
    ? { borderColor: 'var(--rail-surface)' }
    : { backgroundColor: 'var(--rail-surface)' }
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

// The mock's `.t-age`: a right-aligned mono column beside the stations, inside the same reserved
// measure, so the fourth fact is drawn and not only announced.
const AGE_COLUMN_WIDTH = 26
// The gutter between the stations and that column. It is drawn by the static `ml-[6px]` below —
// Tailwind reads class strings, not constants — so the two must be changed together.
const AGE_COLUMN_GUTTER = 6

// What a surface adds to its stations' measure to reserve the age column too. Exported because a
// surface that draws the column has to widen for it rather than squeeze the stations.
export const AGE_COLUMN_MEASURE = AGE_COLUMN_WIDTH + AGE_COLUMN_GUTTER

export interface RealityTrackProps {
  shape: TrackShape
  label: string
  orientation?: 'horizontal' | 'vertical'
  // Horizontal only, in px: the reserved measure. Every track at the same measure occupies the
  // same width whether it is empty or fully populated, so populating a signal cannot shift a row.
  width?: number
  // Horizontal only. Review age, formatted by `formatReviewAge`, drawn in the reserved mono column
  // beside the stations. THREE states on purpose: `undefined` is a surface with no age column at
  // all (a board card, a home row that states the age in words beside it); `null` is a surface that
  // HAS the column and this track has no age yet; a string draws it. A surface that draws the
  // column passes `null` rather than omitting it, so an unlinked row reserves exactly what a
  // populated one does.
  age?: string | null
  // Vertical only: the surface the rail is drawn on. The node haloes and the `//` knockout patch
  // paint it, so a rail on a panel must be told the panel's colour or it paints a hole of page
  // colour into it.
  surface?: TrackSurface
  className?: string
}

function HorizontalTrack({
  shape,
  label,
  width = REALITY_TRACK_WIDTH,
  age,
  className,
}: Omit<RealityTrackProps, 'orientation'>) {
  // Reserved and inkless. The slot keeps its measure — and its age column, when the surface draws
  // one — so a signal arriving later shifts nothing; and because it states nothing, it states
  // nothing to a screen reader either, rather than announcing an absence on every row of a list.
  if (isQuietTrack(shape)) {
    return (
      <span
        data-slot="reality-track"
        data-quiet="true"
        aria-hidden="true"
        style={{ width: `${width}px` }}
        className={cn('flex flex-none items-center', className)}
      >
        <span className="flex min-w-0 flex-1 items-center" />
        {age === undefined ? null : (
          <span
            data-slot="reality-track-age"
            style={{ width: `${AGE_COLUMN_WIDTH}px` }}
            className="ml-[6px] flex-none text-right font-mono text-[10.5px] leading-none tabular-nums text-text-2"
          />
        )}
      </span>
    )
  }

  return (
    <span
      data-slot="reality-track"
      role="img"
      aria-label={label}
      style={{ width: `${width}px` }}
      className={cn('flex flex-none items-center', className)}
    >
      <span className="flex min-w-0 flex-1 items-center">
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
      {/* `text-2`, not the mock's `text-3`: at 10.5px this is a fact the reader must read, and
          `--text-3` measures 2.80–3.70 against the surfaces a row is drawn on. */}
      {age === undefined ? null : (
        <span
          data-slot="reality-track-age"
          style={{ width: `${AGE_COLUMN_WIDTH}px` }}
          className="ml-[6px] flex-none text-right font-mono text-[10.5px] leading-none tabular-nums text-text-2"
        >
          {age}
        </span>
      )}
    </span>
  )
}

function VerticalRail({
  shape,
  label,
  surface = 'bg',
  className,
}: Omit<RealityTrackProps, 'orientation'>) {
  return (
    <ol
      data-slot="reality-rail"
      aria-label={label}
      style={{ '--rail-surface': SURFACE_VAR[surface] } as CSSProperties}
      className={cn('relative flex flex-col', className)}
    >
      {shape.stations.map((station, index) => {
        const connector = shape.segments[index]
        const broken = connector === 'broken'
        return (
          <li key={station.id} className="relative pb-3.5 pl-[30px] last:pb-0">
            <span
              aria-hidden="true"
              style={knockoutStyle(station.node)}
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
                style={{ backgroundColor: 'var(--rail-surface)' }}
                className="absolute left-0 bottom-0 w-[13px] py-[2px] text-center font-mono text-[12px] font-medium leading-none tracking-[-0.08em] text-status-urgent-ink"
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
