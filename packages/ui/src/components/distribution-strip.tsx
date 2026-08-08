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
// A second baseline for a note that would otherwise be drawn through the one beside it.
const NOTE_ROW = 14
// 11px mono, per character. The drawing cannot measure text, so the estimate is deliberately
// generous: a note that thinks itself wider than it is drops to its own baseline, which is never
// worse than two notes sharing one.
const NOTE_CHAR_W = 6.4
const NOTE_INSET = 10

function at(position: number): number {
  return LEFT + Math.min(1, Math.max(0, position)) * SPAN
}

function noteWidth(text: string): number {
  return text.length * NOTE_CHAR_W
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

  // The crowd note reads rightward from the median rule and the outlier note reads back leftward
  // from the giants — but a small median beside a near-threshold outlier puts both in the same
  // place, so the two are laid out against each other rather than assumed apart.
  const crowdNote = notes.find((note) => note.kind === 'crowd')
  const crowdSpan =
    crowdNote === undefined
      ? null
      : {
          from: at(crowdNote.position) + NOTE_INSET,
          to: at(crowdNote.position) + NOTE_INSET + noteWidth(crowdNote.text),
        }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 ${-lift} ${WIDTH} ${HEIGHT + lift}`}
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
        const width = noteWidth(note.text)
        // Reading back leftward from a giant near the axis start would start the text off the left
        // edge of the box, where it is simply not drawn. At the edge it turns around instead.
        const fromLeft = !crowd && x - NOTE_INSET - width < LEFT
        const reads = crowd || fromLeft ? 'start' : 'end'
        const anchorX = crowd ? x + NOTE_INSET : fromLeft ? LEFT : x - NOTE_INSET
        const span =
          reads === 'start'
            ? { from: anchorX, to: anchorX + width }
            : { from: anchorX - width, to: anchorX }
        const collides =
          !crowd && crowdSpan !== null && span.from < crowdSpan.to && crowdSpan.from < span.to
        // Its own baseline, ABOVE the crowd's: below would run into the median label under it.
        const y = noteTop - (collides ? NOTE_ROW : 0)
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
