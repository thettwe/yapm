// CYCLE FLOW, drawn: one bar per completed cycle, a ribbon for the work the rollover carried into
// the next one, and a cap for the work added after a cycle had started. Static inline SVG, no
// motion, no tooltip; every colour is a theme token.
//
// The bars are COUNTS, not fractions, so one unit of height means the same thing in every bar and
// in every ribbon — which is the only way a ribbon between two bars can be read against them.

export interface FlowBar {
  readonly id: string
  readonly label: string
  readonly shipped: number
  readonly added: number
  readonly addedLabel: string | null
}

export interface FlowCarry {
  readonly id: string
  readonly fromIndex: number
  readonly toIndex: number
  readonly count: number
  readonly label: string
}

export interface FlowBandProps {
  readonly bars: readonly FlowBar[]
  readonly carries: readonly FlowCarry[]
  // Truthful and complete: the cycles, their counts and what a bar, a ribbon and a cap each mean.
  readonly label: string
}

const WIDTH = 1120
const HEIGHT = 260
const LEFT = 60
const RIGHT = 1060
const BASELINE = 214
const TOP = 40
const BAR_W = 24
// The mock's unit. A short window would otherwise draw one item as a bar the height of the section,
// which reads as a quantity it is not.
const MAX_UNIT = 13
const LABEL_Y = 232
const COUNT_Y = 248

export function FlowBand({ bars, carries, label }: FlowBandProps) {
  const slot = bars.length === 0 ? RIGHT - LEFT : (RIGHT - LEFT) / bars.length
  const centerOf = (index: number) => LEFT + slot * index + slot / 2

  const tallest = bars.reduce((max, bar) => Math.max(max, bar.shipped + bar.added), 0)
  const widest = carries.reduce((max, carry) => Math.max(max, carry.count), 0)
  const unit = Math.min(MAX_UNIT, (BASELINE - TOP) / Math.max(1, Math.max(tallest, widest)))

  const drawn = bars.map((bar, index) => {
    const center = centerOf(index)
    const shippedH = bar.shipped * unit
    const addedH = bar.added * unit
    return {
      ...bar,
      center,
      x: center - BAR_W / 2,
      shippedH,
      addedH,
      shippedY: BASELINE - shippedH,
      addedY: BASELINE - shippedH - addedH,
      topY: BASELINE - shippedH - addedH,
    }
  })

  const ribbons = carries.flatMap((carry) => {
    const from = drawn[carry.fromIndex]
    const to = drawn[carry.toIndex]
    if (from === undefined || to === undefined) return []
    const thickness = carry.count * unit
    const x0 = from.x + BAR_W
    const x1 = to.x
    const mid = (x0 + x1) / 2
    const topFrom = from.topY
    const topTo = BASELINE - thickness
    return [
      {
        id: carry.id,
        label: carry.label,
        labelX: mid,
        labelY: (topFrom + topTo) / 2 + thickness / 2,
        d: [
          `M ${x0} ${topFrom}`,
          `C ${mid} ${topFrom} ${mid} ${topTo} ${x1} ${topTo}`,
          `L ${x1} ${BASELINE}`,
          `C ${mid} ${BASELINE} ${mid} ${topFrom + thickness} ${x0} ${topFrom + thickness}`,
          'Z',
        ].join(' '),
      },
    ]
  })

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="block h-auto w-full overflow-visible"
    >
      {ribbons.map((ribbon) => (
        <g key={ribbon.id}>
          <path
            d={ribbon.d}
            fill="var(--status-in-progress)"
            fillOpacity={0.15}
            stroke="var(--status-in-progress)"
            strokeOpacity={0.4}
            strokeWidth={1}
          />
          {/* The count is drawn on the ribbon it belongs to, with the page ground painted behind
              the glyphs so it reads over the wash rather than needing a second ink. */}
          <text
            x={ribbon.labelX}
            y={ribbon.labelY}
            textAnchor="middle"
            fontSize={10.5}
            fontWeight={600}
            fontFamily="var(--type-mono)"
            paintOrder="stroke"
            stroke="var(--bg)"
            strokeWidth={4}
            fill="var(--text-1)"
          >
            {ribbon.label}
          </text>
        </g>
      ))}

      {drawn.map((bar) => (
        <g key={bar.id}>
          <rect
            x={bar.x}
            y={bar.shippedY}
            width={BAR_W}
            height={bar.shippedH}
            rx={2}
            fill="var(--status-done)"
          />
          {bar.added === 0 ? null : (
            <rect
              x={bar.x}
              y={bar.addedY}
              width={BAR_W}
              height={bar.addedH}
              rx={2}
              fill="var(--status-in-progress)"
            />
          )}
          {bar.addedLabel === null ? null : (
            <text
              x={bar.center}
              y={bar.topY - 10}
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--type-mono)"
              fill="var(--text-2)"
            >
              {bar.addedLabel}
            </text>
          )}
          <text x={bar.center} y={LABEL_Y} textAnchor="middle" fontSize={11} fill="var(--text-2)">
            {bar.label}
          </text>
          <text
            x={bar.center}
            y={COUNT_Y}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fontFamily="var(--type-mono)"
            fill="var(--text-1)"
          >
            {bar.shipped}
          </text>
        </g>
      ))}

      <line
        x1={LEFT - 8}
        x2={RIGHT + 8}
        y1={BASELINE + 0.5}
        y2={BASELINE + 0.5}
        stroke="var(--border)"
        strokeWidth={1}
      />
    </svg>
  )
}
