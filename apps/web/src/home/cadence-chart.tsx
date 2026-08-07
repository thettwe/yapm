import type { TeamHomeCadence } from '@yapm/schema'

// §D7's ship-cadence drawing: one dot per real release (deployments carry `deployedAt` only when
// they succeeded), stacked per UTC week, with a dashed tick at each closed retro and the today
// caret at the right edge. Static SVG, no motion; every color is a theme token via `var()`.

const SLOT = 52
const HEIGHT = 84
const BASE = HEIGHT - 8
const DOT_R = 3.6
const DOT_STACK = 11
const DOT_CAP = 6

export function CadenceChart({ cadence }: { cadence: TeamHomeCadence }) {
  const width = cadence.weeks.length * SLOT
  const weeks = cadence.weeks.map((week, index) => ({
    ...week,
    id: `week-${week.startMs}`,
    centerX: index * SLOT + SLOT / 2,
    dots: Array.from({ length: Math.min(week.deploys, DOT_CAP) }, (_, dot) => ({
      id: `week-${week.startMs}-dot-${dot + 1}`,
      cy: BASE - 5 - dot * DOT_STACK,
    })),
  }))
  const totalDeploys = cadence.weeks.reduce((sum, week) => sum + week.deploys, 0)
  const caretX = width - 6

  return (
    <div>
      <svg
        role="img"
        aria-label={`${totalDeploys} deployments over the last ${cadence.weeks.length} weeks`}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
      >
        <line x1={0} x2={width} y1={BASE} y2={BASE} stroke="var(--row-hairline)" strokeWidth={1} />
        {weeks
          .filter((week) => week.retro)
          .map((week) => (
            <g key={`${week.id}-retro`}>
              <line
                x1={week.centerX}
                x2={week.centerX}
                y1={14}
                y2={BASE}
                stroke="var(--border-strong)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <text
                x={week.centerX - 6}
                y={11}
                textAnchor="end"
                fill="var(--text-3)"
                fontFamily="var(--type-mono)"
                fontSize={10}
              >
                retro
              </text>
            </g>
          ))}
        <path
          d={`M${caretX - 4} ${HEIGHT} L${caretX} ${HEIGHT - 6} L${caretX + 4} ${HEIGHT}`}
          fill="var(--accent)"
        />
        {weeks.flatMap((week) =>
          week.dots.map((dot) => (
            <circle
              key={dot.id}
              cx={week.centerX}
              cy={dot.cy}
              r={DOT_R}
              fill="var(--status-done)"
            />
          )),
        )}
      </svg>
      <div aria-hidden="true" className="mt-[2px] flex font-mono text-[10.5px] text-text-3">
        {weeks.map((week) => (
          <span key={`${week.id}-month`} style={{ width: `${SLOT}px` }} className="inline-block">
            {week.monthLabel}
          </span>
        ))}
      </div>
    </div>
  )
}
