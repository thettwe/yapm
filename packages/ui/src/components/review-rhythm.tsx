// REVIEW RHYTHM, drawn: small multiples, one row per merged change — where it opened, the wait
// before a first review came back, each review after that, and where it merged. Static inline SVG,
// no motion, no tooltip; every colour is a theme token.
//
// There is no reviewer here at any depth, and no prop that could carry one. A review is a moment on
// a row and nothing else: `review.author` is a provider login with no mapping to a yapm user, and
// this product's metrics are team-level by constraint rather than by restraint.

export interface RhythmRow {
  readonly id: string
  readonly spanHours: number
  readonly firstReviewHours: number | null
  readonly reviewOffsetsHours: readonly number[]
  // A change that ran past the axis states its own duration in words rather than being clipped into
  // a shorter one.
  readonly overAxis: boolean
  readonly spanLabel: string
}

export interface ReviewRhythmProps {
  readonly rows: readonly RhythmRow[]
  readonly axisMaxHours: number
  readonly columns?: number
  // Truthful and complete: how many rows were drawn, of how many, and what ONE ROW represents.
  readonly label: string
}

const WIDTH = 1120
const COLUMNS = 6
const ROW_H = 30
const FIRST_ROW_Y = 17
const BOTTOM_PAD = 12
const COLUMN_GAP = 20
const OPEN_R = 2.6
const REVIEW_R = 2.4
const MERGE_R = 4

export function ReviewRhythm({ rows, axisMaxHours, columns = COLUMNS, label }: ReviewRhythmProps) {
  const slot = WIDTH / columns
  const track = slot - COLUMN_GAP
  const rowCount = Math.max(1, Math.ceil(rows.length / columns))
  const height = FIRST_ROW_Y + (rowCount - 1) * ROW_H + BOTTOM_PAD
  const scale = (hours: number) =>
    Math.min(1, Math.max(0, axisMaxHours === 0 ? 0 : hours / axisMaxHours)) * track

  const placed = rows.map((row, index) => {
    const x0 = (index % columns) * slot + 4
    const y = FIRST_ROW_Y + Math.floor(index / columns) * ROW_H
    const merge = x0 + scale(row.spanHours)
    const first = x0 + scale(row.firstReviewHours ?? row.spanHours)
    return {
      ...row,
      x0,
      y,
      merge,
      first: Math.min(first, merge),
      reviews: row.reviewOffsetsHours.map((offset, at) => ({
        id: `${row.id}-review-${at + 1}`,
        x: Math.min(x0 + scale(offset), merge),
      })),
    }
  })

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="block h-auto w-full overflow-visible"
    >
      {placed.map((row) => (
        <g key={row.id}>
          <line
            x1={row.x0}
            x2={row.first}
            y1={row.y}
            y2={row.y}
            stroke="var(--border-strong)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <line
            x1={row.first}
            x2={row.merge}
            y1={row.y}
            y2={row.y}
            stroke="var(--status-in-review)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          {row.reviews.map((review) => (
            <circle
              key={review.id}
              cx={review.x}
              cy={row.y}
              r={REVIEW_R}
              fill="var(--status-in-review)"
              stroke="var(--bg)"
              strokeWidth={1.4}
            />
          ))}
          <circle
            cx={row.x0}
            cy={row.y}
            r={OPEN_R}
            fill="var(--bg)"
            stroke="var(--border-strong)"
            strokeWidth={1.5}
          />
          {row.overAxis ? (
            <g>
              <path
                d={`M ${row.merge + 4} ${row.y} l 8 0 m -3 -3 l 3 3 l -3 3`}
                fill="none"
                stroke="var(--status-urgent)"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <text
                x={row.merge + 14}
                y={row.y - 6}
                textAnchor="end"
                fontSize={9}
                fontFamily="var(--type-mono)"
                fill="var(--status-urgent-ink)"
              >
                {row.spanLabel}
              </text>
            </g>
          ) : (
            <circle
              cx={row.merge}
              cy={row.y}
              r={MERGE_R}
              fill="var(--status-done)"
              stroke="var(--bg)"
              strokeWidth={1.6}
            />
          )}
        </g>
      ))}
    </svg>
  )
}
