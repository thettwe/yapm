import { cn } from '@yapm/ui/lib/utils'
import type { SVGProps } from 'react'

const PRIORITY = {
  'no-priority': 'No priority',
  low: 'Low priority',
  medium: 'Medium priority',
  high: 'High priority',
  urgent: 'Urgent',
} as const

export type PriorityKind = keyof typeof PRIORITY

// Priority is WEIGHT, drawn as ticks on the northstar's 14-grid with 1.6px round caps: the ticks
// the work does not carry stay in place at .35 opacity, so weight reads as height against a fixed
// row rather than as a count of shapes. One tick standing alone, with a dot beneath it, is urgent.
const STROKE = 1.6
const QUIET = 0.35

// Each level's lit ticks, in the mock's own geometry (`p-1` / `p-2` / `p-3`).
const LIT: Record<Exclude<PriorityKind, 'urgent'>, string> = {
  'no-priority': '',
  low: 'M4 9.6 V6.8',
  medium: 'M4 9.6 V6.8 M7 9.6 V4.4',
  high: 'M4 9.6 V6.8 M7 9.6 V4.4 M10 9.6 V2.4',
}

const QUIET_TICKS = 'M4 9.6 V6.8 M7 9.6 V4.4 M10 9.6 V2.4'

function PriorityMark({
  priority,
  className,
  ...props
}: { priority: PriorityKind } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  const label = PRIORITY[priority]
  const lit = priority === 'urgent' ? '' : LIT[priority]
  return (
    <svg
      viewBox="0 0 14 14"
      role="img"
      aria-label={label}
      className={cn(
        'size-3.5 shrink-0',
        priority === 'urgent' ? 'text-status-urgent' : 'text-text-2',
        className,
      )}
      {...props}
    >
      <title>{label}</title>
      {priority === 'urgent' ? (
        <>
          <path d="M7 2.6 V8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <circle cx="7" cy="11.2" r="1.1" fill="currentColor" />
        </>
      ) : (
        <>
          <path
            d={QUIET_TICKS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeOpacity={QUIET}
          />
          {lit === '' ? null : (
            <path
              d={lit}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE}
              strokeLinecap="round"
            />
          )}
        </>
      )}
    </svg>
  )
}

export { PRIORITY, PriorityMark }
