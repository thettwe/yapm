import type { ReactNode } from 'react'

// The cycle in progress, drawn: one dot per deployment that reached production, a mark where a
// retrospective closed, the today caret, and one called-out moment with its leader line. Static
// inline SVG, no motion, no tooltip; every colour is a theme token through `var()`, and every
// number arrives as a structural prop so the drawing carries no seam to the schema.
//
// Positions are fractions of the cycle's span (0 = start, 1 = end) rather than milliseconds: WHERE
// a mark falls is the page model's arithmetic, and a chart that re-derived it from timestamps would
// be a second clock.

export interface TimelineDeployMark {
  readonly id: string
  readonly position: number
}

export interface TimelineRetroMark {
  readonly id: string
  readonly position: number
  readonly title: string
  // The neutral counts either side of the date. Never a causal clause — whether a retrospective
  // changed anything is not a thing this product knows.
  readonly detail: string
}

export interface TimelineCallout {
  readonly position: number
  readonly headline: string
  readonly subline: string
}

export interface AnnotatedTimelineProps {
  readonly startLabel: string
  readonly endLabel: string
  readonly deploys: readonly TimelineDeployMark[]
  readonly retros: readonly TimelineRetroMark[]
  readonly callout: TimelineCallout | null
  readonly todayPosition: number
  readonly todayLabel: string
  readonly daysLeftLabel: string
  // Truthful and complete: the span, the population, and what one mark represents.
  readonly label: string
  // The page's ONE chip, placed over the track at `chipPosition`. A slot rather than a prop shape,
  // because the chip is a real link the page owns and this drawing must not learn about routing.
  readonly chip?: ReactNode
  readonly chipPosition?: number | null
}

const WIDTH = 1120
const BASE_HEIGHT = 178
const LEFT = 10
const RIGHT = 1110
const SPAN = RIGHT - LEFT
const TRACK_Y = 106
const TRACK_H = 10
const DOT_Y = TRACK_Y + TRACK_H / 2
const DOT_R = 4.5
const DOT_STACK = 13
// Two deployments closer than this on the drawn axis are the same column, so the second stacks
// above the first rather than hiding inside it.
const DOT_GAP = 9
const TICK_TOP = TRACK_Y + TRACK_H + 4
const TICK_BOTTOM = TICK_TOP + 4
const AXIS_LABEL_Y = 136
const CALLOUT_TOP = 42
const RETRO_ROW = 30
const CHIP_Y = 55

function at(position: number): number {
  return LEFT + Math.min(1, Math.max(0, position)) * SPAN
}

// One column per cluster of deployments, so a busy day reads as a stack of dots rather than one dot
// drawn six times.
function stack(deploys: readonly TimelineDeployMark[]) {
  const columns: { x: number; count: number }[] = []
  return [...deploys]
    .sort((a, b) => a.position - b.position)
    .map((deploy) => {
      const x = at(deploy.position)
      const column = columns.find((candidate) => Math.abs(candidate.x - x) < DOT_GAP)
      if (column === undefined) {
        columns.push({ x, count: 1 })
        return { id: deploy.id, x, cy: DOT_Y }
      }
      column.count += 1
      return { id: deploy.id, x: column.x, cy: DOT_Y - (column.count - 1) * DOT_STACK }
    })
}

export function AnnotatedTimeline({
  startLabel,
  endLabel,
  deploys,
  retros,
  callout,
  todayPosition,
  todayLabel,
  daysLeftLabel,
  label,
  chip,
  chipPosition,
}: AnnotatedTimelineProps) {
  const height = BASE_HEIGHT + Math.max(0, retros.length - 1) * RETRO_ROW
  const dots = stack(deploys)
  const todayX = at(todayPosition)
  const calloutX = callout === null ? 0 : at(callout.position)

  return (
    <div className="relative">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="block h-auto w-full overflow-visible"
      >
        <rect
          x={LEFT}
          y={TRACK_Y}
          width={SPAN}
          height={TRACK_H}
          rx={TRACK_H / 2}
          fill="var(--row-hairline)"
        />
        <rect
          x={LEFT}
          y={TRACK_Y}
          width={Math.max(0, todayX - LEFT)}
          height={TRACK_H}
          rx={TRACK_H / 2}
          fill="var(--accent-soft)"
        />

        {dots.map((dot) => (
          <line
            key={`${dot.id}-tick`}
            x1={dot.x}
            x2={dot.x}
            y1={TICK_TOP}
            y2={TICK_BOTTOM}
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}

        <text
          x={LEFT}
          y={AXIS_LABEL_Y}
          textAnchor="start"
          fontSize={10}
          fontFamily="var(--type-mono)"
          fill="var(--text-2)"
        >
          {startLabel}
        </text>
        <text
          x={RIGHT}
          y={AXIS_LABEL_Y}
          textAnchor="end"
          fontSize={10}
          fontFamily="var(--type-mono)"
          fill="var(--text-2)"
        >
          {endLabel}
        </text>

        {dots.map((dot) => (
          <circle
            key={dot.id}
            cx={dot.x}
            cy={dot.cy}
            r={DOT_R}
            fill="var(--status-done)"
            stroke="var(--bg)"
            strokeWidth={2}
          />
        ))}

        <line
          x1={todayX}
          x2={todayX}
          y1={TRACK_Y - 8}
          y2={TICK_BOTTOM}
          stroke="var(--accent)"
          strokeWidth={2}
        />
        {/* The caret carries the accent (non-text drawing, WCAG 1.4.11); its LABEL carries
            `--text-1`, because `--accent-strong` on the page ground measures 4.44 in one preset and
            10.5px text may not sit under AA. The app-frame precedent: the mock loses, not the
            reader. */}
        <text
          x={todayX}
          y={AXIS_LABEL_Y + 14}
          textAnchor="middle"
          fontSize={10.5}
          fontWeight={600}
          fill="var(--text-1)"
        >
          {todayLabel}
        </text>
        <text
          x={(todayX + RIGHT) / 2}
          y={TRACK_Y - 10}
          textAnchor="middle"
          fontSize={11}
          fill="var(--text-2)"
        >
          {daysLeftLabel}
        </text>

        {callout === null ? null : (
          <g>
            <path
              d={`M ${calloutX} ${TRACK_Y - 4} L ${calloutX} ${CALLOUT_TOP}`}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            <circle cx={calloutX} cy={TRACK_Y - 4} r={1.5} fill="var(--border-strong)" />
            <text
              x={calloutX - 6}
              y={CALLOUT_TOP - 16}
              textAnchor="end"
              fontSize={12}
              fontWeight={600}
              fill="var(--text-1)"
            >
              {callout.headline}
            </text>
            <text
              x={calloutX - 6}
              y={CALLOUT_TOP - 2}
              textAnchor="end"
              fontSize={10}
              fontFamily="var(--type-mono)"
              fill="var(--text-2)"
            >
              {callout.subline}
            </text>
          </g>
        )}

        {retros.map((retro, index) => {
          const x = at(retro.position)
          const base = AXIS_LABEL_Y + 18 + index * RETRO_ROW
          return (
            <g key={retro.id}>
              <path
                d={`M ${x} ${TICK_TOP} L ${x} ${base}`}
                fill="none"
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
              <text x={x + 8} y={base + 10} fontSize={12} fontWeight={600} fill="var(--text-1)">
                {retro.title}
              </text>
              <text
                x={x + 8}
                y={base + 25}
                fontSize={10}
                fontFamily="var(--type-mono)"
                fill="var(--text-2)"
              >
                {retro.detail}
              </text>
            </g>
          )
        })}
      </svg>
      {chip === undefined || chipPosition == null ? null : (
        <span
          data-slot="timeline-chip"
          style={{
            left: `${Math.min(1, Math.max(0, chipPosition)) * 100}%`,
            top: `${(CHIP_Y / height) * 100}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2"
        >
          {chip}
        </span>
      )}
    </div>
  )
}
