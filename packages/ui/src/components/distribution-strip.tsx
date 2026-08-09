// OPEN TO MERGED, drawn: one dot per merged change on a LINEAR axis, and the median rule drawn
// where it falls rather than quoted from a summary. Giants are included and named — a log axis, a
// clipped axis or an "other" bucket would each hide the shape this drawing exists to show.
//
// Structural props, static inline SVG, no motion and no tooltip; every colour is a theme token.
// Positions arrive as fractions of the axis, so the drawing never re-derives an hour into a pixel
// twice.

export interface DistributionDot {
  readonly id: string
  readonly position: number
  readonly outlier: boolean
}

export interface DistributionNote {
  readonly id: string
  readonly kind: 'crowd' | 'outlier'
  readonly position: number
  readonly text: string
}

export interface DistributionStripProps {
  readonly dots: readonly DistributionDot[]
  readonly ticks: readonly number[]
  readonly axisMax: number
  readonly tickSuffix?: string
  readonly medianPosition: number
  readonly medianLabel: string
  readonly notes: readonly DistributionNote[]
  // Truthful and complete: the population, the axis and WHAT ONE MARK IS.
  readonly label: string
}

const WIDTH = 1120
const HEIGHT = 152
const LEFT = 14
const RIGHT = 1106
const SPAN = RIGHT - LEFT
const AXIS_Y = 128
const DOT_R = 5
const DOT_STACK = 12
// Two changes closer than this on the drawn axis share a column and stack, so a crowd reads as a
// pile rather than as one dot drawn twenty times.
const DOT_GAP = 9
const MEDIAN_TOP = 58
// Above the median's own label, never beside it: the crowd note and the median label share an x,
// and drawn on one line they overprint each other.
const NOTE_TOP = 26
// A further baseline for a note that would otherwise be drawn through the one beside it.
const NOTE_ROW = 14
// 11px, per character. The drawing cannot measure text, so this must never UNDER-measure any face
// a preset binds to the mono role: both mono faces in the palette (IBM Plex Mono, JetBrains Mono)
// advance 0.6em = 6.6px at 11px, and the editorial preset binds `--type-mono` to a proportional
// sans where no per-character constant is exact. 7.2 is 0.655em. Over-estimating costs a note an
// extra baseline, which is never worse than two notes sharing one.
const NOTE_CHAR_W = 7.2
const NOTE_INSET = 10
// Two notes closer than this on one baseline read as a single run-on sentence. Roughly two
// characters at 11px.
const NOTE_GAP = 18
// 11px text rises about this far above its baseline; the box has to hold the topmost row.
const NOTE_ASCENT = 9

function at(position: number): number {
  return LEFT + Math.min(1, Math.max(0, position)) * SPAN
}

export interface DistributionNoteLayout {
  readonly id: string
  readonly anchorX: number
  readonly textAnchor: 'start' | 'end'
  readonly row: number
  readonly from: number
  readonly to: number
}

// The crowd note reads rightward from the median rule and an outlier note reads back leftward from
// the giants — but a small median beside a near-threshold outlier puts both in the same place, so
// the notes are laid out AGAINST each other rather than assumed apart. The invariant: any two
// notes sharing a row clear each other by at least `gap`.
export function layoutDistributionNotes({
  notes,
  left = LEFT,
  span = SPAN,
  inset = NOTE_INSET,
  charWidth = NOTE_CHAR_W,
  gap = NOTE_GAP,
}: {
  readonly notes: readonly DistributionNote[]
  readonly left?: number
  readonly span?: number
  readonly inset?: number
  readonly charWidth?: number
  readonly gap?: number
}): readonly DistributionNoteLayout[] {
  const ordered = [...notes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'crowd' ? -1 : 1
    return a.position - b.position
  })

  const rows: { from: number; to: number }[][] = []
  return ordered.map((note) => {
    const x = left + Math.min(1, Math.max(0, note.position)) * span
    const width = note.text.length * charWidth
    // Reading back leftward from a giant near the axis start would start the text off the left
    // edge of the box, where it is simply not drawn. At the edge it turns around instead.
    const fromLeft = note.kind !== 'crowd' && x - inset - width < left
    const textAnchor: 'start' | 'end' = note.kind === 'crowd' || fromLeft ? 'start' : 'end'
    const anchorX = note.kind === 'crowd' ? x + inset : fromLeft ? left : x - inset
    const from = textAnchor === 'start' ? anchorX : anchorX - width
    const to = from + width

    let row = 0
    while ((rows[row] ?? []).some((placed) => from < placed.to + gap && placed.from < to + gap)) {
      row += 1
    }
    const occupants = rows[row] ?? []
    occupants.push({ from, to })
    rows[row] = occupants

    return { id: note.id, anchorX, textAnchor, row, from, to }
  })
}

function stack(dots: readonly DistributionDot[]) {
  const columns: { x: number; count: number }[] = []
  return [...dots]
    .sort((a, b) => a.position - b.position)
    .map((dot) => {
      const x = at(dot.position)
      const column = columns.find((candidate) => Math.abs(candidate.x - x) < DOT_GAP)
      if (column === undefined) {
        columns.push({ x, count: 1 })
        return { ...dot, x, cy: AXIS_Y - 10 }
      }
      column.count += 1
      return { ...dot, x: column.x, cy: AXIS_Y - 10 - (column.count - 1) * DOT_STACK }
    })
}

export function DistributionStrip({
  dots,
  ticks,
  axisMax,
  tickSuffix = '',
  medianPosition,
  medianLabel,
  notes,
  label,
}: DistributionStripProps) {
  const placed = stack(dots)
  const medianX = at(medianPosition)
  const marks = ticks.map((tick) => ({
    tick,
    x: at(axisMax === 0 ? 0 : tick / axisMax),
  }))

  // A crowd stacks upward without a ceiling, so the annotations rise above the tallest column and
  // the box grows to hold them rather than the dots painting through the median label and then out
  // of the viewBox, over whatever the page drew above this section.
  const stackTop = placed.reduce((top, dot) => Math.min(top, dot.cy - DOT_R), AXIS_Y - 10 - DOT_R)
  const lift = Math.max(0, MEDIAN_TOP - stackTop)
  const medianTop = MEDIAN_TOP - lift
  const noteTop = NOTE_TOP - lift

  const layout = layoutDistributionNotes({ notes })
  const byId = new Map(layout.map((entry) => [entry.id, entry]))
  // A note pushed onto a second or third baseline rises above the box's own headroom, so the box
  // grows for however many rows the layout used rather than clipping the topmost note away.
  const topRow = layout.reduce((top, entry) => Math.max(top, entry.row), 0)
  const headroom = Math.max(0, topRow * NOTE_ROW + NOTE_ASCENT - NOTE_TOP)
  const boxTop = lift + headroom

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 ${-boxTop} ${WIDTH} ${HEIGHT + boxTop}`}
      className="block h-auto w-full overflow-visible"
    >
      <line x1={LEFT} x2={RIGHT} y1={AXIS_Y} y2={AXIS_Y} stroke="var(--border)" strokeWidth={1} />
      {marks.map((mark) => (
        <g key={`tick-${mark.tick}`}>
          <line
            x1={mark.x}
            x2={mark.x}
            y1={AXIS_Y}
            y2={AXIS_Y + 4}
            stroke="var(--border)"
            strokeWidth={1}
          />
          <text
            x={mark.x}
            y={AXIS_Y + 17}
            textAnchor="middle"
            fontSize={10}
            fontFamily="var(--type-mono)"
            fill="var(--text-2)"
          >
            {`${mark.tick}${tickSuffix}`}
          </text>
        </g>
      ))}

      <line
        x1={medianX}
        x2={medianX}
        y1={medianTop}
        y2={AXIS_Y}
        stroke="var(--accent)"
        strokeWidth={1.6}
      />
      {/* The rule carries the accent (non-text drawing, WCAG 1.4.11); its LABEL carries `--text-1`,
          because `--accent-strong` on the page ground measures 4.44 in one preset and 11px text may
          not sit under AA. */}
      <text
        x={medianX}
        y={medianTop - 10}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        fill="var(--text-1)"
      >
        {medianLabel}
      </text>

      {placed.map((dot) =>
        // An outlier is a hollow ring, not a red dot: the fact is carried by SHAPE first, and the
        // annotation states it in words as well (WCAG 1.4.1).
        dot.outlier ? (
          <circle
            key={dot.id}
            cx={dot.x}
            cy={dot.cy}
            r={DOT_R}
            fill="var(--bg)"
            stroke="var(--status-urgent)"
            strokeWidth={1.8}
          />
        ) : (
          <circle
            key={dot.id}
            cx={dot.x}
            cy={dot.cy}
            r={DOT_R}
            fill="var(--text-2)"
            stroke="var(--bg)"
            strokeWidth={2}
          />
        ),
      )}

      {notes.map((note) => {
        const x = at(note.position)
        const crowd = note.kind === 'crowd'
        const entry = byId.get(note.id)
        if (entry === undefined) return null
        const { anchorX, textAnchor: reads, row } = entry
        // Further baselines go ABOVE the first: below would run into the median label under it.
        const y = noteTop - row * NOTE_ROW
        return (
          <g key={note.id}>
            {/* The crowd note needs no leader: the median rule under it IS one. */}
            {crowd ? null : (
              <line
                x1={x}
                x2={x}
                y1={y + 6}
                y2={AXIS_Y - 22}
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
            )}
            <text
              x={anchorX}
              y={y}
              textAnchor={reads}
              fontSize={11}
              fontFamily="var(--type-mono)"
              fill="var(--text-2)"
            >
              {note.text}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
